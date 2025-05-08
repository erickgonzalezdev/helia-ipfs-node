import fs from 'fs'
import { fileTypeFromBuffer, fileTypeFromStream } from 'file-type'
import Stream from 'stream'
import { CID } from 'multiformats/cid'

const CHUNK_SIZE = 10 ** 6 * 10// 10MB

export default class Gateway {
  constructor (config = {}) {
    this.config = config
    this.node = config.node
    this.fs = fs
    this.CID = CID
    this.getContent = this.getContent.bind(this)
    this.handleError = this.handleError.bind(this)
    this.setHelloWorld = this.setHelloWorld.bind(this)
    this.getConnections = this.getConnections.bind(this)
    this.log = this.node.log || console.log
    this.downloadContent = this.downloadContent.bind(this)
    this.parseFolderFormat = this.parseFolderFormat.bind(this)
    this.streamContent = this.streamContent.bind(this)
    this.getStreamFileType = this.getStreamFileType.bind(this)
    this.lsDirectoryContent = this.lsDirectoryContent.bind(this)
    this.pftpDownload = this.pftpDownload.bind(this)
  }

  async getContent (ctx) {
    try {
      const { cid } = ctx.params
      // try to download the cid on the private nerwork first
      await this.node.pftpDownload(cid)

      let cidToFetch = cid
      // Verify if the cid is a folder
      const parsed = await this.parseFolderFormat(ctx)

      // If a result was sent.
      if (parsed && !parsed.cid) return

      // If new cid exist
      if (parsed.cid) cidToFetch = parsed.cid
      console.log('cidToFetch', cidToFetch)

      // Get file stats
      const stats = await this.node.getStat(cidToFetch)

      const fileSize = Number(stats.fileSize)
      this.log(`${cidToFetch} fileSize : ${fileSize}`)
      const localSize = Number(stats.localFileSize)
      this.log(`${cidToFetch} localSize : ${localSize}`)

      // Try to download the content before send it.
      if (localSize < fileSize) {
        this.log(`Node Lazy Downloading for ${cidToFetch}`)
        await this.node.lazyDownload(cidToFetch)
      }

      // Try to stream content.
      const streamed = await this.streamContent(ctx, cidToFetch)
      console.log('streamed', streamed)
      if (streamed) return

      // Send all content
      const totalFileChunks = await this.node.getContent(cidToFetch, { offset: 0, length: fileSize })
      const fileTypeRes = await fileTypeFromBuffer(totalFileChunks)
      const fileType = fileTypeRes || { mime: 'text/plain' }

      ctx.type = fileType.mime
      ctx.body = totalFileChunks
    } catch (error) {
      console.log(error)
      this.handleError(ctx, error)
    }
  }

  async downloadContent (ctx) {
    try {
      const { cid } = ctx.params
      // try to download the cid on the private nerwork first
      await this.node.pftpDownload(cid)

      let cidToFetch = cid
      // Verify if the cid is a folder
      const parsed = await this.parseFolderFormat(ctx)

      // If a result was sent.
      if (parsed && !parsed.cid) return

      // If new cid exist
      if (parsed.cid) cidToFetch = parsed.cid
      console.log('cidToFetch', cidToFetch)

      // Get file stats
      const stats = await this.node.getStat(cidToFetch)

      const fileSize = Number(stats.fileSize)
      this.log(`${cidToFetch} fileSize : ${fileSize}`)
      const localSize = Number(stats.localFileSize)
      this.log(`${cidToFetch} localSize : ${localSize}`)

      // Try to download the content before send it.
      if (localSize < fileSize) {
        this.log(`Node Lazy Downloading for ${cidToFetch}`)
        await this.node.lazyDownload(cidToFetch)
      }

      // Send all content
      const totalFileChunks = await this.node.getContent(cidToFetch, { offset: 0, length: fileSize })
      const fileTypeRes = await fileTypeFromBuffer(totalFileChunks)
      const fileType = fileTypeRes || { mime: 'text/plain' }

      ctx.type = fileType.mime
      ctx.body = totalFileChunks
    } catch (error) {
      console.log(error)
      this.handleError(ctx, error)
    }
  }

  async parseFolderFormat (ctx) {
    try {
      const { cid, name } = ctx.params

      // console.log('body' , ctx.req)
      const s = new Stream.Readable({ read () { } })
      const contentArray = await this.lsDirectoryContent(cid)
      const isDir = contentArray[0].depth

      if (!name && !isDir) {
        return false
      }

      if (name) {
        for (let i = 0; i < contentArray.length; i++) {
          const cont = contentArray[i]
          if (cont.name === name) {
            return { cid: cont.cid.toString() }
          }
        }
      }
      if (isDir) {
        if (isDir) {
          for (let i = 0; i < contentArray.length; i++) {
            const cont = contentArray[i]
            if (cont.path !== cid) {
              // ctx.response.set('content-type', 'txt/html')
              ctx.type = 'html'
              s.push(`<a href='http://localhost:${this.config.port}/ipfs/${cid}/${cont.name}' >/${cont.name} ( ${cont.cid} )</a><hr />`)
            }
          }
          s.push(null)
          ctx.body = s

          this.log('Resolved cid directory format')
          return true
        }
      }

      return false
    } catch (error) {
      this.log(error)
      throw error
    }
  }

  async streamContent (ctx, cid) {
    try {
      if (!cid) throw new Error('cid must be provided!')

      const chunksForFileType = await this.node.getContent(cid, { offset: 0, length: CHUNK_SIZE })
      const fileType = await fileTypeFromBuffer(chunksForFileType)
      console.log('fileType', fileType)
      if (!fileType) return false
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

  async pftpDownload (ctx) {
    try {
      const { cid } = ctx.params
      this.log('\x1b[36m%s\x1b[0m', `PFTP Gateway Download Start For CID: ${cid}`)
      const has = await this.node.helia.blockstore.has(this.CID.parse(cid))
      if (!has) {
        throw new Error('CID not found!')
      }
      // Send all content
      const totalFileChunks = await this.node.getContent(cid)
      ctx.body = totalFileChunks
    } catch (error) {
      this.handleError(ctx, error)
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

  async getConnections (ctx) {
    try {
      const connections = await this.node.getConnections()
      ctx.body = { connections: connections.length }
    } catch (error) {
      this.handleError(ctx, error)
    }
  }
}
