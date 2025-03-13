import { assert } from 'chai'
import sinon from 'sinon'
import { describe, it } from 'mocha'

import GarbageCollector from '../../src/helia/gb.js'
import HeliaNode from '../../src/helia/node.js'
import createLibp2pMock from '../mocks/libp2p-mock.js'
import createHeliaMock from '../mocks/helia-mock.js'
describe('#GarbageCollector', () => {
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

    uut = new GarbageCollector({ node })
  })

  beforeEach(() => {
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
        const unit = new GarbageCollector({ })
        this.log(unit)
      } catch (err) {
        assert.include(err.message, 'Helia-IPFS-Node must be passed on GB constructor')
      }
    })
    it('should handle wrong provided period', async () => {
      try {
        const unit = new GarbageCollector({ node: {}, period: {} })
        this.log(unit)
      } catch (err) {
        assert.include(err.message, 'Provided period must be a number to specify the minutes on interval')
      }
    })
  })
  describe('#start', () => {
    it('should start timers', async () => {
      assert.isUndefined(uut.gcTimer)

      uut.start()
      assert.exists(uut.gcTimer)
      clearInterval(uut.gcTimer)
    })
  })

  describe('#garbageCollection', () => {
    it('should handle timer', async () => {
      try {
        const clearISpy = sandbox.stub(uut, 'clearInterval').resolves(true)
        const setISpy = sandbox.stub(uut, 'setInterval').resolves(true)

        const result = await uut.garbageCollection()
        assert.isTrue(result)
        assert.isTrue(clearISpy.calledOnce) // should stop interval on start func
        assert.isTrue(setISpy.calledOnce) // should start interval after success
      } catch (error) {
        assert.fail('Unexpected code path')
      }
    })
    it('should return false on error', async () => {
      try {
        const clearISpy = sandbox.stub(uut, 'clearInterval').resolves(true)
        const setISpy = sandbox.stub(uut, 'setInterval').resolves(true)
        // Force an error.
        sandbox.stub(uut.node.helia, 'gc').throws(new Error('test error'))

        const res = await uut.garbageCollection()
        assert.isFalse(res)
        assert.isTrue(clearISpy.calledOnce) // should stop interval on start func
        assert.isTrue(setISpy.calledOnce) // should start interval on error
      } catch (error) {
        assert.fail('Unexpected code path')
      }
    })
  })
})
