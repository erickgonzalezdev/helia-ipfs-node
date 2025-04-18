import { assert } from 'chai'
import sinon from 'sinon'
import { describe, it } from 'mocha'

import PFTProtocol from '../../src/helia/pft-protocol.js'
import HeliaNode from '../../src/helia/node.js'
import createLibp2pMock from '../mocks/libp2p-mock.js'
import createHeliaMock from '../mocks/helia-mock.js'
import StreamMock from '../mocks/stream-mock.js'
describe('#PFTProtocol', () => {
  let uut
  let sandbox
  let testLog = () => { }

  before(async () => {
    // Restore the sandbox before each test.
    if (process.env.log) {
      testLog = console.log
    }
    const node = new HeliaNode({ log: testLog })
    node.publicIp = async () => { return '192.168.1.1' }
    node.createHelia = createHeliaMock
    node.createLibp2p = createLibp2pMock
    await node.start()

    uut = new PFTProtocol({ node })

    uut.CID = { parse: () => { return 'test' } }
    uut.pipe = () => { return true }
    uut.multiaddr = () => { return 'testaddress' }
  })

  beforeEach(async () => {
    uut.privateAddresssStore = []
    uut.blackListAddresssStore = []
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  after(async () => {
  })
  describe('#constructor', () => {
    it('should throw error if node is not provided', async () => {
      try {
        const unit = new PFTProtocol({})
        this.log(unit)
      } catch (err) {
        assert.include(err.message, 'Helia-IPFS-Node must be passed on PFTProtocol constructor')
      }
    })
  })
  describe('#start', () => {
    it('should start pft protocol', async () => {
      uut.notificationTimer = 100
      uut.logTimerInterval = 100
      uut.blackListCleanupTimer = 100
      const clock = sandbox.useFakeTimers()
      await uut.start()
      clock.tick(100)
      clock.restore()
    })
  })

  describe('#handlePFTProtocol', () => {
    it('should handle pft protocol', async () => {
      try {
        sandbox.stub(uut.node.helia.blockstore, 'has').resolves(true)
        const result = await uut.handlePFTProtocol({ stream: new StreamMock() })
        assert.isTrue(result)
      } catch (error) {
        // console.log(error)
        assert.fail('Unexpected code path')
      }
    })
    it('should return false if cid is not found', async () => {
      try {
        sandbox.stub(uut.node.helia.blockstore, 'has').resolves(false)
        const result = await uut.handlePFTProtocol({ stream: new StreamMock() })
        assert.isFalse(result)
      } catch (error) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return false on error', async () => {
      try {
        sandbox.stub(uut.node.helia.blockstore, 'has').throws(new Error('test error'))
        const result = await uut.handlePFTProtocol({ stream: new StreamMock() })
        assert.isFalse(result)
      } catch (error) {
        assert.fail('Unexpected code path')
      }
    })
  })
  describe('#downloadCid', () => {
    it('should download cid', async () => {
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(false)
      uut.privateAddresssStore = ['testaddress']
      sandbox.stub(uut, 'fetchCidFromPeer').resolves(true)
      const result = await uut.downloadCid('testcid')
      assert.isTrue(result)
    })
    it('should download cid locally', async () => {
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(true)
      uut.privateAddresssStore = ['testaddress']
      sandbox.stub(uut, 'fetchCidFromPeer').resolves(true)
      const result = await uut.downloadCid('testcid')
      assert.isTrue(result)
    })
    it('should return false if no private addresss store', async () => {
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(false)
      uut.privateAddresssStore = []
      const result = await uut.downloadCid('testcid')
      assert.isFalse(result)
    })
    it('should return false if cid is not found', async () => {
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(false)
      uut.privateAddresssStore = ['testaddress']
      sandbox.stub(uut, 'fetchCidFromPeer').resolves(false)
      const result = await uut.downloadCid('testcid')
      assert.isFalse(result)
    })
  })
  describe('#fetchCidFromPeer', () => {
    it('should fetch cid from peer', async () => {
      const testCid = 'test cid'

      // Stream mock iterable
      const streamMock = new StreamMock()
      const mockIterable = {
        [Symbol.asyncIterator]: async function * () {
          yield new TextEncoder().encode(new Uint8Array(testCid))
          yield new TextEncoder().encode(new Uint8Array(testCid))
        }
      }
      streamMock.source = mockIterable

      sandbox.stub(uut.node.helia.libp2p, 'dialProtocol').resolves(streamMock)
      const address = '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH'
      const result = await uut.fetchCidFromPeer('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', address)
      assert.isTrue(result)
    })
    it('should freturn false if cid does not match', async () => {
      const testCid = 'test cid'

      // Stream mock iterable
      const streamMock = new StreamMock()
      const mockIterable = {
        [Symbol.asyncIterator]: async function * () {
          yield new TextEncoder().encode(new Uint8Array(testCid))
          yield new TextEncoder().encode(new Uint8Array(testCid))
        }
      }
      streamMock.source = mockIterable

      sandbox.stub(uut.node.helia.libp2p, 'dialProtocol').resolves(streamMock)
      const address = '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH'
      const result = await uut.fetchCidFromPeer('known cid', address)
      assert.isFalse(result)
    })
    it('should return false if cid is not found', async () => {
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(false)
      const address = '/127.0.0.1:8080/p2p/QmHash'
      const result = await uut.fetchCidFromPeer('testcid', address)
      assert.isFalse(result)
    })
  })

  describe('#handlePubsubMsg', () => {
    it('should handle pubsub msg', async () => {
      uut.topic = 'testtopic'
      const msg = {
        detail: {
          topic: 'testtopic',
          data: new TextEncoder().encode(JSON.stringify({
            multiAddress: 'testaddress',
            knownPeers: ['testaddress2']
          }))
        }
      }
      const result = await uut.handlePubsubMsg(msg)
      assert.isTrue(result)
      assert.equal(uut.privateAddresssStore.length, 2)
    })
    it('should return false if topic does not match', async () => {
      uut.topic = 'testtopic'
      const result = await uut.handlePubsubMsg({ topic: 'testtopic2', data: 'testdata' })
      assert.isFalse(result)
    })
    it('should handle error', async () => {
      try {
        uut.topic = 'testtopic'
        const msg = {
          detail: {
            topic: 'testtopic',
            data: new TextEncoder().encode(JSON.stringify({
              multiAddress: 'testaddress',
              knownPeers: ['testaddress2']
            }))
          }
        }
        sandbox.stub(uut, 'addKnownPeer').throws(new Error('test error'))
        await uut.handlePubsubMsg(msg)
        assert.fail('Unexpected code path')
      } catch (error) {
        assert.include(error.message, 'test error')
      }
    })
  })

  describe('#addKnownPeer', () => {
    it('should add known peer', async () => {
      const result = await uut.addKnownPeer('testaddress')
      assert.isTrue(result)
    })
    it('should ignore node peer address', async () => {
      uut.node.addresses = ['testaddress']
      const result = await uut.addKnownPeer('testaddress')
      assert.isFalse(result)
    })
    it('should ignore black list address', async () => {
      uut.blackListAddresssStore = ['testaddress2']
      const result = await uut.addKnownPeer('testaddress2')
      assert.isFalse(result)
    })
    it('should ignore already known address', async () => {
      uut.privateAddresssStore = ['known address']
      const result = await uut.addKnownPeer('known address')
      assert.isTrue(result)
    })
    it('should add known peer', async () => {
      const result = await uut.addKnownPeer('test new address')
      assert.isTrue(result)
    })
    it('should return false on error', async () => {
      const result = await uut.addKnownPeer()
      assert.isFalse(result)
    })
  })
  describe('#getKnownPeers', () => {
    it('should get known peers', async () => {
      uut.privateAddresssStore = ['testaddress', 'testaddress2']
      const result = await uut.getKnownPeers()
      assert.equal(result.length, 2)
      assert.equal(result[0], 'testaddress')
      assert.equal(result[1], 'testaddress2')
    })
  })
  describe('#removeKnownPeer', () => {
    it('should remove known peer', async () => {
      uut.privateAddresssStore = ['testaddress', 'testaddress2']
      const result = await uut.removeKnownPeer('testaddress')
      assert.isTrue(result)
      assert.equal(uut.privateAddresssStore.length, 1)
      assert.equal(uut.privateAddresssStore[0], 'testaddress2')
    })
    it('should return false if peer is not found', async () => {
      const result = await uut.removeKnownPeer('testaddress')
      assert.isFalse(result)
    })
    it('should return false if address to remove is the same that the known peer address', async () => {
      uut.knownPeerAddress = 'testaddress'
      const result = await uut.removeKnownPeer('testaddress')
      assert.isFalse(result)
    })
    it('should return false on error', async () => {
      const result = await uut.removeKnownPeer()
      assert.isFalse(result)
    })
  })
  describe('#renewConnections', () => {
    it('should renew connections', async () => {
      uut.privateAddresssStore = ['testaddress']
      sandbox.stub(uut.node, 'connect').resolves(true)
      const result = await uut.renewConnections()
      assert.isTrue(result)
    })
    it('should return false on error', async () => {
      uut.privateAddresssStore = null
      const result = await uut.renewConnections()
      assert.isFalse(result)
    })
    it('should return skip if cannot connect to peer', async () => {
      uut.privateAddresssStore = ['testaddress']
      sandbox.stub(uut.node, 'connect').throws(new Error('test error'))
      const result = await uut.renewConnections()
      assert.isTrue(result)
    })
  })
  describe('#listenPubsub', () => {
    it('should listen pubsub', async () => {
      sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'addEventListener').resolves(true)
      const result = await uut.listenPubsub()
      assert.isTrue(result)
    })
    it('should handle error', async () => {
      try {
        uut.topic = 'testtopic'
        sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'addEventListener').throws(new Error('test error'))
        await uut.listenPubsub()
        assert.fail('Unexpected code path')
      } catch (error) {
        assert.include(error.message, 'test error')
      }
    })
  })
})
