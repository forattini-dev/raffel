# Building a REST API

A complete guide to building production-ready REST APIs with Raffel.

---

## Minimal example

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('users.list').handler(async () => {
  return [{ id: '1', name: 'Alice' }]
})

server.procedure('users.create').handler(async ({ name, email }) => {
  return { id: crypto.randomUUID(), name, email }
})

await server.start()
```

HTTP routes are derived automatically from procedure names:

| Procedure | HTTP Method | Path |
|-----------|-------------|------|
| `users.list` | GET | `/users/list` |
| `users.create` | POST | `/users/create` |

---

## HTTP-style routes

If you prefer explicit HTTP methods and REST URLs:

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

// GET /users
server.http.get('/users', async (req, ctx) => {
  const users = await db.users.findMany()
  return Response.json(users)
})

// POST /users
server.http.post('/users', async (req, ctx) => {
  const body = await req.json()
  const user = await db.users.create({ data: body })
  return Response.json(user, { status: 201 })
})

// GET /users/:id
server.http.get('/users/:id', async (req, ctx) => {
  const { id } = ctx.params
  const user = await db.users.findUnique({ where: { id } })
  if (!user) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(user)
})

// PATCH /users/:id
server.http.patch('/users/:id', async (req, ctx) => {
  const { id } = ctx.params
  const body = await req.json()
  const user = await db.users.update({ where: { id }, data: body })
  return Response.json(user)
})

// DELETE /users/:id
server.http.delete('/users/:id', async (req, ctx) => {
  const { id } = ctx.params
  await db.users.delete({ where: { id } })
  return new Response(null, { status: 204 })
})

await server.start()
```

---

## Input validation

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

const CreateUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(['user', 'admin']).default('user'),
})

server
  .procedure('users.create')
  .input(CreateUserSchema)
  .handler(async (input) => {
    // input is fully typed: { name: string, email: string, role: 'user' | 'admin' }
    const user = await db.users.create({ data: input })
    return user
  })
```

Invalid input returns `400 VALIDATION_ERROR` automatically.

---

## Authentication

```typescript
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
  requireAuth,
  hasRole,
  RaffelError,
} from 'raffel'

const server = createServer({ port: 3000 })

const auth = createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => verifyJwt(token),
    }),
  ],
  publicProcedures: ['health.check'],
})

server.use(auth)

server.procedure('users.me').handler(async (_input, ctx) => {
  const { principal, claims } = requireAuth(ctx)
  return { userId: principal, email: claims?.email }
})

server.procedure('admin.users.list').handler(async (_input, ctx) => {
  if (!hasRole(ctx, 'admin')) {
    throw new RaffelError('PERMISSION_DENIED', 'Admin only')
  }
  return db.users.findMany()
})
```

---

## Rate limiting

```typescript
import { createRateLimitInterceptor } from 'raffel'

server.use(
  createRateLimitInterceptor({
    maxRequests: 100,
    windowMs: 60_000,   // 100 requests / minute
    keyBy: (envelope, ctx) => ctx.auth?.principal ?? ctx.ip ?? 'anonymous',
  })
)
```

---

## Auto-CRUD (file-based resources)

For CRUD APIs, define a resource and Raffel generates the endpoints:

```typescript
// src/resources/users.ts
import type { RestResource } from 'raffel'

export default {
  name: 'users',
  handlers: {
    list:   async () => db.users.findMany(),
    get:    async ({ id }) => db.users.findUnique({ where: { id } }),
    create: async (input) => db.users.create({ data: input }),
    update: async ({ id, ...data }) => db.users.update({ where: { id }, data }),
    delete: async ({ id }) => db.users.delete({ where: { id } }),
  },
} satisfies RestResource
```

Generates:
- `GET /users` → `users.list`
- `GET /users/:id` → `users.get`
- `POST /users` → `users.create`
- `PATCH /users/:id` → `users.update`
- `DELETE /users/:id` → `users.delete`

---

## Router modules (grouping)

```typescript
import { createServer, createRouterModule } from 'raffel'
import { createAuthMiddleware, createBearerStrategy } from 'raffel'

const usersModule = createRouterModule()
  .use(createAuthMiddleware({ strategies: [bearer] }))
  .procedure('users.list').handler(async () => db.users.findMany()).end()
  .procedure('users.create').handler(async (input) => db.users.create({ data: input })).end()
  .end()

const server = createServer({ port: 3000 })
server.mount(usersModule)
await server.start()
```

---

## Error handling

Throw `RaffelError` for expected errors — Raffel maps them to HTTP status codes:

```typescript
import { RaffelError } from 'raffel'

server.procedure('users.get').handler(async ({ id }) => {
  const user = await db.users.findUnique({ where: { id } })
  if (!user) throw new RaffelError('NOT_FOUND', `User ${id} not found`)
  return user
})
```

HTTP response:
```json
HTTP/1.1 404 Not Found
{
  "error": "NOT_FOUND",
  "message": "User abc not found"
}
```

Available error codes and their HTTP equivalents — see [Error Codes](/error-codes.md).

---

## Complete example

```typescript
import { createServer, createBearerStrategy, createAuthMiddleware, requireAuth, createRateLimitInterceptor, createZodAdapter, registerValidator, RaffelError } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({
  port: 3000,
  cors: { origin: 'https://myapp.com', credentials: true },
})

// Auth
const auth = createAuthMiddleware({
  strategies: [createBearerStrategy({ verify: verifyJwt })],
  publicProcedures: ['health.check', 'auth.login'],
})

server
  .use(auth)
  .use(createRateLimitInterceptor({ maxRequests: 100, windowMs: 60_000 }))

// Health check (public)
server.procedure('health.check').handler(async () => ({ ok: true, uptime: process.uptime() }))

// Login (public)
server.procedure('auth.login')
  .input(z.object({ email: z.string().email(), password: z.string() }))
  .handler(async ({ email, password }) => {
    const user = await db.users.findByEmail(email)
    if (!user || !await bcrypt.compare(password, user.hash)) {
      throw new RaffelError('UNAUTHENTICATED', 'Invalid credentials')
    }
    const token = signJwt({ sub: user.id, email: user.email })
    return { token }
  })

// Users (authenticated)
server.procedure('users.list').handler(async (_input, ctx) => {
  requireAuth(ctx)
  return db.users.findMany()
})

server.procedure('users.get')
  .input(z.object({ id: z.string() }))
  .handler(async ({ id }, ctx) => {
    requireAuth(ctx)
    const user = await db.users.findUnique({ where: { id } })
    if (!user) throw new RaffelError('NOT_FOUND', 'User not found')
    return user
  })

await server.start()
console.log('Server running at http://localhost:3000')
```

---

## See also

- [Interceptors](/interceptors.md) — rate limiting, caching, logging
- [Authentication Guide](/guides/auth.md) — all auth strategies
- [Validation](/validation.md) — all validation adapters
- [Error Codes](/error-codes.md) — complete list
- [REST Auto-CRUD](/rest-autocrud.md) — file-based CRUD
