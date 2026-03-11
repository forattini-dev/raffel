import { z } from 'zod'
import { createServer } from '../../../src/server/index.ts'

const server = createServer({
  port: 4310,
  basePath: '/api',
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
  grpc: { port: 5310, protoPath: 'virtual.proto' },
})

server
  .procedure('users.list')
  .input(z.object({ cursor: z.string().optional() }))
  .output(z.array(z.object({ id: z.string() })))
  .http('/users', 'GET')
  .policy({
    auth: { roles: ['admin'] },
    timeout: { timeoutMs: 1500 },
  })
  .handler(async () => [{ id: 'user-1' }])

server.grpcNs
  .service('UserService', { packageName: 'pkg' })
  .method(
    'GetUser',
    {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
    },
    async (input) => input
  )
  .end()

server.ws.channel('presence-users', {
  type: 'presence',
  description: 'User presence',
  tags: ['presence'],
})

export default server
