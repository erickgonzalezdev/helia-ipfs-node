import { HeliaNode, Server } from '../src/lib.js'

//  Basic example with custom data.
const start = async () => {
  // Start helia node.
  const node = new HeliaNode()
  await node.start()
  console.log('node started!')

  // Start Gateway.
  const gateway = new Server({ node, port: 5050 })
  await gateway.start()

  // Get multi addresses
  const nodeAddrss = await node.getMultiAddress()

  // Connections

  const node2 = new HeliaNode({ alias: 'my second node', wsPort: 4011, tcpPort: 4012, storePath: 'data-path' })
  await node2.start()

  // Connect nodes
  await node2.connect(nodeAddrss[0])
  console.log('Connected!')
}

start()
