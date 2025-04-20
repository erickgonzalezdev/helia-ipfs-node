// Mocks for libp2p js package node module.
class Pubsub {
  constructor (config) { this.config = config }

  async subscribe () { return true }
  async publish () { return true }
  async addEventListener () { return true }
  async getTopics () { return [] }
  async unsubscribe () { return true }
  async getPeers () { return [] }
}
class ContentRoutingMock {
  constructor (config) { this.config = config }

  async findProviders () { return true }
  async getConnections () { return [] }
}

class Libp2pMock {
  constructor () {
    this.contentRouting = new ContentRoutingMock()
    this.services = {
      pubsub: new Pubsub(),
      ping: { ping: () => { return 1 } }
    }
  }

  getMultiaddrs () { return [] }
  async dial () { return true }
  async dialProtocol () { return true }
  async hangUp () { return true }
  async getConnections () { return [] }
  async handle () { return true }
}

const createLibp2pMock = (opts) => {
  return new Libp2pMock(opts)
}
export default createLibp2pMock
