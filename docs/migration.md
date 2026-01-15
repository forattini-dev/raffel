# Migration Guide

Moving from Express, Fastify, Koa, or Hono? This guide shows you exactly how to migrate.

---

## From Express

### Basic Route Migration

<table>
<tr>
<th width="50%">Express</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```javascript
const express = require('express')
const app = express()

app.use(express.json())

app.get('/users', (req, res) => {
  const users = db.users.findMany()
  res.json(users)
})

app.get('/users/:id', (req, res) => {
  const user = db.users.findById(req.params.id)
  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    })
  }
  res.json(user)
})

app.post('/users', (req, res) => {
  const user = db.users.create(req.body)
  res.status(201).json(user)
})

app.listen(3000)
```

</td>
<td>

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

app.get('/users', async () => {
  return db.users.findMany()
})

app.get('/users/:id', async ({ id }) => {
  const user = db.users.findById(id)
  if (!user) {
    throw app.errors.notFound('User not found')
  }
  return user
})

app.post('/users', async (body) => {
  return db.users.create(body)
})

await app.start()
```

</td>
</tr>
</table>

**Key differences:**
- No `req, res` - just return the value
- Path params extracted automatically (`:id` → `{ id }`)
- Body parsed automatically (no `express.json()`)
- Errors thrown, not `res.status().json()`

### Middleware Migration

<table>
<tr>
<th width="50%">Express</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```javascript
// Logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization
  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized'
    })
  }
  req.user = verifyToken(token)
  next()
}

app.get('/profile', auth, (req, res) => {
  res.json(req.user)
})
```

</td>
<td>

```typescript
// Logging middleware
app.use(async (req, next) => {
  console.log(`${req.method} ${req.path}`)
  return next()
})

// Auth middleware
const auth = async (req, next) => {
  const token = req.headers.authorization
  if (!token) {
    throw app.errors.unauthorized()
  }
  req.user = verifyToken(token)
  return next()
}

app.get('/profile', auth, async (_, req) => {
  return req.user
})
```

</td>
</tr>
</table>

**Key differences:**
- Middleware uses `async/await` and `return next()`
- No `res.status().json()` - throw errors instead
- Per-route middleware: `app.get('/path', middleware, handler)`

### Error Handling

<table>
<tr>
<th width="50%">Express</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```javascript
// Express error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({
    error: err.message
  })
})

// Throwing errors
app.get('/users/:id', (req, res, next) => {
  const user = db.users.findById(req.params.id)
  if (!user) {
    const err = new Error('User not found')
    err.status = 404
    return next(err)
  }
  res.json(user)
})
```

</td>
<td>

```typescript
// Raffel handles errors automatically
// Just throw!

app.get('/users/:id', async ({ id }) => {
  const user = db.users.findById(id)
  if (!user) {
    throw app.errors.notFound('User not found')
  }
  return user
})

// Custom error handler (optional)
app.onError(async (err, req) => {
  console.error(err)
  // Return custom response or let default handler run
})
```

</td>
</tr>
</table>

### Query Parameters

<table>
<tr>
<th width="50%">Express</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```javascript
app.get('/users', (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 20
  const search = req.query.search

  const users = db.users.findMany({
    skip: (page - 1) * limit,
    take: limit,
    where: search
      ? { name: { contains: search } }
      : undefined
  })

  res.json(users)
})
```

</td>
<td>

```typescript
import { z } from 'zod'

app.get('/users', {
  query: z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(20),
    search: z.string().optional(),
  }),
  handler: async ({ page, limit, search }) => {
    return db.users.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where: search
        ? { name: { contains: search } }
        : undefined
    })
  }
})
```

</td>
</tr>
</table>

**Key differences:**
- Query params validated and coerced automatically
- `z.coerce.number()` handles string → number conversion
- Defaults work as expected

### Validation

<table>
<tr>
<th width="50%">Express + express-validator</th>
<th width="50%">Raffel + Zod</th>
</tr>
<tr>
<td>

```javascript
const { body, validationResult } = require('express-validator')

app.post('/users',
  body('email').isEmail(),
  body('name').isLength({ min: 2 }),
  body('age').optional().isInt({ min: 18 }),
  (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors: errors.array()
      })
    }

    const user = db.users.create(req.body)
    res.status(201).json(user)
  }
)
```

</td>
<td>

```typescript
import { z } from 'zod'

app.post('/users', {
  body: z.object({
    email: z.string().email(),
    name: z.string().min(2),
    age: z.number().min(18).optional(),
  }),
  handler: async (body) => {
    // body is fully typed!
    return db.users.create(body)
  }
})

// Validation errors returned automatically:
// { error: "VALIDATION_ERROR", details: [...] }
```

</td>
</tr>
</table>

---

## From Fastify

### Basic Routes

<table>
<tr>
<th width="50%">Fastify</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```typescript
import Fastify from 'fastify'

const fastify = Fastify()

fastify.get('/users/:id', {
  schema: {
    params: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { id } = request.params
  return db.users.findById(id)
})

fastify.listen({ port: 3000 })
```

</td>
<td>

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

const app = createServer({ port: 3000 })

app.get('/users/:id', {
  params: z.object({
    id: z.string()
  }),
  handler: async ({ id }) => {
    return db.users.findById(id)
  }
})

await app.start()
```

</td>
</tr>
</table>

### Hooks → Middleware

<table>
<tr>
<th width="50%">Fastify</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```typescript
// Pre-handler hook
fastify.addHook('preHandler', async (request, reply) => {
  const token = request.headers.authorization
  if (!token) {
    reply.code(401).send({ error: 'Unauthorized' })
    return
  }
  request.user = await verifyToken(token)
})

// On-response hook
fastify.addHook('onResponse', async (request, reply) => {
  console.log(`${request.method} ${request.url} - ${reply.statusCode}`)
})
```

</td>
<td>

```typescript
// Pre-handler middleware
app.use(async (req, next) => {
  const token = req.headers.authorization
  if (!token) {
    throw app.errors.unauthorized()
  }
  req.user = await verifyToken(token)
  return next()
})

// Response logging
app.use(async (req, next) => {
  const result = await next()
  console.log(`${req.method} ${req.path} - done`)
  return result
})
```

</td>
</tr>
</table>

---

## From Hono

### Basic Routes

<table>
<tr>
<th width="50%">Hono</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

const app = new Hono()

app.get('/users/:id', async (c) => {
  const { id } = c.req.param()
  const user = await db.users.findById(id)
  return c.json(user)
})

app.post('/users',
  zValidator('json', CreateUserSchema),
  async (c) => {
    const body = c.req.valid('json')
    const user = await db.users.create(body)
    return c.json(user, 201)
  }
)

export default app
```

</td>
<td>

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

const app = createServer({ port: 3000 })

app.get('/users/:id', async ({ id }) => {
  return db.users.findById(id)
})

app.post('/users', {
  body: CreateUserSchema,
  handler: async (body) => {
    return db.users.create(body)
  }
})

await app.start()
```

</td>
</tr>
</table>

### Middleware

<table>
<tr>
<th width="50%">Hono</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```typescript
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { jwt } from 'hono/jwt'

app.use('*', cors())
app.use('*', logger())
app.use('/api/*', jwt({ secret: 'secret' }))
```

</td>
<td>

```typescript
const app = createServer({
  port: 3000,
  cors: { origin: '*' },  // Built-in
})

// Logging
app.use(async (req, next) => {
  console.log(`${req.method} ${req.path}`)
  return next()
})

// JWT auth
app.use('/api/*', async (req, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) throw app.errors.unauthorized()
  req.user = jwt.verify(token, 'secret')
  return next()
})
```

</td>
</tr>
</table>

---

## From tRPC

### Procedures

<table>
<tr>
<th width="50%">tRPC</th>
<th width="50%">Raffel</th>
</tr>
<tr>
<td>

```typescript
import { initTRPC } from '@trpc/server'

const t = initTRPC.create()

const router = t.router({
  users: t.router({
    list: t.procedure
      .query(async () => {
        return db.users.findMany()
      }),

    get: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return db.users.findById(input.id)
      }),

    create: t.procedure
      .input(CreateUserSchema)
      .mutation(async ({ input }) => {
        return db.users.create(input)
      }),
  }),
})
```

</td>
<td>

```typescript
import { createServer } from 'raffel'

const app = createServer({ port: 3000 })

// REST-style (recommended for HTTP)
app.get('/users', async () => db.users.findMany())
app.get('/users/:id', async ({ id }) => db.users.findById(id))
app.post('/users', {
  body: CreateUserSchema,
  handler: async (body) => db.users.create(body)
})

// Or tRPC-style procedure names
server.procedure('users.list')
  .handler(async () => db.users.findMany())

server.procedure('users.get')
  .input(z.object({ id: z.string() }))
  .handler(async ({ id }) => db.users.findById(id))
```

</td>
</tr>
</table>

**Raffel advantage:** Your tRPC-style procedures also work over HTTP REST automatically.

---

## Step-by-Step Migration Checklist

### 1. Install Raffel

```bash
pnpm add raffel
pnpm remove express body-parser cors helmet express-validator
# (or your current framework)
```

### 2. Create Server

```typescript
// Before (Express)
const express = require('express')
const app = express()
app.use(express.json())
app.use(cors())

// After (Raffel)
import { createServer } from 'raffel'
const app = createServer({
  port: 3000,
  cors: { origin: '*' },
})
```

### 3. Migrate Routes

```typescript
// Before
app.get('/users/:id', (req, res) => {
  res.json(getUser(req.params.id))
})

// After
app.get('/users/:id', async ({ id }) => {
  return getUser(id)
})
```

### 4. Migrate Middleware

```typescript
// Before
app.use((req, res, next) => {
  console.log(req.method, req.path)
  next()
})

// After
app.use(async (req, next) => {
  console.log(req.method, req.path)
  return next()
})
```

### 5. Migrate Error Handling

```typescript
// Before
if (!user) {
  return res.status(404).json({ error: 'Not found' })
}

// After
if (!user) {
  throw app.errors.notFound('Not found')
}
```

### 6. Migrate Validation

```typescript
// Before (express-validator)
body('email').isEmail()

// After (Zod)
body: z.object({ email: z.string().email() })
```

### 7. Start Server

```typescript
// Before
app.listen(3000)

// After
await app.start()
```

---

## MCP Migration Prompts

Use Raffel's MCP tools for assisted migration:

```bash
# Add to Claude Code
claude mcp add raffel npx raffel-mcp
```

Available prompts:
- `migrate_from_express` - Express to Raffel
- `migrate_from_fastify` - Fastify to Raffel
- `migrate_from_trpc` - tRPC to Raffel
- `migrate_from_koa` - Koa to Raffel
- `migrate_from_hono` - Hono to Raffel

---

## Common Patterns

### CORS

```typescript
// Express
app.use(cors({ origin: '*' }))

// Raffel
const app = createServer({
  port: 3000,
  cors: { origin: '*' },
})
```

### JSON Body Parsing

```typescript
// Express
app.use(express.json())

// Raffel - automatic, no config needed
```

### Static Files

```typescript
// Express
app.use('/static', express.static('public'))

// Raffel
app.static('/static', './public')
```

### Health Check

```typescript
// Express
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Raffel
app.get('/health', async () => ({ status: 'ok' }))
```
