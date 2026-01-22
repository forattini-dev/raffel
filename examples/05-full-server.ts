/**
 * Example 5: Complete Full-Featured Server
 *
 * This example combines multiple Raffel features in one comprehensive server:
 *
 * Protocols:
 * - HTTP/REST with CORS
 * - WebSocket with channels (public, private, presence)
 * - JSON-RPC 2.0
 * - SSE Streams
 * - GraphQL
 *
 * Features:
 * - Authentication (Bearer tokens)
 * - Authorization (RBAC)
 * - Metrics (Prometheus)
 * - Tracing
 * - Validation (Zod)
 * - OpenAPI documentation
 * - RaffelDocs multi-protocol documentation
 */

import { z } from 'zod'
import {
  createServer,
  createLogger,
  createZodAdapter,
  registerValidator,
  createBearerStrategy,
  createAuthMiddleware,
  hasRole,
  sid,
  Errors,
} from '../src/index.js'

const logger = createLogger({ name: 'full-server', level: 'debug' })

registerValidator(createZodAdapter(z))

// =============================================================================
// In-Memory Data Store
// =============================================================================

interface User {
  id: string
  email: string
  name: string
  avatar: string
  role: 'admin' | 'user' | 'premium'
  createdAt: Date
}

interface Task {
  id: string
  title: string
  completed: boolean
  userId: string
  createdAt: Date
}

const startTime = Date.now()

const db = {
  users: new Map<string, User>([
    ['user-1', { id: 'user-1', email: 'admin@example.com', name: 'Admin', avatar: '👑', role: 'admin', createdAt: new Date() }],
    ['user-2', { id: 'user-2', email: 'alice@example.com', name: 'Alice', avatar: '👩', role: 'user', createdAt: new Date() }],
    ['user-3', { id: 'user-3', email: 'bob@example.com', name: 'Bob', avatar: '👨', role: 'premium', createdAt: new Date() }],
  ]),
  tasks: new Map<string, Task>([
    ['task-1', { id: 'task-1', title: 'Learn Raffel', completed: false, userId: 'user-2', createdAt: new Date() }],
    ['task-2', { id: 'task-2', title: 'Build awesome API', completed: false, userId: 'user-2', createdAt: new Date() }],
  ]),
}

// Token -> User mapping
const tokens: Record<string, string> = {
  'admin-token': 'user-1',
  'alice-token': 'user-2',
  'bob-token': 'user-3',
}

// Channel membership
const channelMembers: Record<string, Set<string>> = {
  'private-admins': new Set(['user-1']),
  'private-premium': new Set(['user-1', 'user-3']),
}

// =============================================================================
// Schemas
// =============================================================================

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatar: z.string(),
  role: z.enum(['admin', 'user', 'premium']),
  createdAt: z.date(),
})

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  userId: z.string(),
  createdAt: z.date(),
})

const CalcInputSchema = z.object({
  a: z.number(),
  b: z.number(),
})

// =============================================================================
// Server Setup
// =============================================================================

const server = createServer({
  port: 3005,
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
  },
})
  // WebSocket with channels
  .enableWebSocket({
    path: '/ws',
    authenticate: async (req) => {
      const url = new URL(req.url || '', 'http://localhost')
      const token = url.searchParams.get('token')
      if (!token) return { authenticated: false }

      const userId = tokens[token]
      if (!userId) return { authenticated: false }

      const user = db.users.get(userId)
      if (!user) return { authenticated: false }

      return {
        authenticated: true,
        principal: userId,
        roles: [user.role],
        metadata: { name: user.name, avatar: user.avatar },
      }
    },
    channels: {
      authorize: async (socketId, channel, ctx) => {
        if (!channel.startsWith('private-') && !channel.startsWith('presence-')) {
          return true
        }
        if (!ctx.auth?.authenticated) return false

        const members = channelMembers[channel]
        if (members) return members.has(ctx.auth.principal!)

        if (channel.startsWith('presence-')) return true
        return false
      },
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principal,
        name: ctx.auth?.metadata?.name || 'Anonymous',
        avatar: ctx.auth?.metadata?.avatar || '👤',
      }),
    },
  })

// =============================================================================
// WebSocket Channels (explicit definitions for documentation)
// =============================================================================

// Define channels explicitly so they appear in USD documentation
server.ws
  .channel('general', {
    type: 'public',
    description: 'General public chat channel. Anyone can join.',
    tags: ['chat'],
  })
  .channel('announcements', {
    type: 'public',
    description: 'Server announcements and notifications.',
    tags: ['chat'],
  })
  .channel('presence-lobby', {
    type: 'presence',
    description: 'Lobby with presence tracking. Shows who is online.',
    tags: ['presence'],
  })
  .channel('private-admins', {
    type: 'private',
    description: 'Private channel for administrators only.',
    tags: ['admin'],
  })
  .channel('private-premium', {
    type: 'private',
    description: 'Private channel for premium users.',
    tags: ['premium'],
  })

const serverConfig = server
  // JSON-RPC
  .enableJsonRpc('/rpc')

  // GraphQL
  .enableGraphQL({
    path: '/graphql',
    graphiql: true,
  })

  // Authentication
  .use(
    createAuthMiddleware({
      strategies: [
        createBearerStrategy({
          async verify(token) {
            const userId = tokens[token]
            if (!userId) return null

            const user = db.users.get(userId)
            if (!user) return null

            return {
              authenticated: true,
              principal: userId,
              roles: [user.role],
              claims: { email: user.email, name: user.name },
            }
          },
        }),
      ],
      publicProcedures: [
        'health',
        'calculator.add',
        'calculator.subtract',
        'calculator.multiply',
        'calculator.divide',
        'streams.counter',
        'streams.time',
      ],
    })
  )

  // Metrics
  .enableMetrics({
    path: '/metrics',
    includeProcessMetrics: true,
  })

  // Tracing
  .enableTracing({
    serviceName: 'full-server',
    sampler: { type: 'probability', probability: 0.1 },
  })

  // USD Documentation (Universal Service Documentation)
  // USD extends OpenAPI 3.1 with the x-usd namespace for all protocol types
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'Full-Featured Raffel Server',
      version: '1.0.0',
      description: `## Welcome to Raffel

This is a **full-featured server** demonstrating multiple protocols:

- HTTP/REST with CORS
- WebSocket channels
- Server-Sent Events (SSE) streams
- JSON-RPC methods

Use the sidebar to navigate between endpoints.`,
    },
    ui: {
      theme: 'auto',
      tryItOut: true,
    },
  })

// =============================================================================
// System Procedures
// =============================================================================

server
  .procedure('health')
  .description('Health check')
  .output(z.object({ status: z.string(), uptime: z.number(), protocols: z.array(z.string()) }))
  .handler(async () => ({
    status: 'healthy',
    uptime: Date.now() - startTime,
    protocols: ['http', 'websocket', 'json-rpc', 'graphql', 'sse'],
  }))

// =============================================================================
// Calculator Procedures (Public)
// =============================================================================

server
  .procedure('calculator.add')
  .description('Add two numbers')
  .input(CalcInputSchema)
  .output(z.object({ result: z.number(), operation: z.string() }))
  .handler(async (input) => ({ result: input.a + input.b, operation: 'add' }))

server
  .procedure('calculator.subtract')
  .description('Subtract two numbers')
  .input(CalcInputSchema)
  .output(z.object({ result: z.number(), operation: z.string() }))
  .handler(async (input) => ({ result: input.a - input.b, operation: 'subtract' }))

server
  .procedure('calculator.multiply')
  .description('Multiply two numbers')
  .input(CalcInputSchema)
  .output(z.object({ result: z.number(), operation: z.string() }))
  .handler(async (input) => ({ result: input.a * input.b, operation: 'multiply' }))

server
  .procedure('calculator.divide')
  .description('Divide two numbers')
  .input(CalcInputSchema)
  .output(z.object({ result: z.number(), operation: z.string() }))
  .handler(async (input) => {
    if (input.b === 0) throw Errors.badRequest('Division by zero')
    return { result: input.a / input.b, operation: 'divide' }
  })

// =============================================================================
// User Procedures
// =============================================================================

server
  .procedure('users.list')
  .description('List all users')
  .output(z.object({ users: z.array(UserSchema), total: z.number() }))
  .handler(async (_, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const users = Array.from(db.users.values())
    return { users, total: users.length }
  })

server
  .procedure('users.get')
  .description('Get user by ID')
  .input(z.object({ id: z.string() }))
  .output(UserSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const user = db.users.get(input.id)
    if (!user) throw Errors.notFound(`User ${input.id} not found`)
    return user
  })

server
  .procedure('me')
  .description('Get current authenticated user')
  .output(UserSchema.nullable())
  .handler(async (_, ctx) => {
    if (!ctx.auth?.authenticated) return null
    return db.users.get(ctx.auth.principal!) || null
  })

// =============================================================================
// Task Procedures
// =============================================================================

server
  .procedure('tasks.list')
  .description('List tasks for current user')
  .output(z.object({ tasks: z.array(TaskSchema), total: z.number() }))
  .handler(async (_, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const tasks = Array.from(db.tasks.values()).filter(
      (t) => t.userId === ctx.auth!.principal || hasRole('admin')(ctx)
    )
    return { tasks, total: tasks.length }
  })

server
  .procedure('tasks.get')
  .description('Get task by ID')
  .input(z.object({ id: z.string() }))
  .output(TaskSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const task = db.tasks.get(input.id)
    if (!task) throw Errors.notFound(`Task ${input.id} not found`)
    if (task.userId !== ctx.auth.principal && !hasRole('admin')(ctx)) {
      throw Errors.permissionDenied()
    }
    return task
  })

server
  .procedure('tasks.create')
  .description('Create a new task')
  .input(z.object({ title: z.string().min(1).max(200) }))
  .output(TaskSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const task: Task = {
      id: sid(),
      title: input.title,
      completed: false,
      userId: ctx.auth.principal!,
      createdAt: new Date(),
    }
    db.tasks.set(task.id, task)
    logger.info({ taskId: task.id }, 'Task created')
    return task
  })

server
  .procedure('tasks.update')
  .description('Update a task')
  .input(z.object({
    id: z.string(),
    title: z.string().min(1).max(200).optional(),
    completed: z.boolean().optional(),
  }))
  .output(TaskSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const task = db.tasks.get(input.id)
    if (!task) throw Errors.notFound(`Task ${input.id} not found`)
    if (task.userId !== ctx.auth.principal && !hasRole('admin')(ctx)) {
      throw Errors.permissionDenied()
    }
    const updated = {
      ...task,
      ...(input.title !== undefined && { title: input.title }),
      ...(input.completed !== undefined && { completed: input.completed }),
    }
    db.tasks.set(input.id, updated)
    logger.info({ taskId: input.id }, 'Task updated')
    return updated
  })

server
  .procedure('tasks.delete')
  .description('Delete a task')
  .input(z.object({ id: z.string() }))
  .output(z.object({ success: z.boolean() }))
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const task = db.tasks.get(input.id)
    if (!task) throw Errors.notFound(`Task ${input.id} not found`)
    if (task.userId !== ctx.auth.principal && !hasRole('admin')(ctx)) {
      throw Errors.permissionDenied()
    }
    db.tasks.delete(input.id)
    logger.info({ taskId: input.id }, 'Task deleted')
    return { success: true }
  })

// =============================================================================
// Admin Procedures
// =============================================================================

server
  .procedure('admin.stats')
  .description('System statistics (admin only)')
  .output(z.object({
    users: z.number(),
    tasks: z.number(),
    uptime: z.number(),
  }))
  .handler(async (_, ctx) => {
    if (!hasRole('admin')(ctx)) throw Errors.permissionDenied('Admin only')
    return {
      users: db.users.size,
      tasks: db.tasks.size,
      uptime: Date.now() - startTime,
    }
  })

// =============================================================================
// Streams
// =============================================================================

// Public counter stream
server
  .stream('streams.counter')
  .description('Counter stream')
  .input(z.object({
    count: z.coerce.number().int().min(1).max(50).default(10),
  }))
  .handler(async function* (input) {
    for (let i = 1; i <= input.count; i++) {
      yield { count: i, total: input.count }
      await new Promise((r) => setTimeout(r, 500))
    }
  })

// Public time stream
server
  .stream('streams.time')
  .description('Server time stream')
  .handler(async function* (_, ctx) {
    while (!ctx.signal?.aborted) {
      yield { time: new Date().toISOString(), uptime: Date.now() - startTime }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })

// Private activity stream
server
  .stream('streams.activity')
  .description('Activity stream (authenticated)')
  .handler(async function* (_, ctx) {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()

    let eventId = 0
    while (!ctx.signal?.aborted) {
      await new Promise((r) => setTimeout(r, 3000))
      eventId++
      yield {
        id: eventId,
        type: ['login', 'logout', 'action'][eventId % 3],
        timestamp: new Date().toISOString(),
      }
    }
  })

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  await server.start()

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   ███████╗██╗   ██╗██╗     ██╗         ███████╗███████╗██████╗ ██╗   ██╗    ║
║   ██╔════╝██║   ██║██║     ██║         ██╔════╝██╔════╝██╔══██╗██║   ██║    ║
║   █████╗  ██║   ██║██║     ██║         ███████╗█████╗  ██████╔╝██║   ██║    ║
║   ██╔══╝  ██║   ██║██║     ██║         ╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝    ║
║   ██║     ╚██████╔╝███████╗███████╗    ███████║███████╗██║  ██║ ╚████╔╝     ║
║   ╚═╝      ╚═════╝ ╚══════╝╚══════╝    ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝      ║
║                                                                              ║
║            Complete Multi-Protocol Server with ALL Features                  ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🌐 Endpoints:                                                               ║
║     HTTP:        http://localhost:3005                                       ║
║     WebSocket:   ws://localhost:3005/ws                                      ║
║     JSON-RPC:    http://localhost:3005/rpc                                   ║
║     GraphQL:     http://localhost:3005/graphql                               ║
║                                                                              ║
║  📚 Documentation:                                                           ║
║     Swagger:     http://localhost:3005/docs                                  ║
║     RaffelDocs:  http://localhost:3005/raffeldocs                            ║
║                                                                              ║
║  📊 Observability:                                                           ║
║     Metrics:     http://localhost:3005/metrics                               ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔑 Auth Tokens:                                                             ║
║     admin-token  → Admin (full access)                                       ║
║     alice-token  → Regular user                                              ║
║     bob-token    → Premium user                                              ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📋 HTTP Examples:                                                           ║
║                                                                              ║
║  # Health check (public)                                                     ║
║  curl http://localhost:3005/health                                           ║
║                                                                              ║
║  # Calculator (public)                                                       ║
║  curl -X POST http://localhost:3005/calculator.add \\                         ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '{"a":5,"b":3}'                                                        ║
║                                                                              ║
║  # Get current user                                                          ║
║  curl http://localhost:3005/me -H "Authorization: Bearer alice-token"        ║
║                                                                              ║
║  # List users (auth required)                                                ║
║  curl http://localhost:3005/users.list \\                                     ║
║    -H "Authorization: Bearer admin-token"                                    ║
║                                                                              ║
║  # Create task                                                               ║
║  curl -X POST http://localhost:3005/tasks.create \\                           ║
║    -H "Content-Type: application/json" \\                                     ║
║    -H "Authorization: Bearer alice-token" \\                                  ║
║    -d '{"title":"New task"}'                                                 ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📡 JSON-RPC Examples:                                                       ║
║                                                                              ║
║  curl -X POST http://localhost:3005/rpc \\                                    ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '{"jsonrpc":"2.0","method":"calculator.add",                           ║
║         "params":{"a":5,"b":3},"id":1}'                                      ║
║                                                                              ║
║  # Batch request                                                             ║
║  curl -X POST http://localhost:3005/rpc \\                                    ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '[                                                                     ║
║      {"jsonrpc":"2.0","method":"calculator.add","params":{"a":1,"b":2},"id":1},║
║      {"jsonrpc":"2.0","method":"calculator.multiply","params":{"a":3,"b":4},"id":2}║
║    ]'                                                                        ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔮 GraphQL Examples:                                                        ║
║                                                                              ║
║  curl -X POST http://localhost:3005/graphql \\                                ║
║    -H "Content-Type: application/json" \\                                     ║
║    -d '{"query":"{ health { status uptime } }"}'                             ║
║                                                                              ║
║  curl -X POST http://localhost:3005/graphql \\                                ║
║    -H "Content-Type: application/json" \\                                     ║
║    -H "Authorization: Bearer admin-token" \\                                  ║
║    -d '{"query":"{ users_list { users { id name email } } }"}'               ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📡 SSE Streams:                                                             ║
║                                                                              ║
║  curl http://localhost:3005/streams.counter?count=5                          ║
║  curl http://localhost:3005/streams.time                                     ║
║  curl http://localhost:3005/streams.activity \\                               ║
║    -H "Authorization: Bearer alice-token"                                    ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔌 WebSocket:                                                               ║
║                                                                              ║
║  wscat -c "ws://localhost:3005/ws?token=alice-token"                         ║
║  > {"type":"subscribe","channel":"general","id":"1"}                         ║
║  > {"type":"subscribe","channel":"presence-lobby","id":"2"}                  ║
║  > {"type":"publish","channel":"general","event":"message",                  ║
║     "data":{"text":"Hello!"},"id":"3"}                                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

  logger.info('Full server started with all protocols and features enabled')
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
