import Router from 'koa-router'

import Controller from './controller.js'

class RouterHanlder {
  constructor (config) {
    this.controller = new Controller(config)
    this.router = new Router({ prefix: '/ipfs' })
    this.port = config.port
    this.node = config.node
    this.start = this.start.bind(this)
    this.generateGatewayURL = this.generateGatewayURL.bind(this)
  }

  async start (app) {
    this.router.get('/connections', this.controller.getConnections)
    this.router.get('/download/:cid', this.controller.downloadContent)
    this.router.get('/pftp/:cid', this.controller.pftpDownload)
    this.router.get('/metadata/:cid', this.controller.getMetadata)
    this.router.get('/:cid/:name', this.controller.getContent)
    this.router.get('/:cid', this.controller.getContent)

    app.use(this.router.routes())
    app.use(this.router.allowedMethods())

    const gatewayURL = this.generateGatewayURL()
    this.node.GATEWAY_URL = gatewayURL

    const helloCid = await this.controller.setHelloWorld()
    console.log('Gateway started!')
    console.log(`${this.node.GATEWAY_URL}/${helloCid}`)
  }

  generateGatewayURL () {
    try {
      const address = this.node.addresses[0].toString()
      const ip = this.node.getIPByRemoteAddress(address)
      return `http://${ip}:${this.port}/ipfs/pftp`
    } catch (error) {
      console.log('Error creating gateway URL', error)
      return null
    }
  }
}

export default RouterHanlder
