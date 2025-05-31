import Gateway from './gateway/router.js'

export default class initRouter {
  constructor (config = {}) {
    this.node = config.node
    this.log = this.node.log || console.log
    this.gateway = new Gateway(config)
    this.unpinOnLastAccessOfHours = Number(config.unpinOnLastAccessOfHours) // hours > Unpin content after last access in hours
    this.pinOnGetContent = config.pinOnGetContent
    this.start = this.start.bind(this)
    this.unpinContent = this.unpinContent.bind(this)
    this.unpinIntervalTime = 1000 * 60 * 60 // 1 hour
    this.unpinInterval = null
  }

  start (app) {
    this.gateway.start(app)

    this.log('Gateway Enable Pin On Get Content', !!this.pinOnGetContent)
    this.log('Gateway Unpin On Last Access Of Hours', !!this.unpinOnLastAccessOfHours)
    if (this.unpinOnLastAccessOfHours && typeof this.unpinOnLastAccessOfHours === 'number') {
      console.log('Starting interval for unpinning content after last access of', this.unpinOnLastAccessOfHours, 'hours')
      this.unpinInterval = setInterval(this.unpinContent, this.unpinIntervalTime)
    }
  }

  async unpinContent () {
    try {
      clearInterval(this.unpinInterval)
      const pins = await this.node.getPins()

      for (const cid of pins) {
        try {
          const metadata = await this.node.tsMetadata.getMetadata(cid.toString())
          const lastAccess = metadata.lastAccessAt
          const now = new Date()
          const timeDiff = now - lastAccess
          const hoursDiff = timeDiff / (1000 * 60 * 60)

          if (hoursDiff > this.unpinOnLastAccessOfHours) {
            await this.gateway.controller.tryToUnpinContent(cid.toString())
          }
        } catch (error) {
          continue
        }
      }
      this.unpinInterval = setInterval(this.unpinContent, this.unpinIntervalTime)
    } catch (error) {
      this.unpinInterval = setInterval(this.unpinContent, this.unpinIntervalTime)
      this.log('Error in unpinContent', error)
    }
  }
}
