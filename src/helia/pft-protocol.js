/**
 *
 *  Custom private file transfer protocol.
 *
 *  This protocol allow to  fetch a cid  from  another  known connected peer
 *
 *  This protocol allow to share all known peers to another connected nodes with the same topic
 *  in order to get all nodes with this protocol and same topic keep connected!.
 *
 */
import { CID } from 'multiformats/cid'
import { pipe } from 'it-pipe'
import { multiaddr } from '@multiformats/multiaddr'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { ping } from '@libp2p/ping'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { logger, disable } from '@libp2p/logger'
import { createLibp2p } from 'libp2p'

class PFTProtocol {
  constructor (config = {}) {
    if (!config.node) {
      throw new Error('Helia-IPFS-Node must be passed on PFTProtocol constructor')
    }
    this.pftPort = config.pftPort || 4004
    this.protocol = '/pft/1.0.0'
    this.topic = config.topic
    this.node = config.node
    this.selfAddress = null
    this.knownPeerAddress = config.knownPeerAddress
    this.knownPeerIsConnected = false
    this.knownPeerDisconnectedTimes = 0 // For log only
    this.log = this.node.log || console.log
    this.CID = CID
    this.createLibp2p = createLibp2p
    this.pipe = pipe
    this.multiaddr = multiaddr
    // bind functions
    this.instantiateLibp2p = this.instantiateLibp2p.bind(this)
    this.handlePFTProtocol = this.handlePFTProtocol.bind(this)
    this.fetchCidFromPeer = this.fetchCidFromPeer.bind(this)
    this.start = this.start.bind(this)
    this.downloadCid = this.downloadCid.bind(this)
    this.addKnownPeer = this.addKnownPeer.bind(this)
    this.getKnownPeers = this.getKnownPeers.bind(this)
    this.handlePubsubMsg = this.handlePubsubMsg.bind(this)
    this.listenPubsub = this.listenPubsub.bind(this)
    this.renewInitialKnownPeerConnection = this.renewInitialKnownPeerConnection.bind(this)
    this.removeKnownPeer = this.removeKnownPeer.bind(this)
    this.topicHandler = this.topicHandler.bind(this)
    this.listenPeerDisconnections = this.listenPeerDisconnections.bind(this)
    this.cleanKnownPeers = this.cleanKnownPeers.bind(this)
    this.handlePendingReconnects = this.handlePendingReconnects.bind(this)
    this.connect = this.connect.bind(this)
    this.publishKnownPeers = this.publishKnownPeers.bind(this)
    this.startIntervals = this.startIntervals.bind(this)

    this.privateAddresssStore = [] // Save al known peers for private connections

    this.blackListAddresssStore = [] //  Save all addresses that failed to connect
    this.disconnectedPeerRecordsTime = {}
    this.pendingReconnects = []
    this.libp2p = null

    // inject the downloadCid function to the provided node.
    this.node.pftpDownload = this.downloadCid

    // rIntervals times
    this.notificationTimer = 6000
    this.cleanKnownPeersTimer = 30000
    this.logTimerInterval = 15000
    this.renewInitialKnownPeerTimer = 10000
    this.pendingReconnectsInterval = 15000
  }

  async start () {
    this.log(`Starting on Private file transfer protocol ( PFTP) on protocol ${this.protocol}`)
    await this.instantiateLibp2p()
    // add provided known peer to address store
    await this.addKnownPeer(this.knownPeerAddress)
    //if (this.knownPeerAddress && !connected) { throw new Error('Cannot connect to initial known peer') }
    // handle pubsub
    this.listenPubsub()
    this.topicHandler()
    // handle protocol
    this.libp2p.handle(this.protocol, this.handlePFTProtocol)
    this.listenPeerDisconnections()

    this.startIntervals()
    return true
  }

  startIntervals () {
    this.handleTopicSubscriptionInterval = setInterval(this.topicHandler, 80000)
    this.handlePendingReconnectsInterval = setInterval(this.handlePendingReconnects, this.pendingReconnectsInterval)
    this.nofitySubscriptionInterval = setInterval(this.publishKnownPeers, this.notificationTimer)
    this.cleanPeerRecordsInterval = setInterval(this.cleanKnownPeers, this.cleanKnownPeersTimer)
    // Show known peers addresses every 10 seconds
    this.logPrivateAddresssStoreInterval = setInterval(() => {
      this.log('PFTP Known Peers addresses: ', this.privateAddresssStore)
      this.log(`Known peer disconnected times: ${this.knownPeerDisconnectedTimes}`)
    }, this.logTimerInterval)

    this.connectionsLogsInterval = setInterval(() => {
      this.log('PFTP Connections: ', this.libp2p.getConnections()?.length)
    }, 5000)
  }

  publishKnownPeers () {
    const msg = {
      msgType: 'known-peers',
      multiAddress: this.selfAddress,
      knownPeers: this.getKnownPeers()
    }
    const msgStr = JSON.stringify(msg)
    this.log('PFTP Sending addresses')
    this.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msgStr))
  }

  async instantiateLibp2p () {
    this.libp2p = await this.createLibp2p({
      privateKey: this.node.keyPair,
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${this.pftPort}`]
      },
      connectionManager: {
        minConnections: 1,
        autoDial: true
      },
      transports: [
        tcp({ logger: logger('upgrade') })
      ],
      connectionEncrypters: [
        noise()
      ],
      streamMuxers: [
        yamux()
      ],
      services: {
        identify: identify(),
        pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
        ping: ping()
      },
      logger: disable()
    })
    const multiaddrs = this.libp2p.getMultiaddrs()
    this.selfAddress = multiaddrs[0].toString()
    this.log('PFTP Multiaddrs: ', multiaddrs)
  }

  cleanKnownPeers () {
    for (const address of this.privateAddresssStore) {
      const disconnectedTime = this.disconnectedPeerRecordsTime[address]
      if (disconnectedTime) {
        const timeSinceDisconnect = Math.floor((new Date().getTime() - disconnectedTime) / 1000)
        this.log(`Time since disconnect: ${timeSinceDisconnect} seconds for address: ${address}`)
        // Dont remove peer if has been disconnected for less than 3 minutes
        if (timeSinceDisconnect > 180) { // 3 minutes in seconds
          this.removeKnownPeer(address)
        }
      }
    }
  }

  listenPubsub () {
    try {
      this.libp2p.services.pubsub.addEventListener('message', this.handlePubsubMsg)
      return true
    } catch (error) {
      this.log('Error on PFTP/listen()')
      throw error
    }
  }

  listenPeerDisconnections () {
    this.libp2p.addEventListener('peer:disconnect', async (evt) => {
      try {
        const disconnectedPeerId = evt.detail.toString()
        // this.log('disconnectedPeerId', disconnectedPeerId)
        // Check if disconnected peer is in our known peers list
        for (const address of this.privateAddresssStore) {
          if (address.includes(disconnectedPeerId)) {
            if (this.pendingReconnects.includes(address)) {
              continue
            }
            this.log(`\x1b[33mDisconnected known peer: ${disconnectedPeerId}\x1b[0m`)
            this.pendingReconnects.push(address)
            this.disconnectedPeerRecordsTime[address] = new Date().getTime()
            if (address === this.knownPeerAddress) {
              this.knownPeerIsConnected = false
              this.knownPeerDisconnectedTimes += 1
            }
            break
          }
        }
      } catch (error) {
        this.log('Error on PFTP/listenPeerDisconnections()', error)
      }
    })
  }

  async handlePendingReconnects () {
    if (this.pendingReconnects.length === 0) {
      return
    }
    this.log(`\x1b[33mPendings ${this.pendingReconnects.length} reconnects`)
    clearInterval(this.handlePendingReconnectsInterval)
    for (const address of this.pendingReconnects) {
      this.log(`\x1b[33mAttempting to reconnect to known peer: ${address}\x1b[0m`)
      try {
        const connection = await this.connect(address)
        this.log(`\x1b[33smSuccessfully reconnected to peer: ${connection.remoteAddr}\x1b[0m`)
        this.disconnectedPeerRecordsTime[address] = null
        // Remove from pending reconnects after successful reconnection
        this.pendingReconnects = this.pendingReconnects.filter(addr => addr !== address)

        if (address === this.knownPeerAddress) {
          this.knownPeerIsConnected = true
        }
      } catch (error) {
        this.log(`\x1b[31mFailed to reconnect to ${address}: ${error.message}\x1b[0m`)
      }
    }
    this.handlePendingReconnectsInterval = setInterval(this.handlePendingReconnects, this.pendingReconnectsInterval)
  }

  handlePubsubMsg (message = {}) {
    try {
      this.log('PFTP message received')
      if (message && message.detail) {
        if (message.detail.topic === this.topic) {
          const msgStr = new TextDecoder().decode(message.detail.data)
          const msgObj = JSON.parse(msgStr)
          this.log(`PFTP Msg received! : from  ${message.detail.topic}: , messageType: ${msgObj.msgType}`)
          const { multiAddress, knownPeers, msgType } = msgObj
          if (msgType === 'known-peers') {
            const addresses = [...knownPeers, multiAddress]
            // Update known peers addresses
            for (const address of addresses) {
              this.addKnownPeer(address)
            }
            return true
          }
        }
      }
      return false
    } catch (error) {
      this.log('Error in PFTP/handlePubsubMsg()', error)
      return false
    }
  }

  async handlePFTProtocol ({ stream }) {
    if (!stream) {
      this.log('Error: No stream provided')
      return false
    }

    try {
      this.log('\x1b[32mNew PFT connection request.\x1b[0m')
      const decoder = new TextDecoder()
      const source = stream.source
      const sink = stream.sink

      // Validate CID with timeout
      const cidChunks = []

      for await (const chunk of source) {
        cidChunks.push(decoder.decode(chunk.bufs[0]))
      }

      const cid = cidChunks.join('')
      this.log(`\x1b[32mPFT connection requesting cid: ${cid}\x1b[0m`)

      // Validate CID format
      if (!cid || typeof cid !== 'string') {
        throw new Error('Invalid CID format')
      }

      const parsedCID = this.CID.parse(cid)
      const has = await this.node.helia.blockstore.has(parsedCID)

      if (!has) {
        throw new Error(`CID ${cid} not found in blockstore`)
      }

      const fileStream = await this.node.ufs.cat(cid)
      await this.pipe(fileStream, sink)

      this.log('\x1b[32mPFT connection request successful.\x1b[0m')
      return true
    } catch (error) {
      this.log('\x1b[31mError in handlePFTProtocol(): \x1b[0m', error)
      return false
    } finally {
      if (stream) {
        await stream.close().catch(err => {
          this.log('\x1b[31mError closing stream:\x1b[0m', err)
        })
        this.log('\x1b[31mhandlePFTProtocol closed stream\x1b[0m')
      }
    }
  }

  async fetchCidFromPeer (cid, address) {
    if (!cid || !address) {
      throw new Error('CID and address are required')
    }

    let stream
    try {
      this.log(`\x1b[32mRequesting content for CID: ${cid} from address: ${address}\x1b[0m`)

      // Add timeout to dial

      stream = await this.libp2p.dialProtocol([this.multiaddr(address)], this.protocol)
      this.log('\x1b[32mStream established:\x1b[0m', stream.id)

      const encoder = new TextEncoder()
      await stream.sink([encoder.encode(cid)])

      // Add timeout for receiving data
      const receivedData = []
      /*     const receiveTimeout = setTimeout(() => {
        throw new Error('Data reception timeout')
      }, 60000) */

      for await (const chunk of stream.source) {
        receivedData.push(chunk.subarray())
      }
      // clearTimeout(receiveTimeout)

      const cidAdded = await this.node.ufs.addBytes(async function * () {
        for (const chunk of receivedData) {
          yield chunk
        }
      }())

      if (cidAdded.toString() !== cid.toString()) {
        throw new Error(`CID mismatch: expected ${cid}, got ${cidAdded}`)
      }

      this.log('Successfully downloaded and verified CID:', cid)
      return true
    } catch (error) {
      if (error.name === 'AbortError') {
        this.log('\x1b[31mTimeout reached while downloading CID\x1b[0m')
      } else {
        this.log('\x1b[31mError in fetchCidFromPeer(): \x1b[0m', error)
      }
      // Add peer to blacklist after multiple failures
      return false
    } finally {
      if (stream) {
        await stream.close().catch(err => {
          this.log('\x1b[31mError closing stream:\x1b[0m', err)
        })
        this.log('\x1b[31mfetchCidFromPeer closed stream\x1b[0m')
      }
    }
  }

  async downloadCid (cid) {
    try {
      const has = await this.node.helia.blockstore.has(this.CID.parse(cid))
      if (has) {
        return true
      }
      if (this.privateAddresssStore.length === 0) {
        throw new Error('No private addresss store found')
      }

      for (const address of this.privateAddresssStore) {
        const result = await this.fetchCidFromPeer(cid, address)
        // console.log('result', result)
        if (result) {
          return true
        }
      }
      return false
    } catch (error) {
      this.log('Error in downloadCid(): ', error)
      return false
    }
  }

  async addKnownPeer (address) {
    try {
      if (!address) {
        throw new Error('Address is required')
      }
      if (address === this.node.addresses[0].toString()) {
        return false
      }
      if (address.includes(this.node.peerId.toString())) {
        return false
      }
      if (this.privateAddresssStore.includes(address)) {
        return true
      }
      /**
    * If the address is in the black list, ignore it
    */
      if (this.blackListAddresssStore.includes(address)) {
        return false
      }
      await this.connect(address)
      if (address === this.knownPeerAddress) {
        this.knownPeerIsConnected = true
      }
      this.privateAddresssStore.push(address)
      this.log(`Successfully connected to peer: ${address}`)
      return true
    } catch (error) {
      this.log('Error in addKnownPeer(): ', error.message)
      return false
    }
  }

  getKnownPeers () {
    return this.privateAddresssStore
  }

  removeKnownPeer (address) {
    try {
      if (!address) {
        throw new Error('Address is required')
      }
      if (address === this.knownPeerAddress) {
        throw new Error('Cannot remove initial known peer address')
      }

      const index = this.privateAddresssStore.indexOf(address)
      if (index === -1) {
        return false
      }
      this.privateAddresssStore.splice(index, 1)
      return true
    } catch (error) {
      this.log('Error in removeKnownPeer(): ', error.message)
      return false
    }
  }

  topicHandler () {
    try {
      const isSubscribed = this.libp2p.services.pubsub.getTopics().includes(this.topic)
      this.log(`isSubscribed: ${isSubscribed}`)
      if (!isSubscribed) {
        this.libp2p.services.pubsub.subscribe(this.topic)
        this.log(`Subcribed to : ${this.topic}`)
      }
      return true
    } catch (error) {
      this.log('Error in PFTP/topicHandler()', error)
      return false
    }
  }

  // Dial to multiAddress
  async connect (addr) {
    try {
      if (!addr) { throw new Error('addr is required!') }
      // Connect to a node
      const conection = await this.libp2p.dial(multiaddr(addr))
      return conection
    } catch (err) {
      this.log('Error PFTP connect()  ', err.message)
      throw err
    }
  }

  /**
   *
   * This function is used to renew the connection to the initial known peer
   * TODO :  verif if this function is needed due to the pending reconnects
   */
    async renewInitialKnownPeerConnection() {
      try {
        this.log(`Known peer is connected: ${this.knownPeerIsConnected}`)
        if (!this.knownPeerAddress || this.knownPeerIsConnected) {
          this.log('No known peer address or already connected to known peer')
          return true
        }
        this.log(`Attempting to connect to known peer: ${this.knownPeerAddress}`)
        clearInterval(this.reconnectInitialKnownPeerInterval)
        await this.connect(this.knownPeerAddress)
        this.knownPeerIsConnected = true
        this.log(`Successfully connected to peer: ${this.knownPeerAddress}`)
        this.pendingReconnects = this.pendingReconnects.filter(addr => addr !== this.knownPeerAddress)
        this.reconnectInitialKnownPeerInterval = setInterval(this.renewInitialKnownPeerConnection, this.renewInitialKnownPeerTimer)
      } catch (error) {
        this.reconnectInitialKnownPeerInterval = setInterval(this.renewInitialKnownPeerConnection, this.renewInitialKnownPeerTimer)
        this.log('Error in PFTProtocol/renewInitialKnownPeerConnection()', error.message)
      }
    } 
}

export default PFTProtocol
