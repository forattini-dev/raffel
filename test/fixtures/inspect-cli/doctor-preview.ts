import { createServer } from '../../../src/server/index.ts'

const server = createServer({ port: 4320 })

server.procedure('public.ping').handler(async () => ({ ok: true }))
server.http.get('/legacy', async () => ({ ok: true }))

export default server
