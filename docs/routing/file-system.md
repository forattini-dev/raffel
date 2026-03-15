# File-System Discovery

Raffel can auto-discover handlers from the filesystem. It maps folders and filenames
into literal handler names and registers procedures and streams for you.

Important notes:
- Route names are literal strings; dynamic segments are converted (e.g. `[id]` -> `:id`) but not extracted at runtime.
- Discovery registers procedures and streams. Events are still manual.
- Channels, REST resources, resources, TCP, and UDP handlers are auto-registered when you use server discovery or `addDiscovery`.
- `_middleware` `matcher`/`exclude` patterns are applied with a simple `*` wildcard.

## Quick start

```ts
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  discovery: true,
})

await server.start()
```

## Directory layout

Default directories:

```
src/
  http/        # HTTP procedures
  rpc/         # JSON-RPC + gRPC procedures
  streams/     # Stream handlers
  channels/    # WebSocket channel configs
  rest/        # REST resources
  resources/   # Resource handlers
  tcp/         # TCP handlers
  udp/         # UDP handlers
```

## Route naming

Routes are derived from the file path and are **not** transformed. The adapter
uses the exact name you registered.

Examples:

- `src/http/users/get.ts` -> `users/get`
- `src/rpc/users/create.ts` -> `users/create`
- `src/rpc/UserService.Create.ts` -> `UserService.Create`
- `src/streams/logs/tail.ts` -> `logs/tail`
- `src/http/users/[id]/get.ts` -> `users/:id/get`
- `src/http/posts/[...slug].ts` -> `posts/:slug*`
- `src/http/posts/[[slug]].ts` -> `posts/:slug?`

If you want gRPC `service.method` names, name the file with a dot. Dynamic segments
are part of the route name only; adapters do not extract params.

## Handler exports

Each handler file exports a default function and optional metadata.

```ts
import { z } from 'zod'

export const input = z.object({ id: z.string() })
export const output = z.object({ name: z.string() })

export const meta = {
  description: 'Fetch a user',
  auth: 'required',
  roles: ['admin'],
  rateLimit: { limit: 10, window: 60_000 },
}

export default async function handler(input, ctx) {
  return { name: `user-${input.id}` }
}
```

### Schemas and validators

If you use schemas, register a validator adapter once at startup:

```ts
import { z } from 'zod'
import { createZodAdapter, registerValidator } from 'raffel'

registerValidator(createZodAdapter(z))
```

## Middleware

`_middleware.ts` files apply to all handlers in the same directory tree,
from root to leaf.

```ts
// src/http/_middleware.ts
export default async function middleware(ctx, next) {
  const start = Date.now()
  const result = await next()
  console.log(`took ${Date.now() - start}ms`)
  return result
}
```

`matcher` and `exclude` are supported with a simple `*` wildcard match. Example:

```ts
export const matcher = ['users/*']
export const exclude = ['users/internal/*']
```

## Authentication

Add `_auth.ts` to configure auth for a directory tree. Handlers use
`meta.auth` to request auth.

```ts
// src/http/_auth.ts
export default {
  strategy: 'bearer',
  verify: async (token) => ({ principal: token, roles: ['user'] }),
}
```

Supported strategies:
- `bearer` (reads `authorization` header)
- `api-key` (reads `x-api-key` header)
- custom function `(credential, ctx) => AuthResult`

## Streams

Stream handlers live in `src/streams` and can be `server`, `client`, or `bidi`.

```ts
// src/streams/logs/tail.ts
export const meta = { direction: 'server' }

export default async function* handler(input, ctx) {
  for await (const line of tailLogs(input.service)) {
    yield { line }
  }
}
```

Client and bidirectional streams receive an async iterable input:

```ts
// src/streams/uploads/ingest.ts
export const meta = { direction: 'client' }

export default async function handler(chunks, ctx) {
  let count = 0
  for await (const chunk of chunks) {
    count += 1
  }
  return { received: count }
}
```

## Channels

Channel files are loaded from `src/channels` and auto-registered when discovery
is enabled or when you call `addDiscovery`.

```ts
// src/channels/presence-lobby.ts
import { z } from 'zod'

export const auth = 'required'
export const events = {
  message: { input: z.object({ text: z.string() }) },
}
```

If a channels directory contains `_auth.ts`, Raffel applies the closest auth
config when authorizing subscriptions for channels in that directory.

## Manual loading

You can load discovery results and register them manually (includes channels,
REST/resources, and TCP/UDP handlers).

```ts
import { createServer, loadDiscovery } from 'raffel'

const server = createServer({ port: 3000 })
const result = await loadDiscovery({ discovery: true })

server.addDiscovery(result)
```

Note: loader APIs live under `server/fs-routes` in this repo and are also
exported from the package entrypoint.

## REST + resources loaders

Raffel also ships loaders for REST-style resources and TCP/UDP handlers. These
can be used directly when you want to opt out of full discovery.

```ts
import { loadRestResources, loadResources, loadTcpHandlers, loadUdpHandlers } from 'raffel'

const rest = await loadRestResources({ restDir: './src/rest' })
for (const resource of rest.resources) {
  server.addRest(resource)
}

const resources = await loadResources({ resourcesDir: './src/resources' })
for (const resource of resources.resources) {
  server.addResource(resource)
}

const tcp = await loadTcpHandlers({ tcpDir: './src/tcp' })
for (const handler of tcp.handlers) {
  server.addTcpHandler(handler)
}

const udp = await loadUdpHandlers({ udpDir: './src/udp' })
for (const handler of udp.handlers) {
  server.addUdpHandler(handler)
}
```

`addRest`/`addResource` register procedures using `resourceName.operation`.
You can also use the generated `routes` metadata to build custom routing.

## Hot reload

Hot reload is enabled by default in development. You can control it with
`hotReload` and access the watcher via `server.discoveryWatcher`.

```ts
const server = createServer({
  port: 3000,
  discovery: true,
  hotReload: true,
})

await server.discoveryWatcher?.reload()
```
