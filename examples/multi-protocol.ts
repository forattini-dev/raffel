/**
 * Multi-Protocol Example
 *
 * Demonstrates Raffel's core value proposition:
 * Same handlers exposed over HTTP, WebSocket, and TCP simultaneously.
 *
 * Run with: npx tsx examples/multi-protocol.ts
 *
 * Test HTTP:
 *   curl -X POST http://localhost:3001/greet -d '{"name":"World"}' -H 'Content-Type: application/json'
 *   curl http://localhost:3001/streams/counter?count=5
 *
 * Test WebSocket:
 *   wscat -c ws://localhost:3000
 *   > {"procedure":"greet","type":"request","payload":{"name":"World"}}
 *
 * Test TCP (using createTcpClient):
 *   const client = createTcpClient({ host: 'localhost', port: 3002 })
 *   await client.connect()
 *   const result = await client.call('greet', { name: 'World' })
 */

import {
  createRegistry,
  createRouter,
  createWebSocketAdapter,
  createHttpAdapter,
  createTcpAdapter,
  RaffelError,
  createLogger,
} from '../src/index.js'

const logger = createLogger('multi-protocol')

// === Create Registry (shared by all protocols) ===
const registry = createRegistry()

// === Register Procedures ===

registry.procedure('greet', async (input: { name: string }) => {
  return { message: `Hello, ${input.name}!` }
}, { description: 'Greet a user' })

registry.procedure('math.add', async (input: { a: number; b: number }) => {
  return { result: input.a + input.b }
}, { description: 'Add two numbers' })

registry.procedure('math.multiply', async (input: { a: number; b: number }) => {
  return { result: input.a * input.b }
}, { description: 'Multiply two numbers' })

registry.procedure('users.get', async (input: { id: string }) => {
  if (input.id === 'not-found') {
    throw new RaffelError('USER_NOT_FOUND', `User '${input.id}' not found`)
  }
  return {
    id: input.id,
    name: 'John Doe',
    email: 'john@example.com',
    createdAt: new Date().toISOString(),
  }
}, { description: 'Get user by ID' })

// === Register Streams ===

registry.stream('counter', async function* (input: { count: number; delay?: number }) {
  const delay = input.delay ?? 500
  for (let i = 1; i <= input.count; i++) {
    yield { value: i, total: input.count, progress: Math.round((i / input.count) * 100) }
    if (i < input.count) {
      await new Promise(r => setTimeout(r, delay))
    }
  }
}, { description: 'Count from 1 to N' })

registry.stream('time', async function* () {
  while (true) {
    yield {
      timestamp: new Date().toISOString(),
      unix: Date.now(),
    }
    await new Promise(r => setTimeout(r, 1000))
  }
}, { description: 'Stream current time every second' })

registry.stream('fibonacci', async function* (input: { count: number }) {
  let a = 0, b = 1
  for (let i = 0; i < input.count; i++) {
    yield { index: i, value: a }
    ;[a, b] = [b, a + b]
    await new Promise(r => setTimeout(r, 100))
  }
}, { description: 'Generate Fibonacci sequence' })

// === Register Events ===

registry.event('log', async (payload: { level: string; message: string }) => {
  logger.info({ level: payload.level }, payload.message)
}, { description: 'Log a message' })

registry.event('analytics.track', async (payload: { event: string; properties?: Record<string, unknown> }) => {
  logger.info({ event: payload.event, properties: payload.properties }, 'Analytics event tracked')
}, { description: 'Track an analytics event' })

// === Create Router (shared by all protocols) ===
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

// === Create Adapters ===

// WebSocket adapter on port 3000
const wsAdapter = createWebSocketAdapter(router, {
  port: 3000,
  heartbeatInterval: 30000,
})

// HTTP adapter on port 3001
const httpAdapter = createHttpAdapter(router, {
  port: 3001,
  basePath: '/',
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    headers: ['Content-Type', 'X-Request-ID'],
    credentials: true,
  },
})

// TCP adapter on port 3002
const tcpAdapter = createTcpAdapter(router, {
  port: 3002,
  keepAliveInterval: 30000,
})

// === Start Servers ===
async function main() {
  await Promise.all([
    wsAdapter.start(),
    httpAdapter.start(),
    tcpAdapter.start(),
  ])

  logger.info(`
╔════════════════════════════════════════════════════════════════╗
║               Raffel Multi-Protocol Server                     ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  WebSocket: ws://localhost:3000                                ║
║  HTTP:      http://localhost:3001                              ║
║  TCP:       tcp://localhost:3002                               ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║  HTTP Examples:                                                ║
║                                                                ║
║  Procedures (POST):                                            ║
║    curl -X POST http://localhost:3001/greet \\                  ║
║         -d '{"name":"World"}' -H 'Content-Type: application/json'
║                                                                ║
║    curl -X POST http://localhost:3001/math.add \\               ║
║         -d '{"a":5,"b":3}' -H 'Content-Type: application/json' ║
║                                                                ║
║  Streams (GET with SSE):                                       ║
║    curl http://localhost:3001/streams/counter?count=5          ║
║    curl http://localhost:3001/streams/fibonacci?count=10       ║
║                                                                ║
║  Events (POST, fire-and-forget):                               ║
║    curl -X POST http://localhost:3001/events/log \\             ║
║         -d '{"level":"info","message":"Hello!"}' \\             ║
║         -H 'Content-Type: application/json'                    ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║  WebSocket Examples (via wscat -c ws://localhost:3000):        ║
║                                                                ║
║  {"procedure":"greet","type":"request",                        ║
║   "payload":{"name":"World"}}                                  ║
║                                                                ║
║  {"procedure":"counter","type":"stream:start",                 ║
║   "payload":{"count":5}}                                       ║
║                                                                ║
║  {"procedure":"log","type":"event",                            ║
║   "payload":{"level":"info","message":"Hello!"}}               ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║  TCP Examples (length-prefixed JSON):                          ║
║                                                                ║
║  Protocol: [4 bytes length (big-endian)] + [JSON payload]      ║
║  Use createTcpClient from raffel for easy integration:         ║
║                                                                ║
║  const client = createTcpClient({ host: 'localhost', port: 3002 })
║  await client.connect()                                        ║
║  const result = await client.call('greet', { name: 'World' })  ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...')
    await Promise.all([
      wsAdapter.stop(),
      httpAdapter.stop(),
      tcpAdapter.stop(),
    ])
    process.exit(0)
  })
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start servers')
  process.exit(1)
})
