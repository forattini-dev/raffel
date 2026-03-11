import { z } from 'zod'
import { createServer } from '../../../src/server/index.ts'

const server = createServer({
  port: 4330,
  basePath: '/api',
  grpc: { port: 5330, protoPath: 'billing.proto' },
})

server
  .procedure('payments.charge')
  .input(z.object({
    amount: z.number(),
    currency: z.string(),
  }))
  .output(z.object({
    id: z.string(),
    approved: z.boolean(),
  }))
  .http('/payments/charge', 'POST')
  .grpc({
    serviceName: 'billing.Payments',
    methodName: 'Charge',
    type: 'unary',
  })
  .policy({
    auth: { scopes: ['payments:write'] },
  })
  .handler(async () => ({
    id: 'ch_123',
    approved: true,
  }))

export default server
