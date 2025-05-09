// Mocks for unixfs js package node module.
async function * mockIterable () {
  yield new Uint8Array('chunk1')
  yield new Uint8Array('chunk2')
}
class UnixFSMock {
  constructor () {
    this.cat = mockIterable
    this.stat = async () => { return { fileSize: 100, localFileSize: 100 } }
    this.addBytes = async () => { return true }
  }

/*   async cat () {
      return catIterable()
  } */
}

const unixfsMock = new UnixFSMock()

export default unixfsMock
