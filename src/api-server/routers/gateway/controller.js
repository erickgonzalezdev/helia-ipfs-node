import fs from 'fs'
import { fileTypeFromBuffer } from 'file-type'
import Stream from 'stream'

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
      const { cid, name } = ctx.params

      const s = new Stream.Readable({ read () { } })
      const contentArray = await this.lsDirectoryContent(cid)
      const isDir = contentArray[0].depth

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

        ctx.type = 'text/plain; charset=utf-8'
        ctx.body = content
      }
    } catch (error) {
      this.handleError(ctx, error)
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
