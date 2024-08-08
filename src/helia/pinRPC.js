/**
 * Comunicate from another node subscribed to the provided topic channel.
 * A node can request to another nodes subscribes to this topic to pin a provided CID.
 *
 * After a success pin the node notify from the topic channel
 *
 * Request message :
 * {
 *    toPeerId  : 'node id that should pin the id.'
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
 */
import { CID } from 'multiformats/cid'

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
    this.onSuccessRemotePin = config.onSuccessRemotePin || this.defaultRemotePinCallback
    this.log = this.node.log || console.log

    // Bind all functions
    this.start = this.start.bind(this)
    this.requestRemotePin = this.requestRemotePin.bind(this)
    this.listen = this.listen.bind(this)
    this.parseMsgProtocol = this.parseMsgProtocol.bind(this)
    this.defaultRemotePinCallback = this.defaultRemotePinCallback.bind(this)
  }

  async start () {
    try {
      this.log(`Subcribing to : ${this.topic}`)
      this.node.helia.libp2p.services.pubsub.subscribe(this.topic)
      this.log(`Subcribed to : ${this.topic}`)

      this.listen()
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
      this.log(`Publishing ${msg} to  ${this.topic}`)

      this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(msg))

      return true
    } catch (error) {
      this.log('Error in pinRPC/requestRemotePin()', error)
      throw error
    }
  }

  /*   listen() {
    try {
      this.node.helia.libp2p.services.pubsub.addEventListener('message', (message) => {

        try {
          if (message.detail.topic !== this.topic) return

          const msgStr = new TextDecoder().decode(message.detail.data)
          const msgObj = JSON.parse(msgStr)
          this.log(`Msg received! :  ${message.detail.topic}:`, msgObj)

          this.parseMsgProtocol(msgObj)

        } catch (error) {
          this.log(`Error on pinRPC/listen() callback`)
          // Skip error
        }
      })
    } catch (error) {
      this.log(`Error on pinRPC/listen()`)
      throw error

    }
  } */
  listen () {
    try {
      this.node.helia.libp2p.services.pubsub.addEventListener('message', this.parseMsgProtocol)
    } catch (error) {
      this.log('Error on pinRPC/listen()')
      throw error
    }
  }

  async parseMsgProtocol (message = {}) {
    try {
      if (message.detail.topic !== this.topic) return 'invalid topic'
      const msgStr = new TextDecoder().decode(message.detail.data)
      const msgObj = JSON.parse(msgStr)
      this.log(`Msg received! :  ${message.detail.topic}:`, msgObj)
      const { fromPeerId, cid, msgType, toPeerId } = msgObj

      if (toPeerId !== this.node.peerId.toString()) return 'destination peerId does not match'

      if (msgType === 'remote-pin') {
        try {
          await this.node.pinCid(CID.parse(cid))
        } catch (error) {
          if (!error.message.toLowerCase().match('already')) throw error
        }
        const responseMsg = {
          msgType: 'success-pin',
          toPeerId: fromPeerId,
          fromPeerId: this.node.peerId.toString(),
          cid

        }
        this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(JSON.stringify(responseMsg)))
        return true
      }

      //
      if (msgType === 'success-pin') {
        this.onSuccessRemotePin({ cid, host: this.node.peerId.toString() })
        return true
      }
      return 'invalid protocol'
    } catch (error) {
      this.log('Error in pinRPC/parseMsgProtocol()', error)
      throw error
    }
  }

  /*
    async parseMsgProtocol(inOBj = {}) {
      const { fromPeerId, cid, msgType, toPeerId } = inOBj
      try {

        if (toPeerId !== this.node.peerId.toString()) return

        if (msgType === 'remote-pin') {
          try {
            await this.node.pinCid(CID.parse(cid))
          } catch (error) {
            if (!error.message.toLowerCase().match('already')) throw error
          }
          const responseMsg = {
            msgType: 'success-pin',
            toPeerId: fromPeerId,
            fromPeerId: this.node.peerId.toString(),
            cid

          }
          this.node.helia.libp2p.services.pubsub.publish(this.topic, new TextEncoder().encode(JSON.stringify(responseMsg)))

        }

        //
        if (msgType === 'success-pin') {
          this.onSuccessRemotePin({ cid, host: this.node.peerId.toString() })
        }

      } catch (error) {
        throw error
      }
    }
   */
  defaultRemotePinCallback (inObj = {}) {
    this.log(`Success remote pin cid  : ${inObj.cid} on ${inObj.host} `)
  }
}

export default PinRPC
