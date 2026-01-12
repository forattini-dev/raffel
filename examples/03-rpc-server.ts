/**
 * Example 3: JSON-RPC Server
 *
 * Features demonstrated:
 * - JSON-RPC 2.0 protocol
 * - Batch requests
 * - Calculator procedures
 * - User management
 * - Streaming (fibonacci)
 */

import { z } from 'zod'
import {
  createServer,
  createLogger,
  createZodAdapter,
  registerValidator,
  Errors,
  sid,
} from '../src/index.js'

const logger = createLogger({ name: 'rpc-server', level: 'debug' })

registerValidator(createZodAdapter(z))

// =============================================================================
// In-Memory Data Store
// =============================================================================

interface User {
  id: string
  name: string
  email: string
  createdAt: Date
}

const db = {
  users: new Map<string, User>([
    ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com', createdAt: new Date() }],
    ['user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com', createdAt: new Date() }],
  ]),
}

// =============================================================================
// Schemas
// =============================================================================

const CalcInputSchema = z.object({
  a: z.number(),
  b: z.number(),
})

const CalcResultSchema = z.object({
  result: z.number(),
  operation: z.string(),
})

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.date(),
})

// =============================================================================
// Server Setup
// =============================================================================

const server = createServer({ port: 3003 })
  // JSON-RPC 2.0 endpoint
  .enableJsonRpc('/rpc')

  // USD Documentation (Universal Service Documentation)
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'RPC Server',
      version: '1.0.0',
      description: 'JSON-RPC 2.0 server with calculator and string utilities.',
    },
    contentTypes: {
      default: 'application/json',
      supported: ['application/json', 'text/csv'],
    },
    jsonrpc: {
      contentTypes: {
        default: 'application/json',
        supported: ['application/json', 'text/csv'],
      },
    },
    streams: {
      contentTypes: {
        default: 'application/json',
        supported: ['application/json', 'application/x-ndjson'],
      },
    },
  })

// =============================================================================
// Calculator Procedures
// =============================================================================

server
  .procedure('calculator.add')
  .description('Add two numbers')
  .input(CalcInputSchema)
  .output(CalcResultSchema)
  .handler(async (input) => ({
    result: input.a + input.b,
    operation: 'add',
  }))

server
  .procedure('calculator.subtract')
  .description('Subtract two numbers')
  .input(CalcInputSchema)
  .output(CalcResultSchema)
  .handler(async (input) => ({
    result: input.a - input.b,
    operation: 'subtract',
  }))

server
  .procedure('calculator.multiply')
  .description('Multiply two numbers')
  .input(CalcInputSchema)
  .output(CalcResultSchema)
  .handler(async (input) => ({
    result: input.a * input.b,
    operation: 'multiply',
  }))

server
  .procedure('calculator.divide')
  .description('Divide two numbers')
  .input(CalcInputSchema)
  .output(CalcResultSchema)
  .handler(async (input) => {
    if (input.b === 0) throw Errors.badRequest('Division by zero')
    return { result: input.a / input.b, operation: 'divide' }
  })

// =============================================================================
// Fibonacci Stream
// =============================================================================

server
  .stream('calculator.fibonacci')
  .description('Stream fibonacci sequence')
  .input(z.object({ count: z.number().int().min(1).max(100).default(10) }))
  .handler(async function* (input) {
    let a = 0, b = 1
    for (let i = 0; i < input.count; i++) {
      yield { index: i, value: a }
      ;[a, b] = [b, a + b]
      await new Promise(r => setTimeout(r, 100))
    }
  })

// =============================================================================
// User Procedures
// =============================================================================

server
  .procedure('users.get')
  .description('Get user by ID')
  .input(z.object({ id: z.string() }))
  .output(UserSchema)
  .handler(async (input) => {
    const user = db.users.get(input.id)
    if (!user) throw Errors.notFound(`User ${input.id} not found`)
    return user
  })

server
  .procedure('users.list')
  .description('List all users')
  .output(z.object({
    users: z.array(UserSchema),
    total: z.number(),
  }))
  .handler(async () => {
    const users = Array.from(db.users.values())
    return { users, total: users.length }
  })

server
  .procedure('users.create')
  .description('Create a new user')
  .input(z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }))
  .output(UserSchema)
  .handler(async (input) => {
    const id = sid()
    const user: User = { id, ...input, createdAt: new Date() }
    db.users.set(id, user)
    logger.info({ userId: id }, 'User created')
    return user
  })

server.procedure(
  'reports.export',
  async () => 'id,name\nuser-1,Alice\nuser-2,Bob\n',
  {
    summary: 'Export users as CSV',
    contentType: 'text/csv',
  }
)

// =============================================================================
// System Procedures
// =============================================================================

server
  .procedure('health')
  .description('Health check')
  .output(z.object({ status: z.string(), protocols: z.array(z.string()) }))
  .handler(async () => ({
    status: 'healthy',
    protocols: ['http', 'json-rpc'],
  }))

server
  .procedure('echo')
  .description('Echo back the input')
  .input(z.object({ message: z.string() }))
  .output(z.object({ message: z.string(), timestamp: z.string() }))
  .handler(async (input) => ({
    message: input.message,
    timestamp: new Date().toISOString(),
  }))

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  await server.start()

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║       ██████╗ ██████╗  ██████╗    ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ ║
║       ██╔══██╗██╔══██╗██╔════╝    ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗║
║       ██████╔╝██████╔╝██║         ███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝║
║       ██╔══██╗██╔═══╝ ██║         ╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗║
║       ██║  ██║██║     ╚██████╗    ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║║
║       ╚═╝  ╚═╝╚═╝      ╚═════╝    ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝║
║                                                                              ║
║                     JSON-RPC 2.0 Server                                      ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🌐 HTTP:      http://localhost:3003                                         ║
║  📡 JSON-RPC:  http://localhost:3003/rpc                                     ║
║  📚 Swagger:   http://localhost:3003/docs                                    ║
║  📖 RaffelDocs: http://localhost:3003/raffeldocs                             ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📡 JSON-RPC 2.0 Usage:                                                      ║
║                                                                              ║
║  # Single request                                                            ║
║  curl -X POST http://localhost:3003/rpc \\                                    ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '{"jsonrpc":"2.0","method":"calculator.add",                           ║
║         "params":{"a":5,"b":3},"id":1}'                                      ║
║                                                                              ║
║  # Batch request                                                             ║
║  curl -X POST http://localhost:3003/rpc \\                                    ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '[                                                                     ║
║      {"jsonrpc":"2.0","method":"calculator.add","params":{"a":1,"b":2},"id":1},║
║      {"jsonrpc":"2.0","method":"calculator.multiply","params":{"a":3,"b":4},"id":2}║
║    ]'                                                                        ║
║                                                                              ║
║  # HTTP style                                                                ║
║  curl -X POST http://localhost:3003/calculator.add \\                         ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '{"a":5,"b":3}'                                                        ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📋 Available Methods:                                                       ║
║     calculator.add        - Add two numbers                                  ║
║     calculator.subtract   - Subtract two numbers                             ║
║     calculator.multiply   - Multiply two numbers                             ║
║     calculator.divide     - Divide two numbers                               ║
║     calculator.fibonacci  - Stream fibonacci (streaming)                     ║
║     users.get             - Get user by ID                                   ║
║     users.list            - List all users                                   ║
║     users.create          - Create new user                                  ║
║     health                - Health check                                     ║
║     echo                  - Echo message                                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

  logger.info('RPC server started')
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
