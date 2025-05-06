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
        sandbox.stub(uut.node, 'getStat').resolves({ fileSize: 100 })
        const streamMock = new StreamMock()
        streamMock.source = {
          [Symbol.asyncIterator]: async function * () {
            yield { bufs: [new TextEncoder().encode(new Uint8Array('bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m'))] }
          }
        }
        const result = await uut.handlePFTProtocol({ stream: streamMock })
        assert.isTrue(result)
      } catch (error) {
        console.log(error)
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
          yield { bufs: [new TextEncoder().encode(JSON.stringify({ fileSize: 100 }))] }
          yield { bufs: [new TextEncoder().encode(new Uint8Array(testCid))] }
        }
      }
      streamMock.source = mockIterable

      sandbox.stub(uut.node.helia.libp2p, 'dialProtocol').resolves(streamMock)
      sandbox.stub(uut, 'downloadFromGateway').resolves(true)
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(true)

      const address = '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH'
      const result = await uut.fetchCidFromPeer('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', address)
      assert.isTrue(result)
    })

    it('should return false if cid is not found', async () => {
      const testCid = 'test cid'

      // Stream mock iterable
      const streamMock = new StreamMock()
      const mockIterable = {
        [Symbol.asyncIterator]: async function * () {
          yield { bufs: [new TextEncoder().encode(JSON.stringify({ error: 'CID_NOT_FOUND' }))] }
          yield { bufs: [new TextEncoder().encode(new Uint8Array(testCid))] }
        }
      }
      streamMock.source = mockIterable

      sandbox.stub(uut.node.helia.libp2p, 'dialProtocol').resolves(streamMock)
      sandbox.stub(uut, 'downloadFromGateway').resolves(true)
      sandbox.stub(uut.node.helia.blockstore, 'has').resolves(false)

      const address = '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH'
      const result = await uut.fetchCidFromPeer('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', address)
      assert.isFalse(result)
    })
  })

  describe('#handlePubsubMsg', () => {
    it('should handle pubsub msg', async () => {
      sandbox.stub(uut, 'addKnownPeer').resolves(true)
      uut.topic = 'testtopic'
      const msg = {
        detail: {
          topic: 'testtopic',
          data: new TextEncoder().encode(JSON.stringify({
            multiAddress: 'testaddress',
            knownPeers: ['testaddress2'],
            msgType: 'known-peers',
            gateway: 'testgateway'
          }))
        }
      }
      const result = await uut.handlePubsubMsg(msg)
      assert.isTrue(result)
    })
    it('should return false if topic does not match', async () => {
      uut.topic = 'testtopic'
      const msg = {
        detail: {
          topic: 'unknown-topic',
          data: new TextEncoder().encode(JSON.stringify({
            multiAddress: 'testaddress',
            knownPeers: ['testaddress2'],
            msgType: 'known-peers',
            gateway: 'testgateway'
          }))
        }
      }
      const result = await uut.handlePubsubMsg(msg)
      assert.isFalse(result)
    })
    it('should return false on error', async () => {
      try {
        uut.topic = 'testtopic'
        const msg = {
          detail: {
            topic: 'testtopic',
            data: new TextEncoder().encode(JSON.stringify({
              multiAddress: 'testaddress',
              knownPeers: ['testaddress2'],
              msgType: 'known-peers',
              gateway: 'testgateway'
            }))
          }
        }
        sandbox.stub(uut, 'addKnownPeer').throws(new Error('test error'))
        const result = await uut.handlePubsubMsg(msg)
        assert.isFalse(result)
      } catch (error) {
        assert.fail('Unexpected code path')
      }
    })
  })

  describe('#addKnownPeer', () => {
    it('should add known peer', async () => {
      const result = await uut.addKnownPeer({ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' })
      assert.isTrue(result)
    })
    it('should ignore node peer address', async () => {
      uut.node.addresses = ['/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH']
      const result = await uut.addKnownPeer({ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' })
      assert.isFalse(result)
    })
    it('should ignore black list address', async () => {
      uut.blackListAddresssStore = ['/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH']
      const result = await uut.addKnownPeer({ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' })
      assert.isFalse(result)
    })
    it('should ignore already known address', async () => {
      uut.blackListAddresssStore = []
      uut.node.addresses = ['node address']
      uut.privateAddresssStore = [{ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' }]
      const result = await uut.addKnownPeer({ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' })
      assert.isTrue(result)
    })
    it('should add known peer', async () => {
      uut.privateAddresssStore = []
      uut.blackListAddresssStore = []
      uut.node.addresses = ['/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH2']
      const result = await uut.addKnownPeer({ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' })
      assert.isTrue(result)
    })
    it('should return false on error', async () => {
      const result = await uut.addKnownPeer()
      assert.isFalse(result)
    })
  })
  describe('#getKnownPeers', () => {
    it('should get known peers', async () => {
      uut.privateAddresssStore = [{ address: 'testaddress', gateway: 'testgateway' }, { address: 'testaddress2', gateway: 'testgateway2' }]
      const result = await uut.getKnownPeers()
      assert.equal(result.length, 2)
      assert.equal(result[0].address, 'testaddress')
      assert.equal(result[0].gateway, 'testgateway')
      assert.equal(result[1].address, 'testaddress2')
      assert.equal(result[1].gateway, 'testgateway2')
    })
  })
  describe('#removeKnownPeer', () => {
    it('should remove known peer', async () => {
      uut.privateAddresssStore = [{ address: 'testaddress', gateway: 'testgateway' }, { address: 'testaddress2', gateway: 'testgateway2' }]
      const result = await uut.removeKnownPeer('testaddress')
      assert.isTrue(result)
      assert.equal(uut.privateAddresssStore.length, 1)
      assert.equal(uut.privateAddresssStore[0].address, 'testaddress2')
      assert.equal(uut.privateAddresssStore[0].gateway, 'testgateway2')
    })
    it('should return false if peer is not found', async () => {
      uut.privateAddresssStore = []
      const result = await uut.removeKnownPeer('testaddress')
      assert.isFalse(result)
    })
    it('should return false if address to remove is the same that the known peer address', async () => {
      uut.privateAddresssStore = [{ address: 'testaddress', gateway: 'testgateway' }, { address: 'testaddress2', gateway: 'testgateway' }]
      uut.knownPeerAddress = 'testaddress'
      const result = await uut.removeKnownPeer('testaddress')
      assert.isFalse(result)
    })
    it('should return false on error', async () => {
      const result = await uut.removeKnownPeer()
      assert.isFalse(result)
    })
  })
  describe('#renewKnownPeerConnection', () => {
    it('should renew connections', async () => {
      try {
        uut.privateAddresssStore = [{ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' }]
        const spyConnect = sandbox.stub(uut.node, 'connect').resolves(true)
        const result = await uut.renewKnownPeerConnection()
        assert.isTrue(result)
        assert.isTrue(spyConnect.called)
      } catch (error) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return false on error', async () => {
      uut.privateAddresssStore = null
      const result = await uut.renewKnownPeerConnection()
      assert.isFalse(result)
    })
    it('should return skip if cannot connect to peer', async () => {
      uut.privateAddresssStore = [{ address: '/ip4/127.0.0.1/tcp/6002/p2p/12D3KooWKBqstptEURdhigM6GdBjtphP8nDW7cAj5Zyg5ApfsGsH', gateway: 'testgateway' }]
      sandbox.stub(uut.node, 'connect').throws(new Error('test error'))
      const result = await uut.renewKnownPeerConnection()
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
  describe('#topicHandler', () => {
    it('should re-subscribe to topics', async () => {
      try {
        sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'getTopics').returns([])
        const spy = sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'subscribe').returns(true)
        const result = uut.topicHandler()
        assert.isTrue(result)
        assert.isTrue(spy.calledOnce)
      } catch (err) {
        console.log(err)
        assert.fail('Unexpected code path')
      }
    })

    it('should handle error', async () => {
      try {
        sandbox.stub(uut.node.helia.libp2p.services.pubsub, 'unsubscribe').throws(new Error('test error'))
        const result = uut.topicHandler(['topic1', 'topic2'])
        assert.isFalse(result)
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })
})
