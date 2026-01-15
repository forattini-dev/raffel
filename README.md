<div align="center">

# Raffel

### Build APIs Like Express. Scale Like Nothing Else.

[![npm version](https://img.shields.io/npm/v/raffel.svg?style=flat-square&color=8b5cf6)](https://www.npmjs.com/package/raffel)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[Quick Start](#quick-start) · [Full Documentation](https://forattini-dev.github.io/raffel) · [Examples](./examples) · [Migration from Express](#migration-from-express)

</div>

---

## If You Know Express, You Know Raffel

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

app.get('/users', async () => {
  return db.users.findMany()
})

app.get('/users/:id', async ({ id }) => {
  return db.users.findById(id)
})

app.post('/users', async (body) => {
  return db.users.create(body)
})

await app.start()
```

```bash
curl http://localhost:3000/users
curl http://localhost:3000/users/123
curl -X POST http://localhost:3000/users -d '{"name":"John"}'
```

**That's it. Familiar, right?**

---

## Quick Start

```bash
pnpm add raffel
```

### Hello World

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

app.get('/hello/:name', async ({ name }) => {
  return { message: `Hello, ${name}!` }
})

await app.start()
```

```bash
curl http://localhost:3000/hello/World
# → {"message":"Hello, World!"}
```

### CRUD API in 30 Seconds

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

const users = new Map()

app.get('/users', async () => [...users.values()])

app.get('/users/:id', async ({ id }) => {
  const user = users.get(id)
  if (!user) throw app.errors.notFound('User not found')
  return user
})

app.post('/users', async (body) => {
  const user = { id: crypto.randomUUID(), ...body }
  users.set(user.id, user)
  return user
})

app.put('/users/:id', async ({ id, ...body }) => {
  if (!users.has(id)) throw app.errors.notFound('User not found')
  const user = { id, ...body }
  users.set(id, user)
  return user
})

app.delete('/users/:id', async ({ id }) => {
  if (!users.delete(id)) throw app.errors.notFound('User not found')
  return { success: true }
})

await app.start()
```

### Add Validation (with Zod)

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

const app = createServer({ port: 3000 })

app.post('/users', {
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }),
  handler: async (body) => {
    return db.users.create(body)
  }
})

await app.start()
```

Invalid request? Automatic error response:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": [
    { "path": "email", "message": "Invalid email" }
  ]
}
```

### Add Middleware

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

// Global middleware
app.use(async (req, next) => {
  const start = Date.now()
  const result = await next()
  console.log(`${req.method} ${req.path} - ${Date.now() - start}ms`)
  return result
})

// Auth middleware
const requireAuth = async (req, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) throw app.errors.unauthorized()
  req.user = await verifyToken(token)
  return next()
}

app.get('/profile', requireAuth, async (_, req) => {
  return req.user
})

await app.start()
```

---

## Wait, There's More

Here's where Raffel gets interesting. **That same API you just wrote? It already works over WebSocket, JSON-RPC, and more.**

```typescript
const app = createServer({
  port: 3000,
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
})

app.get('/users/:id', async ({ id }) => {
  return db.users.findById(id)
})

await app.start()
```

**Same handler. Three protocols. Zero extra code.**

```bash
# HTTP (as usual)
curl http://localhost:3000/users/123

# WebSocket
wscat -c ws://localhost:3000/ws
> {"method":"users.get","params":{"id":"123"}}

# JSON-RPC
curl -X POST http://localhost:3000/rpc \
  -d '{"jsonrpc":"2.0","method":"users.get","params":{"id":"123"},"id":1}'
```

### Why Does This Matter?

- **Write once** - Same validation, auth, and error handling everywhere
- **Client choice** - HTTP for REST, WebSocket for real-time, JSON-RPC for internal services
- **Zero friction** - No adapters, no mappings, no duplicate code

---

## The Full Picture

Under the hood, Raffel normalizes all requests into a unified format called an **Envelope**. But you don't need to think about that - it just works.

| What You Write | What Raffel Exposes |
|----------------|---------------------|
| `app.get('/users/:id', handler)` | HTTP GET, WS, JSON-RPC, gRPC, GraphQL |
| `app.post('/users', handler)` | HTTP POST, WS, JSON-RPC, gRPC, GraphQL |
| Validation schema | Same validation, all protocols |
| Auth middleware | Same auth, all protocols |
| Error handling | Protocol-appropriate errors |

### Supported Protocols

| Protocol | Status | Use Case |
|----------|--------|----------|
| HTTP | Production | REST APIs, webhooks |
| WebSocket | Production | Real-time, bi-directional |
| JSON-RPC | Production | Internal services, batch |
| gRPC | Production | Microservices, high-perf |
| GraphQL | Production | Flexible queries |
| TCP | Production | IoT, custom protocols |
| UDP | Production | Gaming, streaming |

---

## Going Deeper: The Procedure API

For power users who want full control, Raffel exposes its native API:

```typescript
import { createServer, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({
  port: 3000,
  websocket: { path: '/ws' },
})

// Full procedure definition
server.procedure('users.create')
  .description('Create a new user')
  .input(z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
  }))
  .handler(async (input, ctx) => {
    // ctx has auth, tracing, request metadata
    return db.users.create(input)
  })

// Streaming (server → client)
server.stream('logs.tail')
  .handler(async function* ({ file }) {
    for await (const line of readLines(file)) {
      yield { line, timestamp: Date.now() }
    }
  })

// Events (fire-and-forget with guarantees)
server.event('emails.send')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    await sendEmail(payload)
    ack()
  })

await server.start()
```

### The Envelope Model

Every request becomes an Envelope:

```typescript
interface Envelope {
  id: string           // Correlation ID
  procedure: string    // Handler name (e.g., "users.create")
  type: 'request' | 'response' | 'stream:data' | 'event'
  payload: unknown     // Your data
  context: Context     // Auth, tracing, deadline, metadata
}
```

This abstraction is what enables protocol-agnostic handlers. You write business logic once, Raffel handles the protocol translation.

---

## Features at a Glance

| Category | Features |
|----------|----------|
| **HTTP** | GET/POST/PUT/PATCH/DELETE, path params, query params, headers |
| **Validation** | Zod, Yup, Joi, Ajv, fastest-validator |
| **Auth** | JWT, API Key, OAuth2, OIDC, Basic, Session |
| **Resilience** | Rate Limit, Circuit Breaker, Retry, Timeout, Bulkhead |
| **Observability** | Prometheus Metrics, OpenTelemetry Tracing |
| **Caching** | Memory, Redis, S3, Read-through, Write-through |
| **Real-time** | WebSocket Channels, Presence, Broadcasting |
| **Documentation** | Auto-generated OpenAPI/Swagger from schemas |
| **DX** | Hot Reload, File-based Routing, TypeScript-first |

---

## Migration from Express

Already have an Express app? Migration is straightforward:

<table>
<tr>
<th>Express</th>
<th>Raffel</th>
</tr>
<tr>
<td>

```javascript
const express = require('express')
const app = express()

app.get('/users/:id', (req, res) => {
  const user = getUser(req.params.id)
  res.json(user)
})

app.post('/users', (req, res) => {
  const user = createUser(req.body)
  res.status(201).json(user)
})

app.listen(3000)
```

</td>
<td>

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

app.get('/users/:id', async ({ id }) => {
  return getUser(id)
})

app.post('/users', async (body) => {
  return createUser(body)
})

await app.start()
```

</td>
</tr>
</table>

**Key differences:**
- Return values instead of `res.json()`
- Path params and body merged into handler argument
- `async/await` native (no callback hell)
- Errors thrown, not manually handled

See [full migration guide](./docs/migration.md) for middleware, error handling, and advanced patterns.

---

## Examples

```bash
# Clone and run
git clone https://github.com/tetis-io/raffel
cd raffel

# Basic examples
pnpm tsx examples/00-hello-world.ts
pnpm tsx examples/01-rest-api.ts
pnpm tsx examples/02-websocket-server.ts
pnpm tsx examples/03-rpc-server.ts

# Advanced
pnpm tsx examples/07-resource-builder.ts
pnpm tsx examples/08-declarative-api.ts
```

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Quickstart](https://forattini-dev.github.io/raffel/#/quickstart) | 5-minute guide |
| [HTTP Deep Dive](https://forattini-dev.github.io/raffel/#/protocols/http) | REST, middleware, routing |
| [Authentication](https://forattini-dev.github.io/raffel/#/auth/overview) | JWT, API Key, OAuth2, OIDC |
| [Validation](https://forattini-dev.github.io/raffel/#/validation) | Zod, Yup, Joi integration |
| [WebSocket](https://forattini-dev.github.io/raffel/#/protocols/websocket) | Real-time, channels, presence |
| [Interceptors](https://forattini-dev.github.io/raffel/#/interceptors) | Rate limit, retry, cache |
| [Core Model](https://forattini-dev.github.io/raffel/#/core-model) | Envelope, Context, architecture |
| [File-based Routing](https://forattini-dev.github.io/raffel/#/file-system-discovery) | Zero-config discovery |

---

## MCP Server (AI Integration)

Raffel includes an MCP server for AI-powered development:

```bash
# Add to Claude Code
claude mcp add raffel npx raffel-mcp

# Or run directly
npx raffel-mcp --category minimal
```

Tools: `raffel_create_server`, `raffel_create_procedure`, `raffel_add_middleware`, `raffel_api_patterns`

---

## License

ISC

---

<div align="center">

**[Documentation](https://forattini-dev.github.io/raffel)** · **[GitHub](https://github.com/tetis-io/raffel)** · **[npm](https://www.npmjs.com/package/raffel)**

</div>
