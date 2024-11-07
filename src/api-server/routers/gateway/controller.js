import fs from 'fs'
import { fileTypeFromBuffer, fileTypeFromStream } from 'file-type'

import Stream from 'stream'

const CHUNK_SIZE = 10 ** 6 * 10// 1MB

export default class Gateway {
  constructor (config = {}) {
    this.node = config.node
    this.fs = fs
    this.getContent = this.getContent.bind(this)
    this.handleError = this.handleError.bind(this)
    this.setHelloWorld = this.setHelloWorld.bind(this)
    this.log = this.node.log || console.log

    this.downloadRequest = {

    }
  }
  /*   async getContent2(ctx) {
      try {
        const { cid, name } = ctx.params

        const s = new Stream.Readable({ read() { } })
        const contentArray = await this.lsDirectoryContent(cid)
        const isDir = contentArray[0].depth

        // CID with file name format
        if (name) {
          for (let i = 0; i < contentArray.length; i++) {
            const cont = contentArray[i]

            if (cont.name === name) {
              const content = await this.node.getContent(cont.cid.toString())
              const fileType = await fileTypeFromBuffer(content)
              this.log('fileType', fileType)

              ctx.type = 'text/plain; charset=utf-8'
              ctx.body = content
              return
            }
          }
          s.push(null)
          ctx.body = s
        }
        // CID folder ,  display List of cid
        if (isDir) {
          for (let i = 0; i < contentArray.length; i++) {
            const cont = contentArray[i]
            if (cont.path !== cid) {
              ctx.response.set('content-type', 'txt/html')
              ctx.type = 'html' // <-- THIS is the important step!
              s.push(`<a href='http://localhost:8085/ipfs/${cid}/${cont.name}' >/${cont.name} ( ${cont.cid} )</a><hr />`)
            }
          }
          s.push(null)
          ctx.body = s
        } else {

          const content = await this.node.getContent(cid)

          const fileType = await fileTypeFromBuffer(content)
          this.log('fileType', fileType)
          let contentType = 'text/plain; charset=utf-8'
          if (fileType && fileType.mime) {
            contentType = fileType.mime
          }

          // Stream video
          if (contentType === 'video/mp4') {
            const range = ctx.req.headers.range
            if (range) {
              const videoSize = content.length
              const CHUNK_SIZE = 10 ** 6 // 1MB
              const start = Number(range.replace(/\D/g, ''))
              const end = Math.min(start + CHUNK_SIZE, videoSize - 1)
              const contentLength = end - start + 1

              ctx.set('Content-Range', `bytes ${start}-${end}/${videoSize}`)
              ctx.set('Accept-Ranges', 'bytes')
              ctx.set('Content-Length', contentLength)
              ctx.set('Accept-Ranges', 'bytes')
            }
          }
          ctx.type = contentType
          ctx.body = content
        }
      } catch (error) {
        this.handleError(ctx, error)
      }
    } */

  async getContent (ctx) {
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
            const content = await this.node.getContent(cont.cid.toString())
            const fileType = await fileTypeFromBuffer(content)
            this.log('fileType', fileType)

            ctx.type = 'text/plain; charset=utf-8'
            ctx.body = content
            return
          }
        }
        s.push(null)
        ctx.body = s
      }
      // CID folder ,  display List of cid
      if (isDir) {
        for (let i = 0; i < contentArray.length; i++) {
          const cont = contentArray[i]
          if (cont.path !== cid) {
            ctx.response.set('content-type', 'txt/html')
            ctx.type = 'html' // <-- THIS is the important step!
            s.push(`<a href='http://localhost:8085/ipfs/${cid}/${cont.name}' >/${cont.name} ( ${cont.cid} )</a><hr />`)
          }
        }
        s.push(null)
        ctx.body = s
      } else {
        let start = 0
        const range = ctx.req.headers.range
        // console.log(ctx.headers)

        const stats = await this.node.getStat(cid)
        // console.log('stats', stats)
        // console.log('stats', stats)
        const fileSize = Number(stats.fileSize)
        const localSize = Number(stats.localFileSize)

        // Try to download the content before stream it.
        if (localSize < fileSize) {
          console.log('lazy loading')
          await this.node.lazyDownload(cid)
        }

        if (range) start = Number(range.replace(/\D/g, ''))
        const end = Math.min(start + CHUNK_SIZE, fileSize - 1)

        const contentLength = end - start + 1

        const readable = new Stream.Readable({ read () { } })

        // ctx.body =   fs.createReadStream(_path, { start, end })
        //, { offset: start, length: CHUNK_SIZE *10 }
        const chunks = await this.node.getContent(cid, { offset: start, length: end })
        const defaultType = 'text/plain'
        ctx.type = defaultType
        if (chunks.length + 1 === fileSize) {
          console.log('no stream needed')
          const fileType = await fileTypeFromBuffer(chunks)
          console.log('fileType', fileType)
          if (fileType) {
            ctx.type = fileType.mime
          }
          ctx.body = chunks
          return
        }

        // Stream long size files.
        const fileType = await this.getStreamFileType(cid, fileSize)
        console.log('fileType', fileType)

        // const content  = await this.node.getContent(cid)
        readable.push(chunks)
        readable.push(null)

        ctx.status = 206
        ctx.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        ctx.set('Accept-Ranges', 'bytes')
        ctx.set('Content-Length', contentLength)

        ctx.type = fileType.mime
        ctx.body = readable
      }
    } catch (error) {
      this.handleError(ctx, error)
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
