import { createHelia } from 'helia'
import fs from 'fs'
import { FsBlockstore } from 'blockstore-fs'
import { FsDatastore } from 'datastore-fs'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'

import { multiaddr } from '@multiformats/multiaddr'
import { unixfs } from '@helia/unixfs'

import { logger, disable } from '@libp2p/logger'
import path from 'path'
import { bootstrap } from '@libp2p/bootstrap'

import { bootstrapConfig } from '../util/bootstrap.js'

import { circuitRelayServer } from '@libp2p/circuit-relay-v2'

import { webSockets } from '@libp2p/websockets'
import { ping } from '@libp2p/ping'

// import { autoNAT } from '@libp2p/autonat'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
// import { uPnPNAT } from '@libp2p/upnp-nat'
// import { autoNAT } from '@libp2p/autonat'

// import { mdns } from '@libp2p/mdns'
// import { delegatedContentRouting } from '@libp2p/delegated-content-routing'
import { CID } from 'multiformats/cid'
import crypto from 'crypto'
import { identify } from '@libp2p/identify'
import { publicIpv4 } from 'public-ip'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import getFolderSize from 'get-folder-size'

import { sleep } from '../util/util.js'
import * as Libp2pCryptoKeys from '@libp2p/crypto/keys'

import { peerIdFromPrivateKey } from '@libp2p/peer-id'

class HeliaNode {
  constructor (inputOptions = {}) {
    this.multiaddr = multiaddr
    this.publicIp = publicIpv4
    this.createHelia = createHelia
    this.createLibp2p = createLibp2p
    this.path = path
    this.FsBlockstore = FsBlockstore
    this.FsDatastore = FsDatastore
    this.fs = fs
    this.multiaddr = multiaddr
    this.unixfs = unixfs
    this.logger = logger
    this.disable = disable
    this.Promise = Promise
    this.opts = inputOptions
    this.peerId = null
    this.KeyPath = 'node-key.json'
    this.getFolderSize = getFolderSize

    this.helia = null
    this.ufs = null
    this.ip4 = null
    this.addresses = [] // node multi address

    this.start = this.start.bind(this)
    this.connect = this.connect.bind(this)
    this.connectMultiaddr = this.connectMultiaddr.bind(this)
    this.upload = this.upload.bind(this)
    this.uploadDir = this.uploadDir.bind(this)
    this.pftpDownload = this.pftpDownload.bind(this)

    // this.uploadObject = this.uploadObject.bind(this)
    // this.uploadString = this.uploadString.bind(this)
    this.uploadStrOrObj = this.uploadStrOrObj.bind(this)
    this.uploadFile = this.uploadFile.bind(this)
    // this.listProviders = this.listProviders.bind(this)
    this.generateSalt = this.generateSalt.bind(this)
    // this.renewBootstrap = this.renewBootstrap.bind(this)
    this.getContent = this.getContent.bind(this)
    this.getMultiAddress = this.getMultiAddress.bind(this)
    this.pinCid = this.pinCid.bind(this)
    this.unPinCid = this.unPinCid.bind(this)
    this.getPins = this.getPins.bind(this)
    this.saveKey = this.saveKey.bind(this)
    this.readKey = this.readKey.bind(this)
    this.getDiskSize = this.getDiskSize.bind(this)
    this.getStat = this.getStat.bind(this)
    this.lazyDownload = this.lazyDownload.bind(this)
    this.provideCID = this.provideCID.bind(this)
    this.downloading = {}
    this.sleep = sleep
    this.getLibp2pOpts = this.getLibp2pOpts.bind(this)
    this.log = inputOptions.log || console.log
    this.parseOptions = this.parseOptions.bind(this)
    this.handleRelay = this.handleRelay.bind(this)
    this.getConnections = this.getConnections.bind(this)
    this.cleanDownloading = this.cleanDownloading.bind(this)
  }

  // Parse injected options
  async parseOptions () {
    const defaultOptions = {
      storePath: this.opts.storePath || this.path.resolve('./helia-data'),
      nodeKey: this.opts.nodeKey || this.generateSalt(),
      tcpPort: this.opts.tcpPort || 4001,
      wsPort: this.opts.wsPort || 4002,
      bootstrapList: this.opts.bootstrapList || bootstrapConfig,
      alias: this.opts.alias,
      relay: this.opts.relay,
      announce: this.opts.announce,
      serverDHTProvide: this.opts.serverDHTProvide,
      maxConnections: this.opts.maxConnections || 300,
      announceAddr: this.opts.announceAddr
    }

    let existingKey
    try {
      this.log('looking for existing node')
      existingKey = await this.readKey(`${defaultOptions.storePath}/${this.KeyPath}`)
    } catch (error) {
      this.log('Existing node not found . A new node will be created!')
    }

    if (existingKey && !this.opts.nodeKey) {
      defaultOptions.nodeKey = existingKey
    }

    this.opts = defaultOptions
    return defaultOptions
  }

  handleRelay (libp2pOpts) {
    if (!this.opts.relay) return libp2pOpts
    libp2pOpts.services.relay = circuitRelayServer({ // makes the node function as a relay server
      hopTimeout: 30 * 1000, // incoming relay requests must be resolved within this time limit
      advertise: true,
      reservations: {
        maxReservations: 15, // how many peers are allowed to reserve relay slots on this server
        reservationClearInterval: 300 * 1000, // how often to reclaim stale reservations
        applyDefaultLimit: true, // whether to apply default data/duration limits to each relayed connection
        defaultDurationLimit: 2 * 60 * 1000 // the default maximum amount of time a relayed connection can be open for
        /*       defaultDataLimit: BigInt(2 << 7), // the default maximum number of bytes that can be transferred over a relayed connection
        maxInboundHopStreams: 32, // how many inbound HOP streams are allow simultaneously
        maxOutboundHopStreams: 64// how many outbound HOP streams are allow simultaneously */
      }
    })

    return libp2pOpts
  }

  getLibp2pOpts (privateKey, datastore) {
    const libp2pOpts = {
      privateKey,
      datastore,
      addresses: {
        listen: [
          /*           '/ip4/0.0.0.0/tcp/0', */
          `/ip4/0.0.0.0/tcp/${this.opts.tcpPort}`,
          `/ip4/0.0.0.0/tcp/${this.opts.wsPort}/ws`,
          '/webrtc'
        ],
        announce: this.opts.announce
          ? this.opts.announceAddr
            ? [
                this.opts.announceAddr
              ]
            : [
                `/ip4/${this.ip4}/tcp/${this.opts.tcpPort}`
              ]
          : []
      },
      connectionManager: {
        maxConnections: this.opts.maxConnections || 50,
        minConnections: this.opts.maxConnections ? this.opts.maxConnections * 0.5 : 10

      },
      transports: [
        tcp({ logger: logger('upgrade') }),
        webSockets()
      ],
      connectionEncrypters: [
        noise()
      ],
      streamMuxers: [
        yamux()
      ],
      peerDiscovery: [
        // mdns(),
        bootstrap(bootstrapConfig)

      ],
      peerRouting: [
        // delegatedContentRouting(client)
      ],
      services: {
        identify: identify(),
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
        ping: ping(),
        dht: kadDHT({
          protocol: '/ipfs/kad/1.0.0',
          peerInfoMapper: removePrivateAddressesMapper,
          clientMode: !this.opts.serverDHTProvide,
          queryTimeout: 30000, // 30 seconds
          protocolPrefix: '/ipfs' // Standard prefix for IPFS DHT
          /*     reprovide: this.opts.serverDHTProvide
            ? {
                concurrency: 5,
                interval: 10000
              }
            : false */
        })
      },
      logger: disable()
    }

    return this.handleRelay(libp2pOpts)
  }

  async start () {
    try {
      const options = await this.parseOptions()
      this.log('Starting Helia IPFS Node')

      const blockStorePath = `${options.storePath}/blockstore`
      const dataStorePath = `${options.storePath}/datastore`

      if (this.fs.existsSync(`${dataStorePath}/peers`)) {
        await this.fs.promises.rm(`${dataStorePath}/peers`, { recursive: true, force: true })
      }

      // Create block and data stores.
      const blockstore = new this.FsBlockstore(blockStorePath)
      const datastore = new this.FsDatastore(dataStorePath)

      const keyPair = await Libp2pCryptoKeys.generateKeyPairFromSeed('Ed25519', Buffer.from(options.nodeKey))
      this.keyPair = keyPair
      const peerId = peerIdFromPrivateKey(keyPair)
      this.log(`Peer Id : ${peerId}`)

      this.ip4 = await this.publicIp()

      const libp2pInputs = this.getLibp2pOpts(keyPair, datastore)

      this.log(`Node Alias : ${this.opts.alias}`)
      this.log(`RELAY : ${!!this.opts.relay}`)
      this.log(`DHT SERVER MODE : ${!!this.opts.serverDHTProvide}`)
      this.log(`Announce Public Addresses: ${!!this.opts.announce}`)
      this.log(`MAX CONNECTIONS : ${this.opts.maxConnections}`)

      const libp2p = await this.createLibp2p(libp2pInputs)
      await libp2p.services.dht.reprovider.stop()

      this.peerId = peerId
      // Create helia node
      this.helia = await this.createHelia({
        blockstore,
        datastore,
        libp2p
      })

      const multiaddrs = await this.getMultiAddress()
      this.log('Multiaddrs: ', multiaddrs)

      this.ufs = this.unixfs(this.helia)
      await this.saveKey(options.nodeKey, `${options.storePath}/${this.KeyPath}`)
      return this.helia
    } catch (error) {
      this.log('error in helia/start()', error)
      throw error
    }
  }

  // Dial to multiAddress
  async connect (addr) {
    try {
      if (!addr) { throw new Error('addr is required!') }
      // Connect to a node
      const conection = await this.helia.libp2p.dial(multiaddr(addr))
      return conection
    } catch (err) {
      this.log('Error helia connect()  ', err.message)
      throw err
    }
  }

  // Dial to multiAddress
  async tryDisconnect (addr) {
    try {
      if (!addr) { throw new Error('addr is required!') }
      const conection = await this.helia.libp2p.hangUp(multiaddr(addr))
      this.log(`Disconnection successfull from ${addr}`)
      return conection
    } catch (err) {
      this.log('Error helia tryDisconnect()  ', err.message)
      return false
    }
  }

  // Dial to multiAddress
  async connectMultiaddr (multiaddr) {
    try {
      if (!multiaddr) { throw new Error('multiaddr is required!') }
      // Connect to the P2WDB Pinning service used by pearson-api.
      await this.helia.libp2p.dial(multiaddr)
      return true
    } catch (err) {
      this.log('Error helia connect()  ', err)
      throw err
    }
  }

  // Upload content to the node
  async upload (path) {
    try {
      if (!path) { throw new Error('path is required!') }

      const filePath = this.path.resolve(path)
      if (!this.fs.existsSync(filePath)) {
        throw new Error('File or Directory not found!')
      }

      let cid

      // For directory content
      if (this.fs.lstatSync(filePath).isDirectory()) {
        cid = await this.uploadDir(filePath)
        this.log('Added Directory:', cid.toString())
      } else if (this.fs.lstatSync(filePath).isFile()) { // For single file content
        cid = await this.uploadFile(filePath)
      }

      if (!cid) { throw new Error('Upload fail!') }

      return cid
    } catch (error) {
      this.log('Error helia uploadFile  ', error)
      throw error
    }
  }

  // Upload file to the node
  async uploadFile (path) {
    try {
      if (!path) { throw new Error('path is required!') }
      if (!this.fs.existsSync(path)) { throw new Error('File not found!') }
      if (!this.fs.lstatSync(path).isFile()) { throw new Error('Provided path is not a file.') }

      const cid = await this.ufs.addFile({ content: this.fs.createReadStream(path) })

      return cid
    } catch (error) {
      this.log('Error in uploadFile(): ', error)
      throw error
    }
  }

  // Upload dir to the node
  async uploadDir (dir) {
    try {
      if (!dir) { throw new Error('Dir is required!') }
      if (!this.fs.existsSync(path)) { throw new Error('Dir not found!') }
      if (!this.fs.lstatSync(path).isDirectory()) { throw new Error('Provided path is not a dir.') }

      let rootCid = await this.ufs.addDirectory('new dir')

      const dirents = await this.fs.promises.readdir(dir, { withFileTypes: true })
      await this.Promise.all(dirents.map(async dirent => {
        const _path = this.path.join(dir, dirent.name)
        if (dirent.isFile()) {
          this.log('adding path', dirent.name)
          const cid = await this.ufs.addFile({ content: this.fs.createReadStream(_path) })
          this.log('dir file cid', cid)
          rootCid = await this.ufs.cp(cid, rootCid, dirent.name)
        }
      }))
      this.log('rootCid', rootCid)
      return rootCid
    } catch (error) {
      this.log('Error in uploadDir(): ', error)
      throw error
    }
  }

  // Upload object with dir wrapper
  async uploadStrOrObj (value) {
    try {
      if (!value) { throw new Error('object or string is required!') }
      if (typeof value !== 'string' && typeof value !== 'object') {
        throw new Error('Input must be an object or string!')
      }

      let cid
      const encoder = new TextEncoder()
      if (typeof value === 'object') {
        cid = await this.ufs.addBytes(encoder.encode(JSON.stringify(value)), this.helia.blockstore)
      }
      if (typeof value === 'string') {
        cid = await this.ufs.addBytes(encoder.encode(value), this.helia.blockstore)
      }

      return cid.toString()
    } catch (error) {
      this.log('Error in uploadStrOrObj(): ', error)
      throw error
    }
  }

  generateSalt (phrase) {
    return crypto.randomBytes(16).toString('hex')
  }

  // Get all connected nodes
  getConnections () {
    const cs = this.helia.libp2p.getConnections()
    return cs
  }

  // Get content from CID
  async getContent (CID, options = {}) {
    try {
      if (!CID || typeof CID !== 'string') {
        throw new Error('CID string is required.')
      }

      const chunks = []
      for await (const chunk of this.ufs.cat(CID, options)) {
        chunks.push(chunk)
      }

      return Buffer.concat(chunks)
    } catch (error) {
      this.log('Error helia getContent()  ', error)
      throw error
    }
  }

  async lazyDownload (cid, length, signal) {
    try {
      if (!cid || typeof cid !== 'string') {
        throw new Error('CID string is required.')
      }
      // Clean up stale downloads
      this.cleanDownloading()

      if (!length) length = 10 ** 6 * 50 // max 50mb chunks

      let ready = true
      let fileSize
      let localSize
      // Ignore all incoming request to download a cid wich is already downloading . this keep lower ram usage.
      // If the CID is fully downloaded on this node , go ahead to get the content.
      do {
        const stats = await this.getStat(cid, { signal })
        fileSize = Number(stats.fileSize)
        localSize = Number(stats.localFileSize)

        if (this.downloading[cid] && localSize !== fileSize) {
          ready = false
          await this.sleep(2000)
        } else {
          ready = true
        }
      } while (!ready)
      this.downloading[cid] = {
        cid,
        timestamp: Date.now()
      }
      // console.log(stats)
      let chunkLength = 0
      while (chunkLength < Number(fileSize)) {
        const chunks = await this.getContent(cid, { offset: chunkLength, length, signal })
        chunkLength += chunks.length
      }

      this.downloading[cid] = null

      return cid
    } catch (error) {
      this.downloading[cid] = null
      this.log('Error helia lazyDownload()  ', error)
      throw error
    }
  }

  async getStat (cid, options = {}) {
    try {
      if (!cid || typeof cid !== 'string') {
        throw new Error('CID string is required.')
      }
      const res = await this.ufs.stat(CID.parse(cid), options)

      return res
    } catch (error) {
      this.log('Error helia getContent()  ', error)
      throw error
    }
  }

  // Get node multi addresses
  async getMultiAddress () {
    try {
      // Attempt to guess our ip4 IP address.
      const multiaddrs = this.helia.libp2p.getMultiaddrs()
      if (this.opts.announce) {
        this.addresses = multiaddrs
        return multiaddrs
      }
      const ip4 = await this.publicIp()
      this.ip4 = ip4

      let detectedMultiaddr = `/ip4/${ip4}/tcp/${this.opts.tcpPort}/p2p/${this.peerId}`
      detectedMultiaddr = this.multiaddr(detectedMultiaddr)
      multiaddrs.push(detectedMultiaddr)

      this.addresses = multiaddrs

      return multiaddrs
    } catch (error) {
      this.log('Error helia getMultiAddress()  ', error)
      throw error
    }
  }

  // Pin a CID
  async pinCid (cid) {
    if (!cid) {
      throw new Error('CID is required.')
    }

    return new this.Promise(async (resolves, reject) => {
      try {
        this.log('Content downloaded!')
        this.log('Pining content.!')
        for await (const pinnedCid of this.helia.pins.add(CID.parse(cid))) {
          resolves(pinnedCid)
        }
        this.log('Pinned content.!')
      } catch (error) {
        this.log('Error in pinCid()', error)
        reject(error)
      }
    })
  }

  // UN-pin a CID
  async unPinCid (cid) {
    if (!cid) {
      throw new Error('CID is required.')
    }
    return new this.Promise(async (resolves, reject) => {
      try {
        for await (const unpinnedCid of this.helia.pins.rm(CID.parse(cid))) {
          resolves(unpinnedCid)
        }
      } catch (error) {
        this.log('Error in unPinCid()', error)
        reject(error)
      }
    })
  }

  // Get all pins list.
  async getPins () {
    return new this.Promise(async (resolves, reject) => {
      try {
        const pins = []
        for await (const cid of this.helia.pins.ls()) {
          pins.push(cid)
        }

        resolves(pins)
      } catch (error) {
        this.log('Error in getPins()', error)
        reject(error)
      }
    })
  }

  saveKey (key, path) {
    // this.log('fs1', this.fs)
    return new this.Promise((resolve, reject) => {
      try {
        if (!key || typeof key !== 'string') {
          throw new Error('key  must be a string')
        }
        if (!path || typeof path !== 'string') {
          throw new Error('path must be a string')
        }
        // const fileStr = JSON.stringify(obj, null, 2)
        this.fs.writeFile(path, key, function (err) {
          if (err) {
            return reject(err)
          } else {
            return resolve(true)
          }
        })
      } catch (err) {
        this.log('Error in savekey()', err)
        return reject(err)
      }
    })
  }

  readKey (path) {
    return new Promise((resolve, reject) => {
      try {
        if (!path || typeof path !== 'string') {
          throw new Error('path must be a string')
        }

        this.fs.readFile(path, (err, data) => {
          if (err) {
            return reject(err)
          }
          return resolve(data.toString())
        })
      } catch (err) {
        this.log('Error in readKey()', err)
        return reject(err)
      }
    })
  }

  async getDiskSize () {
    try {
      const size = await this.getFolderSize.strict(this.opts.storePath)
      const mbSize = (size / 1000 / 1000).toFixed(2)
      this.log(`Node size :  ${mbSize} MB`)
      return mbSize
    } catch (err) {
      this.log('Error in getDiskSize()', err)
      return false
    }
  }

  async provideCID (cid, options = {}) {
    try {
      if (!cid || typeof cid !== 'string') {
        throw new Error('CID string is required.')
      }
      await this.helia.routing.provide(CID.parse(cid), options)
      this.log(`Provided cid ${cid}`)
      return true
    } catch (err) {
      this.log('Error in provideCID()', err)
      throw err
    }
  }

  cleanDownloading () {
    try {
      const minutesAgoObj = new Date()
      minutesAgoObj.setMinutes(minutesAgoObj.getMinutes() - 2)

      const minutesAgo = minutesAgoObj.getTime()

      Object.keys(this.downloading).forEach(cid => {
        if (this.downloading[cid] && (this.downloading[cid].timestamp) < minutesAgo) {
          delete this.downloading[cid]
        }
      })
      return true
    } catch (error) {
      console.log(error)
      this.log('Error in cleanDownloading(): ', error)
      return false
    }
  }

  // A function prototype to download a cid using the pftp protocol.
  // this function will be replaced if u provide this node to the pftp protocol.
  async pftpDownload (cid) {
    return false
  }
}

export default HeliaNode
