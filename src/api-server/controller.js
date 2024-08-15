// npm libraries
import Koa from 'koa'
import cors from 'kcors'
import bodyParser from 'koa-bodyparser'
import serve from 'koa-static'
import mount from 'koa-mount'

import Routers from './routers/controller.js'

class Server {
  constructor (config = {}) {
    if (!config.node) {
      throw new Error('Helia-IPFS-Node must be passed on Gateway constructor')
    }
    // this.heliaWrapper = config.heliaWrapper
    this.port = config.port || 8085
    config.port = this.port
    this.routers = new Routers(config)

    this.start = this.start.bind(this)
  }

  async start () {
    const app = new Koa()
    app.use(bodyParser())
    app.use(cors({ origin: '*' }))

    app.use(mount('/', serve(`${process.cwd()}/public`)))

    this.routers.start(app)

    app.listen(this.port)

    console.log(`Server started on port : ${this.port}`)
  }
}

export default Server
