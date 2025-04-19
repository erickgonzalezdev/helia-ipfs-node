import Router from 'koa-router'

import Controller from './controller.js'

class RouterHanlder {
  constructor (config) {
    this.controller = new Controller(config)
    this.router = new Router({ prefix: '/ipfs' })
    this.port = config.port
    this.start = this.start.bind(this)
  }

  async start (app) {
    this.router.get('/connections', this.controller.getConnections)
    this.router.get('/:cid/:name', this.controller.getContent)
    this.router.get('/:cid', this.controller.getContent)

    app.use(this.router.routes())
    app.use(this.router.allowedMethods())

    const helloCid = await this.controller.setHelloWorld()
    console.log('Gateway started!')
    console.log(`http://127.0.0.1:${this.port}/ipfs/${helloCid}`)
  }
}

export default RouterHanlder
