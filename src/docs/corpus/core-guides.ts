export const AUTH_GUIDE = `# Authentication Guide

Raffel's auth layer is protocol-agnostic: it works over HTTP, WebSocket, JSON-RPC, gRPC, and more.

## Bearer Token (JWT)

\`\`\`typescript
import { createServer, createAuthMiddleware, createBearerStrategy, requireAuth } from 'raffel'

const server = createServer({ port: 3000 })
server.use(createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        const payload = await verifyJwt(token)
        if (!payload) return null
        return { authenticated: true, principal: payload.sub, claims: payload }
      },
    }),
  ],
  publicProcedures: ['health.check', 'auth.login'],
}))
\`\`\`

## OAuth2 (Google, GitHub, etc.)

\`\`\`typescript
import { createOAuth2Strategy, generateState } from 'raffel'

const googleAuth = createOAuth2Strategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
})

server.use(createAuthMiddleware({ strategies: [googleAuth] }))

// Redirect to Google
server.procedure('auth.authorize').handler(async (_input, ctx) => {
  const state = generateState()
  ctx.session.data.oauthState = state
  ctx.session.touch()
  return { redirect: googleAuth.getAuthorizationUrl({ state }) }
})

// Handle callback
server.procedure('auth.callback').handler(async ({ code, state }, ctx) => {
  if (state !== ctx.session.data.oauthState) throw new RaffelError('INVALID_STATE', 'Bad state')
  const tokens = await googleAuth.exchangeCode(code)
  const userInfo = await googleAuth.getUserInfo(tokens.accessToken)
  ctx.session.data.userId = userInfo.sub
  ctx.session.touch()
  return { ok: true }
})
\`\`\`

Supported providers: \`google\`, \`github\`, \`microsoft\`, \`apple\`, \`facebook\`, \`custom\`

## OIDC (Auto-Discovery)

\`\`\`typescript
import { createOIDCStrategy } from 'raffel'

const oidc = createOIDCStrategy({
  issuer: 'https://accounts.google.com',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
})

server.use(createAuthMiddleware({ strategies: [oidc] }))

server.procedure('auth.callback').handler(async ({ code }) => {
  const tokens = await oidc.exchangeCode(code) // validates ID token automatically
  return { ok: true }
})
\`\`\`

## Role-Based Access Control

\`\`\`typescript
import { createAuthzMiddleware, hasRole, requireAuth } from 'raffel'

server.use(createAuthzMiddleware({
  rules: [
    { procedure: 'admin.*', roles: ['admin'] },
    { procedure: 'billing.*', roles: ['admin', 'billing'] },
  ],
  defaultAllow: false,
}))
\`\`\`

## Auth helpers: requireAuth(ctx), hasRole(ctx, role), hasAnyRole(ctx, roles)
`

export const SESSIONS_GUIDE = `# Session Store

\`ctx.session\` is injected into every handler — a mutable data bag persisted across requests.

## Setup

\`\`\`typescript
import { createServer, createSessionInterceptor } from 'raffel'

// Development (in-memory)
const server = createServer({ port: 3000 })
server.use(createSessionInterceptor({ driver: 'memory', ttl: 3600 }))

// OR in ServerOptions
const server2 = createServer({
  port: 3000,
  session: { driver: 'memory', ttl: 3600, cookie: { name: 'sid' } }
})
\`\`\`

## Usage in handlers

\`\`\`typescript
server.procedure('auth.login').handler(async ({ userId }, ctx) => {
  ctx.session.data.userId = userId
  ctx.session.touch()            // mark as dirty → saves after handler
  return { ok: true }
})

server.procedure('auth.me').handler(async (_input, ctx) => {
  return { userId: ctx.session.data.userId ?? null }
})

server.procedure('auth.logout').handler(async (_input, ctx) => {
  ctx.session.destroy()          // deletes from store + clears cookie
  return { ok: true }
})
\`\`\`

## Redis (production)

\`\`\`typescript
import { createRedisSessionDriver } from 'raffel'
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

server.use(createSessionInterceptor({
  driver: createRedisSessionDriver({ client: redis }),
  ttl: 7200,
  rolling: true,    // sliding window
  secret: process.env.SESSION_SECRET,
}))
\`\`\`

## Session API

- \`ctx.session.data\` — mutable data bag
- \`ctx.session.touch()\` — mark as dirty
- \`ctx.session.destroy()\` — delete + clear cookie
- \`ctx.session.regenerate()\` — new session ID (after login, prevents fixation)
- \`ctx.session.id\` — current session ID
`

export const REST_API_GUIDE = `# REST API Guide

## Quick start

\`\`\`typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('users.list').handler(async () => db.users.findMany())
server.procedure('users.get').handler(async ({ id }) => db.users.findUnique({ where: { id } }))
server.procedure('users.create').handler(async (input) => db.users.create({ data: input }))
server.procedure('users.update').handler(async ({ id, ...data }) => db.users.update({ where: { id }, data }))
server.procedure('users.delete').handler(async ({ id }) => db.users.delete({ where: { id } }))

await server.start()
\`\`\`

HTTP mapping: \`users.list\` → \`GET /users/list\`, \`users.create\` → \`POST /users/create\`

## With validation (Zod)

\`\`\`typescript
import { createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

server.procedure('users.create')
  .input(z.object({ name: z.string().min(2), email: z.string().email() }))
  .handler(async (input) => db.users.create({ data: input }))
\`\`\`

## With auth + rate limiting

\`\`\`typescript
server
  .use(createAuthMiddleware({ strategies: [bearer] }))
  .use(createRateLimitInterceptor({ maxRequests: 100, windowMs: 60_000 }))
\`\`\`

## Error handling

\`\`\`typescript
import { RaffelError } from 'raffel'

server.procedure('users.get').handler(async ({ id }) => {
  const user = await db.users.findUnique({ where: { id } })
  if (!user) throw new RaffelError('NOT_FOUND', \`User \${id} not found\`)
  return user
})
\`\`\`
`

export const PROVIDERS_GUIDE = `# Providers (Dependency Injection)

Providers are how Raffel injects long-lived dependencies (database clients,
caches, config) into handlers. A provider **factory runs once during
\`server.start()\`** — after the runtime is wired — and its instance is exposed
on \`ctx\` for every handler, including filesystem-discovered ones.

## Setup

\`\`\`ts
import { createServer } from 'raffel/server'

const server = createServer({
  port: 3000,
  providers: {
    db: () => new PrismaClient(),
    cache: () => new Redis(process.env.REDIS_URL),
    // factories receive already-resolved providers and can depend on each other
    users: ({ db }) => new UserRepository(db),
  },
})

await server.start()
\`\`\`

## Usage in handlers

\`\`\`ts
// src/http/users/get.ts (discovered) — ctx.db / ctx.users are ready
export default async (input, ctx) => ctx.users.findById(input.id)
\`\`\`

## Why this matters in ESM

Filesystem discovery \`import()\`s handler modules **before** \`server.start()\`.
Top-level initialisation therefore runs too early:

\`\`\`ts
// ✗ getDb() runs at import time, before providers exist → undefined
const repo = new LeadRepository(getDb())
export const list = () => repo.findAll()

// ✓ inject via ctx — no lazy-getter boilerplate
export const list = (input, ctx) => ctx.leads.findAll()
\`\`\`

## Imperative registration

\`\`\`ts
server.provide('db', () => new PrismaClient(), {
  onShutdown: (db) => db.\$disconnect(),
})
\`\`\`

\`onShutdown\` runs on \`server.stop()\` for every provider that was instantiated.
`

export const MIGRATION_GUIDE = `# Migrating to Raffel

## From Express

Key differences: Express uses \`(req, res, next)\` callbacks; Raffel handlers return a \`Response\`.

\`\`\`typescript
// Express                                   // Raffel HttpApp
import express from 'express'                import { HttpApp, serve } from 'raffel/http'
const app = express()                        const app = new HttpApp()
app.use(express.json())                      // not needed — parsed on demand

app.get('/users/:id', (req, res) => {        app.get('/users/:id', (c) => {
  const id = req.params.id                     const id = c.req.param('id')
  res.json({ id })                             return c.json({ id })
})                                           })

app.post('/users', async (req, res) => {     app.post('/users', async (c) => {
  const body = req.body                        const body = await c.req.json()
  res.status(201).json(body)                   return c.json(body, 201)
})                                           })

// Middleware (req, res, next) 3-arg          // Middleware (c, next) — return to short-circuit
app.use((req, res, next) => {                app.use('*', async (c, next) => {
  req.user = await auth(req)                   c.set('user', await auth(c))
  next()                                       await next()
})                                           })

// Error handler: 4-arg signature             // onError()
app.use((err, req, res, next) => {           app.onError((err, c) => {
  res.status(500).json({ error: err.message }) return c.json({ error: err.message }, 500)
})                                           })

app.listen(3000, () => console.log('ok'))    const server = serve({
                                               fetch: app.fetch, port: 3000,
                                               keepAliveTimeout: 65000,
                                               onListen: () => console.log('ok'),
                                             })
                                             process.on('SIGTERM', () => server.shutdown())
\`\`\`

Package replacements:
| Express | Raffel |
|---------|--------|
| \`cors\` (npm) | \`cors\` from \`raffel/http\` |
| \`helmet\` | \`secureHeaders\` from \`raffel/http\` |
| \`compression\` | \`compress\` from \`raffel/http\` |
| \`express-rate-limit\` | \`createRateLimiter\` + \`rateLimitMiddleware\` |
| \`express-session\` | \`createSessionInterceptor\` |
| \`express.static\` | \`serveStatic\` from \`raffel/http\` |
| \`swagger-ui-express\` | \`mountOpenApiDocs\` from \`raffel/http\` |

## From Fastify

Key differences: Fastify has plugins/decorators; Raffel uses sub-apps and context variables.

\`\`\`typescript
// Fastify                                   // Raffel
fastify.get('/users/:id',                    app.get('/users/:id', (c) => {
  async (request, reply) => {                  const id = c.req.param('id')
    const { id } = request.params               return c.json({ id })
    reply.send({ id })                       })
})

fastify.post('/users',                       app.post('/users', async (c) => {
  async (request, reply) => {                  const body = await c.req.json()
    const body = request.body                   return c.json(body, 201)
    reply.status(201).send(body)             })
})

// addHook → middleware
fastify.addHook('onRequest',                 app.use('*', async (c, next) => {
  async (req, reply) => {                      const token = c.req.header('authorization')
    const token = req.headers.authorization    c.set('user', await verifyJwt(token))
    req.user = await verifyJwt(token)          await next()
  })                                         })

// Plugin → sub-app
fastify.register(usersPlugin,               const usersApp = new HttpApp()
  { prefix: '/users' })                     // ... register routes on usersApp
                                            app.route('/users', usersApp)

// Decorator → context variable
fastify.decorateRequest('user', null)       const app = new HttpApp<{ user: User }>()
// req.user = ...                           // c.set('user', ...)  /  c.get('user')

await fastify.listen({ port: 3000 })        const server = serve({
                                              fetch: app.fetch, port: 3000,
                                              keepAliveTimeout: 65000,
                                            })
\`\`\`

Package replacements:
| Fastify | Raffel |
|---------|--------|
| \`@fastify/cors\` | \`cors\` from \`raffel/http\` |
| \`@fastify/helmet\` | \`secureHeaders\` from \`raffel/http\` |
| \`@fastify/compress\` | \`compress\` from \`raffel/http\` |
| \`@fastify/rate-limit\` | \`createRateLimiter\` + \`rateLimitMiddleware\` |
| \`@fastify/session\` | \`createSessionInterceptor\` |
| \`@fastify/static\` | \`serveStatic\` from \`raffel/http\` |
| \`@fastify/swagger\` + \`@fastify/swagger-ui\` | \`mountOpenApiDocs\` from \`raffel/http\` |

## From Fetch-first Routers

Raffel's \`HttpApp\` uses familiar Fetch-style routing and middleware concepts, but it remains the HTTP front door of a larger multi-transport runtime.

\`\`\`typescript
// Before (router-first stack)               // After (Raffel)
import { Hono } from 'hono'                  import { HttpApp } from 'raffel/http'
import { serve } from '@hono/node-server'    import { serve } from 'raffel/http'
import { cors } from 'hono/cors'             import { cors } from 'raffel/http'
const app = new Hono()                       const app = new HttpApp()
// Map routes and middleware concepts, then reuse contracts across transports

// @hono/swagger-ui
import { swaggerUI } from '@hono/swagger-ui' import { mountOpenApiDocs } from 'raffel/http'
app.get('/docs', swaggerUI({ url: '/openapi.json' }))
// → mountOpenApiDocs(app, { spec: () => mySpec, title: 'API' })

// serve() callback → onListen option
serve({ fetch: app.fetch, port: 3000 },      serve({ fetch: app.fetch, port: 3000,
  (info) => console.log(info.port))            onListen: ({ port }) => console.log(port),
                                               keepAliveTimeout: 65000 })
\`\`\`

## From WebSocket (\`ws\` library)

The \`ws\` library exposes raw frames through Node.js event emitters.
Raffel routes messages through a typed procedure/stream/event registry.

\`\`\`typescript
// ws concept                                 // Raffel equivalent
wss.on('connection', handler)                 // handled internally by adapter
ws.on('message', handler)                     // registry.procedure() / event() / stream()
ws.send(JSON.stringify(data))                 // return data (from procedure handler)
ws.on('close', () => cleanup())              // ctx.signal.addEventListener('abort', cleanup)
wss.clients.forEach(ws => ws.send(...))       // channels.broadcast('channel', 'event', data)
\`\`\`

\`\`\`typescript
// ws — manual routing + reply
const wss = new WebSocket.Server({ port: 8080 })
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'users.list') {
      db.users.findAll().then(users =>
        ws.send(JSON.stringify({ id: msg.id, data: users })))
    }
  })
})

// Raffel — procedures, typed, auto-routed; HTTP + WebSocket on same port
const server = createServer({ port: 3000 })

server.procedure('users.list').handler(async () => db.users.findAll())

server.stream('metrics.live').handler(async function* (_input, ctx) {
  while (!ctx.signal.aborted) {
    yield getMetrics()
    await delay(1000, ctx.signal)  // cancelled automatically on disconnect
  }
})

server.event('analytics.track').handler(async (payload) => {
  await analytics.record(payload)  // fire-and-forget, no reply
})

await server.start()
\`\`\`

\`\`\`typescript
// Authentication — contextFactory (runs at WebSocket upgrade)
const server = createServer({
  websocket: {
    contextFactory: async (ws, req) => {
      const user = await verifyToken(req.headers['authorization'])
      if (!user) throw new Error('Unauthorized')   // closes connection
      return { auth: { principal: user.id, claims: user } }
    }
  }
})
\`\`\`

Envelope format: \`{ "id": "req-1", "procedure": "users.list", "type": "request", "payload": {} }\`
Stream lifecycle: \`stream:start\` → \`stream:data\` (repeated) → \`stream:end\`; client cancels with \`{ "type": "cancel", "id": "s1" }\`

\`\`\`bash
pnpm remove ws @types/ws
\`\`\`

## From Socket.IO

Socket.IO adds rooms, namespaces, reconnection, and acknowledgements on top of WebSocket.

\`\`\`typescript
// Socket.IO concept                          // Raffel equivalent
io.on('connection', handler)                  // handled internally by adapter
socket.on('event', handler)                   // server.event() or server.procedure()
socket.emit('event', data) with ack callback  // server.procedure() (returns value)
socket.join('room') + io.to('room').emit()    // channels.broadcast('room:id', 'event', data)
io.of('/namespace')                           // separate createServer() + path routing
io.use(async (socket, next) => { next() })    // contextFactory (runs at upgrade)
\`\`\`

\`\`\`typescript
// Socket.IO
io.on('connection', (socket) => {
  socket.on('chat.send', async (data, ack) => {
    const msg = await db.messages.create({ ...data, userId: socket.user.id })
    io.to(\`room:\${data.roomId}\`).emit('chat.message', msg)
    ack({ ok: true, id: msg.id })
  })
  socket.on('room.join', ({ roomId }) => {
    socket.join(\`room:\${roomId}\`)
  })
})

// Raffel
const server = createServer({
  websocket: {
    contextFactory: async (ws, req) => {
      const user = await verifyJwt(req.headers['authorization'])
      if (!user) throw new Error('Unauthorized')
      return { auth: { principal: user.id, claims: user } }
    },
    channels: {
      authorize: async (socketId, channel) =>
        channel.startsWith('room:') || channel.startsWith('private-user:'),
      presenceData: (socketId, channel, ctx) => ({ userId: ctx.auth?.principal })
    }
  }
})

server.procedure('chat.send')
  .input(z.object({ roomId: z.string(), text: z.string() }))
  .handler(async (input, ctx) => {
    const msg = await db.messages.create({ ...input, userId: ctx.auth?.principal })
    ctx.transport?.channels?.broadcast(\`room:\${input.roomId}\`, 'chat.message', msg)
    return { ok: true, id: msg.id }  // returned value = acknowledgement
  })

// client subscribes to channel: { "type": "subscribe", "channel": "room:123" }

await server.start()
\`\`\`

Broadcast variants:
\`channels.broadcast('channel', 'event', data)\` — all subscribers
\`channels.broadcast('channel', 'event', data, exceptSocketId)\` — except one sender

Key differences: no automatic fallback to polling (WebSocket only); reconnection handled client-side; \`socket.id\` maps to \`ctx.requestId\`.

\`\`\`bash
pnpm remove socket.io socket.io-client
\`\`\`
`
