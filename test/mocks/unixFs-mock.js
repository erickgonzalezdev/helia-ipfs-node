// Mocks for unixfs js package node module.
async function * mockIterable () {
  yield new Uint8Array('chunk1')
  yield new Uint8Array('chunk2')
}
class UnixFSMock {
  constructor () {
    this.cat = mockIterable
  }

/*   async cat () {
      return catIterable()
  } */
}

const unixfsMock = new UnixFSMock()

export default unixfsMock
