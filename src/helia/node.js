import { createHelia } from 'helia'
import fs from 'fs'
import { FsBlockstore } from 'blockstore-fs'
import { FsDatastore } from 'datastore-fs'
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'

import { multiaddr } from '@multiformats/multiaddr'
import { keychain } from '@libp2p/keychain'
import { unixfs } from '@helia/unixfs'

import { logger, disable } from '@libp2p/logger'
import path from 'path'
import { bootstrap } from '@libp2p/bootstrap'

import { bootstrapConfig } from '../util/bootstrap.js'

import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { webRTCDirect } from '@libp2p/webrtc'
// import {  webRTC } from '@libp2p/webrtc'

import { webSockets } from '@libp2p/websockets'

// import { autoNAT } from '@libp2p/autonat'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { uPnPNAT } from '@libp2p/upnp-nat'
// import { mdns } from '@libp2p/mdns'
import { delegatedContentRouting } from '@libp2p/delegated-content-routing'
import { create as createIpfsHttpClient } from 'kubo-rpc-client'
// import { CID } from 'multiformats/cid'
import crypto from 'crypto'
import { identify } from '@libp2p/identify'
import { publicIpv4 } from 'public-ip'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'

// default is to use ipfs.io
const client = createIpfsHttpClient({
  // use default api settings
  protocol: 'https',
  port: 443,
  host: 'node0.delegate.ipfs.io'
})

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
    this.keychain = keychain
    this.unixfs = unixfs
    this.logger = logger
    this.disable = disable
    this.Promise = Promise
    this.opts = inputOptions
    this.peerId = null
    this.KeyPath = 'node-key.json'

    this.helia = null
    this.ufs = null
    this.chain = null
    this.ip4 = null

    this.start = this.start.bind(this)
    this.connect = this.connect.bind(this)
    this.upload = this.upload.bind(this)
    this.uploadDir = this.uploadDir.bind(this)

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
    this.log = inputOptions.log || console.log
  }

  // Parse injected options
  async parseOptions () {
    const defaultOptions = {
      storePath: this.opts.storePath || this.path.resolve('./helia-data'),
      nodeKey: this.opts.nodeKey || this.generateSalt(),
      tcpPort: this.opts.tcpPort || 4001,
      wsPort: this.opts.wsPort || 4002,
      announceAddresses: this.opts.announceAddresses || [],
      bootstrapList: this.opts.bootstrapList || bootstrapConfig
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

  async start () {
    try {
      const options = await this.parseOptions()
      this.log('Starting Helia IPFS Node')

      // Create block and data stores.
      const blockstore = new this.FsBlockstore(`${options.storePath}/blockstore`)
      const datastore = new this.FsDatastore(`${options.storePath}/datastore`)

      // Key chain to define node id
      const keychainInit = {
        dek: {
          keyLength: 64,
          iterationCount: 10000,
          salt: options.nodeKey,
          hash: 'sha2-512'
        }
      }

      this.chain = this.keychain(keychainInit)({
        datastore,
        logger: { forComponent: logger('libp2p:keychain') }
      })
      // Define peerId
      let peerId
      let existingKey
      // Verify existing key name
      try {
        existingKey = await this.chain.findKeyByName(options.nodeKey)
      } catch (error) {
        this.log('Key not found ')
      }
      // Create new key if it does not exist ,or use existing key name to define peerId
      if (!existingKey) {
        await this.chain.createKey(options.nodeKey, 'Ed25519', 4096)
        peerId = await this.chain.exportPeerId(options.nodeKey)
      } else {
        peerId = await this.chain.exportPeerId(existingKey.name)
      }

      this.peerId = peerId

      this.log(`Peer ID : ${peerId}`)
      const libp2p = await this.createLibp2p({
        peerId,
        datastore,
        addresses: {
          listen: [
            '/ip4/0.0.0.0/tcp/0',
            `/ip4/0.0.0.0/tcp/${options.tcpPort}`,
            `/ip4/0.0.0.0/tcp/${options.wsPort}/ws`,
            '/webrtc'
          ]
        },
        announce: options.announceAddresses,
        transports: [
          tcp({ logger: logger('upgrade') }),
          circuitRelayTransport({
            discoverRelays: 2
          }),
          webRTCDirect(),
          webSockets()
          /*     webRTC() */
        ],
        connectionEncryption: [
          noise()
        ],
        streamMuxers: [
          yamux()
        ],
        peerDiscovery: [
          // mdns() ,
          bootstrap(bootstrapConfig)

        ],
        peerRouting: [
          delegatedContentRouting(client)
        ],
        services: {
          identify: identify(),
          pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),

          /*        lanDHT: kadDHT({
                   protocol: '/ipfs/lan/kad/1.0.0',
                   clientMode: false
                 }), */
          aminoDHT: kadDHT({
            protocol: '/ipfs/kad/1.0.0',
            peerInfoMapper: removePrivateAddressesMapper
          }),
          nat: uPnPNAT({
            description: 'my-node', // set as the port mapping description on the router, defaults the current libp2p version and your peer id
            ttl: 7200, // TTL for port mappings (min 20 minutes)
            keepAlive: true // Refresh port mapping after TTL expires
          }),
          //  identify: identify(),
          // autoNAT: autoNAT(),
          /*           dht: kadDHT({
                      clientMode: false,
                    }), */

          relay: circuitRelayServer({ // makes the node function as a relay server
            hopTimeout: 30 * 1000, // incoming relay requests must be resolved within this time limit
            advertise: true,
            reservations: {
              maxReservations: 15, // how many peers are allowed to reserve relay slots on this server
              reservationClearInterval: 300 * 1000, // how often to reclaim stale reservations
              applyDefaultLimit: true, // whether to apply default data/duration limits to each relayed connection
              defaultDurationLimit: 2 * 60 * 1000, // the default maximum amount of time a relayed connection can be open for
              defaultDataLimit: BigInt(2 << 7), // the default maximum number of bytes that can be transferred over a relayed connection
              maxInboundHopStreams: 32, // how many inbound HOP streams are allow simultaneously
              maxOutboundHopStreams: 64// how many outbound HOP streams are allow simultaneously
            }
          })
        },
        logger: disable()
      })

      // Create helia node
      this.helia = await this.createHelia({
        blockstore,
        datastore,
        libp2p
      })
      /*       // Attempt to guess our ip4 IP address.
            const ip4 = await this.publicIp()
            this.ip4 = ip4

            let detectedMultiaddr = `/ip4/${ip4}/tcp/${options.tcpPort}/p2p/${this.peerId}`
            detectedMultiaddr = this.multiaddr(detectedMultiaddr) */

      // Get the multiaddrs for the node.
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
      // Connect to the P2WDB Pinning service used by pearson-api.
      await this.helia.libp2p.dial(multiaddr(addr))
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

  /*   // Upload object with dir wrapper
  async uploadObject(obj, objName = 'data.json') {
    try {
      if (!obj) { throw new Error('obj is required!') }

      const encoder = new TextEncoder()
      const cid = await this.ufs.addBytes(encoder.encode(JSON.stringify(obj)), this.helia.blockstore)
      let rootCid = await this.ufs.addDirectory()

      this.log('rootCid', rootCid)
      rootCid = await this.ufs.cp(cid, rootCid, objName)

      return rootCid
    } catch (error) {
      this.log('Error trying to connect to pinning service: ', error)
      throw error
    }
  } */

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

  /*   // Upload string to the node
  async uploadString(str) {
    try {
      if (!str) { throw new Error('str is required!') }

      const encoder = new TextEncoder()
      const cid = await this.ufs.addBytes(encoder.encode(str), this.helia.blockstore)

      return cid
    } catch (error) {
      this.log('Error trying to connect to pinning service: ', error)
      throw error
    }
  } */

  /*   // List provider for a CID
  async listProviders(cid) {
    try {
      for await (const provider of this.helia.libp2p.contentRouting.findProviders(CID.parse(cid))) {
        this.log(`Provider for ${cid}`, provider)
      }
    } catch (error) {
      this.log('Error trying to connect to pinning service: ', error)
      throw error
    }
  }
 */
  generateSalt (phrase) {
    return crypto.randomBytes(16).toString('hex')
  }

  // Get all connected nodes
  getConnections () {
    const cs = this.helia.libp2p.getConnections()
    return cs
  }

  /*   // Renew boostrap connections
  async renewBootstrap() {
    const list = this.opts.bootstrapList.list
    if (!list) return
    for (let i = 0; i < list.length; i++) {
      try {
        this.log(`Try to connect to ${list[i]}`)

        await this.connect(list[i])
        this.log(`Connected to ${list[i]}`)
      } catch (error) {
        this.log(`Cannot connect to ${list[i]}`)
      }
    }
  } */

  // Download content from CID
  async getContent (CID) {
    try {
      if (!CID || typeof CID !== 'string') {
        throw new Error('CID string is required.')
      }

      const chunks = []
      for await (const chunk of this.ufs.cat(CID)) {
        chunks.push(chunk)
      }

      return Buffer.concat(chunks)
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
      const ip4 = await this.publicIp()
      this.ip4 = ip4

      let detectedMultiaddr = `/ip4/${ip4}/tcp/${this.opts.tcpPort}/p2p/${this.peerId}`
      detectedMultiaddr = this.multiaddr(detectedMultiaddr)
      multiaddrs.push(detectedMultiaddr)

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
        await this.getContent(cid.toString())
        for await (const CID of this.helia.pins.add(cid)) {
          resolves(CID)
        }
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
        for await (const CID of this.helia.pins.rm(cid)) {
          resolves(CID)
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
}

export default HeliaNode