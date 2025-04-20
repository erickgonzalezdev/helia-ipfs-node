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
    this.topic = `${config?.topic ? config.topic : ''}-pftp-protocol`
    this.node = config.node
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
    this.renewConnections = this.renewConnections.bind(this)
    this.removeKnownPeer = this.removeKnownPeer.bind(this)
    this.topicHandler = this.topicHandler.bind(this)

    this.privateAddresssStore = [] // Save al known peers for private connections

    this.blackListAddresssStore = [] //  Save all addresses that failed to connect

    this.notificationTimer = 20000
    this.blackListCleanupTimer = 1000 * 60 * 2
    this.logTimerInterval = 30000

    // inject the downloadCid function to the provided node.
    this.node.pftpDownload = this.downloadCid

    // renew connections timer
    this.renewConnections = this.renewConnections.bind(this)
    this.renewConnectionsTimeout = 60000
    this.reconnectConnectionsInterval = setInterval(this.renewConnections, this.renewConnectionsTimeout)

    this.handleTopicSubscriptionInterval = setInterval(() => { this.topicHandler([this.topic]) }, 90000)
  }

  async start () {
    this.log(`Starting on Private file transfer protocol ( PFTP) on protocol ${this.protocol}`)

    // add provided known peer to address store
    this.addKnownPeer(this.knownPeerAddress)

    // handle pubsub
    this.listenPubsub()

    this.topicHandler([this.topic])

    // handle protocol
    this.node.helia.libp2p.handle(this.protocol, this.handlePFTProtocol)

    await this.renewConnections()

    this.nofitySubscriptionInterval = setInterval(async () => {
      const msg = {
        multiAddress: this.node.addresses[0],
        knownPeers: this.getKnownPeers()
      }
      const msgStr = JSON.stringify(msg)
      this.log('PFTP Sending addresses')
      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msgStr))
    }, this.notificationTimer)

    // Clean Black list every 2 minutes
    this.blackListCleanupInterval = setInterval(() => {
      this.blackListAddresssStore = []
    }, this.blackListCleanupTimer)

    // Show known peers addresses every 10 seconds
    this.logPrivateAddresssStoreInterval = setInterval(() => {
      this.log('PFTP Known Peers addresses: ', this.privateAddresssStore)
    }, this.logTimerInterval)

    return true
  }

  listenPubsub () {
    try {
      this.node.helia.libp2p.services.pubsub.addEventListener('message', this.handlePubsubMsg)
      return true
    } catch (error) {
      this.log('Error on pinRPC/listen()')
      throw error
    }
  }

  handlePubsubMsg (message = {}) {
    try {
      if (message && message.detail) {
        if (message.detail.topic === this.topic) {
          const msgStr = new TextDecoder().decode(message.detail.data)
          const msgObj = JSON.parse(msgStr)
          this.log(`PFTP Msg received! : from  ${message.detail.topic}:`)
          const { multiAddress, knownPeers } = msgObj

          const addresses = [...knownPeers, multiAddress]
          // Update known peers addresses
          for (const address of addresses) {
            this.addKnownPeer(address)
          }

          return true
        }
      }
      return false
    } catch (error) {
      this.log('Error in pinRPC/handlePubsubMsg()', error)
      return false
    }
  }

  async handlePFTProtocol ({ stream }) {
    try {
      this.log('New PFT connection')

      const decoder = new TextDecoder()
      const source = stream.source
      const sink = stream.sink

      let cid = ''

      for await (const chunk of source) {
        // console.log('chunk', chunk.bufs[0])
        cid += decoder.decode(chunk.bufs[0])
      }
      this.log(`PFT connection requesting cid: ${cid}`)

      const has = await this.node.helia.blockstore.has(this.CID.parse(cid))

      if (!has) {
        throw new Error('CID not found!')
        // Obtener el stream del archivo desde UnixFS
      }

      const fileStream = this.node.ufs.cat(cid) // fs = unixfs(helia)

      // Pipe para enviar los chunks directamente
      await this.pipe(
        fileStream, // Source: archivo dividido en chunks
        sink // Sink: enviar directamente a través del stream
      )
      return true
    } catch (error) {
      this.log('Error in handlePFTProtocol(): ', error)
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

  async fetchCidFromPeer (cid, address) {
    let stream
    try {
      this.log('Request new content')
      stream = await this.node.helia.libp2p.dialProtocol([this.multiaddr(address)], this.protocol)
      this.log('Stream Id', stream.id)
      const encoder = new TextEncoder()

      // Enviar el CID que queremos
      await stream.sink([encoder.encode(cid)])

      const cidAdded = await this.node.ufs.addBytes(async function * () {
        for await (const chunk of stream.source) {
          yield chunk.subarray()
        }
      }())

      this.log('cidAdded', cidAdded)
      if (cidAdded.toString() !== cid.toString()) {
        throw new Error('cid does not match!')
      }
      this.log('downloaded cid', cid)
      return true
    } catch (error) {
      this.log('Error in fetchCidFromPeer(): ', error)
      return false
    } finally {
      console.log('try to close stream')
      if (stream) {
        // Ensure stream is properly closed
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

  addKnownPeer (address) {
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
      this.privateAddresssStore.push(address)
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
      this.blackListAddresssStore.push(address)
      this.privateAddresssStore.splice(index, 1)
      return true
    } catch (error) {
      this.log('Error in removeKnownPeer(): ', error.message)
      return false
    }
  }

  // Renew subscription connection
  async renewConnections () {
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
  }

  topicHandler (topics = []) {
    try {
      for (const topic of topics) {
        this.node.helia.libp2p.services.pubsub.unsubscribe(topic)
        this.node.helia.libp2p.services.pubsub.subscribe(topic)
        this.log(`Subcribed to : ${topic}`)
        const peerListeners = this.node.helia.libp2p.services.pubsub.getPeers(topic)
        this.log(`${topic} peerListeners`, peerListeners)
      }

      return true
    } catch (error) {
      this.log('Error in PinRPC/topicHandler()', error)
      return false
    }
  }
}

export default PFTProtocol
