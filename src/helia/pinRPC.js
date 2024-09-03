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
 *   msgType: 'notify-subscription',
 *   timeStamp: 'current time stamp',
 *   peerId: 'sender node peer id',
 *   multiAddress: 'sender node multi addresses'
 * }
 *
 *
 */
import { CID } from 'multiformats/cid'
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
    this.pinTopic = `${this.topic}-pin`
    this.stateTopic = `${this.topic}-state`
    this.onSuccessRemotePin = config.onSuccessRemotePin || this.defaultRemotePinCallback
    this.log = this.node.log || console.log

    this.pinQueue = new PQueue({ concurrency: 1, timeout: 60000 * 2 })
    this.onQueue = []
    this.sleep = sleep
    // Bind all functions
    this.start = this.start.bind(this)
    this.requestRemotePin = this.requestRemotePin.bind(this)
    this.listen = this.listen.bind(this)
    this.parsePinMsgProtocol = this.parsePinMsgProtocol.bind(this)
    this.parseStateMsgProtocol = this.parseStateMsgProtocol.bind(this)
    this.defaultRemotePinCallback = this.defaultRemotePinCallback.bind(this)
    this.addToQueue = this.addToQueue.bind(this)
    this.handlePin = this.handlePin.bind(this)
    this.deleteFromQueueArray = this.deleteFromQueueArray.bind(this)
    this.handlePubsubMsg = this.handlePubsubMsg.bind(this)
    this.getSubscriptionList = this.getSubscriptionList.bind(this)
    this.subscriptionList = []
    this.nofitySubscriptionInterval = null
    this.notificationTimer = 30000
  }

  async start () {
    try {
      this.node.helia.libp2p.services.pubsub.subscribe(this.pinTopic)
      this.log(`Subcribed to : ${this.pinTopic}`)

      this.node.helia.libp2p.services.pubsub.subscribe(this.stateTopic)
      this.log(`Subcribed to : ${this.stateTopic}`)

      this.listen()

      // Send notification message above the state topic
      this.nofitySubscriptionInterval = setInterval(() => {
        const msg = {
          msgType: 'notify-subscription',
          timeStamp: new Date().getTime(),
          peerId: this.node.peerId,
          multiAddress: this.node.addresses,
          alias: this.node.opts.alias
        }
        const msgStr = JSON.stringify(msg)
        this.log('Sending notify-subscription')
        this.node.helia.libp2p.services.pubsub.publish(this.stateTopic, new TextEncoder().encode(msgStr))
      }, this.notificationTimer)
    } catch (error) {
      this.log(error)
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
      this.log(`Publishing ${msg} to  ${this.pinTopic}`)

      this.node.helia.libp2p.services.pubsub.publish(this.pinTopic, new TextEncoder().encode(msg))

      return true
    } catch (error) {
      this.log('Error in pinRPC/requestRemotePin()', error)
      throw error
    }
  }

  listen () {
    try {
      this.node.helia.libp2p.services.pubsub.addEventListener('message', this.handlePubsubMsg)
    } catch (error) {
      this.log('Error on pinRPC/listen()')
      throw error
    }
  }

  handlePubsubMsg (message = {}) {
    try {
      if (message && message.detail) {
        if (message.detail.topic === this.pinTopic) {
          this.parsePinMsgProtocol(message)
          return true
        }
        if (message.detail.topic === this.stateTopic) {
          this.parseStateMsgProtocol(message)
          return true
        }
        return false
      }

      return false
    } catch (error) {
      this.log('Error in pinRPC/handleMsg()', error)
      throw error
    }
  }

  async parsePinMsgProtocol (message = {}) {
    try {
      if (message.detail.topic !== this.pinTopic) return 'invalid topic'
      const msgStr = new TextDecoder().decode(message.detail.data)
      const msgObj = JSON.parse(msgStr)
      this.log(`Msg received! :  ${message.detail.topic}:`, msgObj)
      const { toPeerId, cid, msgType } = msgObj

      // Validate if  this node peerId match with the property if it is a string.
      if (typeof toPeerId === 'string' && toPeerId !== this.node.peerId.toString()) return 'destination peerId does not match'

      // Validate if this node peerId exist into property array
      if (Array.isArray(toPeerId)) {
        const toMe = toPeerId.find((val) => { return val === this.node.peerId.toString() })
        if (!toMe) return 'destination peerId does not match'
      }

      if (msgType === 'remote-pin') {
        this.addToQueue(msgObj)
        return true
      }

      if (msgType === 'success-pin') {
        this.onSuccessRemotePin({ cid, host: this.node.peerId.toString() })
        return true
      }

      return 'invalid protocol'
    } catch (error) {
      this.log('Error in pinRPC/parsePinMsgProtocol()', error)
      throw error
    }
  }

  async parseStateMsgProtocol (message = {}) {
    try {
      if (message.detail.topic !== this.stateTopic) return 'invalid topic'
      const msgStr = new TextDecoder().decode(message.detail.data)
      const msgObj = JSON.parse(msgStr)
      this.log(`Msg received! :  ${message.detail.topic}:`, msgObj)
      const { msgType } = msgObj

      if (msgType === 'notify-subscription') {
        this.updateSubscriptionList(msgObj)
        return true
      }
      return 'invalid protocol'
    } catch (error) {
      this.log('Error in pinRPC/parsePinMsgProtocol()', error)
      throw error
    }
  }

  addToQueue (inObj = {}) {
    try {
      const alreadyInQueue = this.onQueue.find((val) => { return val === inObj.cid })
      if (alreadyInQueue) {
        this.log(`cid already on queue : ${inObj.cid}`)
        return true
      }
      this.onQueue.push(inObj.cid)
      this.log(`Adding pin to queue for cid ${inObj.cid}`)
      this.pinQueue.add(async () => { await this.handlePin(inObj) })
      return true
    } catch (error) {
      this.log('Error on PinRPC/addToQueue', error)
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
        await this.node.pinCid(CID.parse(cid))
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
      throw error
    }
  }

  deleteFromQueueArray (cid) {
    try {
      if (!cid || typeof cid !== 'string') throw new Error('cid string is required')
      const cidIndex = this.onQueue.findIndex((val) => { return val === cid })
      if (cidIndex >= 0) {
        this.onQueue.splice(cidIndex, 1)
        return true
      }
      return false
    } catch (error) {
      this.log('Error on PinRPC/deleteFromQueueArray()', error)
      throw error
    }
  }

  updateSubscriptionList (msg = {}) {
    try {
      const { peerId, multiAddress, timeStamp, alias } = msg
      if (!peerId || typeof peerId !== 'string') throw new Error('peerId is required')
      if (!Array.isArray(multiAddress)) throw new Error('multiAddress must be an array of addresses')

      const exist = this.subscriptionList.find((value) => { return peerId === value.peerId })
      if (exist) return false
      this.subscriptionList.push({
        alias,
        peerId,
        multiAddress,
        timeStamp: timeStamp || new Date().getTime()
      })

      return true
    } catch (error) {
      this.log('Error on PinRPC/updateSubscriptionList()', error)
      throw error
    }
  }

  getSubscriptionList () {
    return this.subscriptionList
  }

  defaultRemotePinCallback (inObj = {}) {
    this.log(`Success remote pin cid  : ${inObj.cid} on ${inObj.host} `)
  }
}

export default PinRPC
