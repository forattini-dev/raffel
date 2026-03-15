# Migration Guide

API mapping reference for teams moving an existing project to Raffel.
Each section covers import changes, API equivalents, and a before/after example.

For the capability-based runtime context and the official DEVX golden path, see
[DEVX Migration](/migration/devx.md).

- [From Express](#from-express)
- [From Fastify](#from-fastify)
- [From Fetch-first routers](#from-fetch-first-routers)
- [WebSocket: from `ws`](#websocket-from-ws)
- [WebSocket: from Socket.IO](#websocket-from-socketio)

---

## From Express

Express uses `(req, res, next)` callbacks and mutates `res` in place.
Raffel uses the Web Fetch API — handlers return a `Response` object.

### Routing

```typescript
// Express
app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id })
})

// Raffel
app.get('/users/:id', (c) => {
  return c.json({ id: c.req.param('id') })
})
```

### Request body

```typescript
// Express — requires express.json() middleware
app.use(express.json())
app.post('/users', async (req, res) => {
  const body = req.body
  res.status(201).json(body)
})

// Raffel — no body-parser middleware needed
app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json(body, 201)
})
```

### Query params and headers

```typescript
// Express
const page  = req.query.page       // string | ParsedQs
const token = req.headers['authorization']

// Raffel
const page  = c.req.query('page')       // string | undefined
const all   = c.req.query()            // Record<string, string>
const token = c.req.header('authorization')  // case-insensitive
```

### Middleware

```typescript
// Express — (req, res, next) — stop chain by NOT calling next()
app.use(async (req, res, next) => {
  try {
    req.user = await verifyToken(req.headers.authorization)
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
})

// Raffel — (c, next) — stop chain by returning a Response
app.use('*', async (c, next) => {
  try {
    const user = await verifyToken(c.req.header('authorization'))
    c.set('user', user)
    await next()
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }
})
```

### Error handling

```typescript
// Express — 4-argument signature
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message })
})

// Raffel
app.onError((err, c) => c.json({ error: err.message }, 500))
app.notFound((c) => c.json({ error: 'Not found' }, 404))
```

### Context locals

```typescript
// Express
res.locals.user = await getUser(req)

// Raffel
const app = new HttpApp<{ user: User }>()
app.use('*', async (c, next) => {
  c.set('user', await getUser(c))
  await next()
})
// In handler:
const user = c.get('user')
```

### Router / route groups

```typescript
// Express
const usersRouter = express.Router()
usersRouter.get('/', listHandler)
usersRouter.get('/:id', getHandler)
app.use('/users', usersRouter)

// Raffel — sub-app
const usersApp = new HttpApp()
usersApp.get('/', listHandler)
usersApp.get('/:id', getHandler)
app.route('/users', usersApp)

// Or: shared-state basePath prefix
const usersApp = app.basePathApp('/users')
usersApp.get('/', listHandler)
usersApp.get('/:id', getHandler)
```

### Server startup

```typescript
// Express
const server = app.listen(3000, '0.0.0.0', () => console.log('ready'))
process.on('SIGTERM', () => server.close())

// Raffel
import { serve } from 'raffel/http'
const server = serve({
  fetch: app.fetch,
  port: 3000,
  hostname: '0.0.0.0',
  keepAliveTimeout: 65000,  // recommended for production
  headersTimeout: 66000,
  onListen: ({ port }) => console.log(`ready on :${port}`),
})
process.on('SIGTERM', () => server.shutdown()) // waits for in-flight requests
```

### Package equivalents

| Express ecosystem | Raffel |
|-------------------|--------|
| `cors` (npm) | `cors` from `raffel/http` |
| `helmet` | `secureHeaders` from `raffel/http` |
| `compression` | `compress` from `raffel/http` |
| `express-rate-limit` | `createRateLimiter` + `rateLimitMiddleware` |
| `express-session` | `createSessionInterceptor` + `createMemorySessionDriver` |
| `express.static` | `serveStatic` from `raffel/http` |
| `swagger-ui-express` | `mountOpenApiDocs` from `raffel/http` |

### Complete before/after

```typescript
// === Before (Express) ===
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'

const app = express()
app.use(express.json())
app.use(cors({ origin: 'https://app.example.com' }))
app.use(helmet())
app.use(compression())
app.use(rateLimit({ windowMs: 60_000, max: 100 }))

app.get('/users', async (req, res, next) => {
  try {
    res.json(await db.users.findAll())
  } catch (err) { next(err) }
})

app.post('/users', async (req, res, next) => {
  try {
    res.status(201).json(await db.users.create(req.body))
  } catch (err) { next(err) }
})

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message })
})

const server = app.listen(3000, () => console.log('ready'))
process.on('SIGTERM', () => server.close())
```

```typescript
// === After (Raffel) ===
import { HttpApp, serve, cors, secureHeaders, compress,
         createRateLimiter, rateLimitMiddleware } from 'raffel/http'

const app = new HttpApp()
const limiter = createRateLimiter({ windowMs: 60_000, max: 100 })

app.use('*', cors({ origin: 'https://app.example.com' }))
app.use('*', secureHeaders())
app.use('*', compress())
app.use('*', rateLimitMiddleware(limiter))

app.get('/users', async (c) => c.json(await db.users.findAll()))
app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json(await db.users.create(body), 201)
})

app.onError((err, c) => c.json({ error: err.message }, 500))

const server = serve({
  fetch: app.fetch, port: 3000, hostname: '0.0.0.0',
  keepAliveTimeout: 65000, headersTimeout: 66000,
  onListen: ({ port }) => console.log(`ready on :${port}`),
})
process.on('SIGTERM', () => server.shutdown())
```

```bash
# Packages to remove
pnpm remove express cors helmet compression express-rate-limit body-parser
pnpm remove @types/express @types/cors @types/compression
```

---

## From Fastify

Fastify pre-parses request bodies and uses a plugin/decorator system.
Raffel parses bodies on demand and uses sub-apps + context variables.

### Routing

```typescript
// Fastify
fastify.get('/users/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  return { id }   // auto-serialized
})

// Raffel
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
```

### Request body

```typescript
// Fastify — body pre-parsed before handler runs
fastify.post('/users', async (request, reply) => {
  const body = request.body as { name: string }
  reply.status(201).send(body)
})

// Raffel — parsed on demand
app.post('/users', async (c) => {
  const body = await c.req.json<{ name: string }>()
  return c.json(body, 201)
})
```

### Hooks → Middleware

```typescript
// Fastify
fastify.addHook('onRequest', async (request, reply) => {
  request.user = await verifyJwt(request.headers.authorization)
})

// Raffel
app.use('*', async (c, next) => {
  const user = await verifyJwt(c.req.header('authorization'))
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  c.set('user', user)
  await next()
})
```

### Plugins → Sub-apps

```typescript
// Fastify
const usersPlugin: FastifyPlugin = async (fastify) => {
  fastify.get('/', listHandler)
  fastify.get('/:id', getHandler)
}
fastify.register(usersPlugin, { prefix: '/users' })

// Raffel
const usersApp = new HttpApp()
usersApp.get('/', listHandler)
usersApp.get('/:id', getHandler)
app.route('/users', usersApp)
```

### Decorators → Context variables

```typescript
// Fastify
fastify.decorateRequest('user', null)
// req.user = ...

// Raffel
const app = new HttpApp<{ user: User }>()
// c.set('user', ...)  /  c.get('user')
```

### Schema validation

```typescript
// Fastify — JSON Schema inline
fastify.post('/users', {
  schema: {
    body: { type: 'object', required: ['name'],
            properties: { name: { type: 'string' } } }
  }
}, async (request, reply) => {
  return db.create(request.body)
})

// Raffel — validation middleware (any schema library)
import { validateBody } from 'raffel/http'
import { z } from 'zod'

const Schema = z.object({ name: z.string() })

app.post('/users', validateBody(Schema), async (c) => {
  const body = await c.req.json()
  return c.json(await db.create(body), 201)
})
```

### Error handling

```typescript
// Fastify
fastify.setErrorHandler((error, request, reply) => {
  reply.status(error.statusCode || 500).send({ error: error.message })
})
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ error: 'Not found' })
})

// Raffel
app.onError((err, c) => c.json({ error: err.message }, (err as any).statusCode || 500))
app.notFound((c) => c.json({ error: 'Not found' }, 404))
```

### OpenAPI documentation

```typescript
// Fastify — two packages required
await fastify.register(require('@fastify/swagger'), { openapi: { info: { title: 'My API' } } })
await fastify.register(require('@fastify/swagger-ui'), { routePrefix: '/docs' })

// Raffel — built-in
import { mountOpenApiDocs } from 'raffel/http'
mountOpenApiDocs(app, {
  spec: () => generateOpenApiSpec(),
  title: 'My API',
  ui: 'swagger', // or 'redoc'
})
```

### Server startup

```typescript
// Fastify
await fastify.listen({ port: 3000, host: '0.0.0.0' })
process.on('SIGTERM', async () => fastify.close())

// Raffel
const server = serve({
  fetch: app.fetch, port: 3000, hostname: '0.0.0.0',
  keepAliveTimeout: 65000, headersTimeout: 66000,
  onListen: ({ port }) => console.log(`ready on :${port}`),
})
process.on('SIGTERM', () => server.shutdown())
```

### Package equivalents

| Fastify ecosystem | Raffel |
|-------------------|--------|
| `@fastify/cors` | `cors` from `raffel/http` |
| `@fastify/helmet` | `secureHeaders` from `raffel/http` |
| `@fastify/compress` | `compress` from `raffel/http` |
| `@fastify/rate-limit` | `createRateLimiter` + `rateLimitMiddleware` |
| `@fastify/session` | `createSessionInterceptor` |
| `@fastify/static` | `serveStatic` from `raffel/http` |
| `@fastify/swagger` + `@fastify/swagger-ui` | `mountOpenApiDocs` from `raffel/http` |

```bash
# Packages to remove
pnpm remove fastify @fastify/cors @fastify/helmet @fastify/compress
pnpm remove @fastify/rate-limit @fastify/session @fastify/static
pnpm remove @fastify/swagger @fastify/swagger-ui
```

---

## From Fetch-first Routers

If your current router already thinks in `Request`/`Response` style handlers,
the conceptual mapping into Raffel is shallow. The important difference is that
Raffel treats HTTP as the front door of a larger runtime, not the whole product.

### Import changes

| Example source | Raffel |
|---------------|--------|
| `import { Hono } from 'hono'` | `import { HttpApp } from 'raffel/http'` |
| `import { serve } from '@hono/node-server'` | `import { serve } from 'raffel/http'` |
| `import { cors } from 'hono/cors'` | `import { cors } from 'raffel/http'` |
| `import { swaggerUI } from '@hono/swagger-ui'` | `import { serveSwaggerUI, serveRedoc } from 'raffel/http'` |
| `import type { Context, Next, MiddlewareHandler } from 'hono'` | `import type { HttpContextInterface, HttpMiddleware } from 'raffel/http'` |

### Routes, middleware, context

Most Fetch-first router concepts map directly: `get`, `post`, `put`, `patch`,
`delete`, `options`, `head`, `all`, `on`, `use`, `route`, `notFound`, and `onError`.

Context concepts are similar: `c.req.param()`, `c.req.query()`, `c.req.header()`,
`c.req.json()`, `c.json()`, `c.html()`, `c.text()`, `c.redirect()`, `c.get()`,
`c.set()`, and `c.var`.

### serve() callback → onListen option

```typescript
// Hono
serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Listening on port ${info.port}`)
})

// Raffel
serve({
  fetch: app.fetch,
  port: 3000,
  keepAliveTimeout: 65000,
  headersTimeout: 66000,
  onListen: ({ port }) => console.log(`Listening on port ${port}`),
})
```

### Replace @hono/swagger-ui

```typescript
// Hono
import { swaggerUI } from '@hono/swagger-ui'
app.get('/openapi.json', (c) => c.json(spec))
app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// Raffel
import { mountOpenApiDocs } from 'raffel/http'
mountOpenApiDocs(app, { spec: () => spec, title: 'My API', ui: 'swagger' })
```

### TypeScript environment type

```typescript
// Hono
const app = new Hono<{ Variables: { user: User } }>()

// Raffel
const app = new HttpApp<{ user: User }>()
```

```bash
# Packages to remove
pnpm remove hono @hono/node-server @hono/swagger-ui
```

---

## WebSocket: from `ws`

The `ws` library exposes raw WebSocket frames through Node.js event emitters.
Raffel routes messages through a typed procedure/stream/event registry.

### Concepts

| `ws` | Raffel |
|------|--------|
| `wss.on('connection', handler)` | Handled internally by the adapter |
| `ws.on('message', handler)` | `registry.procedure()` / `registry.event()` / `registry.stream()` |
| `ws.send(JSON.stringify(data))` | `return data` from a procedure handler |
| `ws.on('close', handler)` | `ctx.signal` abort event |
| `wss.clients.forEach(ws => ws.send(...))` | `channels.broadcast('channel', 'event', data)` |

### Message protocol

Raffel uses an envelope format for all messages:

```json
// Client → Server (request)
{ "id": "req-1", "procedure": "users.list", "type": "request", "payload": {} }

// Server → Client (response)
{ "id": "req-1", "procedure": "users.list", "type": "response", "payload": [...] }

// Client → Server (event, no response)
{ "id": "evt-1", "procedure": "log", "type": "event", "payload": { "msg": "hello" } }
```

### Request-response (procedure)

```typescript
// ws — raw message parsing, manual routing
const wss = new WebSocket.Server({ port: 8080 })
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'users.list') {
      db.users.findAll().then((users) => {
        ws.send(JSON.stringify({ id: msg.id, data: users }))
      })
    }
    if (msg.type === 'users.create') {
      db.users.create(msg.payload).then((user) => {
        ws.send(JSON.stringify({ id: msg.id, data: user }))
      })
    }
  })
})

// Raffel — registered procedures, auto-routed
const server = createServer()

server.procedure('users.list').handler(async () => {
  return db.users.findAll()
})

server.procedure('users.create')
  .input(z.object({ name: z.string(), email: z.string() }))
  .handler(async (input) => {
    return db.users.create(input)
  })

await server.start()
// WebSocket accessible at ws://localhost:{port}
// HTTP REST accessible at the same port (same procedures, different transport)
```

### Server-sent streams

```typescript
// ws — manual interval + cleanup
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'subscribe:metrics') {
      const interval = setInterval(() => {
        ws.send(JSON.stringify({ type: 'metrics', data: getMetrics() }))
      }, 1000)
      ws.on('close', () => clearInterval(interval))
    }
  })
})

// Raffel — async generator, cancellation via AbortSignal
server.stream('metrics.live').handler(async function* (input, ctx) {
  while (!ctx.signal.aborted) {
    yield getMetrics()
    await delay(1000, ctx.signal)
  }
})
```

Client sends `{ "id": "s1", "procedure": "metrics.live", "type": "stream:start", "payload": {} }`.
Server sends `stream:start` → `stream:data` (repeated) → `stream:end`.
Client sends `{ "type": "cancel", "id": "s1" }` to stop early.

### Fire-and-forget events

```typescript
// ws
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.type === 'analytics.track') {
    analytics.record(msg.payload)  // no reply sent
  }
})

// Raffel
server.event('analytics.track').handler(async (payload) => {
  await analytics.record(payload)  // no reply sent automatically
})
```

### Broadcasting (pub/sub)

```typescript
// ws — manual broadcast loop
wss.clients.forEach((client) => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({ type: 'chat', data: message }))
  }
})

// Raffel — channels API
import { createServer } from 'raffel'

const server = createServer({
  websocket: {
    path: '/ws',
    channels: {
      authorize: async (socketId, channel, ctx) => {
        if (channel.startsWith('private-')) return !!ctx.auth?.principal
        return true
      }
    }
  }
})

// Inside a procedure handler, broadcast to a channel
server.procedure('chat.send').handler(async (input, ctx) => {
  const { adapter } = ctx.transport as any
  adapter.channels.broadcast('chat-room', 'message', { text: input.text })
  return { ok: true }
})
```

### Authentication

```typescript
// ws — parse cookie/header from upgrade request
const wss = new WebSocket.Server({ port: 8080 })
wss.on('connection', (ws, req) => {
  const token = req.headers['authorization']
  const user = verifyToken(token)
  if (!user) { ws.close(1008, 'Unauthorized'); return }
  ws.user = user
})

// Raffel — contextFactory
const server = createServer({
  websocket: {
    path: '/ws',
    contextFactory: async (ws, req) => {
      const token = req.headers['authorization']
      const user = await verifyToken(token)
      if (!user) throw new Error('Unauthorized')  // closes connection
      return { auth: { principal: user.id, claims: user } }
    }
  }
})

// ctx.auth available in all handlers
server.procedure('profile').handler(async (input, ctx) => {
  return { userId: ctx.auth?.principal }
})
```

### Disconnection / cleanup

```typescript
// ws
ws.on('close', () => cleanup())
ws.on('error', (err) => handleError(err))

// Raffel — AbortSignal on the context
server.stream('live.feed').handler(async function* (input, ctx) {
  ctx.signal.addEventListener('abort', () => cleanup())
  try {
    for await (const item of liveFeed()) {
      if (ctx.signal.aborted) break
      yield item
    }
  } finally {
    cleanup()
  }
})
```

```bash
# Packages to remove
pnpm remove ws @types/ws
```

---

## WebSocket: from Socket.IO

Socket.IO adds rooms, namespaces, reconnection, and acknowledgements on top of WebSocket.
Raffel maps these concepts to channels (rooms), procedures (acknowledgements), and events.

### Concepts

| Socket.IO | Raffel |
|-----------|--------|
| `io.on('connection', handler)` | Handled internally by the adapter |
| `socket.on('event', handler)` | `server.event('event')` or `server.procedure('event')` |
| `socket.emit('event', data)` | `return data` (procedure) or `yield data` (stream) |
| `socket.join('room')` + `io.to('room').emit(...)` | `channels.broadcast('channel', 'event', data)` |
| `io.of('/namespace')` | Separate `createServer()` instances or path-based routing |
| Acknowledgement callback | `server.procedure()` (returns value) |
| Reconnection | Native WebSocket reconnection on client side |

### Event handlers

```typescript
// Socket.IO
io.on('connection', (socket) => {
  socket.on('message', (data, callback) => {
    console.log(data)
    callback({ received: true })
  })

  socket.on('disconnect', () => {
    console.log('user left')
  })
})

// Raffel — procedure (with response, like acknowledgement)
server.procedure('message').handler(async (data, ctx) => {
  console.log(data)
  return { received: true }  // equivalent to callback({ received: true })
})

// Raffel — event (fire and forget, no acknowledgement)
server.event('message').handler(async (data) => {
  console.log(data)
})
```

### Rooms → Channels

```typescript
// Socket.IO
socket.join('room:123')
io.to('room:123').emit('update', { changed: true })
socket.leave('room:123')

// Raffel — client subscribes/unsubscribes via protocol messages
// { "type": "subscribe", "channel": "room:123" }
// { "type": "unsubscribe", "channel": "room:123" }

// Server broadcasts via ChannelManager
server.procedure('room.update').handler(async (input, ctx) => {
  const channels = ctx.transport?.channels
  channels?.broadcast(`room:${input.roomId}`, 'update', { changed: true })
  return { ok: true }
})
```

### Broadcast variants

```typescript
// Socket.IO
io.emit('global', data)                        // all clients
io.to('room').emit('update', data)             // room
socket.broadcast.emit('peer', data)            // all except sender
socket.to('room').emit('update', data)         // room except sender

// Raffel channels
channels.broadcast('public-global', 'global', data)           // all subscribed to channel
channels.broadcast('room:123', 'update', data)                 // room channel
channels.broadcast('public-global', 'peer', data, senderSocketId)  // except sender
```

### Presence (online members)

```typescript
// Socket.IO
const members = await io.in('room:123').fetchSockets()

// Raffel — presence channels
// Configure presence data in contextFactory
const server = createServer({
  websocket: {
    channels: {
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principal,
        name: ctx.auth?.claims?.name,
      })
    }
  }
})

// Client subscribes to presence-* channel to get member list
// { "type": "subscribe", "channel": "presence-room:123" }
// → Server responds with current members list

// From server-side handler
const members = channels.getMembers('presence-room:123')
```

### Namespaces → Separate servers

```typescript
// Socket.IO
const chatNS  = io.of('/chat')
const adminNS = io.of('/admin')
chatNS.on('connection', (socket) => { ... })
adminNS.on('connection', (socket) => { ... })

// Raffel — path-based or separate createServer() instances
const server = createServer({
  websocket: { path: '/chat' }      // all procedures accessible at /chat
})

// Or mount multiple websocket adapters with different paths
// (use the low-level createWebSocketAdapter() directly)
```

### Middleware

```typescript
// Socket.IO
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token
  try {
    socket.user = await verifyJwt(token)
    next()
  } catch (err) {
    next(new Error('Authentication error'))
  }
})

// Raffel — contextFactory (runs at connection time)
const server = createServer({
  websocket: {
    contextFactory: async (ws, req) => {
      const token = req.headers['authorization']
      const user = await verifyJwt(token)
      if (!user) throw new Error('Authentication error')
      return { auth: { principal: user.id, claims: user } }
    }
  }
})
```

### Complete before/after

```typescript
// === Before (Socket.IO) ===
import { Server } from 'socket.io'
import { createServer } from 'http'

const httpServer = createServer()
const io = new Server(httpServer, { cors: { origin: '*' } })

io.use(async (socket, next) => {
  socket.user = await verifyJwt(socket.handshake.auth.token)
  next()
})

io.on('connection', (socket) => {
  // Join user's personal room
  socket.join(`user:${socket.user.id}`)

  socket.on('chat.send', async (data, ack) => {
    const msg = await db.messages.create({ ...data, userId: socket.user.id })
    io.to(`room:${data.roomId}`).emit('chat.message', msg)
    ack({ ok: true, id: msg.id })
  })

  socket.on('room.join', async ({ roomId }) => {
    socket.join(`room:${roomId}`)
    io.to(`room:${roomId}`).emit('room.joined', { userId: socket.user.id })
  })

  socket.on('disconnect', () => {
    io.emit('presence.offline', { userId: socket.user.id })
  })
})

httpServer.listen(3000)
```

```typescript
// === After (Raffel) ===
import { createServer } from 'raffel'
import { z } from 'zod'

const server = createServer({
  websocket: {
    path: '/ws',
    contextFactory: async (ws, req) => {
      const token = req.headers['authorization']
      const user = await verifyJwt(token)
      if (!user) throw new Error('Unauthorized')
      return { auth: { principal: user.id, claims: user } }
    },
    channels: {
      authorize: async (socketId, channel) => {
        // allow all private-user:* and room:* channels
        return channel.startsWith('private-user:') || channel.startsWith('room:')
      },
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principal
      })
    }
  }
})

server.procedure('chat.send')
  .input(z.object({ roomId: z.string(), text: z.string() }))
  .handler(async (input, ctx) => {
    const msg = await db.messages.create({ ...input, userId: ctx.auth?.principal })
    // ctx.transport?.channels available for broadcasting
    return { ok: true, id: msg.id }
  })

server.procedure('room.join')
  .input(z.object({ roomId: z.string() }))
  .handler(async (input, ctx) => {
    // Client subscribes to channel via protocol: { "type": "subscribe", "channel": "room:roomId" }
    return { ok: true }
  })

await server.start()
```

### Key differences summary

| Socket.IO behavior | Raffel equivalent |
|-------------------|-------------------|
| Automatic reconnection | Client-side WebSocket reconnect logic (or use a client library) |
| Binary/blob support | Supported natively (msgpack codec available) |
| Fallback to polling | Not supported — WebSocket only |
| `socket.id` | `ctx.requestId` (per-request) or configure via contextFactory |
| Volatile events | Fire-and-forget events (`server.event()`) |
| Acknowledgements | Procedures (`server.procedure()`) |

```bash
# Packages to remove
pnpm remove socket.io socket.io-client
```
