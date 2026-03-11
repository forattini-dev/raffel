import { createServer } from '../../../src/server/index.ts'

const server = createServer({ port: 4350 })

server.tcpNs
  .handler('raw.echo', {
    port: 9002,
    host: '127.0.0.1',
    framing: 'delimiter',
    delimiter: '\n',
  })
  .onData((data, socket) => {
    socket.write(`${data.toString('utf8').toUpperCase()}\n`)
  })
  .end()

export default server
