import { Key } from 'interface-datastore'
import { CID } from 'multiformats/cid'

class TimeStampMetadata {
  constructor (config = {}) {
    this.datastore = config.datastore
    this.blockstore = config.blockstore
    this.encoder = new TextEncoder()
    this.decoder = new TextDecoder()
    this.storeKey = '/timestamp-metadata'

    // Bind all methods
    this.updateMetadata = this.updateMetadata.bind(this)
    this.getMetadata = this.getMetadata.bind(this)
    this.deleteMetadata = this.deleteMetadata.bind(this)
    this.garbageCollector = this.garbageCollector.bind(this)
    this.getAllMetadatas = this.getAllMetadatas.bind(this)
    this.gcTime = 1000 * 60 * 60 * 2 // 2 hours
    this.gcInterval = setInterval(this.garbageCollector, this.gcTime)
  }

  // Record last time of and action over a cid
  // Actions : 'lastAccessAt', 'providedAt'
  // Store timestamp of each action provided
  async updateMetadata (cid, action) {
    try {
      let record = await this.getMetadata(cid)
      if (!record) {
        record = {}
      }

      const now = new Date().getTime()
      record.cid = cid
      record[action] = now
      record.lastMetadataUpdate = now

      const jsonData = JSON.stringify(record)
      const key = new Key(this.storeKey + '/' + cid)
      await this.datastore.put(key, this.encoder.encode(jsonData))
      // console.log('Registro actualizado')
      return true
    } catch (error) {
      return false
    }
  }

  async getMetadata (cid) {
    const key = new Key(this.storeKey + '/' + cid)
    const has = await this.datastore.has(key)
    if (!has) return null
    const data = await this.datastore.get(key)
    return JSON.parse(this.decoder.decode(data))
  }

  async deleteMetadata (cid) {
    // console.log('cid', cid)
    const record = await this.getMetadata(cid)
    // console.log('record to delete', record)
    if (!record) {
      // console.log('no record to delete found!')
    }
    const key = new Key(this.storeKey + '/' + cid)
    await this.datastore.delete(key)
    // console.log('deleteMetadata', cid)

    return true
  }

  // Query all metadata records
  async getAllMetadatas () {
    const q = this.datastore.query({
      prefix: this.storeKey
    })
    const records = []
    for await (const { value } of q) {
      const json = JSON.parse(new TextDecoder().decode(value))
      records.push(json)
    }
    return records
  }

  // Block Store Garbage Collector for metadata records
  // Delete metadata records for CIDs that are no longer found in the blockstore
  // This functions delete metadata records for cids not hosted in the node  or removed from the node
  async garbageCollector () {
    try {
      // crear interval
      clearInterval(this.gcInterval)

      // query all records in the datastore with the prefix
      const q = this.datastore.query({
        prefix: this.storeKey
      })

      // iterate over all records
      for await (const { value } of q) {
        try {
          const json = JSON.parse(new TextDecoder().decode(value))
          // console.log('Registro encontrado:', json)
          const lastMetadataUpdate = json.lastMetadataUpdate
          const now = new Date().getTime()
          const timeDiff = now - lastMetadataUpdate
          const oneDay = 1000 * 60 * 60 * 24
          // check only records non updated in the last 24 hours
          if (timeDiff > oneDay) {
            // check if the cid is still in the blockstore
            const has = await this.blockstore.has(CID.parse(json.cid))
            // Delete record if the node does not have the cid
            if (!has) {
              await this.deleteMetadata(json.cid)
            } else {
              // update the record with the current timestamp
              // to prevent to be checked again in the next 24 hours
              // this call also updates the lastMetadataUpdate timestamp
              this.updateMetadata(json.cid, 'gcReviewAt')
            }
          }
        } catch (error) {
          continue
        }
      }

      this.gcInterval = setInterval(this.garbageCollector, this.gcTime)
    } catch (error) {
      this.gcInterval = setInterval(this.garbageCollector, this.gcTime)
      console.error('Error en garbageCollection:', error)
    }
  }
}
export default TimeStampMetadata
