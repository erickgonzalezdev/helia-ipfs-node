// Mocks for libp2p js package node module.
class Pubsub {
  constructor () {}

  async subscribe () { return true }
  async publish () { return true }
  async addEventListener () { return true }
}
class ContentRoutingMock {
  constructor () {}

  async findProviders () { return true }
  async getConnections () { return [] }
}

class Libp2pMock {
  constructor () {
    this.contentRouting = new ContentRoutingMock()
    this.services = {
      pubsub: new Pubsub()
    }
  }

  getMultiaddrs () { return [] }
  async dial () { return true }
  async getConnections () { return [] }
}

const createLibp2pMock = (opts) => {
  return new Libp2pMock(opts)
}
export default createLibp2pMock
