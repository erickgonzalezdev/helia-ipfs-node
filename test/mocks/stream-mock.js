async function * mockIterable () {
  yield { bufs: new TextEncoder().encode(new Uint8Array('buff1')) }
  // yield { bufs : new Uint8Array([new TextEncoder().encode('chunk2')])}
}

class StreamMock {
  constructor () {
    this.source = mockIterable()
    this.sink = () => { return true }
  }

  close () {
    return {
      catch: (func) => {
        func()
      }
    }
  }
}

export default StreamMock
