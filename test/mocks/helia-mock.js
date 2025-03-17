// Mocks for helia js package node module.
async function * mockIterable () {
  yield new Uint8Array('chunk1')
  yield new Uint8Array('chunk2')
}

class PinsMock {
  constructor () {
    this.add = mockIterable
    this.rm = mockIterable
    this.ls = mockIterable
  }

  async rm () { return true }
  async ls () { return [] }
}

class BlockStoreMock {
  constructor (config) { this.config = config }

  async put () { return true }
  async get () { return true }
}
class RoutingMock {
  constructor (config) { this.config = config }

  async provide () { return true }
  async findProviders () { return [] }
}

class HeliaMock {
  constructor (opts) {
    this.blockstore = {}
    this.datastore = {}
    this.libp2p = opts.libp2p
    this.pins = new PinsMock()
    this.blockstore = new BlockStoreMock()
    this.routing = new RoutingMock()
  }

  getMultiaddrs () { return [] }
  async dial () { return true }
  async gc () { return true }
}

const createHeliaMock = (opts) => {
  return new HeliaMock(opts)
}

export default createHeliaMock
