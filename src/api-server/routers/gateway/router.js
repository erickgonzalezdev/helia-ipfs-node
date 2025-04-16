import Router from 'koa-router'

import Controller from './controller.js'

class RouterHanlder {
  constructor(config) {
    this.node = config.node
    this.controller = new Controller(config)
    this.router = new Router({ prefix: '/ipfs' })
    this.port = config.port
    this.start = this.start.bind(this)

    this.restart = this.restart.bind(this)
  }

  async start(app) {
    this.router.get('/debug/restart/node', this.restart)
    this.router.get('/debug/:debugcid', this.controller.getContent)
    this.router.get('/:cid/:name', this.controller.getContent)
    this.router.get('/:cid', this.controller.getContent)

    app.use(this.router.routes())
    app.use(this.router.allowedMethods())

    const helloCid = await this.controller.setHelloWorld()
    console.log('Gateway started!')
    console.log(`http://127.0.0.1:${this.port}/ipfs/${helloCid}`)
  }


  async restart() {
    try {
      console.log('Restarting node')
      await this.node.helia.stop()
      setTimeout(async () => {
        await this.node.helia.start()
        console.log('Node restarted')
      }, 3000)
    } catch (error) {
      console.error('Error restarting node', error)
    }
  }
}

export default RouterHanlder
