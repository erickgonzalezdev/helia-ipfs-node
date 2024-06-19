import { HeliaNode, Server } from '../src/index.js'

//  Basic example with custom data.
const start = async () => {
  // Start helia node.
  // 60abce06cb25fb4794147aff0b0f61a1
  //
  const node = new HeliaNode()
  await node.start()
  console.log('node started!')

  // Start Gateway.
  const gateway = new Server({ node, port: 5050 })
  await gateway.start()
}

start()
