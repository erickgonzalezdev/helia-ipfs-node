/*
  Unit tests for pinRPC.js
*/

import { assert } from 'chai'
import sinon from 'sinon'
import { describe, it } from 'mocha'

import PinRPC from '../../src/helia/pinRPC.js'
import HeliaNode from '../../src/helia/index.js'
import createLibp2pMock from '../mocks/libp2p-mock.js'
import createHeliaMock from '../mocks/helia-mock.js'

describe('#pinRPC.js', () => {
  let sandbox
  // let mockData
  let uut
  let testLog = () => { }


  before(async () => {
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


  })

  afterEach(() => sandbox.restore())

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
        const node = new HeliaNode({ log : testLog })
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
        const node = new HeliaNode({  log : testLog })
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

  describe('#parseMsgProtocol', () => {
    it('should handle action "remote-pin" action', async () => {
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
            topic: 'test topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseMsgProtocol(message)
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
            topic: 'test topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseMsgProtocol(message)
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
            topic: 'test topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'invalid protocol')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle error', async () => {
      try {
        await uut.parseMsgProtocol()
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
        const result = await uut.parseMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'invalid topic')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return if destination peerId does not match', async () => {
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
            topic: 'test topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        const result = await uut.parseMsgProtocol(message)
        assert.isString(result)
        assert.include(result, 'destination peerId does not match')
      } catch (err) {
        assert.fail('Unexpected code path')
      }
    })

    it('should handle pin Error', async () => {
      try {
        sandbox.stub(uut.node, 'pinCid').throws(new Error('Test Error'))

        uut.node.peerId = 'node peer id 2'
        const msgData = {
          msgType: 'remote-pin',
          toPeerId: uut.node.peerId,
          fromPeerId: 'peerId',
          cid: 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        }
        const message = {
          detail: {
            topic: 'test topic',
            data: new TextEncoder().encode(JSON.stringify(msgData))
          }
        }
        await uut.parseMsgProtocol(message)
        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
  })
})
