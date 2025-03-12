import fs from 'fs'
import { fileTypeFromBuffer, fileTypeFromStream } from 'file-type'

import Stream from 'stream'

const CHUNK_SIZE = 10 ** 6 * 5// 1MB

export default class Gateway {
  constructor (config = {}) {
    this.node = config.node
    this.fs = fs
    this.getContent = this.getContent.bind(this)
    this.handleError = this.handleError.bind(this)
    this.setHelloWorld = this.setHelloWorld.bind(this)
    this.log = this.node.log || console.log
  }

  async getContent (ctx) {
    try {
      const { cid } = ctx.params

      const stats = await this.node.getStat(cid)
      // console.log('stats', stats)
      // console.log('stats', stats)
      const fileSize = Number(stats.fileSize)
      this.log('stats.fileSize : ', fileSize)
      const localSize = Number(stats.localFileSize)
      this.log('stats.localSize : ', localSize)

      // Try to download the content before send it.
      if (localSize < fileSize) {
        console.log('Node Lazy Downloading')
        await this.node.lazyDownload(cid)
      }

      const parsed = await this.parseContent(ctx)
      if (parsed) return

      // Try to stream content.
      const streamed = await this.streamContent(ctx, cid)
      console.log('streamed', streamed)
      if (streamed) return

      // Send all content
      const totalFileChunks = await this.node.getContent(cid, { offset: 0, length: fileSize })
      const fileTypeRes = await fileTypeFromBuffer(totalFileChunks)
      const fileType = fileTypeRes || { mime: 'application/octet-stream' }

      ctx.type = fileType.mime
      ctx.body = totalFileChunks
    } catch (error) {
      this.handleError(ctx, error)
    }
  }

  async parseContent (ctx) {
    try {
      const { cid, name } = ctx.params
      // console.log('body' , ctx.req)
      const s = new Stream.Readable({ read () { } })
      const contentArray = await this.lsDirectoryContent(cid)
      const isDir = contentArray[0].depth

      // CID with file name format
      if (name) {
        for (let i = 0; i < contentArray.length; i++) {
          const cont = contentArray[i]

          if (cont.name === name) {
            await this.node.lazyDownload(cont.cid.toString())
            const content = await this.node.getContent(cont.cid.toString())
            const fileTypeRes = await fileTypeFromBuffer(content)
            const fileType = fileTypeRes || { mime: 'application/octet-stream' }

            ctx.type = fileType.mime
            ctx.body = content
            return true
          }
        }
        // s.push(null)
        // ctx.body = s
      }
      // CID folder ,  display List of cid
      if (isDir) {
        for (let i = 0; i < contentArray.length; i++) {
          const cont = contentArray[i]
          if (cont.path !== cid) {
            // ctx.response.set('content-type', 'txt/html')
            ctx.type = 'html'
            s.push(`<a href='http://localhost:8085/ipfs/${cid}/${cont.name}' >/${cont.name} ( ${cont.cid} )</a><hr />`)
          }
        }
        s.push(null)
        ctx.body = s
        return true
      }

      return false
    } catch (error) {
      this.log(error)
      throw error
    }
  }

  async streamContent (ctx) {
    try {
      const { cid } = ctx.params
      if (!cid) throw new Error('cid must be provided!')

      const chunksForFileType = await this.node.getContent(cid, { offset: 0, length: CHUNK_SIZE })
      const fileType = await fileTypeFromBuffer(chunksForFileType)
      const mime = fileType.mime

      if (!mime.includes('video') && !mime.includes('audio')) {
        this.log('Wrong mime , required match "audio" or "video" for stream . mime detected :', mime)
        return false
      }
      let start = 0
      const range = ctx.req.headers.range
      // console.log(ctx.headers)

      const stats = await this.node.getStat(cid)
      // console.log('stats', stats)
      // console.log('stats', stats)
      const fileSize = Number(stats.fileSize)

      if (range) start = Number(range.replace(/\D/g, ''))
      const end = Math.min(start + CHUNK_SIZE, fileSize - 1)

      const contentLength = end - start + 1

      const readable = new Stream.Readable({ read () { } })

      // ctx.body =   fs.createReadStream(_path, { start, end })
      //, { offset: start, length: CHUNK_SIZE *10 }
      const chunks = await this.node.getContent(cid, { offset: start, length: end })

      // Stream long size files.
      // const fileType = await this.getStreamFileType(cid)

      // const content  = await this.node.getContent(cid)
      readable.push(chunks)
      readable.push(null)

      ctx.status = 206
      ctx.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      ctx.set('Accept-Ranges', 'bytes')
      ctx.set('Content-Length', contentLength)
      ctx.type = fileType.mime
      ctx.body = readable
      return true
    } catch (error) {
      this.log(error)
      throw error
    }
  }

  async getStreamFileType (cid) {
    try {
      const streamForFileType = new Stream.Readable({ read () { } })
      const chunks = await this.node.getContent(cid, { offset: 0, length: CHUNK_SIZE })
      streamForFileType.push(chunks)
      const fileType = await fileTypeFromStream(streamForFileType)
      streamForFileType.push(null)
      return fileType
    } catch (error) {
      this.log('error on getStreamFileType')
      throw error
    }
  }

  async lsDirectoryContent (cid) {
    try {
      const files = []
      for await (const file of this.node.ufs.ls(cid)) {
        files.push(file)
      }

      return files
    } catch (error) {
      this.log(error)
      throw error
    }
  }

  async setHelloWorld () {
    try {
      const cid = await this.node.uploadStrOrObj('The gateway is ready!')
      return cid
    } catch (error) {
      this.log(error)
      throw error
    }
  }

  handleError (ctx, err) {
    if (err.status) {
      if (err.message) {
        ctx.throw(err.status, err.message)
      } else {
        ctx.throw(err.status)
      }
    } else {
      ctx.throw(422, err.message)
    }
  }
}
