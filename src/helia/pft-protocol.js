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
    this.announce = config.node.opts.announce
    this.ip4 = config.node.ip4
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
    this.listenConnectionClose = this.listenConnectionClose.bind(this)
    this.renewKnownPeerConnection = this.renewKnownPeerConnection.bind(this)

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
    this.renewConnectionsInterval = 15000

    this.renewKnownPeerConnectionRunning = false
  }

  async start () {
    this.log(`Starting on Private file transfer protocol ( PFTP) on protocol ${this.protocol}`)
    await this.instantiateLibp2p()
    // add provided known peer to address store
    await this.addKnownPeer(this.knownPeerAddress)
    // if (this.knownPeerAddress && !connected) { throw new Error('Cannot connect to initial known peer') }
    // handle pubsub
    this.listenPubsub()
    this.topicHandler()
    // handle protocol
    this.libp2p.handle(this.protocol, this.handlePFTProtocol)
    // this.listenPeerDisconnections()
    this.listenConnectionClose()
    this.startIntervals()
    return true
  }

  startIntervals () {
    this.handleTopicSubscriptionInterval = setInterval(this.topicHandler, 80000)
    this.handleReconnectsInterval = setInterval(this.renewKnownPeerConnection, this.renewConnectionsInterval)
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
        listen: [`/ip4/0.0.0.0/tcp/${this.pftPort}`],
        announce: this.announce ? [`/ip4/${this.ip4}/tcp/${this.pftPort}`] : []

      },
      connectionManager: {
        minConnections: 1,
        autoDial: true
      },
      transports: [
        tcp({
          logger: logger('upgrade'),
          outboundSocketInactivityTimeout: 60000 * 30,
          socketCloseTimeout: 30000 // Connection timeout in ms
        })
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
    this.libp2p.addEventListener('connection:close', async (evt) => {
      try {
        console.log('evt', evt)
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

  listenConnectionClose () {
    this.libp2p.addEventListener('connection:close', async (evt) => {
      this.log('\x1b[33mPFTP Connection closed with peer: ' + evt.detail.remoteAddr.toString() + '\x1b[0m')
      await this.renewKnownPeerConnection()
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

  async renewKnownPeerConnection () {
    this.log('try renewKnownPeerConnection')
    if (this.renewKnownPeerConnectionRunning) {
      this.log('renewKnownPeerConnection already running')
      return
    }
    this.log('renewKnownPeerConnection running')
    this.renewKnownPeerConnectionRunning = true
    for (const address of this.privateAddresssStore) {
      try {
        await this.connect(address)
        this.log(`\x1b[33mSuccessfully reconnected to peer: ${address}\x1b[0m`)
      } catch (error) {
        this.log(`\x1b[31mFailed to reconnect to ${address}: ${error.message}\x1b[0m`)
      }
    }
    this.renewKnownPeerConnectionRunning = false
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
      const encoder = new TextEncoder()
      const source = stream.source
      const sink = stream.sink

      // Get requested CID and optional byte range
      const cidChunks = []

      for await (const chunk of source) {
        const data = JSON.parse(decoder.decode(chunk.bufs[0]))
        if (data.cid) cidChunks.push(data.cid)
      }

      const cid = cidChunks.join('')

      // Validate CID format and existence
      if (!cid || typeof cid !== 'string') {
        throw new Error('Invalid CID format')
      }

      const parsedCID = this.CID.parse(cid)
      const has = await this.node.helia.blockstore.has(parsedCID)

      if (!has) {
        await stream.sink([encoder.encode(JSON.stringify({ error: 'CID_NOT_FOUND' }))])
        throw new Error(`CID ${cid} not found in blockstore`)
      }

      const stats = await this.node.getStat(cid)
      const fileSize = Number(stats.fileSize)

      const fileStream = await this.node.ufs.cat(cid)

      await pipe(
        fileStream,
        async function * (source) {
          yield encoder.encode(JSON.stringify({ fileSize }))

          for await (const chunk of source) {
            yield chunk
          }
        },
        sink
      )

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
    let retryCount = 0
    const MAX_RETRIES = 5
    let fileSize = 0

    while (retryCount < MAX_RETRIES) {
      try {
        this.log(`\x1b[32mRequesting content for CID: ${cid} from address: ${address}\x1b[0m`)

        stream = await this.libp2p.dialProtocol([this.multiaddr(address)], this.protocol, { signal: AbortSignal.timeout(10000) })
        this.log('\x1b[32mStream established:\x1b[0m', stream.id)

        const encoder = new TextEncoder()
        await stream.sink([encoder.encode(JSON.stringify({ cid }))])

        let hasCidMsgErr = ''
        let message

        const cidAdded = await this.node.ufs.addBytes(async function * () {
          for await (const chunk of stream.source) {
            try {
              if (!message) {
                message = JSON.parse(new TextDecoder().decode(chunk.bufs[0]))
                console.log('message', message)
                hasCidMsgErr = message.error
                fileSize = message.fileSize
                if (hasCidMsgErr) throw new Error(hasCidMsgErr)
              } else { throw new Error('No message received') }
              continue
            } catch (err) {
              yield chunk.subarray()
            }
          }
        }())

        this.log('cidAdded', cidAdded)

        const has = await this.node.helia.blockstore.has(CID.parse(cid))
        if (!has) { throw new Error('Download failed') }

        this.log('Successfully downloaded and verified CID:', cid)
        return true
      } catch (error) {
        this.log(`\x1b[31mError in fetchCidFromPeer (attempt ${retryCount + 1}): \x1b[0m`, error)
        retryCount++

        if (retryCount >= MAX_RETRIES) {
          this.log('\x1b[31mMax retries reached, giving up\x1b[0m')
          return false
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 3000 * retryCount))
      } finally {
        if (stream) {
          await stream.close().catch(err => {
            this.log('\x1b[31mError closing stream:\x1b[0m', err)
          })
          this.log('\x1b[31mfetchCidFromPeer closed stream\x1b[0m')
        }
      }
    }

    return false
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
        console.log(`downloadCid fetch addr${address} result ${result}`)
        if (result) {
          console.log('CID found on PFTP')
          return true
        }
      }
      console.log('NOT CID found on PFTP')
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
  async renewInitialKnownPeerConnection () {
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
