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

class PFTProtocol {
  constructor (config = {}) {
    if (!config.node) {
      throw new Error('Helia-IPFS-Node must be passed on PFTProtocol constructor')
    }
    this.protocol = '/pft/1.0.0'
    this.topic = config.topic
    this.node = config.node
    this.knownPeerAddress = config.knownPeerAddress
    this.knownPeerIsConnected = false
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
    this.renewInitialKnownPeerConnection = this.renewInitialKnownPeerConnection.bind(this)
    this.removeKnownPeer = this.removeKnownPeer.bind(this)
    this.topicHandler = this.topicHandler.bind(this)
    this.listenPeerDisconnections = this.listenPeerDisconnections.bind(this)
    this.cleanKnownPeers = this.cleanKnownPeers.bind(this)

    this.privateAddresssStore = [] // Save al known peers for private connections

    this.blackListAddresssStore = [] //  Save all addresses that failed to connect
    this.disconnectedPeerRecordsTime = {}

    this.notificationTimer = 6000
    this.cleanKnownPeersTimer = 30000
    this.logTimerInterval = 30000

    // inject the downloadCid function to the provided node.
    this.node.pftpDownload = this.downloadCid

    // renew connections timer
    this.renewInitialKnownPeerTimer = 10000
    this.reconnectInitialKnownPeerInterval = setInterval(this.renewInitialKnownPeerConnection, this.renewInitialKnownPeerTimer)

    this.handleTopicSubscriptionInterval = setInterval(this.topicHandler, 80000)
  }

  async start () {
    this.log(`Starting on Private file transfer protocol ( PFTP) on protocol ${this.protocol}`)

    // add provided known peer to address store
    this.addKnownPeer(this.knownPeerAddress)

    // handle pubsub
    this.listenPubsub()

    this.topicHandler()

    // handle protocol
    this.node.helia.libp2p.handle(this.protocol, this.handlePFTProtocol)

    this.listenPeerDisconnections()
    // await this.renewConnections()

    this.nofitySubscriptionInterval = setInterval(async () => {
      const msg = {
        msgType: 'known-peers',
        multiAddress: this.node.addresses[0],
        knownPeers: this.getKnownPeers()
      }
      const msgStr = JSON.stringify(msg)
      this.log('PFTP Sending addresses')
      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msgStr))
    }, this.notificationTimer)

    // Clean Black list every 2 minutes
    this.cleanPeerRecordsInterval = setInterval(this.cleanKnownPeers, this.cleanKnownPeersTimer)

    // Show known peers addresses every 10 seconds
    this.logPrivateAddresssStoreInterval = setInterval(() => {
      this.log('PFTP Known Peers addresses: ', this.privateAddresssStore)
    }, this.logTimerInterval)

    return true
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
      this.node.helia.libp2p.services.pubsub.addEventListener('message', this.handlePubsubMsg)
      return true
    } catch (error) {
      this.log('Error on PFTP/listen()')
      throw error
    }
  }

  listenPeerDisconnections () {
    this.node.helia.libp2p.addEventListener('peer:disconnect', async (evt) => {
      try {
        const disconnectedPeerId = evt.detail.toString()
        // this.log('disconnectedPeerId', disconnectedPeerId)
        // Check if disconnected peer is in our known peers list
        for (const address of this.privateAddresssStore) {
          if (address.includes(disconnectedPeerId)) {
            this.disconnectedPeerRecordsTime[address] = new Date().getTime()
            this.log(`Attempting to reconnect to known peer: ${address}`)
            try {
              const connection = await this.node.connect(address)
              this.log(`Successfully reconnected to peer: ${connection.remoteAddr}`)
              this.disconnectedPeerRecordsTime[address] = null
            } catch (error) {
              this.log(`Failed to reconnect to ${address}: ${error.message}`)
              if (address === this.knownPeerAddress) {
                this.log(`Failed to reconnect to known peer: ${address}`)
                this.knownPeerIsConnected = false
              }
            }
            break
          }
        }
      } catch (error) {
        this.log('Error on PFTP/listenPeerDisconnections()', error)
      }
    })
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
      this.log('New PFT connection request.')
      const decoder = new TextDecoder()
      const source = stream.source
      const sink = stream.sink

      // Validate CID with timeout
      const cidChunks = []

      for await (const chunk of source) {
        cidChunks.push(decoder.decode(chunk.bufs[0]))
      }

      const cid = cidChunks.join('')
      this.log(`PFT connection requesting cid: ${cid}`)

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

      this.log('PFT connection request successful.')
      return true
    } catch (error) {
      this.log('Error in handlePFTProtocol(): ', error)
      return false
    } finally {
      if (stream) {
        await stream.close().catch(err => {
          this.log('Error closing stream:', err)
        })
        this.log('handlePFTProtocol closed stream')
      }
    }
  }

  async fetchCidFromPeer (cid, address) {
    if (!cid || !address) {
      throw new Error('CID and address are required')
    }

    let stream
    try {
      this.log(`Requesting content for CID: ${cid} from address: ${address}`)

      // Add timeout to dial
      stream = await this.node.helia.libp2p.dialProtocol([this.multiaddr(address)], this.protocol)
      this.log('Stream established:', stream.id)

      const encoder = new TextEncoder()
      await stream.sink([encoder.encode(cid)])

      // Add timeout for receiving data
      const receivedData = []
      const receiveTimeout = setTimeout(() => {
        throw new Error('Data reception timeout')
      }, 60000)

      for await (const chunk of stream.source) {
        receivedData.push(chunk.subarray())
      }
      clearTimeout(receiveTimeout)

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
      this.log('Error in fetchCidFromPeer(): ', error)
      // Add peer to blacklist after multiple failures
      return false
    } finally {
      if (stream) {
        await stream.close().catch(err => {
          this.log('Error closing stream:', err)
        })
        this.log('fetchCidFromPeer closed stream')
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
      if (this.privateAddresssStore.includes(address)) {
        return true
      }
      /**
    * If the address is in the black list, ignore it
    */
      if (this.blackListAddresssStore.includes(address)) {
        return false
      }
      await this.node.connect(address)
      if (address === this.knownPeerAddress) {
        this.knownPeerIsConnected = true
      }
      this.privateAddresssStore.push(address)
      this.log(`Successfully connected to peer: ${address}`)
      return true
    } catch (error) {
      // this.log('Error in addKnownPeer(): ', error)
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
  /*
    // Renew subscription connection
    async renewConnections() {
      try {
        clearInterval(this.reconnectConnectionsInterval)
        for (const address of this.privateAddresssStore) {
          // Try to connect to each address into the private addresss store
          try {
            const connection = await this.node.connect(address)
            const ttl = await this.node.helia.libp2p.services.ping.ping(multiaddr(address))
            console.log('ttl', ttl)
            this.log(`Successfully connected to peer : ${connection.remoteAddr}`)
          } catch (dialError) {
            this.log(`Failed to connect to ${address}: ${dialError.message}`)
            this.removeKnownPeer(address)
            continue // Try next address if available
          }
        }
        this.reconnectConnectionsInterval = setInterval(this.renewConnections, this.renewConnectionsTimeout)
        return true
      } catch (error) {
        this.reconnectConnectionsInterval = setInterval(this.renewConnections, this.renewConnectionsTimeout)
        this.log('Error in PFTProtocol/renewConnections()', error.message)
        return false
      }
    } */

  async renewInitialKnownPeerConnection () {
    try {
      this.log(`Known peer is connected: ${this.knownPeerIsConnected}`)
      if (!this.knownPeerAddress || this.knownPeerIsConnected) {
        this.log('No known peer address or already connected to known peer')
        return true
      }
      this.log(`Attempting to connect to known peer: ${this.knownPeerAddress}`)
      clearInterval(this.reconnectInitialKnownPeerInterval)
      await this.node.connect(this.knownPeerAddress)
      this.knownPeerIsConnected = true
      this.log(`Successfully connected to peer: ${this.knownPeerAddress}`)
      this.reconnectInitialKnownPeerInterval = setInterval(this.renewInitialKnownPeerConnection, this.renewInitialKnownPeerTimer)
    } catch (error) {
      this.reconnectInitialKnownPeerInterval = setInterval(this.renewInitialKnownPeerConnection, this.renewInitialKnownPeerTimer)
      this.log('Error in PFTProtocol/renewInitialKnownPeerConnection()', error.message)
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
}

export default PFTProtocol
