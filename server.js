/**
 * Deploy a full node server to work and connect to helia-pin-service
 * Starting Services.
 *  - IPFS Node. ( A helia/libp2p node )
 *  - IPFS Gateway. ( A http server to serve the IPFS content )
 *  - RPC Pin Service. ( A RPC service to pin/unpin files )
 *  - PFT Protocol. ( Private file transfer protocol from a private network)
 *  - Garbage Collector. ( A service to collect garbage )
 *
 */

import { HeliaNode, Server, PinRPC, GB, PFTProtocol } from './src/lib.js'

const alias = process.env.ALIAS ? process.env.ALIAS : 'my node' // Node name
const wsPort = process.env.WS_PORT ? process.env.WS_PORT : 6001 // Websocket port
const tcpPort = process.env.TCP_PORT ? process.env.TCP_PORT : 6002 // TCP port
const gatewayPort = process.env.GATEWAY_PORT ? process.env.GATEWAY_PORT : 8050 // Gateway port
const pinServiceTopic = process.env.PIN_SERVICE_TOPIC ? process.env.PIN_SERVICE_TOPIC : 'pin-rpc-topic' // Pin service topic
const knownPeerAddress = process.env.KNOWN_PEER_ADDRESS ? process.env.KNOWN_PEER_ADDRESS : ''// A known peer address to connect to , a replicate connection
const netWorking = process.env.NETWORKING ? process.env.NETWORKING : 'minimal' // Networking mode
const gbPeriod = process.env.GB_PERIOD ? process.env.GB_PERIOD : null // Garbage collector period
const relay = process.env.RELAY // Enable circuit relay
const announce = process.env.ANNOUNCE // For production mode , use your public address for announce
const serverDHTProvide = process.env.SERVER_DHT_PROVIDE // Start a DHT server to provide content
const role = process.env.ROLE || 'node' // 'node' 'pinner' 'delegator'
const maxConnections = process.env.MAX_CONNECTIONS ? process.env.MAX_CONNECTIONS : 100
const announceAddr = process.env.ANNOUNCE_ADDR ? process.env.ANNOUNCE_ADDR : ''
//  Initialize A node with tools.
const start = async () => {
  // Instantiate helia node.
  const node = new HeliaNode({
    alias,
    wsPort,
    tcpPort,
    networking: netWorking,
    relay,
    announce,
    announceAddr,
    serverDHTProvide,
    maxConnections
  })
  await node.start()

  // Instantiate Gateway.
  const gateway = new Server({ node, port: gatewayPort })
  await gateway.start()

  // Instantiate Pin RPC
  const rpc = new PinRPC({ node, topic: pinServiceTopic, role })
  await rpc.start()

  // Instantiate PFT Protocol
  const pft = new PFTProtocol({ node, knownPeerAddress, topic: pinServiceTopic })
  await pft.start()

  // Instantiate Garbage Collector
  const gb = new GB({ node, period: gbPeriod })
  await gb.start()

  // await node.helia.gc()
}

start()
