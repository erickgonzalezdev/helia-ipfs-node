/*
  Unit tests for helia.js
*/

import { assert } from 'chai'
import sinon from 'sinon'
import { describe, it } from 'mocha'

import HealiaNode from '../../src/helia/node.js'
import createLibp2pMock from '../mocks/libp2p-mock.js'
import createHeliaMock from '../mocks/helia-mock.js'
import unixfsMock from '../mocks/unixFs-mock.js'

describe('#Helia.js', () => {
  let sandbox
  // let mockData
  let uut

  before(() => {
    // Restore the sandbox before each test.
    sandbox = sinon.createSandbox()

    uut = new HealiaNode({ networking: 'full' })
    uut.publicIp = async () => { return '192.168.1.1' }
    uut.createHelia = createHeliaMock
    uut.createLibp2p = createLibp2pMock
    uut.sleep = async () => { }
    if (!process.env.log) {
      uut.log = () => { }
    }
  })

  afterEach(() => sandbox.restore())

  describe('#start', () => {
    it('should start helia node ', async () => {
      try {
        sandbox.stub(uut, 'publicIp').resolves('127.0.0.1')
        sandbox.stub(uut, 'saveKey').resolves(true)

        await uut.start()
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should start helia node full nwtworking', async () => {
      try {
        sandbox.stub(uut, 'publicIp').resolves('127.0.0.1')
        sandbox.stub(uut, 'saveKey').resolves(true)

        await uut.start()
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should start helia node full nwtworking and announce mode', async () => {
      try {
        uut.opts.announce = true
        sandbox.stub(uut, 'publicIp').resolves('127.0.0.1')
        sandbox.stub(uut, 'saveKey').resolves(true)

        await uut.start()
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })

    it('should start helia node with a new salt', async () => {
      try {
        sandbox.stub(uut, 'publicIp').resolves('127.0.0.1')
        sandbox.stub(uut, 'saveKey').resolves(true)
        sandbox.stub(uut, 'readKey').throws(new Error())

        await uut.start({ nodeKey: '6259bf2c92c772162efdc63af1c2d1eb' })
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should start with new peer store', async () => {
      try {
        sandbox.stub(uut, 'publicIp').resolves('127.0.0.1')
        sandbox.stub(uut, 'saveKey').resolves(true)
        sandbox.stub(uut, 'readKey').throws(new Error())
        sandbox.stub(uut.fs, 'existsSync').resolves(true)
        sandbox.stub(uut.fs.promises, 'rm').resolves(true)

        await uut.start({ nodeKey: '6259bf2c92c772162efdc63af1c2d1eb' })
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should handle error', async () => {
      try {
        sandbox.stub(uut, 'publicIp').throws(new Error('Test Error'))
        await uut.start()
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
  })

  describe('#connect', () => {
    it('should connect and dial to provided address', async () => {
      try {
        sandbox.stub(uut.helia.libp2p, 'dial').resolves(true)

        await uut.connect('/ip4/127.0.0.1/tcp/40651/p2p/12D3KooWDiNi4HBbjK5eeCKKD9xoqtueHGgB2WQd83zNjwtgWRhX')
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should handle dial error', async () => {
      try {
        sandbox.stub(uut.helia.libp2p, 'dial').throws(new Error('Test Error'))
        await uut.connect('/ip4/127.0.0.1/tcp/40651/p2p/12D3KooWDiNi4HBbjK5eeCKKD9xoqtueHGgB2WQd83zNjwtgWRhX')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
    it('should throw error if address is not provided', async () => {
      try {
        await uut.connect()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'addr is required!')
      }
    })
  })
  describe('#connectMultiaddr', () => {
    it('should connect and dial to provided multiaddr', async () => {
      try {
        sandbox.stub(uut.helia.libp2p, 'dial').resolves(true)

        await uut.connectMultiaddr(['/ip4/127.0.0.1/tcp/40651/p2p/12D3KooWDiNi4HBbjK5eeCKKD9xoqtueHGgB2WQd83zNjwtgWRhX'])
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should handle dial error', async () => {
      try {
        sandbox.stub(uut.helia.libp2p, 'dial').throws(new Error('Test Error'))
        await uut.connectMultiaddr(['/ip4/127.0.0.1/tcp/40651/p2p/12D3KooWDiNi4HBbjK5eeCKKD9xoqtueHGgB2WQd83zNjwtgWRhX'])

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Test Error')
      }
    })
    it('should throw error if multiaddr is not provided', async () => {
      try {
        await uut.connectMultiaddr()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'addr is required!')
      }
    })
  })

  describe('#upload', () => {
    it('should upload directory path', async () => {
      try {
        sandbox.stub(uut.path, 'resolve').returns('/directory-path')
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut.fs, 'lstatSync').returns({ isDirectory: () => { return true } })
        sandbox.stub(uut, 'uploadDir').returns('mock-cid')

        const cid = await uut.upload('/directory-to-upload')
        assert.isString(cid)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should upload single file path', async () => {
      try {
        sandbox.stub(uut.path, 'resolve').returns('/file-path')
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut, 'uploadFile').returns('mock-cid')

        sandbox.stub(uut.fs, 'lstatSync')
          .onCall(0).returns({ isDirectory: () => { return false } })
          .onCall(1).returns({ isFile: () => { return true } })

        const cid = await uut.upload('/file-to-upload')
        assert.isString(cid)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('handle error if cid cant be created', async () => {
      try {
        sandbox.stub(uut.path, 'resolve').returns('/file-path')
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut, 'uploadFile').returns('mock-cid')

        sandbox.stub(uut.fs, 'lstatSync')
          .onCall(0).returns({ isDirectory: () => { return false } })
          .onCall(1).returns({ isFile: () => { return false } })

        await uut.upload('/file-to-upload')
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Upload fail!')
      }
    })
    it('should throw an error if input is not provided', async () => {
      try {
        await uut.upload()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'path is required!')
      }
    })
    it('should throw error if path is not found', async () => {
      try {
        await uut.upload('path-not-found!')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'File or Directory not found!')
      }
    })
  })

  describe('#uploadFile', () => {
    it('should upload file', async () => {
      try {
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut.fs, 'lstatSync').returns({ isFile: () => { return true } })
        sandbox.stub(uut.fs, 'createReadStream').returns(true)
        sandbox.stub(uut.path, 'resolve').returns('/directory-path')
        sandbox.stub(uut.ufs, 'addFile').resolves('mock-cid')

        const cid = await uut.uploadFile('file-to-upload')
        assert.isString(cid)
      } catch (err) {
        console.log(err)
        assert.fail('Unexpected result')
      }
    })

    it('should throw an error if input is not provided', async () => {
      try {
        await uut.uploadFile()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'path is required!')
      }
    })
    it('should throw error if path is not found', async () => {
      try {
        await uut.uploadFile('path-not-found!')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'File not found!')
      }
    })
    it('should throw error if path is not a file', async () => {
      try {
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut.fs, 'lstatSync').returns({ isFile: () => { return false } })
        await uut.uploadFile('path')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Provided path is not a file.')
      }
    })
  })
  describe('#uploadDir', () => {
    it('should upload dir', async () => {
      try {
        sandbox.stub(uut.ufs, 'addDirectory').returns('mock-cid')
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut.ufs, 'cp').resolves('cid')
        sandbox.stub(uut.fs, 'lstatSync').returns({ isDirectory: () => { return true } })
        sandbox.stub(uut.fs.promises, 'readdir').resolves([{ name: 'mockDirent', isFile: () => { return true } }])
        sandbox.stub(uut.fs, 'createReadStream').returns(true)
        sandbox.stub(uut.ufs, 'addFile').resolves('mock-cid')

        const cid = await uut.uploadDir('dir-to-upload')
        assert.isString(cid)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })

    it('should throw an error if input is not provided', async () => {
      try {
        await uut.uploadDir()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Dir is required!')
      }
    })
    it('should throw error if path is not found', async () => {
      try {
        sandbox.stub(uut.fs, 'existsSync').returns(false)
        await uut.uploadDir('path-not-found!')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Dir not found!')
      }
    })
    it('should throw error if provided path is not a directory', async () => {
      try {
        sandbox.stub(uut.fs, 'existsSync').returns(true)
        sandbox.stub(uut.fs, 'lstatSync').returns({ isDirectory: () => { return false } })
        await uut.uploadDir('path-not-found!')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Provided path is not a dir.')
      }
    })
  })

  describe('#uploadStrOrObj', () => {
    it('should upload object', async () => {
      try {
        const cid = await uut.uploadStrOrObj({ test: 'test' })
        assert.isString(cid)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should upload string', async () => {
      try {
        const cid = await uut.uploadStrOrObj('string')
        assert.isString(cid)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })

    it('should throw an error if input is not provided', async () => {
      try {
        await uut.uploadStrOrObj()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'object or string is required!')
      }
    })
    it('should throw an error if provided input is not a string or object', async () => {
      try {
        await uut.uploadStrOrObj(12345)

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'Input must be an object or string!')
      }
    })
  })

  describe('#getConnections', () => {
    it('should get connections', async () => {
      try {
        const connections = await uut.getConnections()
        assert.isArray(connections)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
  })

  describe('#getContent', () => {
    it('should get connections', async () => {
      try {
        uut.ufs = unixfsMock
        const content = await uut.getContent('cid')
        assert.exists(content)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should throw an error if input is not provided', async () => {
      try {
        await uut.getContent()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'CID string is required.')
      }
    })
  })

  describe('#getMultiAddress', () => {
    it('should get MultiAddress', async () => {
      try {
        sandbox.stub(uut.helia.libp2p, 'getMultiaddrs').returns(['addresses'])
        const addresses = await uut.getMultiAddress()
        assert.isArray(addresses)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should get MultiAddress on announce mode', async () => {
      try {
        uut.opts.announce = true
        sandbox.stub(uut.helia.libp2p, 'getMultiaddrs').returns(['addresses'])
        const addresses = await uut.getMultiAddress()
        assert.isArray(addresses)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should handle error', async () => {
      try {
        sandbox.stub(uut.helia.libp2p, 'getMultiaddrs').throws(new Error('test error'))

        await uut.getMultiAddress()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#pinCid', () => {
    it('should pin cid', async () => {
      try {
        const cid = await uut.pinCid('bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q')
        assert.exists(cid)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should throw an error if input is not provided', async () => {
      try {
        await uut.pinCid()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'CID is required.')
      }
    })
    it('should handle promises error', async () => {
      try {
        sandbox.stub(uut.helia.pins, 'add').throws(new Error('test error'))

        await uut.pinCid('bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#unPinCid', () => {
    it('should unpin cid', async () => {
      try {
        const cid = await uut.unPinCid('bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q')
        assert.exists(cid)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should throw an error if input is not provided', async () => {
      try {
        await uut.unPinCid()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'CID is required.')
      }
    })
    it('should handle promises error', async () => {
      try {
        sandbox.stub(uut.helia.pins, 'rm').throws(new Error('test error'))

        await uut.unPinCid('bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#getPins', () => {
    it('should get pinned cids', async () => {
      try {
        const cid = await uut.getPins()
        assert.isArray(cid)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should handle promises error', async () => {
      try {
        sandbox.stub(uut.helia.pins, 'ls').throws(new Error('test error'))

        await uut.getPins('cid')

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#saveKey', () => {
    it('should save key', async () => {
      try {
        sandbox.stub(uut.fs, 'writeFile').yields(null)
        const result = await uut.saveKey('key', 'path to store')
        assert.isTrue(result)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should handle error if key is not provided', async () => {
      try {
        await uut.saveKey()
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'key  must be a string')
      }
    })
    it('should handle error if path is not provided', async () => {
      try {
        await uut.saveKey('key')
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'path must be a string')
      }
    })
    it('should handle write error', async () => {
      try {
        sandbox.stub(uut.fs, 'writeFile').yields(new Error('write error'))
        await uut.saveKey('key', 'path to store')
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'write error')
      }
    })
  })

  describe('#readKey', () => {
    it('should read key', async () => {
      try {
        sandbox.stub(uut.fs, 'readFile').yields(null, 'key')
        const result = await uut.readKey('key path')
        assert.isString(result)
      } catch (err) {
        // console.log('Err',err)
        assert.fail('Unexpected result')
      }
    })
    it('should handle error if path is not provided', async () => {
      try {
        await uut.readKey()
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'path must be a string')
      }
    })
    it('should handle read error', async () => {
      try {
        sandbox.stub(uut.fs, 'readFile').yields(new Error('read error'))
        await uut.readKey('key path')
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'read error')
      }
    })
  })
  describe('#getDiskSize', () => {
    it('should  get node size', async () => {
      try {
        sandbox.stub(uut.getFolderSize, 'strict').resolves(1)
        const result = await uut.getDiskSize()
        assert.isString(result)
      } catch (err) {
        console.log('Err', err)
        assert.fail('Unexpected result')
      }
    })
    it('should return false on error', async () => {
      try {
        sandbox.stub(uut.getFolderSize, 'strict').throws(new Error('test error'))
        const result = await uut.getDiskSize()
        assert.isFalse(result)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
  })
  describe('#provideCID', () => {
    it('should  throw error if input is not provided', async () => {
      try {
        await uut.provideCID()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'CID string is required.')
      }
    })
    it('should provide a CID', async () => {
      try {
        const cid = 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        const result = await uut.provideCID(cid)
        assert.isTrue(result)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should handle error', async () => {
      try {
        sandbox.stub(uut.helia.routing, 'provide').throws(new Error('test error'))
        const cid = 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        await uut.provideCID(cid)
        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'test error')
      }
    })
  })

  describe('#getStat', () => {
    it('should  throw error if input is not provided', async () => {
      try {
        await uut.getStat()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'CID string is required.')
      }
    })
    it('should get stat', async () => {
      try {
        const cid = 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        sandbox.stub(uut.ufs, 'stat').resolves({ fileSize: 1 })
        const result = await uut.getStat(cid)
        assert.exists(result)
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
  })

  describe('#lazyDownload', () => {
    it('should get content', async () => {
      try {
        uut.getContent = async () => { return Buffer.alloc(1024) }
        // sandbox.stub(uut, 'getContent').resolves( Buffer.alloc(1024))
        uut.ufs = unixfsMock
        const cid = 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'
        const content = await uut.lazyDownload(cid)
        assert.isString(content)
        assert.equal(cid, content)
      } catch (err) {
        console.log('Err', err)
        assert.fail('Unexpected result')
      }
    })
    it('should await if cid is already downloaded and does not exist in local node', async () => {
      try {
        const cid = 'bafkreigwi546vmpive76kqc3getucr43vced5vj47kwkxjajrichk2zk7q'

        uut.ufs = unixfsMock
        uut.downloading[cid] = true
        sandbox.stub(uut, 'getStat')
          .onCall(0).resolves({ fileSize: 1000, localFileSize: 0 })
          .onCall(1).resolves({ fileSize: 1000, localFileSize: 1000 })

        const content = await uut.lazyDownload(cid)
        assert.isString(content)
        assert.equal(cid, content)
      } catch (err) {
        console.log('Err', err)
        assert.fail('Unexpected result')
      }
    })
    it('should throw an error if input is not provided', async () => {
      try {
        await uut.lazyDownload()

        assert.fail('Unexpected result')
      } catch (err) {
        assert.include(err.message, 'CID string is required.')
      }
    })
  })
  describe('#handleRelay', () => {
    it('should not add relay service if it is disabled', async () => {
      try {
        uut.opts.relay = false
        const opts = {
          services: {}
        }
        const result = await uut.handleRelay(opts)
        assert.notProperty(result.services, 'relay')
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should add relay service if it is enabled', async () => {
      try {
        uut.opts.relay = true
        const opts = {
          services: {}
        }
        const result = await uut.handleRelay(opts)
        assert.property(result.services, 'relay')
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
  })
  describe('#cleanDownloading', () => {
    it('should clean downloading', async () => {
      try {
        const minutesAgoObj = new Date()
        minutesAgoObj.setMinutes(minutesAgoObj.getMinutes() - 3)
        uut.downloading = {
          bafybeigfzpnw7rzejeukg4dwet3atopfm6oelchqn4ikow7pfb4bopiiey: {
            timestamp: minutesAgoObj.getTime()
          }
        }
        uut.cleanDownloading()
        assert.notProperty(uut.downloading, 'bafybeigfzpnw7rzejeukg4dwet3atopfm6oelchqn4ikow7pfb4bopiiey')
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should not clean downloading if it is not stale', async () => {
      try {
        uut.downloading = {
          bafybeigfzpnw7rzejeukg4dwet3atopfm6oelchqn4ikow7pfb4bopiiey: {
            timestamp: Date.now()
          }
        }
        uut.cleanDownloading()
        assert.property(uut.downloading, 'bafybeigfzpnw7rzejeukg4dwet3atopfm6oelchqn4ikow7pfb4bopiiey')
      } catch (err) {
        assert.fail('Unexpected result')
      }
    })
    it('should handle error', async () => {
      uut.downloading = null
      const res = uut.cleanDownloading()
      assert.isFalse(res)
    })
  })
})
