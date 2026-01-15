# Quickstart

Build your first API in 5 minutes. No jargon, just code.

---

## Installation

```bash
pnpm add raffel
```

---

## Your First API

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

**That's it.** If you've used Express, Fastify, or Hono, this should feel familiar.

---

## REST CRUD (5 min)

Let's build a complete users API:

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

// In-memory store (swap with your DB)
const users = new Map()

// LIST - GET /users
app.get('/users', async () => {
  return [...users.values()]
})

// READ - GET /users/:id
app.get('/users/:id', async ({ id }) => {
  const user = users.get(id)
  if (!user) throw app.errors.notFound('User not found')
  return user
})

// CREATE - POST /users
app.post('/users', async (body) => {
  const user = { id: crypto.randomUUID(), ...body }
  users.set(user.id, user)
  return user
})

// UPDATE - PUT /users/:id
app.put('/users/:id', async ({ id, ...body }) => {
  if (!users.has(id)) throw app.errors.notFound('User not found')
  const user = { id, ...body }
  users.set(id, user)
  return user
})

// DELETE - DELETE /users/:id
app.delete('/users/:id', async ({ id }) => {
  if (!users.delete(id)) throw app.errors.notFound('User not found')
  return { success: true }
})

await app.start()
```

Test it:

```bash
# Create
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}'

# List
curl http://localhost:3000/users

# Get one
curl http://localhost:3000/users/{id}

# Update
curl -X PUT http://localhost:3000/users/{id} \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}'

# Delete
curl -X DELETE http://localhost:3000/users/{id}
```

---

## Add Validation

Want type-safe input? Add Zod:

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

const app = createServer({ port: 3000 })

const CreateUserSchema = z.object({
  name: z.string().min(2, 'Name too short'),
  email: z.string().email('Invalid email'),
  age: z.number().min(18).optional(),
})

app.post('/users', {
  body: CreateUserSchema,
  handler: async (body) => {
    // body is typed: { name: string, email: string, age?: number }
    return { id: crypto.randomUUID(), ...body }
  }
})

await app.start()
```

Bad input? Automatic error:

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"A","email":"not-an-email"}'
```

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": [
    { "path": "name", "message": "Name too short" },
    { "path": "email", "message": "Invalid email" }
  ]
}
```

---

## Add Middleware

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

// Logging middleware
app.use(async (req, next) => {
  console.log(`→ ${req.method} ${req.path}`)
  const start = Date.now()
  const result = await next()
  console.log(`← ${req.method} ${req.path} (${Date.now() - start}ms)`)
  return result
})

// Auth middleware
const requireAuth = async (req, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) throw app.errors.unauthorized('Missing token')

  // Verify token (use your JWT library)
  req.user = verifyToken(token)
  return next()
}

// Public route
app.get('/health', async () => ({ status: 'ok' }))

// Protected route
app.get('/profile', requireAuth, async (_, req) => {
  return req.user
})

await app.start()
```

---

## The Magic: Multi-Protocol

Here's where Raffel shines. **Your REST API already works over WebSocket:**

```typescript
const app = createServer({
  port: 3000,
  websocket: { path: '/ws' },  // ← Enable WebSocket
})

app.get('/users/:id', async ({ id }) => {
  return db.users.findById(id)
})

await app.start()
```

```bash
# HTTP works as usual
curl http://localhost:3000/users/123

# WebSocket works too!
wscat -c ws://localhost:3000/ws
> {"procedure":"GET /users/:id","payload":{"id":"123"}}
< {"success":true,"data":{"id":"123","name":"Alice"}}
```

**Same handler. Same validation. Same auth. Different protocols.**

---

## Query Parameters

```typescript
app.get('/users', async ({ page, limit, search }) => {
  // GET /users?page=1&limit=10&search=alice
  return db.users.findMany({
    skip: (page - 1) * limit,
    take: limit,
    where: search ? { name: { contains: search } } : undefined,
  })
})
```

With validation:

```typescript
app.get('/users', {
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
  }),
  handler: async ({ page, limit, search }) => {
    // page and limit are numbers (coerced from query string)
    return db.users.findMany({ ... })
  }
})
```

---

## Error Handling

Throw errors, Raffel handles the rest:

```typescript
app.get('/users/:id', async ({ id }) => {
  const user = await db.users.findById(id)

  if (!user) {
    throw app.errors.notFound('User not found')
  }

  return user
})
```

Built-in errors:
- `app.errors.notFound(message)` → 404
- `app.errors.badRequest(message)` → 400
- `app.errors.unauthorized(message)` → 401
- `app.errors.forbidden(message)` → 403
- `app.errors.conflict(message)` → 409
- `app.errors.internal(message)` → 500

Or throw custom errors:

```typescript
throw app.errors.create('CUSTOM_ERROR', 422, 'Something went wrong', {
  field: 'email',
  reason: 'already_exists',
})
```

---

## File-based Routing (Zero Config)

Don't want to define routes manually? Use file-based discovery:

```typescript
// server.ts
import { createServer } from 'raffel'

const app = createServer({
  port: 3000,
  discovery: true,  // ← Enable auto-discovery
})

await app.start()
```

Create route files:

```typescript
// src/routes/users/index.ts → GET /users
export const GET = async () => {
  return db.users.findMany()
}

// src/routes/users/[id].ts → GET/PUT/DELETE /users/:id
export const GET = async ({ id }) => db.users.findById(id)
export const PUT = async ({ id, ...body }) => db.users.update(id, body)
export const DELETE = async ({ id }) => db.users.delete(id)

// src/routes/users/index.ts → POST /users
export const POST = async (body) => db.users.create(body)
```

Directory structure = API structure:

```
src/routes/
├── users/
│   ├── index.ts      → /users (GET, POST)
│   └── [id].ts       → /users/:id (GET, PUT, DELETE)
├── posts/
│   ├── index.ts      → /posts
│   └── [id]/
│       ├── index.ts  → /posts/:id
│       └── comments.ts → /posts/:id/comments
└── health.ts         → /health
```

---

## Next Steps

You've got the basics. Now explore:

| Topic | What You'll Learn |
|-------|-------------------|
| [HTTP Deep Dive](/protocols/http) | Headers, cookies, file uploads, streaming responses |
| [Authentication](/auth/overview) | JWT, API Key, OAuth2, OIDC, sessions |
| [Validation](/validation) | Zod, Yup, Joi - full integration |
| [WebSocket](/protocols/websocket) | Real-time, channels, presence |
| [Interceptors](/interceptors) | Rate limiting, caching, retry, circuit breaker |
| [Procedure API](/handlers/procedures) | Full control with the native API |

---

## Quick Reference

```typescript
// HTTP Methods
app.get('/path', handler)
app.post('/path', handler)
app.put('/path', handler)
app.patch('/path', handler)
app.delete('/path', handler)

// With validation
app.post('/path', {
  body: zodSchema,
  query: zodSchema,
  params: zodSchema,
  handler: async (input) => { ... }
})

// Middleware
app.use(middleware)                    // Global
app.get('/path', middleware, handler)  // Per-route

// Error helpers
app.errors.notFound(message)
app.errors.badRequest(message)
app.errors.unauthorized(message)
app.errors.forbidden(message)
app.errors.conflict(message)
app.errors.internal(message)

// Multi-protocol
const app = createServer({
  port: 3000,
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
  graphql: { path: '/graphql' },
})
```
