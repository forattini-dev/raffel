<div align="center">

# Raffel

### Unified multi-protocol server runtime

One core, many transports. Procedures, streams, and events with delivery guarantees.
Modular routing, file-based discovery, and protocol adapters that speak the same envelope.

[![npm version](https://img.shields.io/npm/v/raffel.svg?style=flat-square&color=2F855A)](https://www.npmjs.com/package/raffel)
[![npm downloads](https://img.shields.io/npm/dm/raffel.svg?style=flat-square&color=3182CE)](https://www.npmjs.com/package/raffel)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

[Documentation](https://forattini-dev.github.io/raffel) · [Quick Start](#quick-start) · [Routing](#routing)

</div>

---

## Quick Start

```bash
pnpm add raffel
```

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .handler(async (input: { name: string }) => {
    return { id: `user-${input.name}` }
  })

server
  .stream('logs.tail')
  .handler(async function* () {
    yield { line: 'booted' }
    yield { line: 'ready' }
  })

server
  .event('emails.send')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 3, initialDelay: 500 })
  .handler(async (_payload, _ctx, ack) => {
    ack()
  })

await server.start()
```

Note: loader APIs live under `server/fs-routes` in this repo. Expose a subpath
export if you want to consume them from the package entrypoint.

## What Raffel gives you

| Area | Highlights |
|:--|:--|
| Core | Protocol-agnostic envelope, immutable context, onion interceptors |
| Protocols | HTTP, WebSocket, TCP, JSON-RPC, gRPC, GraphQL adapters |
| Routing | Router modules with mountable prefixes |
| Discovery | File-system discovery with middleware, auth, and hot reload |
| REST | Auto-CRUD loaders and resource handlers (manual registration) |
| Channels | Pusher-like pub/sub (public, private, presence) |
| Events | best-effort, at-least-once, at-most-once delivery |
| Streams | Async streaming with backpressure (RaffelStream) |
| Custom TCP/UDP | Full control over socket lifecycle with framing |
| Validation | Multi-validator support (Zod, Yup, Joi, Ajv, fastest-validator) |
| Tooling | OpenAPI and GraphQL schema generators |

---

## File-System Discovery

Discovery scans for procedures and streams using a conventional layout:

```
src/
├── http/        # HTTP procedures
├── rpc/         # JSON-RPC + gRPC procedures
├── streams/     # Streaming handlers
└── channels/    # WebSocket channels
```

Route names are literal and used as-is by adapters.

### Enable Discovery

```ts
const server = createServer({
  port: 3000,
  discovery: true, // Enable defaults
})

// Or configure individually:
const server = createServer({
  port: 3000,
  discovery: {
    http: './src/http',
    rpc: './src/rpc',
    streams: './src/streams',
    channels: './src/channels',
  },
})
```

REST/resources and custom TCP/UDP handlers are loaded manually (see below).

---

## REST Auto-CRUD

Define a schema and register the generated handlers:

```ts
import { loadRestResources } from 'raffel'

const rest = await loadRestResources({ restDir: './src/rest' })
for (const resource of rest.resources) {
  server.addRest(resource)
}
```

```ts
// src/rest/users.ts
import { z } from 'zod'

export const schema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.date(),
})

export const config = {
  operations: ['list', 'get', 'create', 'update', 'delete'],
  pagination: { defaultLimit: 20, maxLimit: 100 },
  sortable: ['name', 'createdAt'],
  filterable: ['name', 'email'],
}

// Prisma adapter (auto-detected)
export { prisma.user as adapter }
```

**Generated operations (procedures):**
- `users.list`
- `users.get`
- `users.create`
- `users.update`
- `users.patch`
- `users.delete`

The loader also returns route metadata if you want to map real REST endpoints
in a custom adapter.

---

## Resource Handlers

For explicit control over each operation:

```ts
import { loadResources } from 'raffel'

const resources = await loadResources({ resourcesDir: './src/resources' })
for (const resource of resources.resources) {
  server.addResource(resource)
}
```

```ts
// src/resources/products.ts
import type { ResourceContext, ResourceQuery } from 'raffel'

export const config = {
  basePath: '/products',
  idField: 'id',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
}

export async function list(query: ResourceQuery, ctx: ResourceContext) {
  return db.products.findMany({
    take: query.limit ?? 20,
    skip: query.offset ?? 0,
    orderBy: query.sort ? { [query.sort]: query.order ?? 'asc' } : undefined,
  })
}

export async function get(id: string, ctx: ResourceContext) {
  return db.products.findUnique({ where: { id } })
}

export async function create(data: unknown, ctx: ResourceContext) {
  return db.products.create({ data })
}

export async function update(id: string, data: unknown, ctx: ResourceContext) {
  return db.products.update({ where: { id }, data })
}

export async function delete_(id: string, ctx: ResourceContext) {
  return db.products.delete({ where: { id } })
}
export { delete_ as delete }

// Custom actions
export const actions = {
  publish: {
    method: 'POST',
    collection: false, // Route metadata: POST /products/:id/publish
    handler: async (data, id, ctx) => {
      return db.products.update({ where: { id }, data: { published: true } })
    },
  },
}
```

---

## WebSocket Channels (Pusher-like)

Real-time pub/sub with three channel types:

```ts
const server = createServer({
  port: 3000,
  websocket: {
    path: '/ws',
    channels: {
      authorize: async (socketId, channel, ctx) => {
        // Private/Presence channels require auth
        if (channel.startsWith('private-') || channel.startsWith('presence-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true // Public channels always allowed
      },
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principal,
        name: ctx.auth?.claims?.name,
      }),
    },
  },
})

// Server-side broadcasting
server.channels?.broadcast('chat-room', 'message', { text: 'Hello!' })

// Presence members
const members = server.channels?.getMembers('presence-lobby')
```

**Channel types:**
- `chat-room` → Public (anyone can subscribe)
- `private-user-123` → Private (requires auth)
- `presence-lobby` → Presence (auth + member tracking)

---

## Validation

Raffel supports multiple validation libraries. Install your preferred validator:

```bash
pnpm add zod              # TypeScript-first (recommended)
pnpm add yup              # Object schemas
pnpm add joi              # Powerful validation
pnpm add ajv              # JSON Schema
pnpm add fastest-validator # High performance
```

Register and use:

```ts
import { z } from 'zod'
import { createServer, registerValidator, createZodAdapter } from 'raffel'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input(z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
  }))
  .handler(async (input) => ({
    id: `user-${Date.now()}`,
    name: input.name,
  }))
```

**Available adapters:**
- `createZodAdapter(z)` - TypeScript inference
- `createYupAdapter(yup)` - Object schemas
- `createJoiAdapter(Joi)` - Complex validation
- `createAjvAdapter(new Ajv())` - JSON Schema
- `createFastestValidatorAdapter(v)` - High throughput

See [Validation Guide](docs/validation.md) for more details.

---

## Custom TCP Handlers

Full control over TCP connections with message framing:

```ts
import { loadTcpHandlers } from 'raffel'

const tcp = await loadTcpHandlers({ tcpDir: './src/tcp' })
for (const handler of tcp.handlers) {
  server.addTcpHandler(handler)
}
```

```ts
// src/tcp/game-server.ts
import type { Socket } from 'node:net'
import type { TcpContext } from 'raffel'

export const config = {
  port: 9000,
  keepAlive: true,
  framing: {
    type: 'length-prefixed',
    lengthBytes: 4,
    maxMessageSize: 1024 * 1024,
  },
}

interface PlayerState {
  playerId?: string
  authenticated: boolean
}

export function onConnect(socket: Socket, ctx: TcpContext<PlayerState>) {
  ctx.state = { authenticated: false }
  ctx.send(Buffer.from('WELCOME'))
}

export function onMessage(message: Buffer, socket: Socket, ctx: TcpContext<PlayerState>) {
  const cmd = message.toString()
  if (cmd.startsWith('AUTH:')) {
    ctx.state.playerId = cmd.slice(5)
    ctx.state.authenticated = true
    ctx.send(Buffer.from('OK'))
  }
}

export function onClose(hadError: boolean, socket: Socket, ctx: TcpContext<PlayerState>) {
  console.log(`Player ${ctx.state.playerId} disconnected`)
}
```

**Framing options:**
- `none` → Raw data chunks
- `length-prefixed` → Messages prefixed with length header
- `delimiter` → Messages separated by delimiter (e.g., `\n`)

---

## Custom UDP Handlers

Full control over UDP datagrams:

```ts
import { loadUdpHandlers } from 'raffel'

const udp = await loadUdpHandlers({ udpDir: './src/udp' })
for (const handler of udp.handlers) {
  server.addUdpHandler(handler)
}
```

```ts
// src/udp/metrics-collector.ts
import type { RemoteInfo } from 'node:dgram'
import type { UdpContext } from 'raffel'

export const config = {
  port: 9999,
  type: 'udp4',
}

interface MetricsState {
  packetsReceived: number
}

export function onListening(ctx: UdpContext<MetricsState>) {
  ctx.state = { packetsReceived: 0 }
  console.log(`UDP listening on ${ctx.server.address?.port}`)
}

export function onMessage(
  message: Buffer,
  rinfo: RemoteInfo,
  ctx: UdpContext<MetricsState>
) {
  ctx.state.packetsReceived++

  const metric = JSON.parse(message.toString())
  processMetric(metric)

  // Respond to sender
  ctx.send(Buffer.from('ACK'), rinfo.port, rinfo.address)
}
```

---

## Programmatic Registration API

Full control over discovered handlers with `.add*()` methods:

```ts
import {
  createServer,
  loadDiscovery,
  loadRestResources,
  loadTcpHandlers
} from 'raffel'

const server = createServer({ port: 3000 })

// 1. Load and iterate with full control
const discovery = await loadDiscovery({ discovery: true })
for (const route of discovery.routes) {
  // Skip admin routes
  if (route.name.startsWith('admin.')) continue

  if (route.kind === 'procedure') server.addProcedure(route)
  if (route.kind === 'stream') server.addStream(route)
  if (route.kind === 'event') server.addEvent(route)
}

// 2. Or bulk register everything
server.addDiscovery(discovery)

// 3. Add REST resources selectively
const rest = await loadRestResources({ restDir: './src/rest' })
for (const resource of rest.resources) {
  if (resource.name !== 'internal') {
    server.addRest(resource)
  }
}

// 4. Add TCP handlers
const tcp = await loadTcpHandlers({ tcpDir: './src/tcp' })
for (const handler of tcp.handlers) {
  server.addTcpHandler(handler)
}

// 5. Add inline handlers
server.addProcedure({
  name: 'health.check',
  handler: async () => ({ status: 'ok', timestamp: Date.now() }),
})

await server.start()
```

### Available Methods

| Method | Description |
|:--|:--|
| `addProcedure(input)` | Add procedure handler |
| `addStream(input)` | Add stream handler |
| `addEvent(input)` | Add event handler |
| `addChannel(channel)` | Add WebSocket channel config |
| `addRest(resource)` | Add REST auto-CRUD resource |
| `addResource(resource)` | Add explicit resource handlers |
| `addTcpHandler(handler)` | Add TCP server handler |
| `addUdpHandler(handler)` | Add UDP server handler |
| `addDiscovery(result)` | Bulk add all from discovery |

---

## Protocol Adapters

```ts
createServer({ port: 3000 })
  .enableWebSocket('/ws')
  .enableJsonRpc('/rpc')
  .enableGraphQL('/graphql')
  .tcp({ port: 4000 })
  .grpc({ port: 50051, protoPath: './proto/app.proto', serviceNames: ['UserService'] })
```

---

## Events with Delivery Guarantees

```ts
server
  .event('payments.captured')
  .delivery('at-most-once')
  .deduplicationWindow(5 * 60 * 1000)
  .handler(async (payload) => {
    await reconcile(payload)
  })

server
  .event('orders.created')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 5, initialDelay: 1000, maxDelay: 30000 })
  .handler(async (payload, ctx, ack) => {
    await processOrder(payload)
    ack()
  })
```

---

## Streaming with Backpressure

```ts
server
  .stream('metrics.live')
  .handler(async function* () {
    while (true) {
      yield { cpu: getCpuUsage(), memory: getMemoryUsage() }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })
```

---

## Router Modules

```ts
import { createRouterModule, createServer } from 'raffel'

const users = createRouterModule('users')
users.procedure('create').handler(async () => ({ id: '1' }))
users.procedure('list').handler(async () => [])

const server = createServer({ port: 3000 })
server.mount('api', users)
// Registers: api.users.create, api.users.list
```

---

## Architecture

```
Client -> Adapter (HTTP/WS/TCP/JSON-RPC/gRPC/GraphQL) -> Envelope -> Core -> Handler
```

| Layer | Responsibility |
|:--|:--|
| Adapter | Protocol translation to/from envelope |
| Envelope | Unified message format across protocols |
| Core | Routing, interceptors, context |
| Handler | Business logic (procedure/stream/event) |

---

## Directory Structure

```
src/
├── http/                    # Procedures (discovery)
│   ├── _middleware.ts       # Middleware for all routes in dir
│   ├── _auth.ts             # Auth config for all routes
│   └── users/
│       ├── get.ts           # → users/get
│       └── update.ts        # → users/update
├── rpc/                     # JSON-RPC + gRPC procedures
│   └── UserService.Create.ts # → UserService.Create
├── channels/                # WebSocket pub/sub (manual wiring)
│   ├── chat-room.ts
│   └── presence-lobby.ts
├── streams/                 # Streaming handlers
│   └── logs/tail.ts
├── rest/                    # Manual loader (auto-CRUD)
│   └── users.ts
├── resources/               # Manual loader (explicit handlers)
│   └── products.ts
├── tcp/                     # Manual loader (custom TCP servers)
│   └── game-server.ts
└── udp/                     # Manual loader (custom UDP servers)
    └── metrics-collector.ts
```

---

## Documentation

Full docs: https://forattini-dev.github.io/raffel

## License

MIT
