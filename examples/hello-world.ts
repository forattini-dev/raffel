/**
 * Hello World Example
 *
 * Demonstrates Raffel's core capabilities:
 * - Procedure handlers (unary RPC)
 * - Stream handlers (server streaming)
 * - Event handlers
 * - Interceptors (middleware)
 * - WebSocket adapter
 *
 * Run with: npx tsx examples/hello-world.ts
 * Test with: wscat -c ws://localhost:3000
 */

import {
  createRegistry,
  createRouter,
  createWebSocketAdapter,
  RaffelError,
  createLogger,
} from '../src/index.js'

const logger = createLogger('hello-world')

// === Create Registry ===
const registry = createRegistry()

// === Register Procedures ===

// Simple greeting
registry.procedure('greet', async (input: { name: string }) => {
  return { message: `Hello, ${input.name}!` }
}, { description: 'Greet a user' })

// Math operation
registry.procedure('math.add', async (input: { a: number; b: number }) => {
  return { result: input.a + input.b }
})

// Procedure that throws known error
registry.procedure('users.get', async (input: { id: string }) => {
  if (input.id === 'not-found') {
    throw new RaffelError('USER_NOT_FOUND', `User '${input.id}' not found`)
  }
  return { id: input.id, name: 'John Doe', email: 'john@example.com' }
})

// === Register Streams ===

// Counter stream
registry.stream('counter', async function* (input: { count: number; delay?: number }) {
  const delay = input.delay ?? 500
  for (let i = 1; i <= input.count; i++) {
    yield { value: i, total: input.count }
    if (i < input.count) {
      await new Promise(r => setTimeout(r, delay))
    }
  }
}, { description: 'Count from 1 to N' })

// Time stream (infinite until cancelled)
registry.stream('time', async function* () {
  while (true) {
    yield { timestamp: new Date().toISOString() }
    await new Promise(r => setTimeout(r, 1000))
  }
}, { description: 'Stream current time every second' })

// === Register Events ===

registry.event('log', async (payload: { level: string; message: string }) => {
  logger.info({ level: payload.level }, payload.message)
}, { description: 'Log a message' })

// At-least-once event with retry policy
registry.event('emails.send', async (payload: { to: string; subject: string }, _ctx, ack) => {
  logger.info({ to: payload.to, subject: payload.subject }, 'Sending email')
  ack?.()
}, {
  description: 'Send an email (at-least-once)',
  delivery: 'at-least-once',
  retryPolicy: {
    maxAttempts: 3,
    initialDelay: 500,
    maxDelay: 5000,
    backoffMultiplier: 2,
  },
})

// At-most-once event with deduplication window
registry.event('payments.processed', async (payload: { paymentId: string }) => {
  logger.info({ paymentId: payload.paymentId }, 'Payment processed')
}, {
  description: 'Process a payment (at-most-once)',
  delivery: 'at-most-once',
  deduplicationWindow: 300_000,
})

// === Create Router ===
const router = createRouter(registry)

// Add logging interceptor
router.use(async (envelope, ctx, next) => {
  const start = Date.now()
  logger.debug({ procedure: envelope.procedure, type: envelope.type }, 'Request started')

  try {
    const result = await next()
    logger.debug(
      { procedure: envelope.procedure, duration: Date.now() - start },
      'Request completed'
    )
    return result
  } catch (err) {
    logger.error(
      { procedure: envelope.procedure, duration: Date.now() - start, err },
      'Request failed'
    )
    throw err
  }
})

// === Create WebSocket Adapter ===
const adapter = createWebSocketAdapter(router, {
  port: 3000,
  heartbeatInterval: 30000,
})

// === Start Server ===
async function main() {
  await adapter.start()

  logger.info(`
╔════════════════════════════════════════════════════════════╗
║                    Raffel Hello World                      ║
╠════════════════════════════════════════════════════════════╣
║  WebSocket server running on ws://localhost:3000           ║
║                                                            ║
║  Test with: wscat -c ws://localhost:3000                   ║
║                                                            ║
║  Try these messages:                                       ║
║                                                            ║
║  Procedures:                                               ║
║  {"procedure":"greet","type":"request",                    ║
║   "payload":{"name":"World"}}                              ║
║                                                            ║
║  {"procedure":"math.add","type":"request",                 ║
║   "payload":{"a":5,"b":3}}                                 ║
║                                                            ║
║  {"procedure":"users.get","type":"request",                ║
║   "payload":{"id":"123"}}                                  ║
║                                                            ║
║  Streams:                                                  ║
║  {"procedure":"counter","type":"stream:start",             ║
║   "payload":{"count":5,"delay":300}}                       ║
║                                                            ║
║  Events:                                                   ║
║  {"procedure":"log","type":"event",                        ║
║   "payload":{"level":"info","message":"Hello!"}}           ║
║                                                            ║
║  {"id":"evt-1","procedure":"emails.send","type":"event",   ║
║   "payload":{"to":"user@example.com","subject":"Hi"}}      ║
║                                                            ║
║  {"id":"evt-2","procedure":"payments.processed","type":"event", ║
║   "payload":{"paymentId":"pay_123"}}                       ║
╚════════════════════════════════════════════════════════════╝
`)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...')
    await adapter.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
