/**
 *  Reprovide content over DHT
 *
 */

import { CID } from 'multiformats/cid'

export default class Reprovider {
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
    this.period = this.config.period || 60 // 1 hour default
    this.reproviderPeriod = 60000 * this.period // provided on minutes

    this.reprovideOnTimeDiff = this.config.reprovideOnTimeDiff || 1000 * 60 * 60 * 24 // 24 hours

    if (typeof this.reproviderPeriod !== 'number' || isNaN(this.reproviderPeriod)) {
      throw new Error('Provided period must be a number to specify the minutes on interval ')
    }

    this.start = this.start.bind(this)
    this.reprovider = this.reprovider.bind(this)
  }

  async start () {
    this.log(`Starting content reprovide process  for ${this.reproviderPeriod / 60000} minutes`)
    this.log(`Reprovide content older than ${this.reprovideOnTimeDiff / 1000 / 60 / 60} hours`)
    this.reproviderTimer = this.setInterval(this.reprovider, this.reproviderPeriod)

    return true
  }

  // Run garbage collections.
  async reprovider () {
    try {
      this.log('Starting content reprovide process...')

      const metadataLib = this.node.tsMetadata
      const metadatas = await metadataLib.getAllMetadatas()
      this.log('Metadatas to check for reprovide:', metadatas.length)
      let reprovidedSuccessfully = 0
      let reprovidedFailed = 0
      let reprovideSkipped = 0

      for (const metadata of metadatas) {
        try {
          this.log('Metadata:', metadata)
          // ensure if exists the cid
          const has = await this.node.helia.blockstore.has(CID.parse(metadata.cid))
          if (!has) {
            this.log('CID not found in blockstore:', metadata.cid)
            reprovideSkipped++
            continue
          }

          // Verify if cid has been provided
          const providedAt = metadata.providedAt
          if (metadata.providedAt) {
            const now = new Date().getTime()
            const timeDiff = now - providedAt

            // reprovide content if the time diff is greater than the reprovideOnTimeDiff
            if (timeDiff > this.reprovideOnTimeDiff) {
              this.log('Try to reprovide content:', metadata.cid)
              await this.node.provideCID(metadata.cid)
              this.log('Content reprovided successfully')
              reprovidedSuccessfully++
            } else {
              reprovideSkipped++
            }
          }
        } catch (error) {
          reprovidedFailed++
          continue
        }
      }
      this.log('Content reprovide completed successfully')
      this.log('Content reprovided successfully:', reprovidedSuccessfully)
      this.log('Content reprovided failed:', reprovidedFailed)
      this.log('Content reprovide skipped:', reprovideSkipped)
      return true
    } catch (error) {
      this.log('Reprovider error:', error)
      return false
    } finally {
      // Ensure timer is restarted regardless of success/failure
      this.log(`Starting content reprovide process  for ${this.reproviderPeriod / 60000} minutes`)
      this.reproviderTimer = this.setInterval(this.reprovider, this.reproviderPeriod)
    }
  }
}
