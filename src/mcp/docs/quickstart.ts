/**
 * Raffel MCP - Quickstart Guide
 *
 * Getting started with Raffel - from zero to production-ready API.
 */

export const quickstartGuide = `# Raffel Quickstart

## Installation

\`\`\`bash
pnpm add raffel
# or
npm install raffel
\`\`\`

## Basic Server

\`\`\`typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .procedure('hello')
    .handler(async (input, ctx) => {
      return { message: \`Hello, \${input.name || 'World'}!\` }
    })

await server.start()
console.log('Server running on http://localhost:3000')
\`\`\`

## Core Concepts

### 1. Procedures (RPC Endpoints)

\`\`\`typescript
// Unary RPC: Input → Output
server.procedure('users.create')
  .handler(async (input, ctx) => {
    return await db.users.create({ data: input })
  })
\`\`\`

### 2. Input/Output Validation

\`\`\`typescript
import { z } from 'zod'
import { registerValidator, createZodAdapter } from 'raffel'

registerValidator(createZodAdapter(z))

server.procedure('users.create')
  .input(z.object({
    name: z.string().min(2),
    email: z.string().email()
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string()
  }))
  .handler(async (input, ctx) => {
    // input is validated and typed
    return await db.users.create({ data: input })
  })
\`\`\`

### 3. Context & Authentication

\`\`\`typescript
import { createAuthMiddleware, createBearerStrategy } from 'raffel'

server
  .use(createAuthMiddleware({
    strategies: [createBearerStrategy({
      verify: async (token) => {
        const payload = await verifyJwt(token)
        return payload ? { authenticated: true, principal: payload.sub, claims: payload } : null
      }
    })]
  }))

  .procedure('users.me')
    .handler(async (_input, ctx) => {
      return { userId: ctx.auth?.principal }
    })
\`\`\`

### 4. Streaming

\`\`\`typescript
// Server sends multiple responses
server.stream('logs.tail')
  .handler(async function* (input, ctx) {
    while (!ctx.signal.aborted) {
      const logs = await getNewLogs(input.filter)
      for (const log of logs) {
        yield log
      }
      await sleep(1000)
    }
  })
\`\`\`

### 5. Events

\`\`\`typescript
// Fire-and-forget with retries
server.event('orders.notify')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 5 })
  .handler(async (payload, ctx, ack) => {
    await sendNotification(payload)
    ack()  // Acknowledge success
  })
\`\`\`

### 6. Multiple Protocols

\`\`\`typescript
const server = createServer({ port: 3000 })
  // HTTP is default
  .enableWebSocket({ path: '/ws' })      // Add WebSocket
  .enableJsonRpc({ path: '/jsonrpc' })   // Add JSON-RPC
  .grpc({ port: 50051 })                 // Add gRPC
  .enableGraphQL({ path: '/graphql' })   // Add GraphQL
\`\`\`

## HTTP Mapping

| Handler | HTTP | Path |
|---------|------|------|
| procedure | POST | /api/{name} |
| stream | GET (SSE) | /api/streams/{name} |
| event | POST | /api/events/{name} |

## Complete Example

\`\`\`typescript
import { createServer, registerValidator, createZodAdapter, createAuthMiddleware, createBearerStrategy, RaffelError } from 'raffel'
import { z } from 'zod'

// Setup validation
registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })
  // Providers (DI)
  .provide('db', async () => {
    const prisma = new PrismaClient()
    await prisma.$connect()
    return prisma
  }, { onShutdown: (db) => db.$disconnect() })

  // Global middleware
  .use(createAuthMiddleware({
    strategies: [createBearerStrategy({ verify: verifyToken })]
  }))

  // Procedures
  .procedure('users.list')
    .output(z.array(UserSchema))
    .handler(async (input, ctx) => {
      return await ctx.db.users.findMany()
    })

  .procedure('users.get')
    .input(z.object({ id: z.string() }))
    .output(UserSchema)
    .handler(async ({ id }, ctx) => {
      const user = await ctx.db.users.findUnique({ where: { id } })
      if (!user) throw new RaffelError('NOT_FOUND', \`User \${id} not found\`)
      return user
    })

  .procedure('users.create')
    .input(CreateUserSchema)
    .output(UserSchema)
    .handler(async (input, ctx) => {
      return await ctx.db.users.create({ data: input })
    })

await server.start()
\`\`\`

## Next Steps

- **Interceptors**: Add rate limiting, caching, metrics
- **Streaming**: Real-time data with generators
- **Events**: Background processing with delivery guarantees
- **Multi-protocol**: Same handlers on HTTP, WebSocket, gRPC
- **Observability**: Metrics and distributed tracing
`

export const boilerplates = {
  'basic-api': {
    title: 'Basic REST API',
    description: 'Simple CRUD API with validation and error handling',
    files: {
      'src/server.ts': `import { createServer, registerValidator, createZodAdapter, RaffelError } from 'raffel'
import { z } from 'zod'

// Setup validation
registerValidator(createZodAdapter(z))

// Schemas
const TodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  createdAt: z.string()
})

const CreateTodoInput = z.object({
  title: z.string().min(1).max(200)
})

const UpdateTodoInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional()
})

// In-memory store (replace with database)
const todos = new Map<string, z.infer<typeof TodoSchema>>()

// Server
const server = createServer({ port: 3000 })
  .procedure('todos.list')
    .output(z.array(TodoSchema))
    .handler(async () => {
      return Array.from(todos.values())
    })

  .procedure('todos.get')
    .input(z.object({ id: z.string() }))
    .output(TodoSchema)
    .handler(async ({ id }) => {
      const todo = todos.get(id)
      if (!todo) throw new RaffelError('NOT_FOUND', \`Todo \${id} not found\`)
      return todo
    })

  .procedure('todos.create')
    .input(CreateTodoInput)
    .output(TodoSchema)
    .handler(async (input) => {
      const todo = {
        id: crypto.randomUUID(),
        title: input.title,
        completed: false,
        createdAt: new Date().toISOString()
      }
      todos.set(todo.id, todo)
      return todo
    })

  .procedure('todos.update')
    .input(UpdateTodoInput)
    .output(TodoSchema)
    .handler(async (input) => {
      const todo = todos.get(input.id)
      if (!todo) throw new RaffelError('NOT_FOUND', \`Todo \${input.id} not found\`)

      const updated = { ...todo, ...input }
      todos.set(input.id, updated)
      return updated
    })

  .procedure('todos.delete')
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .handler(async ({ id }) => {
      if (!todos.has(id)) throw new RaffelError('NOT_FOUND', \`Todo \${id} not found\`)
      todos.delete(id)
      return { success: true }
    })

await server.start()
console.log('Todo API running on http://localhost:3000')
`,
      'package.json': `{
  "name": "raffel-todo-api",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "raffel": "latest",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}`,
    },
  },
  'with-auth': {
    title: 'API with Authentication',
    description: 'JWT authentication with protected routes',
    files: {
      'src/server.ts': `import {
  createServer,
  registerValidator,
  createZodAdapter,
  createAuthMiddleware,
  createBearerStrategy,
  forPattern,
  RaffelError
} from 'raffel'
import { z } from 'zod'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

registerValidator(createZodAdapter(z))

// Auth types
interface User {
  id: string
  email: string
  roles: string[]
}

// JWT verification
const verifyToken = async (token: string) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as User
    return { authenticated: true, principal: payload.id, claims: payload }
  } catch {
    return null
  }
}

const server = createServer({ port: 3000 })
  // Auth middleware
  .use(createAuthMiddleware({
    strategies: [createBearerStrategy({ verify: verifyToken })]
  }))

  // Public routes
  .procedure('auth.login')
    .input(z.object({
      email: z.string().email(),
      password: z.string()
    }))
    .handler(async ({ email, password }) => {
      // Replace with real auth logic
      if (password !== 'password') {
        throw new RaffelError('UNAUTHENTICATED', 'Invalid credentials')
      }

      const user: User = { id: '1', email, roles: ['user'] }
      const token = jwt.sign(user, JWT_SECRET, { expiresIn: '1h' })

      return { token, user }
    })

  // Protected routes
  .procedure('users.me')
    .handler(async (_input, ctx) => {
      return {
        userId: ctx.auth?.principal,
        email: ctx.auth?.claims?.email,
        roles: ctx.auth?.claims?.roles,
      }
    })

  .procedure('admin.stats')
    .handler(async (_input, ctx) => {
      if (!ctx.auth?.claims?.roles?.includes('admin')) {
        throw new RaffelError('PERMISSION_DENIED', 'Admin access required')
      }
      return { users: 100, orders: 500 }
    })

await server.start()
console.log('Auth API running on http://localhost:3000')
`,
    },
  },
  'with-prisma': {
    title: 'API with Prisma Database',
    description: 'Full CRUD with Prisma ORM and dependency injection',
    files: {
      'src/server.ts': `import {
  createServer,
  registerValidator,
  createZodAdapter,
  RaffelError
} from 'raffel'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

// Schemas
const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date()
})

const CreateUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100)
})

// Extend Context type for providers
declare module 'raffel' {
  interface Context {
    db: PrismaClient
  }
}

const server = createServer({ port: 3000 })
  // Database provider
  .provide('db', async () => {
    const prisma = new PrismaClient()
    await prisma.$connect()
    console.log('Connected to database')
    return prisma
  }, {
    onShutdown: async (db) => {
      await db.$disconnect()
      console.log('Disconnected from database')
    }
  })

  .procedure('users.list')
    .handler(async (input, ctx) => {
      return await ctx.db.user.findMany({
        orderBy: { createdAt: 'desc' }
      })
    })

  .procedure('users.get')
    .input(z.object({ id: z.string() }))
    .handler(async ({ id }, ctx) => {
      const user = await ctx.db.user.findUnique({ where: { id } })
      if (!user) throw new RaffelError('NOT_FOUND', \`User \${id} not found\`)
      return user
    })

  .procedure('users.create')
    .input(CreateUserInput)
    .handler(async (input, ctx) => {
      const existing = await ctx.db.user.findUnique({
        where: { email: input.email }
      })
      if (existing) {
        throw new RaffelError('ALREADY_EXISTS', 'Email already registered')
      }
      return await ctx.db.user.create({ data: input })
    })

  .procedure('users.update')
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      email: z.string().email().optional()
    }))
    .handler(async ({ id, ...data }, ctx) => {
      try {
        return await ctx.db.user.update({ where: { id }, data })
      } catch {
        throw new RaffelError('NOT_FOUND', \`User \${id} not found\`)
      }
    })

  .procedure('users.delete')
    .input(z.object({ id: z.string() }))
    .handler(async ({ id }, ctx) => {
      try {
        await ctx.db.user.delete({ where: { id } })
        return { success: true }
      } catch {
        throw new RaffelError('NOT_FOUND', \`User \${id} not found\`)
      }
    })

await server.start()
console.log('Prisma API running on http://localhost:3000')
`,
      'prisma/schema.prisma': `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
    },
  },
  'realtime-websocket': {
    title: 'Real-time WebSocket Server',
    description: 'Chat server with WebSocket and pub/sub channels',
    files: {
      'src/server.ts': `import { createServer, createStream, RaffelError } from 'raffel'
import { z } from 'zod'

const server = createServer({ port: 3000 })
  .enableWebSocket({
    path: '/ws',
    channels: {
      authorize: async (socket, channel, ctx) => {
        // Private channels require auth
        if (channel.startsWith('private-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true
      }
    }
  })

  // Send message to channel
  .procedure('chat.send')
    .input(z.object({
      channel: z.string(),
      message: z.string().min(1).max(1000)
    }))
    .handler(async (input, ctx) => {
      const msg = {
        id: crypto.randomUUID(),
        channel: input.channel,
        message: input.message,
        sender: ctx.auth?.principal ?? 'anonymous',
        timestamp: new Date().toISOString()
      }

      // Broadcast to channel subscribers
      server.channels?.broadcast(input.channel, 'message', msg)

      return msg
    })

  // Stream messages from a channel
  .stream('chat.subscribe')
    .handler(async function* (input, ctx) {
      const { channel } = input
      const stream = createStream()

      // Subscribe to channel events
      const unsubscribe = server.channels?.subscribe(channel, (event, data) => {
        stream.write({ event, data })
      })

      ctx.signal.addEventListener('abort', () => {
        unsubscribe?.()
        stream.end()
      })

      for await (const msg of stream) {
        yield msg
      }
    })

  // Get channel members (presence)
  .procedure('chat.members')
    .input(z.object({ channel: z.string() }))
    .handler(async ({ channel }) => {
      const members = server.channels?.getMembers(channel) ?? []
      return { channel, members }
    })

await server.start()
console.log('Chat server running on http://localhost:3000')
console.log('WebSocket available at ws://localhost:3000/ws')
`,
    },
  },
  'multi-protocol': {
    title: 'Multi-Protocol Server',
    description: 'Same handlers exposed via HTTP, WebSocket, gRPC, and GraphQL',
    files: {
      'src/server.ts': `import { createServer, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  stock: z.number()
})

const products = new Map([
  ['1', { id: '1', name: 'Widget', price: 9.99, stock: 100 }],
  ['2', { id: '2', name: 'Gadget', price: 19.99, stock: 50 }]
])

const server = createServer({ port: 3000 })
  // Enable all protocols
  .enableWebSocket({ path: '/ws' })
  .enableJsonRpc({ path: '/jsonrpc' })
  .enableGraphQL({ path: '/graphql', playground: true })
  .grpc({ port: 50051 })

  // Procedures work on ALL protocols
  .procedure('products.list')
    .output(z.array(ProductSchema))
    .handler(async () => Array.from(products.values()))

  .procedure('products.get')
    .input(z.object({ id: z.string() }))
    .output(ProductSchema)
    .handler(async ({ id }) => {
      const product = products.get(id)
      if (!product) throw new Error('Product not found')
      return product
    })

  .procedure('products.create')
    .input(z.object({
      name: z.string(),
      price: z.number().positive(),
      stock: z.number().int().min(0)
    }))
    .output(ProductSchema)
    .handler(async (input) => {
      const product = { id: crypto.randomUUID(), ...input }
      products.set(product.id, product)
      return product
    })

  // Streaming works on WebSocket and gRPC
  .stream('products.watch')
    .handler(async function* (input, ctx) {
      let lastCheck = Date.now()
      while (!ctx.signal.aborted) {
        yield { products: Array.from(products.values()), updatedAt: new Date() }
        await new Promise(r => setTimeout(r, 5000))
      }
    })

await server.start()

console.log(\`
Multi-Protocol Server Running:

  HTTP:      http://localhost:3000/api/*
  WebSocket: ws://localhost:3000/ws
  JSON-RPC:  http://localhost:3000/jsonrpc
  GraphQL:   http://localhost:3000/graphql
  gRPC:      localhost:50051

Try:
  curl -X POST http://localhost:3000/api/products.list
  grpcurl -plaintext localhost:50051 raffel.Products/List
\`)
`,
    },
  },
}

export function getBoilerplate(
  name: keyof typeof boilerplates
): (typeof boilerplates)[keyof typeof boilerplates] | undefined {
  return boilerplates[name]
}

export function listBoilerplates(): Array<{ name: string; title: string; description: string }> {
  return Object.entries(boilerplates).map(([name, bp]) => ({
    name,
    title: bp.title,
    description: bp.description,
  }))
}
