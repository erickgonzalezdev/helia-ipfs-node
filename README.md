# IPFS node.

## Description.
  A helia ipfs node for upload files and sharing it beetwen nodes.

## Usage  
### Instantiate a node.
```js
   import { HeliaNode } from '../src/index.js'
```

```js
  const node = new HeliaNode({ storePath: 'my/store/path' })
  await node.start()
  console.log('node started!')

```

### Instantiate a gateway.

```js
   import { Server } from '../src/index.js'
```

```js
  const gateway = new Server({ node, port: 5050 })
  await gateway.start()
  
```
  
