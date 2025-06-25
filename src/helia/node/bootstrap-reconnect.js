/**
 * Bootstrap Reconnect
 *
 * This class is used to reconnect manually to the bootstrap nodes.
 *
 *
 */

export default class BootstrapReconnect {
  constructor (config = { }) {
    this.config = config
    // Dependency Injection.
    this.node = config.node
    if (!this.node) {
      throw new Error('Helia-IPFS-Node must be passed on GB constructor')
    }

    this.setInterval = setInterval
    this.clearInterval = clearInterval
    this.log = this.node.log || console.log
    // State
    this.renewBootstrapConnectionsPeriod = 60000 // provided on minutes

    this.start = this.start.bind(this)
    this.renewBootstrapConnections = this.renewBootstrapConnections.bind(this)
  }

  async start () {
    this.log(`Starting bootstrap reconnect interval  for ${this.renewBootstrapConnectionsPeriod / 60000} minutes`)
    this.renewBootstrapConnectionsTimer = this.setInterval(this.renewBootstrapConnections, this.renewBootstrapConnectionsPeriod)

    return true
  }

  // Run bootstrap reconnect.
  async renewBootstrapConnections () {
    try {
      // Stop interval
      this.clearInterval(this.renewBootstrapConnectionsTimer)

      this.log('Stopped renewBootstrapConnections interval , waiting for handler to be done!.')

      const bootstrapNodes = this.node.opts.bootstrapList.list
      this.log(`bootstrapNodes : ${bootstrapNodes.length}`)
      for (let i = 0; i < bootstrapNodes.length; i++) {
        try {
          await this.node.connect(bootstrapNodes[i])
          this.log(`\x1b[95mConnected to bootstrap node ${bootstrapNodes[i]}\x1b[0m`)
        } catch (error) {
          this.log(`\x1b[38;5;205mFailed to connect to bootstrap node ${bootstrapNodes[i]}\x1b[0m`)
          continue
        }
      }

      this.log(`Starting renewBootstrapConnections interval  for ${this.renewBootstrapConnectionsPeriod / 60000} minutes`)
      this.renewBootstrapConnectionsTimer = this.setInterval(this.renewBootstrapConnections, this.renewBootstrapConnectionsPeriod)

      return true
    } catch (error) {
      this.log('renewBootstrapConnections error', error.message)
      // On error re-start the interval
      this.log(`Renew renewBootstrapConnections interval after error for ${this.renewBootstrapConnectionsPeriod / 60000} minutes`)
      this.renewBootstrapConnectionsTimer = this.setInterval(this.renewBootstrapConnections, this.renewBootstrapConnectionsPeriod)
      return false
    }
  }
}
