/*
  Unit tests for pinRPC.js
*/

import { assert } from 'chai'
import sinon from 'sinon'
import { describe, it } from 'mocha'

import PinRPC from '../../src/helia/pinRPC.js'
import HeliaNode from '../../src/helia/node.js'
import createLibp2pMock from '../mocks/libp2p-mock.js'
import createHeliaMock from '../mocks/helia-mock.js'
import PQueueMock from '../mocks/p-queue-mock.js'

describe('#pinRPC.js', () => {
  let sandbox
  // let mockData
  let uut
  let clock // fake timer
  let testLog = () => { }

  before(async () => {
    clock = sinon.useFakeTimers()

    // Restore the sandbox before each test.
    if (process.env.log) {
      testLog = console.log
    }
    sandbox = sinon.createSandbox()

    const node = new HeliaNode({ log: testLog })
    node.publicIp = async () => { return '192.168.1.1' }
    node.createHelia = createHeliaMock
    node.createLibp2p = createLibp2pMock
    await node.start()

    uut = new PinRPC({ node, topic: 'test topic' })
    uut.pinQueue = new PQueueMock()
  })

  afterEach(() => {
    sandbox.restore()
    clock.restore()
  })

  describe('#contructor', () => {
    it('should throw error if node is not provided', async () => {
      try {
        const unit = new PinRPC({ topic: 'test topic' })
        this.log(unit)
      } catch (err) {
        assert.include(err.message, 'Helia-IPFS-Node must be passed on pinRPC constructor')
      }
    })

    it('should handle error if node pubsub is not provided', async () => {
      try {
        const node = new HeliaNode({ log: testLog })
        node.createHelia = createHeliaMock
        node.createLibp2p = createLibp2pMock
        node.publicIp = async () => { return '192.168.1.1' }
        await node.start()

        node.helia.libp2p.services = null

        const unit = new PinRPC({ node, topic: 'test topic' })
        this.log(unit)
      } catch (err) {
        assert.include(err.message, 'Service pubsub not found! on pinRPC constructor.')
      }
    })

    it('should handle error if topic property not provided', async () => {
      try {
        const node = new HeliaNode({ log: testLog })
        node.createHelia = createHeliaMock
        node.createLibp2p = createLibp2pMock
        node.publicIp = async () => { return '192.168.1.1' }
        await node.start()

        const unit = new PinRPC({ node })
        this.log(unit)
      } catch (err) {
        assert.include(err.message, 'topic property must be passed on pinRPC constructor!')
      }
    })
  })

  describe('#start', () => {
    it('should start pinRPC', async () => {
      try {
        await uut.start()
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should start pinRPC notification', async () => {
      try {
        uut.notificationTimer = 100
        const clock = sandbox.useFakeTimers()
        await uut.start()
        clock.tick(100)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })

    it('should handle error', async () => {
      try {
        sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'subscribe').throws(new Error('Test Error'))
        await uut.start()
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
  })

  describe('#requestRemotePin', () => {
    it('should request remote pin', async () => {
      try {
        const inObj = {
          toPeerId: 'peerId',
          fromPeerId: 'peerId',
          cid: 'content id'
        }

        const result = uut.requestRemotePin(inObj)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })

    it('should throw error if cid is not provided', async () => {
      try {
        const inObj = {
          toPeerId: 'peerId',
          fromPeerId: 'peerId'
        }
        await uut.requestRemotePin(inObj)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'cid string is required')
      }
    })
    it('should throw error if toPeerId is not provided', async () => {
      try {
        const inObj = {
          fromPeerId: 'peerId',
          cid: 'content id'
        }
        await uut.requestRemotePin(inObj)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'toPeerId string is required')
      }
    })
    it('should throw error if fromPeerId is not provided', async () => {
      try {
        const inObj = {
          toPeerId: 'peerId',
          cid: 'content id'
        }
        await uut.requestRemotePin(inObj)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'fromPeerId string is required')
      }
    })
  })

  describe('#listen', () => {
    it('should subscribe to the event listener', async () => {
      try {
        uut.listen()
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle error', async () => {
      try {
        sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'addEventListener').throws(new Error('Test Error'))
        uut.listen()
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
  })
  describe('#addToQueue', () => {
    it('should add pin to queue', async () => {
      try {
        const inObj = {
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const result = uut.addToQueue(inObj)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return true if cid already exist on queue', async () => {
      try {
        const inObj = {
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        uut.onQueue.push(inObj.cid)

        const result = uut.addToQueue(inObj)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle Error', async () => {
      try {
        sandbox.stub(uut.pinQueue, 'add').throws(new Error('Test Error'))

        const inObj = {
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk71'
        }
        uut.addToQueue(inObj)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
  })
  describe('#deleteFromQueueArray', () => {
    it('should delete cid from queue array', async () => {
      try {
        const cid = 'contentId1234'
        uut.onQueue.push(cid)
        const result = uut.deleteFromQueueArray(cid)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle Error', async () => {
      try {
        uut.deleteFromQueueArray()
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'cid string is required')
      }
    })
  })

  describe('#handlePin', () => {
    it('should handle Pin', async () => {
      try {
        sandbox.stub(uut.node, 'pinCid').resolves(true)

        const inObj = {
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const result = await uut.handlePin(inObj)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should  skip "already pin" error', async () => {
      try {
        sandbox.stub(uut.node, 'pinCid').throws(new Error('already pinned'))

        const inObj = {
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const result = await uut.handlePin(inObj)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should throw error if cid is not provided', async () => {
      try {
        const inObj = {
          fromPeerId: 'peerId'
        }
        await uut.handlePin(inObj)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'cid string is required')
      }
    })

    it('should throw error if fromPeerId is not provided', async () => {
      try {
        const inObj = {
          cid: 'content id'
        }
        await uut.handlePin(inObj)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'fromPeerId string is required')
      }
    })
  })

  describe('#parsePinMsgProtocol', () => {
    it('should handle pass validation if toPeerId string match with node peer id', async () => {
      try {
        uut.node.peerId = 'node peer id'
        const msgData = {
          msgType: 'remote-pin',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle pass validation if toPeerId array match with node peer id', async () => {
      try {
        uut.node.peerId = 'node peer id'
        const msgData = {
          msgType: 'remote-pin',
          toPeerId: [uut.node.peerId],
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle "remote-pin" action', async () => {
      try {
        uut.node.peerId = 'node peer id'
        const msgData = {
          msgType: 'remote-pin',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle action "success-pin" action', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'success-pin',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'content id'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle invalid message type', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'unknow',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'content id'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'invalid protocol')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle error', async () => {
      try {
        await uut.parsePinMsgProtocol()
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Cannot read properties of undefined')
      }
    })

    it('should return if topic does not match', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'success-pin',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'content id'
        }
        const message = {
          detail: {
            topic: 'unknow topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'invalid topic')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return if destination peerId does not match with the string', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'success-pin',
          toPeerId: 'unknow peerId',
          fromPeerId: 'peerId',
          cid: 'content id'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'destination peerId does not match')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return if destination peerId does not match with the array', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'success-pin',
          toPeerId: ['unknow peerId'],
          fromPeerId: 'peerId',
          cid: 'content id'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parsePinMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'destination peerId does not match')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle pin Error', async () => {
      try {
        sandbox.stub(uut, 'addToQueue').throws(new Error('Test Error'))

        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'remote-pin',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        await uut.parsePinMsgProtocol(message)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
  })

  describe('#parseStateMsgProtocol', () => {
    it('should handle "notify-subscription" action', async () => {
      try {
        uut.node.peerId = 'node peer id'
        const msgData = {
          msgType: 'notify-subscription',
          peerId: uut.node.peerId,
          multiAddress: [],
          timeStamp: new Date().getTime()
        }
        const message = {
          detail: {
            topic: uut.stateTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseStateMsgProtocol(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle invalid message type', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'unknow'

        }
        const message = {
          detail: {
            topic: uut.stateTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseStateMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'invalid protocol')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle error', async () => {
      try {
        await uut.parseStateMsgProtocol()
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Cannot read properties of undefined')
      }
    })

    it('should return if topic does not match', async () => {
      try {
        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'notify-subscription'
        }
        const message = {
          detail: {
            topic: 'unknow topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseStateMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'invalid topic')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
  })

  describe('#handlePubsubMsg', () => {
    it('should handle pin topic', async () => {
      try {
        sandbox.stub(uut, 'parsePinMsgProtocol').returns(true)
        const msgData = {}
        const message = {
          detail: {
            topic: uut.pinTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.handlePubsubMsg(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle state topic', async () => {
      try {
        sandbox.stub(uut, 'parseStateMsgProtocol').returns(true)
        const msgData = {}
        const message = {
          detail: {
            topic: uut.stateTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.handlePubsubMsg(message)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle invalid topic', async () => {
      try {
        const msgData = {}
        const message = {
          detail: {
            topic: 'unknow',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.handlePubsubMsg(message)
        assert.isFalse(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should handle error', async () => {
      try {
        sandbox.stub(uut, 'parseStateMsgProtocol').throws(new Error('test error'))
        const msgData = {}
        const message = {
          detail: {
            topic: uut.stateTopic,
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        await uut.handlePubsubMsg(message)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
    it('should handle invalid message', async () => {
      try {
        const message = {}
        const result = await uut.handlePubsubMsg(message)
        assert.isFalse(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
  })

  describe('#updateSubscriptionList', () => {
    it('should update subscruption list', async () => {
      try {
        uut.subscriptionList = []
        const msgData = {
          peerId: 'myId',
          multiAddress: [],
          timeStamp: new Date().getTime()
        }

        const result = await uut.updateSubscriptionList(msgData)
        assert.isTrue(result)
        assert.equal(uut.subscriptionList.length, 1)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return false if peerId already exist', async () => {
      try {
        uut.subscriptionList = [{ peerId: 'myId' }]
        const msgData = {
          peerId: 'myId',
          multiAddress: [],
          timeStamp: new Date().getTime()
        }

        const result = await uut.updateSubscriptionList(msgData)
        assert.isFalse(result)
        assert.equal(uut.subscriptionList.length, 1)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle error if peerId is missing', async () => {
      try {
        const msgData = {
          multiAddress: [],
          timeStamp: new Date().getTime()
        }

        await uut.updateSubscriptionList(msgData)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'peerId is required')
      }
    })
    it('should handle error if multiAddress is missing', async () => {
      try {
        const msgData = {
          peerId: 'myId',
          timeStamp: new Date().getTime()
        }

        await uut.updateSubscriptionList(msgData)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'multiAddress must be an array of addresses')
      }
    })
    it('should handle error if multiAddress is not an array', async () => {
      try {
        const msgData = {
          peerId: 'myId',
          multiAddress: 'address',
          timeStamp: new Date().getTime()
        }

        await uut.updateSubscriptionList(msgData)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'multiAddress must be an array of addresses')
      }
    })
  })
  describe('#getSubscriptionList', () => {
    it('should subscription list', async () => {
      try {
        const result = uut.getSubscriptionList()
        assert.isArray(result)
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
  })
})
