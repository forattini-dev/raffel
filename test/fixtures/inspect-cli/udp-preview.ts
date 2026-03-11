import { createServer } from '../../../src/server/index.ts'

const server = createServer({ port: 4340 })

server.udp
  .handler('metrics.ingest', { port: 9001, host: '127.0.0.1' })
  .onMessage(() => Buffer.from('ok'))
  .end()

export default server
