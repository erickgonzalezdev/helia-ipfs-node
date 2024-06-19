import Gateway from './gateway/router.js'

export default class initRouter {
  constructor (config = {}) {
    this.gateway = new Gateway(config)

    this.start = this.start.bind(this)
  }

  start (app) {
    this.gateway.start(app)
  }
}
