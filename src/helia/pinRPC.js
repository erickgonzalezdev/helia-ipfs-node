/**
 * Comunicate from another node subscribed to the provided topic channel.
 * A node can request to another nodes subscribes to this topic to pin a provided CID.
 *
 * After a success pin the node notify from the topic channel
 *
 * Request message :
 * {
 *    toPeerId  : 'node id that should pin the id.' // 'all'  for broadcast
 *    fromPeerId : 'node id that make the request'
 *    cid : 'cid to be pinned'.
 *    msgTyoe : 'remote-pin" // pin protocol.
 *    webhook : 'TODO'
 * }
 *
 *
 * Success message :
 * {
 *    toPeerId  : 'node id to receive the message'
 *    fromPeerId : 'node id who notifycate the success pinned'
 *    cid : 'success pinned cid'.
 *    msgTyoe : 'success-pin" // success pin protocol.
 * }
 *
 *
 *
 * Notification message :
 * {
 *   msgType: 'notify-state',
 *   timeStamp: 'current time stamp',
 *   peerId: 'sender node peer id',
 *   multiAddress: 'sender node multi addresses'
 * }
 *
 *
 */
// import { CID } from 'multiformats/cid'
import PQueue from 'p-queue'
import { sleep } from '../util/util.js'

class PinRPC {
  constructor (config = {}) {
    if (!config.node) {
      throw new Error('Helia-IPFS-Node must be passed on pinRPC constructor')
    }
    if (!config.node.helia.libp2p.services || !config.node.helia.libp2p.services.pubsub) {
      throw new Error('Service pubsub not found! on pinRPC constructor.')
    }

    if (!config.topic || typeof config.topic !== 'string') throw new Error('topic property must be passed on pinRPC constructor!')

    this.node = config.node
    this.topic = config.topic
    this.role = config.role || 'node' // 'node' 'pinner' 'delegator'
    this.onSuccessRemotePin = config.onSuccessRemotePin || this.defaultRemotePinCallback
    this.onSuccessRemoteUnpin = config.onSuccessRemoteUnpin || this.defaultRemoteUnpinCallback
    this.onSuccessRemoteProvide = config.onSuccessRemoteProvide || this.defaultRemoteProvideCallback

    this.log = this.node.log || console.log

    this.onPinQueueTimeout = Number(config.onPinQueueTimeout) || 60000 * 2 // 2 minutes default
    this.pinQueue = new PQueue({ concurrency: 1, timeout: this.onPinQueueTimeout })
    this.onQueue = [] // Will now store objects with {cid, timestamp}
    this.log(`Timeout on pin queue ${this.pinQueue.timeout}`)

    this.onProvideQueueTimeout = Number(config.onProvideQueueTimeout) || 60000 * 3 // 3 minutes default
    this.provideQueue = new PQueue({ concurrency: 1, timeout: this.onProvideQueueTimeout })
    this.onProvideQueue = [] // Will now store objects with {cid, timestamp}
    this.log(`Timeout on provide queue ${this.provideQueue.timeout}`)

    this.alreadyProvidedArr = []
    this.sleep = sleep
    // Bind all functions
    this.start = this.start.bind(this)
    this.requestRemotePin = this.requestRemotePin.bind(this)
    this.requestRemoteUnpin = this.requestRemoteUnpin.bind(this)
    this.requestRemoteProvide = this.requestRemoteProvide.bind(this)
    this.listenPubsub = this.listenPubsub.bind(this)
    this.parseMsgProtocol = this.parseMsgProtocol.bind(this)
    this.defaultRemotePinCallback = this.defaultRemotePinCallback.bind(this)
    this.addToQueue = this.addToQueue.bind(this)
    this.handlePin = this.handlePin.bind(this)
    this.deleteFromQueueArray = this.deleteFromQueueArray.bind(this)
    this.deleteFromProvideQueueArray = this.deleteFromProvideQueueArray.bind(this)
    this.handlePubsubMsg = this.handlePubsubMsg.bind(this)
    this.getSubscriptionList = this.getSubscriptionList.bind(this)
    this.handleUnpin = this.handleUnpin.bind(this)
    this.handleProvide = this.handleProvide.bind(this)
    this.addToProvideQueue = this.addToProvideQueue.bind(this)
    this.cleanupQueues = this.cleanupQueues.bind(this)
    this.updateSubscriptionList = this.updateSubscriptionList.bind(this)
    this.defaultRemoteUnpinCallback = this.defaultRemoteUnpinCallback.bind(this)
    this.defaultRemoteProvideCallback = this.defaultRemoteProvideCallback.bind(this)
    this.topicHandler = this.topicHandler.bind(this)
    this.isDelegator = this.isDelegator.bind(this)
    // state
    this.subscriptionList = []
    this.nofitySubscriptionInterval = null
    this.notificationTimer = 5000

    // Add cleanup interval (run every minute)
    this.cleanupInterval = setInterval(this.cleanupQueues, 60000)
    this.handleTopicSubscriptionInterval = setInterval(this.topicHandler, 90000)

    this.lastDiskSize = 0
    this.lastDiskSizeInterval = setInterval(this.node.getDiskSize, 180000)
  }

  async start () {
    try {
      this.log(`RPC Role : ${this.role}`)

      this.listenPubsub()
      this.topicHandler()
      // Send notification message above the state topic
      this.nofitySubscriptionInterval = setInterval(async () => {
        const msg = {
          msgType: 'notify-state',
          timeStamp: new Date().getTime(),
          peerId: this.node.peerId,
          multiAddress: this.node.addresses,
          alias: this.node.opts.alias,
          role: this.role,
          onQueue: this.onQueue.length,
          onProvideQueue: this.onProvideQueue.length,
          diskSize: this.lastDiskSize
        }
        const msgStr = JSON.stringify(msg)
        this.log('Sending notify-state')
        this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msgStr))
      }, this.notificationTimer)
    } catch (error) {
      this.log(error)
      throw error
    }
  }

  async updateDiskSize () {
    try {
      clearInterval(this.lastDiskSizeInterval)
      const diskSize = await this.node.getDiskSize()
      this.lastDiskSize = diskSize || this.lastDiskSize
      this.lastDiskSizeInterval = setInterval(this.node.getDiskSize, 180000)
    } catch (error) {
      this.lastDiskSizeInterval = setInterval(this.node.getDiskSize, 180000)
      this.log('Error on pinRPC/updateDiskSize()', error)
    }
  }

  listenPubsub () {
    try {
      this.node.helia.libp2p.services.pubsub.addEventListener('message', this.handlePubsubMsg)
      return true
    } catch (error) {
      this.log('Error on pinRPC/listenPubsub()')
      throw error
    }
  }

  requestRemotePin (inObj = {}) {
    try {
      const { cid, toPeerId, fromPeerId } = inObj
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required!')
      if (!toPeerId || typeof toPeerId !== 'string') throw new Error('toPeerId string is required!')
      if (!fromPeerId || typeof fromPeerId !== 'string') throw new Error('fromPeerId string is required!')

      inObj.msgType = 'remote-pin'

      const msg = JSON.stringify(inObj)
      this.log(`Publishing ${msg} to  ${this.topic}`)

      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msg))

      return true
    } catch (error) {
      this.log('Error in pinRPC/requestRemotePin()', error)
      throw error
    }
  }

  requestRemoteUnpin (inObj = {}) {
    try {
      const { cid, toPeerId, fromPeerId } = inObj
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required!')
      if (!toPeerId || typeof toPeerId !== 'string') throw new Error('toPeerId string is required!')
      if (!fromPeerId || typeof fromPeerId !== 'string') throw new Error('fromPeerId string is required!')

      inObj.msgType = 'remote-unpin'

      const msg = JSON.stringify(inObj)
      this.log(`Publishing ${msg} to  ${this.topic}`)

      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msg))

      return true
    } catch (error) {
      this.log('Error in pinRPC/requestRemoteUnpin()', error)
      throw error
    }
  }

  requestRemoteProvide (inObj = {}) {
    try {
      const { cid, toPeerId, fromPeerId } = inObj
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required!')
      if (!toPeerId || typeof toPeerId !== 'string') throw new Error('toPeerId string is required!')
      if (!fromPeerId || typeof fromPeerId !== 'string') throw new Error('fromPeerId string is required!')

      inObj.msgType = 'remote-provide'

      const msg = JSON.stringify(inObj)
      this.log(`Publishing ${msg} to  ${this.topic}`)

      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msg))

      return true
    } catch (error) {
      this.log('Error in pinRPC/requestRemotePin()', error)
      throw error
    }
  }

  handlePubsubMsg (message = {}) {
    try {
      this.log('RPC message received')
      if (message && message.detail) {
        if (message.detail.topic === this.topic) {
          this.parseMsgProtocol(message)

          return true
        }

        return false
      }
      return false
    } catch (error) {
      this.log('Error in pinRPC/handleMsg()', error)
      return false
    }
  }

  async parseMsgProtocol (message = {}) {
    try {
      if (message.detail.topic !== this.topic) return 'invalid topic'
      const msgStr = new TextDecoder().decode(message.detail.data)
      const msgObj = JSON.parse(msgStr)
      this.log(`RPC Msg received! :  ${message.detail.topic}: , messageType: ${msgObj.msgType}`)
      const { toPeerId, cid, msgType, fromPeerId } = msgObj

      // Validate if  this node peerId match with the property if it is a string.
      if (typeof toPeerId === 'string' && toPeerId !== this.node.peerId.toString()) return 'destination peerId does not match'

      // Validate if this node peerId exist into property array
      if (Array.isArray(toPeerId)) {
        const toMe = toPeerId.find((val) => { return val === this.node.peerId.toString() })
        if (!toMe) return 'destination peerId does not match'
      }
      // Receive request to pin a cid from a delegator peer
      if (msgType === 'remote-pin' && this.isDelegator(fromPeerId)) {
        this.addToQueue(msgObj)
        return true
      }
      // Receive request to unpin a cid from a delegator peer
      if (msgType === 'remote-unpin' && this.isDelegator(fromPeerId)) {
        this.handleUnpin(msgObj)
        return true
      }
      // Receive notification for pinned cid
      if (msgType === 'success-pin') {
        this.onSuccessRemotePin({ cid, host: this.node.peerId.toString() })
        return true
      }
      // Receive notification for unpinned cid
      if (msgType === 'success-unpin') {
        this.onSuccessRemoteUnpin({ cid, host: this.node.peerId.toString() })
        return true
      }

      // Receive request to provide a cid from a delegator peer
      if (msgType === 'remote-provide' && this.isDelegator(fromPeerId)) {
        this.addToProvideQueue(msgObj)
        return true
      }
      // Receive notification for succes provided cid
      if (msgType === 'success-provide') {
        this.onSuccessRemoteProvide({ cid, host: this.node.peerId.toString() })
        return true
      }
      if (msgType === 'notify-state') {
        this.updateSubscriptionList(msgObj)
        return true
      }

      return 'invalid protocol'
    } catch (error) {
      this.log('Error in pinRPC/parseMsgProtocol()', error)
      throw error
    }
  }

  addToQueue (inObj = {}) {
    try {
      const alreadyInQueue = this.onQueue.find((val) => val.cid === inObj.cid)
      if (alreadyInQueue) {
        this.log(`cid already on queue : ${inObj.cid}`)
        return true
      }
      this.onQueue.push({
        cid: inObj.cid,
        timestamp: Date.now()
      })
      this.log(`Adding pin to queue for cid ${inObj.cid}`)
      this.pinQueue.add(async () => { await this.handlePin(inObj) })
      return true
    } catch (error) {
      this.log('Error on PinRPC/addToQueue', error)
      throw error
    }
  }

  addToProvideQueue (inObj = {}) {
    try {
      const alreadyInQueue = this.onProvideQueue.find((val) => val.cid === inObj.cid)
      if (alreadyInQueue) {
        this.log(`cid already on provide queue : ${inObj.cid}`)
        return true
      }
      this.onProvideQueue.push({
        cid: inObj.cid,
        timestamp: Date.now()
      })
      this.log(`Adding pin to provide queue for cid ${inObj.cid}`)
      this.provideQueue.add(async () => { await this.handleProvide(inObj) })
      return true
    } catch (error) {
      this.log('Error on PinRPC/addToProvideQueue', error)
      throw error
    }
  }

  async handlePin (inObj = {}) {
    try {
      const { fromPeerId, cid } = inObj
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required!')
      if (!fromPeerId || typeof fromPeerId !== 'string') throw new Error('fromPeerId string is required!')

      try {
        this.log(`Trying to download and pin cid ${cid} on queue`)
        // const signal = AbortSignal.timeout(this.pinQueue.timeout)

        // Try to download the cid from the private file transfer protocol
        const downloaded = await this.node.pftpDownload(cid) // Download CID
        if (!downloaded) {
          // If the cid is not downloaded, try to download it from the network using lazy download
          await this.node.lazyDownload(cid)
        }
        await this.node.pinCid(cid) // pin CID
      } catch (error) {
        this.log(`Error Trying to download and pin cid ${cid}`)
        if (!error.message.toLowerCase().match('already')) throw error
      }

      this.log('Publish pin success notification')
      const responseMsg = {
        msgType: 'success-pin',
        toPeerId: fromPeerId,
        fromPeerId: this.node.peerId.toString(),
        cid

      }
      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(JSON.stringify(responseMsg)))
      this.deleteFromQueueArray(inObj.cid)
      return true
    } catch (error) {
      this.deleteFromQueueArray(inObj.cid)
      this.log('Error on PinRPC/handlePin()', error)
      return false
    }
  }

  async handleUnpin (inObj = {}) {
    try {
      const { fromPeerId, cid } = inObj
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required!')
      if (!fromPeerId || typeof fromPeerId !== 'string') throw new Error('fromPeerId string is required!')

      try {
        this.log(`Trying to Unpin cid ${cid}`)
        await this.node.unPinCid(cid)
      } catch (error) {
        // skip
      }

      this.log('Publish unpin success notification')
      const responseMsg = {
        msgType: 'success-unpin',
        toPeerId: fromPeerId,
        fromPeerId: this.node.peerId.toString(),
        cid

      }
      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(JSON.stringify(responseMsg)))
      return true
    } catch (error) {
      this.log('Error on PinRPC/handleUnpin()', error)
      return false
    }
  }

  async handleProvide (inObj = {}) {
    try {
      const { fromPeerId, cid } = inObj
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required!')
      if (!fromPeerId || typeof fromPeerId !== 'string') throw new Error('fromPeerId string is required!')

      const alreadyProvided = this.alreadyProvidedArr.find((val) => { return val === inObj.cid })
      if (!alreadyProvided) {
        this.log(`Trying to provide cid ${cid} on queue`)
        // const signal = AbortSignal.timeout(this.provideQueue.timeout)
        await this.node.provideCID(cid) // provide CID
        this.alreadyProvidedArr.push(cid)
      }

      this.log('Publish provide success notification')
      const responseMsg = {
        msgType: 'success-provide',
        toPeerId: fromPeerId,
        fromPeerId: this.node.peerId.toString(),
        cid

      }
      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(JSON.stringify(responseMsg)))
      this.deleteFromProvideQueueArray(inObj.cid)
      return true
    } catch (error) {
      this.deleteFromProvideQueueArray(inObj.cid)
      this.log(`Error Trying to provide cid ${inObj.cid}`)
      this.log('Error on PinRPC/handleProvide()', error.message)
      return false
    }
  }

  deleteFromQueueArray (cid) {
    try {
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required')
      const cidIndex = this.onQueue.findIndex((val) => val.cid === cid)
      if (cidIndex >= 0) {
        this.onQueue.splice(cidIndex, 1)
        return true
      }
      return false
    } catch (error) {
      this.log('Error on PinRPC/deleteFromQueueArray()', error)
      return false
    }
  }

  deleteFromProvideQueueArray (cid) {
    try {
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required')
      const cidIndex = this.onProvideQueue.findIndex((val) => val.cid === cid)
      if (cidIndex >= 0) {
        this.onProvideQueue.splice(cidIndex, 1)
        return true
      }
      return false
    } catch (error) {
      this.log('Error on PinRPC/deleteFromQueueArray()', error)
      return false
    }
  }

  updateSubscriptionList (msg = {}) {
    try {
      const { peerId, multiAddress, timeStamp, alias, diskSize, role, onQueue, onProvideQueue } = msg
      if (!peerId || typeof peerId !== 'string') throw new Error('peerId is required')
      if (!Array.isArray(multiAddress)) throw new Error('multiAddress must be an array of addresses')

      const currentTime = new Date().getTime()
      const timestamp = timeStamp || currentTime

      const subsIndex = this.subscriptionList.findIndex((value) => { return peerId === value.peerId })
      const subscriptor = this.subscriptionList[subsIndex]
      if (subscriptor) {
        this.subscriptionList[subsIndex] = {
          alias,
          peerId,
          multiAddresses: multiAddress,
          timeStamp: timestamp,
          timeStampStr: new Date(timeStamp).toISOString(),
          diskSize,
          role,
          onQueue,
          onProvideQueue
        }
      } else {
        this.subscriptionList.push({
          alias,
          peerId,
          multiAddresses: multiAddress,
          timeStamp: timestamp,
          timeStampStr: new Date(timeStamp).toISOString(),
          diskSize,
          role,
          onQueue,
          onProvideQueue
        })
      }

      return true
    } catch (error) {
      this.log('Error on PinRPC/updateSubscriptionList()', error)
      throw error
    }
  }

  getSubscriptionList () {
    const now = new Date().getTime()
    const subsList = []
    for (const sub of this.subscriptionList) {
      const elapsedMs = now - sub.timeStamp
      const elapsedSeconds = Math.floor(elapsedMs / 1000)

      let since
      if (elapsedSeconds < 60) {
        since = `${elapsedSeconds} seconds`
      } else if (elapsedSeconds < 3600) {
        const minutes = Math.floor(elapsedSeconds / 60)
        since = `${minutes} minutes`
      } else {
        const hours = Math.floor(elapsedSeconds / 3600)
        since = `${hours} hours`
      }

      sub.since = since
      subsList.push(sub)
    }
    return subsList
  }

  defaultRemotePinCallback (inObj = {}) {
    this.log(`Success remote pin cid  : ${inObj.cid} on ${inObj.host} `)
  }

  defaultRemoteUnpinCallback (inObj = {}) {
    this.log(`Success remote unpin cid  : ${inObj.cid} on ${inObj.host} `)
  }

  defaultRemoteProvideCallback (inObj = {}) {
    this.log(`Success remote provide cid  : ${inObj.cid} on ${inObj.host} `)
  }

  cleanupQueues () {
    try {
      const minutesAgoObj = new Date()
      minutesAgoObj.setMinutes(minutesAgoObj.getMinutes() - 3)

      const minutesAgo = minutesAgoObj.getTime()
      // Clean onQueue
      this.onQueue = this.onQueue.filter(item => item.timestamp > minutesAgo)

      // Clean onProvideQueue
      this.onProvideQueue = this.onProvideQueue.filter(item => item.timestamp > minutesAgo)

      this.log(`Cleaned queues. onQueue: ${this.onQueue.length}, onProvideQueue: ${this.onProvideQueue.length}`)
      return true
    } catch (error) {
      this.log('Error in PinRPC/cleanupQueues()', error)
      return false
    }
  }

  topicHandler () {
    try {
      const isSubscribed = this.node.helia.libp2p.services.pubsub.getTopics().includes(this.topic)
      this.log(`isSubscribed: ${isSubscribed}`)
      if (!isSubscribed) {
        this.node.helia.libp2p.services.pubsub.subscribe(this.topic)
        this.log(`Subcribed to : ${this.topic}`)
      }
      return true
    } catch (error) {
      this.log('Error in PinRPC/topicHandler()', error)
      return false
    }
  }

  isDelegator (peerId) {
    try {
      if (!peerId || typeof peerId !== 'string') throw new Error('peerId string is required!')

      const peer = this.subscriptionList.find(sub => sub.peerId === peerId)
      return peer?.role === 'delegator'
    } catch (error) {
      this.log('Error in PinRPC/isDelegator()', error)
      return false
    }
  }
}

export default PinRPC
