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
import { importer } from 'ipfs-unixfs-importer'
import { fixedSize } from 'ipfs-unixfs-importer/chunker'
import { balanced } from 'ipfs-unixfs-importer/layout'
import { pipeline } from 'stream/promises'
import axios from 'axios'

const MAX_CHUNK_SIZE = 256 * 1024 // 256KB chunks

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
    this.removeKnownPeer = this.removeKnownPeer.bind(this)
    this.topicHandler = this.topicHandler.bind(this)
    this.cleanKnownPeers = this.cleanKnownPeers.bind(this)
    this.connect = this.connect.bind(this)
    this.publishKnownPeers = this.publishKnownPeers.bind(this)
    this.startIntervals = this.startIntervals.bind(this)
    this.listenConnectionClose = this.listenConnectionClose.bind(this)
    this.renewKnownPeerConnection = this.renewKnownPeerConnection.bind(this)
    this.disconnect = this.disconnect.bind(this)
    this.retryConnect = this.retryConnect.bind(this)
    // this.restartNode = this.restartNode.bind(this)
    this.sleep = this.sleep.bind(this)

    this.getGatewayByRemoteAddress = this.getGatewayByRemoteAddress.bind(this)
    this.downloadFromGateway = this.downloadFromGateway.bind(this)

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
    this.renewConnectionsInterval = 60000 * 1
    this.restartNodeTime = 60000 * 0.5 // 30 minutes
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
    console.log('startIntervals')
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

    setInterval(() => {
      const mem = process.memoryUsage()
      // console.log('mem', mem)
      console.log(`\x1b[33mRSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB\x1b[0m`)
    }, 1000)

    setInterval(() => {
      // Force garbage collection (if available)
      if (global.gc) {
        console.log('force js garbage collection')
        global.gc()
      } else {
        console.log('no garbage collection')
      }
    }, 3000)
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

  listenConnectionClose () {
    this.libp2p.addEventListener('connection:close', async (evt) => {
      const closedPeerAddr = evt.detail.remoteAddr.toString()

      // Check if the closed connection was with a known peer
      if (this.privateAddresssStore.includes(closedPeerAddr)) {
        this.log(`\x1b[32m Known peer disconnected: ${closedPeerAddr}\x1b[0m`)

        // Record disconnection time
        this.disconnectedPeerRecordsTime[closedPeerAddr] = new Date().getTime()

        if (closedPeerAddr === this.knownPeerAddress) {
          this.knownPeerIsConnected = false
          this.knownPeerDisconnectedTimes++
        }

        // Attempt immediate reconnection
        try {
          this.retryConnect(closedPeerAddr, 1)
          this.log(`\x1b[32mSuccessfully reconnected to peer: ${closedPeerAddr}\x1b[0m`)
          delete this.disconnectedPeerRecordsTime[closedPeerAddr]
        } catch (error) {
          this.log(`\x1b[31mFailed to reconnect to ${closedPeerAddr}: ${error.message}\x1b[0m`)
        }
      }
    })
  }

  async renewKnownPeerConnection () {
    try {
      clearInterval(this.handleReconnectsInterval)
      for (const address of this.privateAddresssStore) {
        try {
          // this disconnection trigger the connection close event, then try to reconnect and renew the connection
          await this.connect(address)
          this.log(`\x1b[33mSuccessfully reconnected to peer: ${address}\x1b[0m`)
        } catch (error) {
          this.log(`\x1b[31mFailed to reconnect to ${address}: ${error.message}\x1b[0m`)
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

  /* async handlePFTProtocol({ stream }) {
    if (!stream) {
      this.log('Error: No stream provided')
      return false
    }

    let fileStream = null
    let source = null
    let sink = null
    let reader = null
    let pipePromise = null

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()

    try {
      this.log('\x1b[32mNew PFT connection request.\x1b[0m')

      source = stream.source
      sink = stream.sink
      reader = source[Symbol.asyncIterator]()
      const { value, done } = await reader.next()

      if (done || !value?.bufs?.[0]) {
        throw new Error('No data received from source')
      }

      const data = JSON.parse(decoder.decode(value.bufs[0]))
      const cid = (data.cid || '').toString()
      const startBytes = Number(data.startBytes || 0)

      if (!cid) {
        throw new Error('Invalid CID format')
      }

      const parsedCID = this.CID.parse(cid)
      const has = await this.node.helia.blockstore.has(parsedCID)

      if (!has) {
        await sink([encoder.encode(JSON.stringify({ error: 'CID_NOT_FOUND' }))])
        throw new Error(`CID ${cid} not found in blockstore`)
      }

      const stats = await this.node.getStat(cid)
      const fileSize = Number(stats.fileSize)

      // Send initial metadata
     // await sink([encoder.encode(JSON.stringify({ fileSize, startBytes }))])

      // Get file stream with smaller chunks
      fileStream = this.node.ufs.cat(cid, {
        chunkSize: MAX_CHUNK_SIZE
      })

      pipePromise = pipe(
        fileStream,
        async function * (source) {
          // Send metadata as first chunk
          yield encoder.encode(JSON.stringify({ fileSize, startBytes }))

          let bytesRead = 0
          for await (const chunk of source) {
            if (bytesRead < startBytes) {
              if (bytesRead + chunk.length <= startBytes) {
                bytesRead += chunk.length
                continue
              }
              const skip = startBytes - bytesRead
              yield chunk.slice(skip)
              bytesRead += chunk.length
            } else {
              yield chunk
              bytesRead += chunk.length
            }
          }
        },
        sink,
      )

      await pipePromise

      this.log('\x1b[32mPFT connection request successful.\x1b[0m')
    } catch (error) {
      this.log('\x1b[31mError in handlePFTProtocol(): \x1b[0m', error)
      return false
    } finally {
      // Cleanup in specific order
      try {
        if (fileStream?.destroy) {
          fileStream.destroy()
        }
        if (sink?.end) {
          await sink.end()
        }
        if (stream?.close) {
          await stream.close()
        }
      } catch (err) {
        this.log('\x1b[31mError during cleanup:\x1b[0m', err)
      }

      // Nullify references
      reader = null
      source = null
      sink = null
      stream = null
      fileStream = null
      pipePromise = null
    }
  } */

  /*   async fetchCidFromPeer (cid, address) {
      if (!cid || !address) {
        throw new Error('CID and address are required')
      }

      let stream = null;
      let retryCount = 0;
      const MAX_RETRIES = 5;
      let fileSize = 0;
      let totalDownloadedSize = 0;
      const chunkCIDs = [];
      let encoder = null;
      let message = null;
      let hasCidMsgErr = '';
      let finalCID = null;
      let entries = null;
      let sink = null;
      let fileInput = null;
      let node =  this.node

      while (retryCount < MAX_RETRIES) {
        try {
          this.log(`\x1b[32mRequesting content for CID: ${cid} from address: ${address}\x1b[0m`)

          stream = await this.libp2p.dialProtocol([this.multiaddr(address)], this.protocol, { signal: AbortSignal.timeout(15000) })
          this.log('\x1b[32mStream established:\x1b[0m', stream.id)

          sink = stream.sink

          encoder = new TextEncoder()
          await sink([encoder.encode(JSON.stringify({ cid, startBytes: totalDownloadedSize }))])
          for await (const chunk of stream.source) {
            try {
              if (!message) {
                message = JSON.parse(new TextDecoder().decode(chunk.bufs[0]))
                console.log('message', message)
                hasCidMsgErr = message.error
                fileSize = message.fileSize
                totalDownloadedSize = message.startBytes || 0
                if (hasCidMsgErr) throw new Error(hasCidMsgErr)
              } else { throw new Error('No message received') }
              continue
            } catch (err) {
              // console.log('put chunk', cid)
              // await node.helia.blockstore.put(CID.parse(cid), chunk.subarray())
              const res = await node.ufs.addFile({ content: chunk.subarray() })
              totalDownloadedSize += chunk.subarray().length
              chunkCIDs.push(res)
              // const percentage = ((totalDownloadedSize / fileSize) * 100).toFixed(2)
              // console.log('\x1b[36mTotal Downloaded Size:\x1b[0m', `\x1b[33m${totalDownloadedSize}\x1b[0m`, `\x1b[32m(${percentage}%)\x1b[0m`)
              // yield chunk.subarray()
            }
          }
          // Necesitamos crear input que el `importer` entienda como archivo
         fileInput = {
            path: 'composed-file',
            content: (async function * () {
              for (const cid of chunkCIDs) {
                const block = await node.helia.blockstore.get(cid)
                yield block
              }
            })()
          }
          entries = importer([fileInput], node.helia.blockstore, {
            cidVersion: 1,
            rawLeaves: true,
            layout: balanced({
              maxChildrenPerNode: 1024
            }),
            chunker: fixedSize({
              chunkSize: 1048576
            })
          })

          for await (const entry of entries) {
            if (entry.path === 'composed-file') {
              finalCID = entry.cid
            }
          }
          this.log('File size', fileSize)
          this.log('finalCID', finalCID)

          const has = await node.helia.blockstore.has(CID.parse(cid))
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
          await new Promise(resolve => setTimeout(resolve, 2500 * retryCount))
        } finally {
          if (sink?.end) {
            console.log('closing sink')
            await sink.end()
          }
          if (stream?.close) {
            console.log('closing stream')
            await stream.close()
          }

          // Clean up variables
          stream = null;
          encoder = null;
          fileInput = null;
          sink = null;
          message = null;
          hasCidMsgErr = null;
          finalCID = null;
          entries = null;
          totalDownloadedSize = null;
          chunkCIDs.length = null;
          console.log('variables cleaned')

        }
      }

      return false;
    }
   */

  async handlePFTProtocol ({ stream }) {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const source = stream.source
    const sink = stream.sink
    try {
      this.log('New PFT connection')

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

  async fetchCidFromPeer (cid, address) {
    let stream
    let retryCount = 0
    const MAX_RETRIES = 5
    const RETRY_DELAY = 2500 // 2 seconds

    while (retryCount < MAX_RETRIES) {
      try {
        this.log(`\x1b[32mRequest new content (attempt ${retryCount + 1}/${MAX_RETRIES})\x1b[0m`)
        stream = await this.libp2p.dialProtocol([this.multiaddr(address)], this.protocol)
        this.log('Stream Id', stream.id)
        const encoder = new TextEncoder()

        // Send the CID we want
        await stream.sink([encoder.encode(cid)])

        let fileSize = 0
        let error = false
        for await (const chunk of stream.source) {
          try {
            const message = JSON.parse(new TextDecoder().decode(chunk.bufs[0]))
            console.log('message', message)
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

        await this.downloadFromGateway(cid, address)
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

  getGatewayByRemoteAddress (address) {
    const ip = address.split('/')[2]
    return ip
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

  // Dial to multiAddress
  async disconnect (addr) {
    try {
      if (!addr) { throw new Error('addr is required!') }
      // Connect to a node
      await this.libp2p.hangUp(multiaddr(addr))
      return true
    } catch (err) {
      this.log('Error PFTP connect()  ', err.message)
      throw err
    }
  }

  async retryConnect (addr, attempt = 1) {
    const MAX_ATTEMPTS = 5
    const RETRY_DELAY = 2000 // 1 minute in milliseconds

    try {
      // Attempt to connect to the node
      const connection = await this.connect(addr)
      this.log(`\x1b[32mSuccessfully connected to ${addr} on attempt ${attempt}\x1b[0m`)
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

  async downloadFromGateway (cid, address) {
    try {
      const GATEWAY_IP = this.getGatewayByRemoteAddress(address)
      console.log('GATEWAY_IP', GATEWAY_IP)
      const GATEWAY_URL = `http://${GATEWAY_IP}:8080/ipfs/download/${cid}`
      console.log('GATEWAY_URL', GATEWAY_URL)
      const response = await axios({
        method: 'get',
        url: `${GATEWAY_URL}`,
        responseType: 'stream'
      })

      const cidAdded = await this.node.ufs.addByteStream(response.data)
      console.log('cidAdded', cidAdded)
    } catch (error) {
      console.error('Error al descargar el archivo:', error.message)
    }
  }
}

export default PFTProtocol
