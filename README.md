# IPFS node.

## Description.
  A helia ipfs node for upload files and sharing it beetwen nodes.

## Usage  
### Instantiate a node.
```js
   import { HeliaNode } from '../src/lib.js'
```

```js
  const node = new HeliaNode({ storePath: 'my/store/path' })
  await node.start()
  console.log('node started!')

```

### Instantiate a gateway.

```js
   import { Server } from '../src/lib.js'
```

```js
  const gateway = new Server({ node, port: 8080 })
  await gateway.start()
  
```

### Connections.

```js
   import { HeliaNode } from '../src/lib.js'
```

```js
  const node1 = new HeliaNode()
  await node1.start()
  console.log('node1 started!')
  
  const node2 = new HeliaNode({ wsPort: 4011 , tcpPort: 4012, 'my-store-path' })
  await node2.start()
  console.log('node2 started!')

  const node1Addrs = await node1.getMultiAddress()
  await node2.connect(node1Addrs[0])
  console.log('connected nodes!')
  
```
  
