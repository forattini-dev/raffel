# Quickstart

Get a multi-protocol server running in under 5 minutes.

---

## Installation

<!-- tabs:start -->

#### **pnpm**

```bash
pnpm add raffel
```

#### **npm**

```bash
npm install raffel
```

#### **yarn**

```bash
yarn add raffel
```

#### **bun**

```bash
bun add raffel
```

<!-- tabs:end -->

---

## Hello World

Create your first multi-protocol server:

```typescript
import { createServer, z } from 'raffel'

const server = createServer({ port: 3000 })

// Define a procedure
server
  .procedure('hello')
  .input(z.object({ name: z.string() }))
  .handler(async ({ name }) => ({ message: `Hello, ${name}!` }))

await server.start()
console.log('⚡ Server running on http://localhost:3000')
```

Test it:

```bash
# HTTP
curl -X POST http://localhost:3000/hello \
  -H 'Content-Type: application/json' \
  -d '{"name": "World"}'

# Response: {"message":"Hello, World!"}
```

---

## Add WebSocket Support

Enable WebSocket with a single line:

```typescript
const server = createServer({
  port: 3000,
  websocket: true,  // or '/ws' for custom path
})

server
  .procedure('hello')
  .input(z.object({ name: z.string() }))
  .handler(async ({ name }) => ({ message: `Hello, ${name}!` }))

await server.start()
```

Test via WebSocket:

```bash
# Using wscat
wscat -c ws://localhost:3000/ws
> {"procedure":"hello","payload":{"name":"World"}}
< {"success":true,"data":{"message":"Hello, World!"}}
```

---

## Add JSON-RPC

Enable JSON-RPC 2.0:

```typescript
const server = createServer({
  port: 3000,
  websocket: true,
  jsonrpc: '/rpc',  // Enable JSON-RPC at /rpc
})

server
  .procedure('hello')
  .input(z.object({ name: z.string() }))
  .handler(async ({ name }) => ({ message: `Hello, ${name}!` }))

await server.start()
```

Test via JSON-RPC:

```bash
curl -X POST http://localhost:3000/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"hello","params":{"name":"World"}}'

# Response: {"jsonrpc":"2.0","id":1,"result":{"message":"Hello, World!"}}
```

---

## Enable GraphQL

Auto-generate a GraphQL schema from your procedures:

```typescript
const server = createServer({
  port: 3000,
  graphql: '/graphql',  // Enable GraphQL at /graphql
})

server
  .procedure('users.create')
  .input(z.object({ name: z.string(), email: z.string().email() }))
  .output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    ...input,
  }))

await server.start()
```

Query via GraphQL:

```graphql
mutation {
  usersCreate(name: "Alice", email: "alice@example.com") {
    id
    name
    email
  }
}
```

---

## Enable gRPC

Expose procedures as gRPC services:

```typescript
const server = createServer({
  port: 3000,
  grpc: {
    port: 50051,
    protoPath: './proto/app.proto',
  },
})

server
  .procedure('UserService.Create')
  .input(z.object({ name: z.string(), email: z.string() }))
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    ...input,
  }))

await server.start()
```

---

## File-Based Routing

Let the filesystem define your endpoints:

```typescript
const server = createServer({
  port: 3000,
  discovery: true,  // Enable auto-discovery
})

await server.start()
```

Create handler files:

```
src/
├── http/
│   └── users/
│       ├── get.ts      → users.get (GET /users.get)
│       └── create.ts   → users.create (POST /users.create)
├── streams/
│   └── logs/
│       └── tail.ts     → logs.tail (streaming)
└── channels/
    └── chat-room.ts    → WebSocket channel
```

Example handler file:

```typescript
// src/http/users/create.ts
import { z } from 'raffel'

export const input = z.object({
  name: z.string(),
  email: z.string().email(),
})

export const handler = async (input) => {
  return { id: crypto.randomUUID(), ...input }
}
```

---

## Add Interceptors

Add rate limiting, logging, and more:

```typescript
import {
  createServer,
  createRateLimitInterceptor,
  createLoggingInterceptor,
  createTimeoutInterceptor,
} from 'raffel'

const server = createServer({ port: 3000 })

// Apply interceptors globally
server.use(createLoggingInterceptor())
server.use(createTimeoutInterceptor({ timeout: 30000 }))
server.use(createRateLimitInterceptor({
  windowMs: 60000,
  maxRequests: 100,
}))

server
  .procedure('hello')
  .handler(async ({ name }) => ({ message: `Hello, ${name}!` }))

await server.start()
```

---

## Add Authentication

Protect your endpoints with JWT:

```typescript
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
} from 'raffel'

const server = createServer({ port: 3000 })

// JWT authentication
const auth = createAuthMiddleware({
  strategy: createBearerStrategy({
    secret: process.env.JWT_SECRET,
    algorithm: 'HS256',
  }),
})

// Public procedure
server
  .procedure('health.check')
  .handler(async () => ({ ok: true }))

// Protected procedure
server
  .procedure('users.me')
  .use(auth)
  .handler(async (input, ctx) => {
    return { userId: ctx.auth.userId }
  })

await server.start()
```

Test with authentication:

```bash
# Get a token (your auth flow)
TOKEN="eyJhbGc..."

# Call protected endpoint
curl -X POST http://localhost:3000/users.me \
  -H 'Authorization: Bearer $TOKEN'
```

---

## Streaming

Create streaming handlers for real-time data:

```typescript
server
  .stream('logs.tail')
  .input(z.object({ file: z.string() }))
  .handler(async function* ({ file }) {
    // Generator-based streaming
    for (let i = 0; i < 100; i++) {
      yield { line: `Log line ${i}`, timestamp: Date.now() }
      await new Promise(r => setTimeout(r, 100))
    }
  })
```

---

## Events (Pub/Sub)

Fire-and-forget events with delivery guarantees:

```typescript
server
  .event('notifications.send')
  .delivery('at-least-once')  // or 'best-effort', 'at-most-once'
  .handler(async (payload, ctx, ack) => {
    await sendNotification(payload)
    ack()  // Acknowledge successful delivery
  })
```

Publish events:

```bash
curl -X POST http://localhost:3000/events/notifications.send \
  -H 'Content-Type: application/json' \
  -d '{"userId": "123", "message": "Hello!"}'
```

---

## Real-time Channels

Pusher-like channels for WebSocket pub/sub:

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: async (socketId, channel, ctx) => {
        // Check if user can access this channel
        if (channel.startsWith('private-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true
      },
    },
  },
})

// Broadcast to channels
server.channels.broadcast('news', 'update', { headline: 'Breaking news!' })
server.channels.broadcast('private-user-123', 'notification', { text: 'New message' })

await server.start()
```

---

## Full Example

Here's a complete example with all features:

```typescript
import {
  createServer,
  z,
  createRateLimitInterceptor,
  createLoggingInterceptor,
  createAuthMiddleware,
  createBearerStrategy,
} from 'raffel'

const server = createServer({
  port: 3000,
  websocket: true,
  jsonrpc: '/rpc',
  graphql: '/graphql',
})

// Global interceptors
server.use(createLoggingInterceptor())
server.use(createRateLimitInterceptor({ windowMs: 60000, maxRequests: 100 }))

// JWT auth middleware
const auth = createAuthMiddleware({
  strategy: createBearerStrategy({ secret: process.env.JWT_SECRET }),
})

// Public health check
server
  .procedure('health.check')
  .handler(async () => ({ ok: true, timestamp: Date.now() }))

// User creation with validation
server
  .procedure('users.create')
  .input(z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }))
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  }))

// Protected user profile
server
  .procedure('users.me')
  .use(auth)
  .handler(async (input, ctx) => ({
    id: ctx.auth.userId,
    email: ctx.auth.email,
  }))

// Streaming logs
server
  .stream('logs.tail')
  .use(auth)
  .input(z.object({ service: z.string() }))
  .handler(async function* ({ service }) {
    for (let i = 0; i < 50; i++) {
      yield { service, line: `Log ${i}`, ts: Date.now() }
      await new Promise(r => setTimeout(r, 500))
    }
  })

// Fire-and-forget notifications
server
  .event('notifications.send')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    console.log('Sending notification:', payload)
    ack()
  })

await server.start()
console.log('⚡ Raffel server running on http://localhost:3000')
console.log('  → HTTP:      http://localhost:3000')
console.log('  → WebSocket: ws://localhost:3000/ws')
console.log('  → JSON-RPC:  http://localhost:3000/rpc')
console.log('  → GraphQL:   http://localhost:3000/graphql')
```

---

## Next Steps

- **[Core Model](core-model.md)** — Deep dive into Envelope, Context, and handlers
- **[Interceptors](interceptors.md)** — Rate limiting, circuit breaker, caching
- **[Authentication](auth/overview.md)** — JWT, OAuth2, OIDC, sessions
- **[File Discovery](file-system-discovery.md)** — Convention-based routing
- **[Protocols](protocols/http.md)** — Protocol-specific details
