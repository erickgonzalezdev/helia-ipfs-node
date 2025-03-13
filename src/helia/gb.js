/**
 * Garbage collection
 */

export default class GarbageCollector {
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
    this.period = this.config.period || 60 * 24
    this.gcPeriod = 60000 * this.period // provided on minutes
    if (typeof this.gcPeriod !== 'number' || isNaN(this.gcPeriod)) {
      throw new Error('Provided period must be a number to specify the minutes on interval ')
    }

    this.garbageCollection = this.garbageCollection.bind(this)
  }

  async start () {
    this.log(`Starting garbageCollection interval  for ${this.gcPeriod / 60000} minutes`)
    this.gcTimer = this.setInterval(this.garbageCollection, this.gcPeriod)

    return true
  }

  // Run garbage collections.
  async garbageCollection () {
    try {
      // Stop interval
      this.clearInterval(this.gcTimer)

      this.log('Stopped garbageCollection interval , waiting for handler to be done!.')
      const beforeDisk = await this.node.getDiskSize()
      this.log(`Disk before run GC ${beforeDisk} MB`)
      await this.node.helia.gc()
      const afterDisk = await this.node.getDiskSize()
      this.log(`Disk after run GC ${afterDisk} MB`)
      // After finish process re-start the interval

      this.log(`Starting garbageCollection interval  for ${this.gcPeriod / 60000} minutes`)
      this.gcTimer = this.setInterval(this.garbageCollection, this.gcPeriod)

      return true
    } catch (error) {
      this.log('GB error', error.message)
      // On error re-start the interval
      this.log(`Renew garbageCollection interval after error for ${this.gcPeriod / 60000} minutes`)
      this.gcTimer = this.setInterval(this.garbageCollection, this.gcPeriod)
      return false
    }
  }
}
