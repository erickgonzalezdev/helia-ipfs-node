/**
 * Deploy a full node server to work and connect to helia-pin-service
 * Starting Services.
 *  - IPFS Node.
 *  - IPFS Gateway.
 *  - RPC Pin Service.
 *
 *  This node are handle remotely by helia-pin-service , to pin/unpin files.
 *
 */

import { HeliaNode, Server, PinRPC, GB } from './src/lib.js'
import { bootstrapConfig } from './src/util/bootstrap.js'

const alias = process.env.ALIAS ? process.env.ALIAS : 'my node'
const wsPort = process.env.WS_PORT ? process.env.ALIAS : 6001
const tcpPort = process.env.TCP_PORT ? process.env.TCP_PORT : 6002
const gatewayPort = process.env.GATEWAY_PORT ? process.env.GATEWAY_PORT : 8050
const pinServiceTopic = process.env.PIN_SERVICE_TOPIC ? process.env.PIN_SERVICE_TOPIC : 'pin-rpc-topic'
const pinServiceAddress = process.env.PIN_SERVICE_ADDRESS ? process.env.PIN_SERVICE_ADDRESS : ''
const netWorking = process.env.NETWORKING ? process.env.NETWORKING : 'minimal'
const gbPeriod = process.env.GB_PERIOD ? process.env.GB_PERIOD : null
const onPinQueueTimeout = process.env.PIN_QUEUE_TIMEOUT
const onProvideQueueTimeout = process.env.PIN_QUEUE_TIMEOUT

//  Basic example with custom data.
const start = async () => {
  // Add pin service address to the bootstrap config
  const bsList = bootstrapConfig.list
  bsList.push(pinServiceAddress)

  // Start helia node.
  const node = new HeliaNode({ alias, wsPort, tcpPort, bootstrapList: bsList, networking: netWorking })
  await node.start()

  // Start Gateway.
  const gateway = new Server({ node, port: gatewayPort })
  await gateway.start()

  // Start Pin RPC
  const rpc = new PinRPC({ node, topic: pinServiceTopic, onPinQueueTimeout, onProvideQueueTimeout })
  await rpc.start()

  // Start Garbage Collector
  const gb = new GB({ node, period: gbPeriod })
  await gb.start()

  if (pinServiceAddress) {
    // Renew Connection
    await reConnect(node)
    setInterval(async () => {
      await reConnect(node)
    }, 30000)
  }
}

const reConnect = async (node) => {
  try {
    console.log(`Trying  to connet to ${pinServiceAddress}`)
    await node.connect(pinServiceAddress)
    console.log('connected.')
  } catch (error) {
    console.log('connection fails.')
  }
}

start()
