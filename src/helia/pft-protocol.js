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
import axios from 'axios'

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
    this.selfAddress = this.node.addresses[0].toString()
    this.knownPeerAddress = config.knownPeerAddress
    this.log = this.node.log || console.log
    this.CID = CID
    this.pipe = pipe
    this.multiaddr = multiaddr
    // bind functions
    this.handlePFTProtocol = this.handlePFTProtocol.bind(this)
    this.fetchCidFromPeer = this.fetchCidFromPeer.bind(this)
    this.start = this.start.bind(this)
    this.downloadCid = this.downloadCid.bind(this)
    this.addKnownPeer = this.addKnownPeer.bind(this)
    this.getKnownPeers = this.getKnownPeers.bind(this)
    this.handlePubsubMsg = this.handlePubsubMsg.bind(this)
    this.listenPubsub = this.listenPubsub.bind(this)
    this.removeKnownPeer = this.removeKnownPeer.bind(this)
    this.topicHandler = this.topicHandler.bind(this)
    this.cleanKnownPeers = this.cleanKnownPeers.bind(this)
    this.publishKnownPeers = this.publishKnownPeers.bind(this)
    this.startIntervals = this.startIntervals.bind(this)
    this.listenConnectionClose = this.listenConnectionClose.bind(this)
    this.renewKnownPeerConnection = this.renewKnownPeerConnection.bind(this)
    this.retryConnect = this.retryConnect.bind(this)
    // this.restartNode = this.restartNode.bind(this)
    this.sleep = this.sleep.bind(this)

    this.downloadFromGateway = this.downloadFromGateway.bind(this)

    this.privateAddresssStore = [] // Save all known peers as {address, gateway} objects

    this.blackListAddressStore = [] //  Save all addresses that failed to connect
    this.disconnectedPeerRecordsTime = {}
    this.pendingReconnects = []

    // inject the downloadCid function to the provided node.
    this.node.pftpDownload = this.downloadCid

    // rIntervals times
    this.notificationTimer = 6000
    this.cleanKnownPeersTimer = 30000
    this.logTimerInterval = 15000
    this.renewInitialKnownPeerTimer = 10000
    this.renewConnectionsInterval = 60000 * 1
    this.restartNodeTime = 60000 * 0.5 // 30 minutes
  }

  async start () {
    this.log(`Starting on Private file transfer protocol ( PFTP) on protocol ${this.protocol}`)
    // add provided known peer to address store
    await this.addKnownPeer({ address: this.knownPeerAddress })
    // if (this.knownPeerAddress && !connected) { throw new Error('Cannot connect to initial known peer') }
    // handle pubsub
    this.listenPubsub()
    this.topicHandler()
    // handle protocol
    this.node.helia.libp2p.handle(this.protocol, this.handlePFTProtocol)
    // this.listenPeerDisconnections()
    this.listenConnectionClose()
    this.startIntervals()
    return true
  }

  startIntervals () {
    this.log('Starting intervals')
    this.handleTopicSubscriptionInterval = setInterval(this.topicHandler, 80000)
    this.handleReconnectsInterval = setInterval(this.renewKnownPeerConnection, this.renewConnectionsInterval)
    this.nofitySubscriptionInterval = setInterval(this.publishKnownPeers, this.notificationTimer)
    this.cleanPeerRecordsInterval = setInterval(this.cleanKnownPeers, this.cleanKnownPeersTimer)
    // Show known peers addresses every 10 seconds
    this.logPrivateAddresssStoreInterval = setInterval(() => {
      this.log('PFTP Known Peers addresses: ', this.privateAddresssStore)
    }, this.logTimerInterval)

    this.connectionsLogsInterval = setInterval(() => {
      this.log('PFTP Connections: ', this.node.helia.libp2p.getConnections()?.length)
    }, 10000)

    setInterval(() => {
      const mem = process.memoryUsage()
      // console.log('mem', mem)
      this.log(`\x1b[33mRSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB\x1b[0m`)
    }, 2000)

    setInterval(() => {
      // Force garbage collection (if available)
      if (global.gc) {
        this.log('JS garbage collection running')
        //  global.gc()
      } else {
        this.log('No JS garbage collection available')
      }
    }, 5000)
  }

  publishKnownPeers () {
    const msg = {
      msgType: 'known-peers',
      multiAddress: this.selfAddress,
      gateway: this.node.GATEWAY_URL,
      knownPeers: this.getKnownPeers()
    }
    const msgStr = JSON.stringify(msg)
    this.log('PFTP Sending addresses')
    this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msgStr))
  }

  cleanKnownPeers () {
    for (const peer of this.privateAddresssStore) {
      const disconnectedTime = this.disconnectedPeerRecordsTime[peer.address]
      if (disconnectedTime) {
        const timeSinceDisconnect = Math.floor((new Date().getTime() - disconnectedTime) / 1000)
        this.log(`Time since disconnect: ${timeSinceDisconnect} seconds for address: ${peer.address}`)
        // Dont remove peer if has been disconnected for less than 3 minutes
        if (timeSinceDisconnect > 180) { // 3 minutes in seconds
          this.removeKnownPeer(peer.address)
        }
      }
    }
  }

  listenPubsub () {
    try {
      this.node.helia.libp2p.services.pubsub.addEventListener('message', this.handlePubsubMsg)
      return true
    } catch (error) {
      this.log('Error on PFTP/listen()')
      throw error
    }
  }

  listenConnectionClose () {
    this.node.helia.libp2p.addEventListener('connection:close', async (evt) => {
      const closedPeerAddr = evt.detail.remoteAddr.toString()

      // Check if the closed connection was with a known peer
      if (this.privateAddresssStore.some(peer => peer.address === closedPeerAddr)) {
        this.log(`\x1b[32m Known peer disconnected: ${closedPeerAddr}\x1b[0m`)

        // Record disconnection time
        this.disconnectedPeerRecordsTime[closedPeerAddr] = new Date().getTime()

        // Attempt immediate reconnection
        try {
          this.retryConnect(closedPeerAddr, 1)
        } catch (error) {
          // this.log(`\x1b[31mFailed to reconnect to ${closedPeerAddr}: ${error.message}\x1b[0m`)
        }
      }
    })
  }

  async renewKnownPeerConnection () {
    try {
      clearInterval(this.handleReconnectsInterval)
      for (const peer of this.privateAddresssStore) {
        try {
          // this disconnection trigger the connection close event, then try to reconnect and renew the connection
          await this.node.connect(peer.address)
          this.log(`\x1b[33mSuccessfully reconnected to peer: ${peer.address}\x1b[0m`)
        } catch (error) {
          this.log(`\x1b[31mFailed to reconnect to ${peer.address}: ${error.message}\x1b[0m`)
        }
      }
      this.handleReconnectsInterval = setInterval(this.renewKnownPeerConnection, this.renewConnectionsInterval)
    } catch (error) {
      this.handleReconnectsInterval = setInterval(this.renewKnownPeerConnection, this.renewConnectionsInterval)
    }
  }

  handlePubsubMsg (message = {}) {
    try {
      this.log('PFTP message received')
      if (message && message.detail) {
        if (message.detail.topic === this.topic) {
          const msgStr = new TextDecoder().decode(message.detail.data)
          const msgObj = JSON.parse(msgStr)
          this.log(`PFTP Msg received! : from  ${message.detail.topic}: , messageType: ${msgObj.msgType}`)
          const { multiAddress, knownPeers, msgType, gateway } = msgObj
          if (msgType === 'known-peers') {
            const providedKnownPeers = knownPeers // provided known peers from the remote node
            providedKnownPeers.push({ address: multiAddress, gateway }) // add remote node address and gateway
            // Update known peers addresses
            for (const peer of providedKnownPeers) {
              this.addKnownPeer(peer)
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
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const source = stream.source
    const sink = stream.sink
    try {
      this.log('\x1b[32mNew PFT connection established\x1b[0m')

      let cid = ''

      for await (const chunk of source) {
        // console.log('chunk', chunk.bufs[0])
        cid += decoder.decode(chunk.bufs[0])
      }
      this.log(`PFT connection requesting cid: ${cid}`)

      const has = await this.node.helia.blockstore.has(this.CID.parse(cid))

      if (!has) {
        throw new Error('CID_NOT_FOUND')
        // Obtener el stream del archivo desde UnixFS
      }

      const stats = await this.node.getStat(cid)
      const fileSize = Number(stats.fileSize)

      // Send initial metadata
      await sink([encoder.encode(JSON.stringify({ fileSize }))])

      return true
    } catch (error) {
      this.log('Error in handlePFTProtocol(): ', error)
      try {
        await sink([encoder.encode(JSON.stringify({ error: error.message }))])
      } catch (err) {
        this.log('Error sending error message:', err)
      }
      return false
    } finally {
      if (stream) {
        // Ensure stream is properly closed
        await stream.close().catch(err => {
          this.log('Error closing stream:', err)
        })
        this.log('handlePFTProtocol closed stream')
      }
    }
  }

  async fetchCidFromPeer (inObj = {}) {
    const { cid, address } = inObj
    let stream
    let retryCount = 0
    const MAX_RETRIES = 5
    const RETRY_DELAY = 2500 // 2 seconds

    while (retryCount < MAX_RETRIES) {
      try {
        this.log(`\x1b[32mRequest new content (attempt ${retryCount + 1}/${MAX_RETRIES})\x1b[0m`)
        stream = await this.node.helia.libp2p.dialProtocol([this.multiaddr(address)], this.protocol)
        this.log('Stream Id', stream.id)
        const encoder = new TextEncoder()

        // Send the CID we want
        await stream.sink([encoder.encode(cid)])

        let fileSize = 0
        let error = false
        for await (const chunk of stream.source) {
          try {
            const message = JSON.parse(new TextDecoder().decode(chunk.bufs[0]))
            this.log('message', message)
            fileSize = message.fileSize
            error = message.error
          } catch (error) {
            this.log('Error parsing message: ', error)
          }
        }
        if (error) {
          throw new Error(error)
        }

        if (fileSize === 0) {
          throw new Error('File size not found!')
        }

        await this.downloadFromGateway(inObj)
        const has = await this.node.helia.blockstore.has(this.CID.parse(cid))
        if (!has) {
          throw new Error('CID not added!')
        }
        this.log(`\x1b[32m Successfully downloaded cid: ${cid} from ${address}\x1b[0m`)
        return true
      } catch (error) {
        this.log(`\x1b[31mError in fetchCidFromPeer (attempt ${retryCount + 1}): ${error.message}\x1b[0m`)
        retryCount++
        if (error.message === 'CID_NOT_FOUND') {
          this.log('\x1b[31mCID not found, giving up\x1b[0m')
          return false
        }
        if (retryCount >= MAX_RETRIES) {
          this.log('\x1b[31mMax retries reached, giving up\x1b[0m')
          return false
        }

        // Wait before retrying
        await this.sleep(RETRY_DELAY * retryCount)
      } finally {
        if (stream) {
          await stream.close().catch(err => {
            this.log('Error closing stream:', err)
          })
          this.log('fetchCidFromPeer closed stream')
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

      for (const peer of this.privateAddresssStore) {
        const inObj = { cid, address: peer.address, gateway: peer.gateway }
        const result = await this.fetchCidFromPeer(inObj)
        this.log(`downloadCid fetch addr${peer.address} result ${result}`)
        if (result) {
          this.log('CID found on PFTP')
          return true
        }
      }
      this.log('NOT CID found on PFTP')
      return false
    } catch (error) {
      this.log('Error in downloadCid(): ', error)
      return false
    }
  }

  async addKnownPeer (inObj = {}) {
    try {
      const { address, gateway } = inObj
      if (!address) {
        throw new Error('Address is required')
      }
      // dont add the node itself
      if (address === this.node.addresses[0].toString()) {
        return false
      }
      // dont add the node itself
      if (address.includes(this.node.peerId.toString())) {
        return false
      }

      if (this.blackListAddressStore.includes(address)) {
        return false
      }
      // Check if address already exists
      if (this.privateAddresssStore.some(peer => peer.address === address)) {
        // update gateway port  to keep updated
        this.privateAddresssStore.find(peer => peer.address === address).gateway = gateway
        return true
      }
      await this.node.connect(address)

      this.privateAddresssStore.push({ address, gateway })
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

      const index = this.privateAddresssStore.findIndex(peer => peer.address === address)
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
      const isSubscribed = this.node.helia.libp2p.services.pubsub.getTopics().includes(this.topic)
      this.log(`isSubscribed: ${isSubscribed}`)
      if (!isSubscribed) {
        this.node.helia.libp2p.services.pubsub.subscribe(this.topic)
        this.log(`Subcribed to : ${this.topic}`)
      }
      return true
    } catch (error) {
      this.log('Error in PFTP/topicHandler()', error)
      return false
    }
  }

  async retryConnect (addr, attempt = 1) {
    const MAX_ATTEMPTS = 5
    const RETRY_DELAY = 2000 // 1 minute in milliseconds

    try {
      // Attempt to connect to the node
      const connection = await this.node.connect(addr)
      this.log(`\x1b[32mSuccessfully connected to ${addr} on attempt ${attempt}\x1b[0m`)
      delete this.disconnectedPeerRecordsTime[addr]
      return connection
    } catch (error) {
      this.log(`\x1b[33mFailed to connect to ${addr} (attempt ${attempt}/${MAX_ATTEMPTS}): ${error.message}\x1b[0m`)

      if (attempt >= MAX_ATTEMPTS) {
        this.log(`\x1b[31mMax attempts (${MAX_ATTEMPTS}) reached. Giving up.\x1b[0m`)
        return false
      }

      // Wait for RETRY_DELAY before next attempt
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))

      // Recursive call for next attempt
      return this.retryConnect(addr, attempt + 1)
    }
  }

  // Add sleep utility function
  async sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async downloadFromGateway (inObj = {}) {
    try {
      const { cid, gateway } = inObj
      if (!gateway) {
        throw new Error('Gateway is required')
      }
      const GATEWAY_URL = `${gateway}/${cid}`
      this.log('GATEWAY_URL TO DOWNLOAD', GATEWAY_URL)
      const response = await axios({
        method: 'get',
        url: `${GATEWAY_URL}`,
        responseType: 'stream'
      })

      const cidAdded = await this.node.ufs.addByteStream(response.data)
      this.log('cidAdded', cidAdded)
    } catch (error) {
      this.log('Error on downloadFromGateway:', error.message)
    }
  }
}

export default PFTProtocol
