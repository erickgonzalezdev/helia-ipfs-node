/**
 *
 * Custom private file transfer protocol.
 *
 *
 */
import { CID } from 'multiformats/cid'
import { pipe } from 'it-pipe'
import { multiaddr } from '@multiformats/multiaddr'
class PFTProtocol {
  constructor (config = {}) {
    if (!config.node) {
      throw new Error('Helia-IPFS-Node must be passed on pinRPC constructor')
    }
    this.protocol = '/pft/1.0.0'
    this.node = config.node
    this.log = this.node.log || console.log

    // bind functions
    this.handlePFTProtocol = this.handlePFTProtocol.bind(this)
    this.fetchCidFromPeer = this.fetchCidFromPeer.bind(this)
    this.start = this.start.bind(this)
    this.downloadCid = this.downloadCid.bind(this)
    this.addKnownPeer = this.addKnownPeer.bind(this)
    this.removeKnownPeer = this.removeKnownPeer.bind(this)
    this.getKnownPeers = this.getKnownPeers.bind(this)

    this.privateAddresssStore = []

    this.logPrivateAddresssStoreInterval = setInterval(() => {
      this.log('PFTP Known Peers addresses: ', this.privateAddresssStore)
    }, 10000)
  }

  start () {
    this.log(`Starting on Private file transfer protocol ( PFTP) on protocol ${this.protocol}`)
    this.node.helia.libp2p.handle(this.protocol, this.handlePFTProtocol)
  }

  async handlePFTProtocol ({ stream }) {
    try {
      const decoder = new TextDecoder()
      const source = stream.source
      const sink = stream.sink

      let cid = ''

      for await (const chunk of source) {
        // console.log('chunk', chunk.bufs[0])
        cid += decoder.decode(chunk.bufs[0])
      }

      const has = await this.node.helia.blockstore.has(CID.parse(cid))

      if (!has) {
        throw new Error('CID not found!')
        // Obtener el stream del archivo desde UnixFS
      }

      const fileStream = this.node.ufs.cat(cid) // fs = unixfs(helia)

      // Pipe para enviar los chunks directamente
      await pipe(
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
      }
    }
  }

  async fetchCidFromPeer (cid, address) {
    try {
      this.log('request new content')
      const stream = await this.node.helia.libp2p.dialProtocol([multiaddr(address)], this.protocol)
      const encoder = new TextEncoder()

      // Enviar el CID que queremos
      await stream.sink([encoder.encode(cid)])

      const cidAdded = await this.node.ufs.addBytes(async function * () {
        for await (const chunk of stream.source) {
          // console.log('chunk', chunk.subarray())
          yield chunk.subarray()
        }
      }())

      if (cidAdded.toString() !== cid.toString()) {
        throw new Error('cid does not match!')
      }
      this.log('downloaded cid', cid)
      return true
    } catch (error) {
      this.log('Error in fetchCid(): ', error)
      return false
    }
  }

  async downloadCid (cid) {
    try {
      const has = await this.node.helia.blockstore.has(CID.parse(cid))

      if (has) {
        return true
      }
      if (this.privateAddresssStore.length === 0) {
        throw new Error('No private addresss store found')
      }

      for (const address of this.privateAddresssStore) {
        const result = await this.fetchCidFromPeer(cid, address)
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
    if (!address) {
      return false
    }
    if (this.privateAddresssStore.includes(address)) {
      return true
    }
    this.privateAddresssStore.push(address)
    return true
  }

  removeKnownPeer (address) {
    if (!address) {
      return false
    }
    this.privateAddresssStore = this.privateAddresssStore.filter(a => a !== address)
    return true
  }

  getKnownPeers () {
    return this.privateAddresssStore
  }
}

export default PFTProtocol
