// Mocks for libp2p
class ContentRoutingMock {
  constructor () {}

  async findProviders () { return true }
  async getConnections () { return [] }
}

class Libp2pMock {
  constructor () {
    this.contentRouting = new ContentRoutingMock()
  }

  getMultiaddrs () { return [] }
  async dial () { return true }
  async getConnections () { return [] }
}

const createLibp2pMock = (opts) => {
  return new Libp2pMock(opts)
}
export default createLibp2pMock
