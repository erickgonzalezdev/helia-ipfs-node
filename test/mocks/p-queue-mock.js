class PQueueMock {
  constructor (config) {
    this.config = config
    this.timeout = 10000
  }

  async add () {
    return ''
  }
}

export default PQueueMock
