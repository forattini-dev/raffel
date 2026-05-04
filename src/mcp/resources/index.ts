/**
 * Raffel MCP - Resources
 *
 * MCP resource definitions and handlers for raffel:// URIs.
 */

import type { MCPResource, MCPResourceTemplate, MCPResourceReadResult } from '../types.js'
import {
  interceptors,
  getInterceptor,
  adapters,
  getAdapter,
  patterns,
  getPattern,
  errors,
  getError,
  quickstartGuide,
  boilerplates,
  getBoilerplate,
} from '../docs/index.js'

interface GuideResource {
  topic: string
  name: string
  description: string
  content: string
}

let GUIDE_RESOURCES: GuideResource[] = []
let GUIDE_CATALOG: { topic: string; name: string; description: string }[] = []

const GUIDE_TOPIC_ALIASES: Record<string, string> = {
  'quick-start': 'quickstart',
  'quick-start-guide': 'quickstart',
  'quick-start-doc': 'quickstart',
  'mock': 'mock-server',
  'json-server': 'mock-server',
  'jsonserver': 'mock-server',
  'universal-service-documentation': 'usd',
  'unified-service-documentation': 'usd',
  'unified-service-doc': 'usd',
  'universal-service-doc': 'usd',
  'unified': 'usd',
  'usd-docs': 'usd',
  'uds': 'usd',
  'x-usd': 'usd',
  'universal': 'usd',
  'proxy': 'proxy',
  'reverse-proxy': 'proxy',
  'reverseproxy': 'proxy',
  'reverse-proxy-guide': 'proxy',
  'proxy-toolkit': 'proxy',
  'proxy-reverse': 'proxy',
  'reverse-proxy-toolkit': 'proxy',
  'proxy-doc': 'proxy',
  'proxy-docs': 'proxy',
  'proxy-guide': 'proxy',
  'traefik': 'proxy',
  'proxy-modes': 'proxy',
  'proxy-suite': 'proxy',
  'proxy-mesh': 'proxy',
  'proxy-service-mesh': 'proxy',
  'service-mesh': 'proxy',
  'proxy-flow-metrics': 'proxy',
  'flow-metrics': 'proxy',
  'mitm-capture': 'proxy',
  'capture-replay': 'proxy',
  'proxy-capture': 'proxy',
  'proxy-replay': 'proxy',
  'proxy-telemetry': 'proxy',
  'proxy-graph': 'proxy',
  'proxy-capabilities': 'proxy-capabilities',
  'proxy-capability': 'proxy-capabilities',
  'proxy-matrix': 'proxy-capabilities',
  'matrix': 'proxy-capabilities',
  'capability-matrix': 'proxy-capabilities',
  'proxy-observability': 'proxy-observability',
  'proxy-metrics': 'proxy-observability',
  'proxy-metrics-graph': 'proxy-observability',
  'graph-metrics': 'proxy-observability',
  'feature-map': 'feature-map',
  'feature-matrix': 'feature-map',
  'feature-maps': 'feature-map',
  'framework-plugin': 'framework-plugins',
  'framework-plugins': 'framework-plugins',
  'framework-runtime': 'framework-plugins',
  'runtime-plugin': 'framework-plugins',
  'plugins': 'framework-plugins',
  'mcp-server': 'mcp-server',
  'build-mcp': 'mcp-server',
  'mcp-library': 'mcp-server',
  'docs-mcp': 'docs-mcp',
  'docs-server': 'docs-mcp',
  'documentation-mcp': 'docs-mcp',
  'markdown-mcp': 'docs-mcp',
  'mcp-intelligence': 'mcp-intelligence',
  'mcp-surface': 'mcp-intelligence',
  'mcp-guide': 'mcp-intelligence',
  'webhook-edge': 'webhook-edge',
  'webhook': 'webhook-edge',
  'webhook-proxy': 'webhook-edge',
  'mitm': 'proxy',
  'socks5': 'proxy',
  'socks5h': 'proxy',
  'socks5-proxy': 'proxy',
  'explicit-proxy': 'proxy',
  'transparent-proxy': 'proxy',
  'http-proxy': 'proxy',
  'https-proxy': 'proxy',
}

function normalizeGuideTopic(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function resolveGuideTopic(topic: string): string {
  const normalized = normalizeGuideTopic(topic)
  return GUIDE_TOPIC_ALIASES[normalized] || normalized
}

function refreshGuideResources(): void {
  GUIDE_RESOURCES = [
    {
      topic: 'quickstart',
      name: 'Quickstart Guide',
      description: 'Getting started with Raffel',
      content: quickstartGuide,
    },
    {
      topic: 'auth',
      name: 'Authentication Guide',
      description: 'Complete guide: Bearer JWT, API Key, OAuth2, OIDC, Sessions',
      content: AUTH_GUIDE,
    },
    {
      topic: 'sessions',
      name: 'Session Store Guide',
      description: 'Session management with memory and custom drivers (including Redis adapters)',
      content: SESSIONS_GUIDE,
    },
    {
      topic: 'rest-api',
      name: 'REST API Guide',
      description: 'Building production-ready REST APIs with CRUD, validation, and auth',
      content: REST_API_GUIDE,
    },
    {
      topic: 'migration',
      name: 'Migration Guide',
      description: 'Migrating from Express, Fastify, Fetch-first routers, ws, or Socket.IO to Raffel',
      content: MIGRATION_GUIDE,
    },
    {
      topic: 'proxy',
      name: 'Reverse Proxy Guide',
      description:
        'Run HTTP/HTTPS ingress + CONNECT/WebSocket flows and discover related explicit/SOCKS5/transparent/service mesh modes with shared observability.',
      content: PROXY_GUIDE,
    },
    {
      topic: 'proxy-capabilities',
      name: 'Proxy Capabilities Matrix',
      description: 'Mode × protocol coverage, opt-in telemetry, and shared collectors across reverse, explicit, socks5, and transparent flows.',
      content: PROXY_CAPABILITIES_GUIDE,
    },
    {
      topic: 'proxy-observability',
      name: 'Proxy Observability',
      description:
        'Edge labels, source→destination→protocol graphing, p50/p90/p95 guidance, error rates, and exported metric families.',
      content: PROXY_OBSERVABILITY_GUIDE,
    },
    {
      topic: 'mcp-server',
      name: 'Building MCP Servers',
      description:
        'Standalone createMcpServer(), integrated mcp: true mode, auth, transports, and protocol features for custom MCP servers.',
      content: MCP_SERVER_GUIDE,
    },
    {
      topic: 'framework-plugins',
      name: 'Framework Plugins',
      description:
        'Build higher-level frameworks on Raffel with ServerPlugin, lifecycle hooks, runtime inspection extensions, and a clear split between DI and runtime extension.',
      content: FRAMEWORK_PLUGINS_GUIDE,
    },
    {
      topic: 'docs-mcp',
      name: 'Documentation MCP Server',
      description:
        'Turn a Markdown docs tree or git repo into an MCP server with search, section reads, code extraction, and docs:// resources.',
      content: DOCS_MCP_GUIDE,
    },
    {
      topic: 'feature-map',
      name: 'Feature Map',
      description:
        'Raffel feature surface by area: protocols, proxy, observability, security, and production DX workflow.',
      content: FEATURE_MAP_GUIDE,
    },
    {
      topic: 'mcp-intelligence',
      name: 'MCP Intelligence Layer',
      description:
        'Use Raffel MCP to discover capabilities across docs, protocols, interceptors, codegen, and proxy telemetry before generating implementation.',
      content: MCP_INTELLIGENCE_GUIDE,
    },
    {
      topic: 'webhook-edge',
      name: 'Webhook Edge Guide',
      description:
        'Public webhook edge with createReverseProxy, TLS termination, optional token/HMAC verification, and anti-replay nonce checks.',
      content: WEBHOOK_EDGE_GUIDE,
    },
    {
      topic: 'mock-server',
      name: 'Mock Server Guide',
      description: 'Spec-driven mock server from OpenAPI/USD, JSON data server, and CLI usage',
      content: `# Mock Server

Raffel ships with two mock server modes accessible via CLI and programmatic API.

## CLI

\`\`\`bash
# From OpenAPI spec (local or remote URL)
raffel mock petstore.yaml
raffel mock https://petstore3.swagger.io/api/v3/openapi.json -p 4000

# From JSON data file (full CRUD json-server)
raffel mock db.json
raffel mock db.json --readonly --ws --jsonrpc
raffel mock db.json --watch
\`\`\`

Auto-detection: files with \`openapi\`/\`paths\` keys → spec mock; plain JSON with arrays → json-server.

## Programmatic: OpenAPI Mock

\`\`\`typescript
import { createMockServer } from 'raffel'

const { server, routes } = await createMockServer({
  spec: './openapi.yaml',
  port: 4000,
  validateRequests: true,
  protocols: { ws: true, jsonrpc: true },
})
\`\`\`

Responses resolved: example → named examples → schema.example → generated fake data.
Mutations (POST/PUT/PATCH) merge request body over template.

## Programmatic: JSON Server

\`\`\`typescript
import { createJsonServer } from 'raffel'

const { server, store } = await createJsonServer({
  db: {
    posts: [{ id: 1, title: 'Hello' }],
    users: [{ id: 1, name: 'Alice' }],
  },
  port: 3000,
})
// GET/POST/PUT/PATCH/DELETE /posts[/:id]
// WebSocket: posts.list, posts.get, posts.create, posts.$watch
\`\`\`

## Mountable Modules

Both modes support mounting into existing servers:

\`\`\`typescript
import { createServer, createMockModule, createJsonModule } from 'raffel'

const mock = createMockModule(openapiSpec)
const json = createJsonModule({ posts: [{ id: 1, title: 'Test' }] })

const server = createServer({
  port: 3000,
  http: { middleware: [mock.middleware, json.middleware] },
})
  .mount('mock', mock.module)
  .mount('data', json.module)
\`\`\`
`,
    },
    {
      topic: 'usd',
      name: 'Universal Service Documentation (USD)',
      description:
        'Unified/Universal Service Documentation for multi-protocol metadata (HTTP, WebSocket, gRPC, JSON-RPC, streams, TCP, UDP), with JSON/YAML exports.',
      content: `# Universal Service Documentation (USD)

USD (Universal Service Documentation) is Raffel's protocol-agnostic API documentation format.

It extends OpenAPI 3.1 with the \`x-usd\` namespace and is designed to expose:

- HTTP routes generated from procedures and resources
- WebSocket channels and channel authorization
- Streams metadata (direction, lifecycle, message contracts)
- JSON-RPC method definitions
- gRPC services and method descriptors
- TCP/UDP protocol-specific configuration

Enable in your server:

\`\`\`typescript
server.enableUSD({ 
  info: { title: 'My API', version: '1.0.0' },
  protocols: ['http', 'websocket'],
  contentTypes: { default: 'application/json' },
})
\`\`\`

Useful endpoints:

- \`GET /docs\` - UI
- \`GET /docs/usd.json\` - Raw USD document
- \`GET /docs/usd.yaml\` - YAML USD document

Use USD docs to make your API discoverable across HTTP/WebSocket/gRPC/JSON-RPC/streams from a single canonical format.
`,
    },
  ]

  GUIDE_CATALOG = GUIDE_RESOURCES.map((guide) => ({
    topic: guide.topic,
    name: guide.name,
    description: guide.description,
  }))
}

function ensureGuideResourcesInitialized(): void {
  if (GUIDE_RESOURCES.length === 0) {
    refreshGuideResources()
  }
}

export function listGuides(): GuideResource[] {
  ensureGuideResourcesInitialized()
  return GUIDE_RESOURCES.map((guide) => ({ ...guide }))
}

export function getGuideCatalog(): { topic: string; name: string; description: string }[] {
  ensureGuideResourcesInitialized()
  return GUIDE_CATALOG.map((guide) => ({ ...guide }))
}

export function getGuideContentByTopic(topic: string): string | null {
  ensureGuideResourcesInitialized()
  const resolvedTopic = resolveGuideTopic(topic)
  const guide = GUIDE_RESOURCES.find((item) => resolveGuideTopic(item.topic) === resolvedTopic)
  return guide?.content || null
}

// === Static Resources ===

export function getStaticResources(): MCPResource[] {
  const resources: MCPResource[] = []
  ensureGuideResourcesInitialized()

  // Guides
  for (const guide of GUIDE_RESOURCES) {
    resources.push({
      uri: `raffel://guide/${guide.topic}`,
      name: guide.name,
      description: guide.description,
      mimeType: 'text/markdown',
    })
  }

  // Interceptors
  for (const i of interceptors) {
    resources.push({
      uri: `raffel://interceptor/${i.name}`,
      name: i.name,
      description: i.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Adapters
  for (const a of adapters) {
    resources.push({
      uri: `raffel://adapter/${a.name.toLowerCase()}`,
      name: `${a.name} Adapter`,
      description: a.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Patterns
  for (const p of patterns) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    resources.push({
      uri: `raffel://pattern/${slug}`,
      name: p.name,
      description: p.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Errors
  for (const e of errors) {
    resources.push({
      uri: `raffel://error/${e.code}`,
      name: e.code,
      description: e.message,
      mimeType: 'text/markdown',
    })
  }

  // Boilerplates
  for (const [name, bp] of Object.entries(boilerplates)) {
    resources.push({
      uri: `raffel://boilerplate/${name}`,
      name: bp.title,
      description: bp.description,
      mimeType: 'text/markdown',
    })
  }

  // Policies (server-scoped — populated by createServer when policy is configured)
  const policySnapshot = policyProvider?.()
  if (policySnapshot && policySnapshot.length > 0) {
    resources.push({
      uri: 'raffel://policies',
      name: 'Authorization Policies',
      description: `${policySnapshot.length} loaded authorization policies`,
      mimeType: 'application/json',
    })
    for (const p of policySnapshot) {
      resources.push({
        uri: `raffel://policy/${encodeURIComponent(p.id)}`,
        name: `Policy: ${p.id}`,
        description: p.description ?? `${p.effect} ${p.actions.join(',')}`,
        mimeType: 'application/json',
      })
    }
  }

  return resources
}

// === Server-scoped policy provider ===

type PolicySnapshot = ReadonlyArray<{
  id: string
  description?: string
  effect: 'allow' | 'deny' | 'audit'
  principals: string[]
  actions: string[]
  resources: string[]
  hasCondition: boolean
  match?: unknown
}>

let policyProvider: (() => PolicySnapshot) | undefined

/**
 * Register a server-scoped policy provider so MCP discovery can list
 * `raffel://policies` and `raffel://policy/<id>` resources.
 *
 * Called by `createServer` when `policy: { ... }` is configured.
 * Pass `null` to clear (e.g. on server.stop / replacement).
 */
export function setPolicyProvider(provider: (() => PolicySnapshot) | null): void {
  policyProvider = provider ?? undefined
}

// === Resource Templates ===

export function getResourceTemplates(): MCPResourceTemplate[] {
  return [
    {
      uriTemplate: 'raffel://interceptor/{name}',
      name: 'Interceptor Documentation',
      description: 'Get documentation for a specific interceptor',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://adapter/{name}',
      name: 'Adapter Documentation',
      description: 'Get documentation for a specific protocol adapter',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://pattern/{name}',
      name: 'API Pattern',
      description: 'Get documentation for a specific API pattern',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://error/{code}',
      name: 'Error Explanation',
      description: 'Get explanation for a specific error code',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://guide/{topic}',
      name: 'Guide',
      description: 'Get a specific guide',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://boilerplate/{template}',
      name: 'Boilerplate Code',
      description: 'Get boilerplate code for a specific template',
      mimeType: 'text/markdown',
    },
  ]
}

// === Guide Content ===

const AUTH_GUIDE = `# Authentication Guide

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

const SESSIONS_GUIDE = `# Session Store

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

const REST_API_GUIDE = `# REST API Guide

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

const MIGRATION_GUIDE = `# Migrating to Raffel

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

const PROXY_GUIDE = `# Reverse Proxy Guide

Raffel ships a proxy toolkit, where the reverse proxy is the HTTP/HTTPS edge and all proxy engines can share policy, filtering, telemetry, and middleware conventions.

Current modules:

- \`createReverseProxy\` (edge ingress for HTTP/HTTPS, CONNECT, WebSocket)
- \`createExplicitProxy\` (HTTP forward + CONNECT tunnel + upgrade forwarding)
- \`createSocks5Proxy\` (SOCKS5 with \`CONNECT\`, \`BIND\`, and \`UDP ASSOCIATE\`)
- \`createTransparentProxy\` (kernel-transparent TCP mode)
- \`createProxySuite\` (explicit + socks5 with shared collector)
- Service-mesh oriented observability via unified graph and shared collectors.
- Unified proxy middleware for policy engines, request shaping, and destination rewrites.

## 1) Protocol matrix by mode

| Capability | Reverse | Explicit | SOCKS5 | Transparent | Suite |
|:----------|:------:|:------:|:------:|:----------:|:-----:|
| HTTP/HTTPS ingress | ✅ | ✅ | ❌ | ❌ | ✅ |
| CONNECT tunneling | ✅ | ✅ | ❌ | ❌ | ✅ |
| WebSocket (\`upgrade\`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| SOCKS5h (hostname mode) | ❌ | ❌ | ✅ (socks5h) | ❌ | ✅ |
| SOCKS5 UDP | ❌ | ❌ | ✅ (socks5-udp, socks5h-udp) | ❌ | ✅ |
| TCP transparent | ❌ | ❌ | ❌ | ✅ | ❌ |

Notes:
- HTTP/HTTPS for reverse proxy is controlled by \`server.tls\` (see section 9).
- Reverse routing only accepts upstream targets with \`http:\`/HTTPS schemes.
- Transparent proxy is TCP-only.

## 2) Reverse proxy (createReverseProxy)

Use this for edge routing by host/path/method and Traefik-like local simulations.

Supports both:

- **File-driven config** (\`.json\` / \`.yaml\`) via \`loadReverseProxyConfig\`.
- **Programmatic config** via \`parseReverseProxyConfig\`.

Both modes produce the same runtime behavior and let you route by host/path/method and rewrites.

\`\`\`ts
import { createReverseProxy, loadReverseProxyConfig, parseReverseProxyConfig } from 'raffel'

const reverseFromFile = await loadReverseProxyConfig('./infra/reverse-proxy.yaml')
const reverseFromCode = parseReverseProxyConfig({
  server: { host: '0.0.0.0', port: 3443 },
  routes: [{ match: { host: 'api.internal.local', pathPrefix: '/v1' }, target: 'http://127.0.0.1:4100' }],
})

await (await createReverseProxy(reverseFromFile)).start()
await (await createReverseProxy(reverseFromCode)).start()
\`\`\`

## 3) Explicit proxy (createExplicitProxy)

\`createExplicitProxy\` is useful when you need classic HTTP proxy client support:

- absolute-form HTTP proxy requests
- CONNECT tunneling
- protocol upgrades (WebSocket)

\`\`\`ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  host: '127.0.0.1',
  port: 3128,
  forward: {
    maxBodySize: 4 * 1024 * 1024,
  },
  tunnel: {
    mode: 'forward',
  },
  telemetry: { sourceHeader: 'x-service-name' },
})

await explicit.start()
\`\`\`

## 4) SOCKS5 proxy (createSocks5Proxy)

Use this for SOCKS5 and SOCKS5h clients, including UDP-associate flows.

\`\`\`ts
import { createSocks5Proxy } from 'raffel'

const socks5 = createSocks5Proxy({
  host: '127.0.0.1',
  port: 1080,
  onConnect: (info) => {
    console.log('SOCKS5 connected', info)
  },
})

await socks5.start()
\`\`\`

## 5) Transparent proxy (createTransparentProxy)

For Linux environments where you want original destination interception:

\`\`\`ts
import { createTransparentProxy } from 'raffel'

const transparent = createTransparentProxy({
  host: '0.0.0.0',
  port: 15001,
  mode: 'tproxy',
})

await transparent.start()
\`\`\`

## 6) Route matching by host, path, and method

Reverse routing is selected in declaration order and stops at the first match.

Routes are matched in order and stop at the first hit.

### Host matching

- \`match.host\` supports a string or array.
- wildcard suffix is supported (for example \`*.internal.local\`).

### Path matching

- \`match.path\`: exact match after normalization.
- \`match.pathPrefix\`: prefix match.
- \`match.path\` supports \`*\` wildcards.

### Method matching

- \`match.methods\` accepts single method or array (\`GET\`, \`POST\`, etc.).
- omitted methods match all.

### Prefix rewrite

- default: \`stripPrefix\` follows \`match.pathPrefix\`.
- explicit \`stripPrefix: false\` disables rewrite.
- explicit string sets exact prefix to remove.

## 7) Examples for common Traefik-like patterns

### Different subdomains, same path

\`\`\`json
[
  {
    "match": { "host": "api.internal.local", "path": "/users" },
    "target": "http://127.0.0.1:4200"
  },
  {
    "match": { "host": "admin.internal.local", "path": "/users" },
    "target": "http://127.0.0.1:4210"
  }
]
\`\`\`

### Same subdomain, different paths

\`\`\`json
[
  {
    "match": { "host": "app.internal.local", "pathPrefix": "/api" },
    "target": "http://127.0.0.1:4300"
  },
  {
    "match": { "host": "app.internal.local", "path": "/health" },
    "target": "http://127.0.0.1:4301",
    "stripPrefix": false
  }
]
\`\`\`

## 8) No-match behavior

Customize missing-route responses with \`noMatch\`.

\`\`\`json
{
  "noMatch": {
    "status": 404,
    "body": "No route matched"
  }
}
\`\`\`

\`{route}\` in body is replaced with the route reason (\`request\`, \`connect\`, etc.).

## 9) MITM, capture and replay (Explicit CONNECT proxy)

\`createExplicitProxy\` exposes a CONNECT tunnel (\`createConnectTunnel\`) with two modes:

- \`forward\` (raw TLS forwarding)
- \`mitm\` (local TLS termination + request intercept)

In \`mitm\` mode you can use:

- \`onRequest\`/\`onResponse\` hooks for inspection/mutation
- \`validate\` for JSON payload validation
- \`mitmCapture\` for persistence/replay workflows

\`\`\`ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  port: 3128,
  tunnel: {
    mode: 'mitm',
    mitmCapture: {
      enabled: true,
      mode: 'capture-only',
      file: './capture/requests.ndjson',
    },
  },
})

await explicit.start()
await explicit.tunnel.startCapture({
  file: './capture/requests.ndjson',
  mode: 'passthrough',
})
await explicit.tunnel.replayCapture({
  file: './capture/requests.ndjson',
  timeoutMs: 15_000,
})
const captureState = explicit.tunnel.getCaptureState()
\`\`\`

About local HTTPS and trust:

- createExplicitProxy generates the proxy MITM CA (\`caCert\`) automatically in tunnel mode.
- For development, clients can use \`rejectUnauthorized: false\` temporarily.
- For production, use trusted certificates at the reverse-proxy ingress and explicit trust stores.

## 10) HTTPS and automatic TLS (Reverse proxy)

\`server.tls\` controls HTTPS:

- omit \`server.tls\` for HTTP
- \`server.tls: false\` to force HTTP explicitly
- \`server.tls\` object to enable HTTPS
- \`server.tls.cert\` / \`server.tls.key\` for inline certs
- \`server.tls.certFile\` / \`server.tls.keyFile\` for file-based certs
- \`server.tls: {}\` to auto-generate cert/key at startup

This is the default local-friendly option for HTTPS tests and multi-subdomain simulations.

\`\`\`ts
import { createReverseProxy } from 'raffel'

const reverse = await createReverseProxy({
  server: {
    host: '127.0.0.1',
    port: 3443,
    tls: {}, // auto-generate cert and key for local bootstrap
  },
  routes: [
    {
      match: { host: 'auto.internal.test', pathPrefix: '/' },
      target: 'http://127.0.0.1:4100',
    },
  ],
})

await reverse.start()
\`\`\`

For production, keep stable certificates in files (cert/key, or CA-chain + files) and never
rely on auto-generated certs for long-running public endpoints.

\`\`\`ts
server: {
  tls: {
    certFile: './certs/api.internal.test/fullchain.pem',
    keyFile: './certs/api.internal.test/privkey.pem',
    rejectUnauthorized: true,
  }
}
\`\`\`

## 11) Unified proxy middleware

All proxy runtimes can opt into a shared middleware surface:

- \`http-request\` / \`http-response\`
- \`mitm-request\` / \`mitm-response\`
- \`upgrade-request\`
- \`connect\`
- \`socks5-connect\`, \`socks5-bind\`, \`socks5-udp-associate\`
- \`transparent\`

The same middleware chain can:

- inspect source, destination, headers, and protocol phase
- block traffic with a standard \`ctx.blocked\` payload
- rewrite \`ctx.target.host\` / \`ctx.target.port\`
- mutate HTTP/MITM request and response objects

\`\`\`ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  port: 3128,
  middleware: [
    async (ctx, next) => {
      if (ctx.kind === 'http-request') {
        ctx.request.headers['x-edge'] = 'mesh-a'
      }

      if (ctx.kind === 'connect' && ctx.target.host.endsWith('.blocked.internal')) {
        ctx.blocked = { statusCode: 403, reason: 'blocked by policy' }
        return
      }

      if (ctx.kind === 'mitm-response' && ctx.response) {
        ctx.response.headers['x-inspected-by'] = 'raffel'
      }

      await next()
    },
  ],
  tunnel: { mode: 'mitm' },
})
\`\`\`

Operational note:

- Middleware is opt-in, just like telemetry.
- Without a configured middleware array, proxy runtimes keep the simpler fast-path behavior.
- Reverse/explicit/MITM support full request-response shaping.
- SOCKS5 and transparent proxy middleware work at connection level (policy + target rewrite).

## 12) Shared proxy options and rollout

\`proxy\` options unify policy and observability for \`createReverseProxy\` and \`createExplicitProxy\`:

- \`auth\` (shared Basic auth model)
- \`filter\` (host/TLD/method-based access rules)
- \`middleware\` (policy, block, rewrite, request/response shaping)
- \`forward\` (HTTP request forwarding tuning)
- \`tunnel\` (CONNECT mode and CA handling)
- \`upgrade\` (WebSocket handshake handling)
- \`telemetry\` (metrics + graph + node labels)

Example:

\`\`\`json
{
  "proxy": {
    "auth": {
      "credentials": {
        "username": "admin",
        "password": "secret"
      }
    },
    "filter": {
      "allowHosts": ["api.internal.local"],
      "denyTLDs": ["ru"]
    },
    "telemetry": {
      "sourceHeader": "x-service-name",
      "graphEndpoint": "/proxy/graph",
      "metricsEndpoint": "/metrics"
    }
  }
}
\`\`\`

## 13) Rollout checklist

- Start local with one route and explicit \`host\` and \`path\`.
- Add TLS (\`server.tls\`) only after route match order is validated.
- Keep \`noMatch\` explicit to avoid leaking upstream errors.
- Start with CONNECT and WebSocket checks before adding TLS passthrough flows.
- Move to method-level splits once path-only routing is stable.
- Add observability endpoints last, after protocol-level ownership is defined.
- Run canary comparing old/new edge behavior before full cutover.
- Validate SOCKS5 and UDP flows in an isolated test harness when enabled.

## 14) Service mesh and flow observability

For service-mesh style visibility, pair explicit and SOCKS5 proxies with shared collectors and graph snapshots:

- \`createTransparentProxy\` for kernel-level TCP interception (where supported)
- \`createProxySuite\` for explicit+SOCKS5 unified telemetry
- \`graphSnapshot()\` for topology and edge labels (\`source\`, \`destination\`, \`protocol\`)

Protocol labels include \`http\`, \`https\`, \`connect\`, \`ws\`, \`wss\`, \`socks5\`, \`socks5h\`, \`socks5-udp\`, \`socks5h-udp\`, and \`tcp\`.

## 15) Next docs

- [Configuração por Arquivo](/proxy/config-file.md)
- [Configuração Programática](/proxy/config-code.md)
- [Roteamento](/proxy/routing.md)
- [TLS/HTTPS](/proxy/tls.md)
- [Webhook Edge](/guides/webhook-edge.md)
- [Arquitetura](/proxy/architecture.md)
- [Modos de Proxy](/proxy/modes.md)
- [Service Mesh](/proxy/service-mesh.md)
- [Métricas e Grafo](/proxy/flow-metrics.md)
- [Operação e Integração](/proxy/operations.md)
- [Troubleshooting](/proxy/troubleshooting.md)
- [Migração de Traefik](/migration/traefik-replacement.md)
`

const MCP_SERVER_GUIDE = `# Building MCP Servers

Raffel ships two different MCP surfaces:

- the built-in Raffel AI assistant (\`raffel mcp\`)
- the MCP library for your own tools, resources, and prompts

Use the library when you want project-specific MCP behavior.

## Standalone

\`\`\`typescript
import { createMcpServer, mcpText } from 'raffel'

const server = createMcpServer({ name: 'my-tools', version: '1.0.0' })

server.tool({
  name: 'ping',
  description: 'Basic connectivity test',
  handler: async () => mcpText('pong'),
})

await server.startStdio()
\`\`\`

## Integrated mode

\`\`\`typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  mcp: {
    path: '/mcp',
    name: 'my-api',
    filter: (meta) => !meta.tags?.includes('internal'),
  },
})
\`\`\`

All eligible procedures become MCP tools automatically.

## Important options

- \`path\`, \`name\`, \`version\`, \`instructions\`
- \`filter\` and \`toolName\`
- extra \`tools\`, \`resources\`, \`resourceTemplates\`, and \`prompts\`
- \`auth\` for the HTTP MCP endpoint

## Transport support

- \`startStdio()\`
- \`startHttp({ port, path })\`
- \`startSse({ port })\`

Supported protocol features include tools, resources, prompts, completion, progress, logging notifications, listChanged notifications, resource subscriptions, and sampling where the transport/client supports it.

## Related guide

Use \`docs-mcp\` when you want to expose Markdown documentation instead of building custom tools by hand.
`

const FRAMEWORK_PLUGINS_GUIDE = `# Framework Plugins

If you are building a higher-level framework on top of Raffel, use \`ServerPlugin\`
for runtime extension and \`server.provide()\` for dependency injection.

## What plugins are for

- register framework-owned handlers
- run startup and shutdown orchestration
- attach namespaced metadata to \`server.preview()\`

## What providers are for

- database clients
- cache or queue clients
- handler-facing services exposed through \`ctx.services\`

## Quick example

\`\`\`typescript
import { createServer, type ServerPlugin } from 'raffel'

const frameworkPlugin: ServerPlugin = {
  name: 'purple',

  register({ server }) {
    server.procedure('purple.health').handler(async () => ({ ok: true }))
  },

  async beforeStart({ providers }) {
    const services = providers as { db?: { ping(): Promise<void> } }
    await services.db?.ping()
  },

  inspect: ({ preview }) => ({
    namespace: 'purple',
    title: 'Purple Runtime',
    nodes: [
      {
        id: 'purple:summary',
        kind: 'summary',
        label: 'Purple Summary',
        data: { operationCount: preview.operations.length },
      },
    ],
  }),
}

const server = createServer({
  port: 3000,
  plugins: [frameworkPlugin],
})
\`\`\`

## Lifecycle order

1. \`register\`
2. \`beforeStart\` in declaration order
3. \`afterStart\` in declaration order
4. \`beforeStop\` in reverse order
5. \`afterStop\` in reverse order

## Runtime graph extension

Framework-specific metadata should live in \`server.preview().extensions\`.
That keeps framework DX aligned with Raffel's canonical runtime graph instead of
creating a second registry for workers, resources, schedules, or policies.

## MCP guidance

If your framework also exposes MCP, prefer Raffel's integrated \`mcp\` mode for
tools/resources/prompts and use plugins for lifecycle + inspection metadata.
`

const DOCS_MCP_GUIDE = `# Documentation MCP Server

Use \`createDocsMcpServer()\` or \`raffel mcp --docs\` to expose Markdown docs over MCP.

## CLI

\`\`\`bash
raffel mcp --docs ./docs
raffel mcp --docs ./docs --transport http --port 3200
raffel mcp --docs https://github.com/org/repo --path docs/ --branch main
\`\`\`

## Programmatic API

\`\`\`typescript
import { createDocsMcpServer } from 'raffel'

const server = createDocsMcpServer({
  dir: './docs',
  watchInterval: 30_000,
  name: 'project-docs',
})

await server.startHttp({ port: 3200, path: '/mcp' })
\`\`\`

Git repository mode:

\`\`\`typescript
const repoDocs = createDocsMcpServer({
  repo: 'https://github.com/org/repo',
  branch: 'main',
  path: 'docs/',
  name: 'repo-docs',
})
\`\`\`

## Built-in tools

- \`search\`
- \`list_files\`
- \`read_file\`
- \`read_section\`
- \`list_headings\`
- \`code_examples\`
- \`file_outline\`
- \`stats\`

## Resources and prompts

- resources: \`docs://files\`, \`docs://file/{path}\`
- prompts: \`explain\`, \`summarize\`

## Operational notes

- indexes \`.md\` and \`.mdx\` by default
- skips \`node_modules\`, \`.git\`, and \`dist\` by default
- \`watchInterval\` auto-reindexes when set
- \`server.reindex()\` forces an immediate refresh
- HTTP/SSE transports can use \`auth\`; stdio cannot
`

const MCP_INTELLIGENCE_GUIDE = `# MCP Intelligence Layer

MCP is the single place to discover what Raffel can do before choosing implementation details.

When you ask Raffel MCP:

- \`raffel_feature_catalog\` gives a complete feature map and points to the right paths.
- \`raffel_proxy_capabilities\` returns the protocol matrix and telemetry surface.
- \`raffel_get_guide\` resolves detailed documentation by topic.

Recommended flow:

1. Start with \`raffel_feature_catalog\` (\`scope=all\`) to map where your need sits.
2. Open implementation-specific guides with \`raffel_get_guide\`.
3. Use \`raffel_search\` for parameter-level details and examples.

This keeps users productive because discovery and execution stay aligned with the same vocabulary.

## What the MCP surface can answer

- Protocols and adapters
- Proxy modes: reverse, explicit, SOCKS5/SOCKS5h, transparent
- Flow telemetry: edges, durations, rates, and error signals
- Security and policy patterns (auth, session, filters, TLS)
- Runtime DX: bootstraps, migration patterns, testing and project scaffolding
- Documentation serving: built-in Raffel MCP, Markdown docs MCP mode, and guide routing
`

const FEATURE_MAP_GUIDE = `# Raffel Feature Map

Raffel is one runtime with five practical surfaces:

- **Protocol Surface**: HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP.
- **Proxy Surface**: edge ingress, forward proxy, SOCKS5/SOCKS5h, transparent TCP, and unified suite mode.
- **Observability Surface**: metrics, graph snapshots, tracing, and request duration/error workflows.
- **Security Surface**: authentication, sessions, TLS, access filters, and guard patterns.
- **DX Surface**: codegen, patterns, interceptors, migration helpers, and MCP-guided onboarding.

Use these entry topics:

- \`mcp-server\` for custom MCP servers over your own runtime
- \`docs-mcp\` for Markdown docs exposed as MCP
- \`proxy\` for transport and edge setup
- \`proxy-capabilities\` for matrix and capabilities
- \`proxy-observability\` for edge metrics and error rates
- \`feature-map\` for periodic team reviews
- \`mcp-intelligence\` for the MCP workflow itself
`

const WEBHOOK_EDGE_GUIDE = `# Webhook Edge Guide

Use Raffel's reverse proxy to expose a public webhook endpoint with TLS termination and layered verification before forwarding to a local service.

Reference example: \`examples/11-webhook-proxy.ts\`

## What the example covers

- local Raffel service for \`/health\` and \`/webhook\`
- public reverse proxy edge with configurable host, port, path, and methods
- TLS termination on the edge
- optional shared-token verification
- optional HMAC signature verification
- optional anti-replay nonce checks

## Flow

\`\`\`text
Internet -> Raffel reverse proxy edge -> local Raffel service
\`\`\`

## Key environment groups

- local service: \`WEBHOOK_INTERNAL_*\`
- public edge: \`WEBHOOK_PUBLIC_*\`, \`WEBHOOK_ROUTE_*\`
- TLS: \`WEBHOOK_TLS_*\`
- message security: \`WEBHOOK_TOKEN_*\`, \`WEBHOOK_SIGNATURE_*\`, \`WEBHOOK_NONCE_*\`

## Production baseline

1. Use file-backed real certificates instead of auto-generated certs.
2. Validate message authenticity with token and/or HMAC.
3. Add nonce replay protection.
4. Enable client certificate validation when the sender supports mTLS.
5. Keep request logging minimal and privacy-aware.

Use the static guide at \`/guides/webhook-edge.md\` for the full env-var matrix and curl examples.
`

const PROXY_CAPABILITIES_GUIDE = `# Proxy Capability Matrix

The proxy toolkit exposes four execution classes, a unified telemetry model, and one shared middleware surface:

- reverse proxy
- explicit proxy
- SOCKS5/SOCKS5h proxy
- transparent TCP proxy
- suite (explicit + socks5 with shared collector)

### Mode × Protocol Matrix

| Capability | Reverse | Explicit | SOCKS5(SOCKS5h) | Transparent | Suite |
|---|:---:|:---:|:---:|:---:|:---:|
| HTTP/HTTPS ingress | ✅ | ✅ | ❌ | ❌ | ✅ |
| CONNECT tunneling | ✅ | ✅ | ❌ | ❌ | ✅ |
| WebSocket upgrade | ✅ | ✅ | ❌ | ❌ | ✅ |
| SOCKS5 + UDP ASSOCIATE | ❌ | ❌ | ✅ | ❌ | ✅ |
| TCP transparent capture | ❌ | ❌ | ❌ | ✅ | ❌ |
| Shared collector/graph | optional | optional | optional | optional | ✅ |

### Metrics and graph defaults

- Telemetry is opt-in by design.
- \`proxy.telemetry\` enables collectors for metrics and graph snapshots.
- Shared \`collector\` can consolidate reverse + explicit + socks5 + transparent state.

Useful options:

- \`sourceHeader\` (\`x-service-name\` or custom marker)
- \`resolveNode\` and \`metricsEndpoint\`
- \`graphEndpoint\` (typically \`/proxy/graph\`)
- \`percentiles\`: \`['p50','p90','p95']\` or \`[0.5,0.9,0.95]\`
- \`rateWindowSeconds\`

### Middleware coverage by mode

- Reverse: \`http-request\`, \`http-response\`, \`connect\`, \`upgrade-request\`, \`mitm-request\`, \`mitm-response\`
- Explicit: \`http-request\`, \`http-response\`, \`connect\`, \`upgrade-request\`, \`mitm-request\`, \`mitm-response\`
- SOCKS5/SOCKS5h: \`socks5-connect\`, \`socks5-bind\`, \`socks5-udp-associate\`
- Transparent: \`transparent\`
- Suite: inherits explicit + socks5 middleware coverage

Behavior model:

- Middleware is opt-in.
- \`ctx.blocked\` cancels a flow with a protocol-appropriate response.
- \`ctx.target\` can be rewritten before the upstream dial.
- HTTP and MITM phases can mutate request/response headers, bodies, paths, and status.
`

const PROXY_OBSERVABILITY_GUIDE = `# Proxy Observability

All proxy telemetry follows the same **edge model**:

- **source** → **destination** → **protocol**
- protocol values currently include \`http\`, \`https\`, \`connect\`, \`ws\`, \`wss\`, \`socks5\`, \`socks5h\`, \`socks5-udp\`, \`socks5h-udp\`, \`tcp\`

### Core edge metrics

- \`raffel_proxy_edge_requests_total\`
- \`raffel_proxy_edge_active_flows\`
- \`raffel_proxy_edge_errors_total\`
- \`raffel_proxy_edge_flow_duration_seconds\`
- \`raffel_proxy_edge_request_duration_seconds\`
- \`raffel_proxy_edge_flow_rate_per_second\`
- \`raffel_proxy_edge_request_rate_per_second\`
- \`raffel_proxy_edge_error_rate_per_second\`
- \`raffel_proxy_edge_failure_ratio\`

### Graph payload (snapshot)

Graph snapshots expose traffic by edge labels:

- request and byte counters by edge
- request/flow durations with quantiles
- active flow state
- optional method/status labels where available

### Recommended operational checks

- Start with \`createProxySuite\` for explicit + SOCKS5 with one collector.
- Keep \`telemetry.sourceHeader\` consistent so source identity is stable across services.
- Use p50/p90/p95 on duration families for SLA/SLO conversations.
- Pair with \`error_rate\` and \`failure_ratio\` for incident-oriented dashboards.
`

function getGuideContent(name: string): string | null {
  const resolvedTopic = resolveGuideTopic(name)

  switch (resolvedTopic) {
    case 'quickstart':
      return quickstartGuide
    case 'auth':
      return AUTH_GUIDE
    case 'sessions':
      return SESSIONS_GUIDE
    case 'rest-api':
      return REST_API_GUIDE
    case 'migration':
      return MIGRATION_GUIDE
    case 'proxy':
      return PROXY_GUIDE
    default: {
      ensureGuideResourcesInitialized()
      const guide = GUIDE_RESOURCES.find((item) => resolveGuideTopic(item.topic) === resolvedTopic)
      return guide?.content || null
    }
  }
}

function parseResourceUri(uri: string): { type: string; name: string } | null {
  if (!uri.startsWith('raffel://')) return null
  const path = uri.slice('raffel://'.length).replace(/^\/+/, '')
  const [type, ...parts] = path.split('/')
  if (!type) return null
  const name = parts.join('/').trim()
  // Some resource types are listings (no name segment) — `policies` is one.
  if (!name && !LISTING_RESOURCE_TYPES.has(type.toLowerCase())) return null
  return { type: type.toLowerCase(), name }
}

const LISTING_RESOURCE_TYPES = new Set(['policies'])

// === Resource Reader ===

export function readResource(uri: string): MCPResourceReadResult | null {
  const parsed = parseResourceUri(uri)
  if (!parsed) return null
  const { type, name } = parsed

  switch (type) {
    case 'guide': {
      const guideContent = getGuideContent(name)
      if (guideContent) {
        return { contents: [{ uri, mimeType: 'text/markdown', text: guideContent }] }
      }
      return null
    }

    case 'policies': {
      const snapshot = policyProvider?.()
      if (!snapshot) return null
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
      }
    }

    case 'policy': {
      const snapshot = policyProvider?.()
      if (!snapshot) return null
      const id = decodeURIComponent(name)
      const policy = snapshot.find((p) => p.id === id)
      if (!policy) return null
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(policy, null, 2),
          },
        ],
      }
    }

    case 'interceptor': {
      const interceptor = getInterceptor(name)
      if (!interceptor) return null

      let md = `# ${interceptor.name}\n\n`
      md += `**Category:** ${interceptor.category}\n\n`
      md += `${interceptor.description}\n\n`

      if (interceptor.options.length > 0) {
        md += `## Options\n\n`
        md += `| Name | Type | Required | Default | Description |\n`
        md += `|------|------|----------|---------|-------------|\n`
        for (const opt of interceptor.options) {
          md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
        }
        md += '\n'
      }

      if (interceptor.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of interceptor.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'adapter': {
      const adapter = getAdapter(name)
      if (!adapter) return null

      let md = `# ${adapter.name} Adapter\n\n`
      md += `**Protocol:** ${adapter.protocol}\n\n`
      md += `${adapter.description}\n\n`

      if (adapter.features.length > 0) {
        md += `## Features\n\n`
        for (const f of adapter.features) {
          md += `- ${f}\n`
        }
        md += '\n'
      }

      if (adapter.options.length > 0) {
        md += `## Options\n\n`
        md += `| Name | Type | Required | Default | Description |\n`
        md += `|------|------|----------|---------|-------------|\n`
        for (const opt of adapter.options) {
          md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
        }
        md += '\n'
      }

      if (adapter.mapping) {
        md += adapter.mapping + '\n'
      }

      if (adapter.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of adapter.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'pattern': {
      const pattern = getPattern(name.replace(/-/g, ' '))
      if (!pattern) return null

      let md = `# ${pattern.name}\n\n`
      md += `${pattern.description}\n\n`
      md += `**Components:** ${pattern.components.join(', ')}\n\n`
      md += `## Signature\n\n\`\`\`typescript\n${pattern.signature}\n\`\`\`\n\n`

      if (pattern.correctExamples.length > 0) {
        md += `## Correct Usage\n\n`
        for (const ex of pattern.correctExamples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      if (pattern.wrongExamples.length > 0) {
        md += `## Common Mistakes (AVOID)\n\n`
        for (const ex of pattern.wrongExamples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
          if (ex.description) {
            md += `> **Why this is wrong:** ${ex.description}\n\n`
          }
        }
      }

      md += `## Why This Pattern?\n\n${pattern.why}\n`

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'error': {
      const error = getError(name)
      if (!error) return null

      let md = `# ${error.code}\n\n`
      md += `**Message:** ${error.message}\n\n`
      md += `${error.description}\n\n`

      md += `## Possible Causes\n\n`
      for (const cause of error.possibleCauses) {
        md += `- ${cause}\n`
      }
      md += '\n'

      md += `## Solutions\n\n`
      for (const sol of error.solutions) {
        md += `- ${sol}\n`
      }
      md += '\n'

      if (error.examples && error.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of error.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'boilerplate': {
      const bp = getBoilerplate(name as 'basic-api')
      if (!bp) return null

      let md = `# ${bp.title}\n\n`
      md += `${bp.description}\n\n`

      for (const [filename, content] of Object.entries(bp.files)) {
        md += `## ${filename}\n\n`
        const ext = filename.split('.').pop()
        md += `\`\`\`${ext === 'json' ? 'json' : 'typescript'}\n${content}\n\`\`\`\n\n`
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    default:
      return null
  }
}
