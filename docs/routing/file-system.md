# File-System Discovery

Raffel can auto-discover handlers from the filesystem. It maps folders and filenames
into literal handler names and registers procedures and streams for you.

Important notes:
- Route names are literal strings; dynamic segments are converted (e.g. `[id]` -> `:id`) but not extracted at runtime.
- Discovery registers procedures and streams. Events are still manual.
- Channels, REST resources, resource handlers, GraphQL resources, TCP, and UDP handlers are auto-registered when you use server discovery or `addDiscovery`.
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
  domains/*/routes/ # Routes Root entries for domain-owned handlers
  http/        # HTTP procedures
  rpc/         # JSON-RPC + gRPC procedures
  streams/     # Stream handlers
  channels/    # WebSocket channel configs
  rest/        # REST resources
  resources/   # Resource handlers
  graphql/     # GraphQL resource files (*.graphql.ts)
  tcp/         # TCP handlers
  udp/         # UDP handlers
```

## Routes Root

Use `discovery.routes` when handlers live inside domain folders instead of
protocol-specific top-level directories. Each Routes Root has an explicit
`prefix`; the prefix is applied to public HTTP paths and also scopes internal
operation names.

```ts
const server = createServer({
  discovery: {
    routes: [
      { dir: './src/domains/leads/routes', prefix: '/api/v1/leads' },
      { dir: './src/domains/:domain/routes', prefix: '/api/v1/:domain' },
      { dir: './src/areas/*/routes', params: ['area'], prefix: '/admin/:area' },
    ],
  },
})
```

Ordinary files in a Routes Root use the same HTTP verb convention as
`src/http`: `notifications/get.ts` becomes `GET /api/v1/leads/notifications`
for the first root above. The internal operation name is prefixed as well,
for example `api/v1/leads/notifications/get`.

Routes Root prefixes are concatenated with file-derived paths without
deduplicating repeated segments for ordinary HTTP handlers. A prefix of `/`
behaves as no prefix.

`.rest.ts` is reserved for REST Resource Files and is not treated as an
ordinary HTTP handler.

Example:

```
src/
  domains/
    leads/
      routes/
        notifications.rest.ts
```

With `{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }`,
`notifications.rest.ts` defines the `notifications` REST resource at
`/api/v1/leads/notifications`. The filename is just the resource anchor; use
any resource name that matches your domain.

For domain roots where the prefix already ends in the resource segment, the
REST anchor is mounted at the prefix root instead of repeating the segment:

```ts
discovery: {
  routes: [{ dir: './src/domains/:domain/routes', prefix: '/api/v1/:domain' }],
}
```

In that layout, `src/domains/leads/routes/leads.rest.ts` mounts at
`/api/v1/leads`, not `/api/v1/leads/leads`. You can also use `index.rest.ts`
to mount a REST Resource File at the Routes Root prefix.

REST Resource Files can coexist with ordinary route files and same-named
directories:

```
routes/
  notifications.rest.ts
  notifications.ts
  notifications/
    export/
      post.ts
    [id]/
      archive/
        post.ts
```

The REST resource operations take precedence for the same method/path. Same-name
files or directories are composed as resource actions only when they do not
shadow a generated REST operation. Set `config.compose = false` in the
`.rest.ts` file to keep same-named files as ordinary discovered routes.

Use composed actions as an escape hatch for commands or state transitions.
Prefer subresources when the domain concept is a noun; use actions for commands
such as `archive`, `retry`, `publish`, or `cancel`.

Routes Root HTTP handlers, `.rest.ts` Resource Anchors, and composed actions can
use either Raffel's procedure-style signature or the native HTTP-style context:

```ts
// routes/notifications/export/post.ts
export default async function handler(input, ctx) {
  return { exported: true, query: ctx.input.query }
}

// routes/notifications/[id]/archive/post.ts
export default async function handler(c) {
  const body = await c.req.json()
  return c.json({ id: c.req.param('id'), reason: body.reason })
}
```

The HTTP-style `c` exposes `c.req.param/query/header/json()` and response helpers
such as `c.json()`, `c.text()`, `c.html()`, `c.redirect()`, and `c.newResponse()`.
It also carries `c.runtime`, the canonical Raffel context used by auth,
policies, tracing, deadlines, and providers. For TypeScript, annotate procedure-style
handlers with `ProcedureHandlerFunction` (or the backwards-compatible
`HandlerFunction` alias) and HTTP-style handlers with `HttpHandlerFunction`:

```ts
import type { HttpHandlerFunction, ProcedureHandlerFunction } from 'raffel'

const procedureHandler: ProcedureHandlerFunction = async (input, ctx) => {
  return { ok: true, query: ctx.input.query }
}

const httpHandler: HttpHandlerFunction = async (c) => {
  return c.json({ ok: true })
}

export default procedureHandler
```

Do not annotate a concrete function with a union of both signatures. TypeScript
cannot contextually type parameters against incompatible call-signature unions
under `strict`/`noImplicitAny`, so a single-parameter procedure handler should use
`ProcedureHandlerFunction`/`HandlerFunction`, and an HTTP-facade handler should
use `HttpHandlerFunction`.

For HTTP path overrides and Routes Root resource/action routes, path params are
available separately as `ctx.input.params` (and `ctx.params` on HTTP contexts).
Raffel also flattens path params into the procedure `input` for compatibility
with resource-style handlers. If a request body/query key collides with a path
param, the path param wins in the flattened `input`; the original request body
stays available as `ctx.input.body` or `c.req.json()` in HTTP-style handlers.

## GraphQL Resources

GraphQL resource discovery is independent from REST resource discovery. A
`leads.rest.ts` file generates RESTful HTTP endpoints; a `leads.graphql.ts`
file contributes GraphQL object types, root fields, relations, pagination args,
and policy checks to the generated GraphQL schema.

```ts
const server = createServer({
  discovery: {
    graphql: [
      { dir: './src/domains/leads/graphql', namespace: 'crm' },
      { dir: './src/domains/users/graphql', namespace: 'identity' },
    ],
  },
  graphql: '/graphql',
})
```

`discovery: true` scans `./src/graphql` by default. For domain-driven projects,
configure multiple `discovery.graphql` entries. `namespace` is logical metadata
for diagnostics and future inspection; it is not a public URL prefix.

GraphQL resource files use the `graphqlResource` helper:

```ts
import { z } from 'zod'
import { graphqlResource } from 'raffel/graphql'

export default graphqlResource({
  name: 'Lead',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    tenantId: z.string(),
  }),
  queries: {
    list: {
      field: 'leads',
      many: true,
      pagination: { style: 'offset', defaultLimit: 25, maxLimit: 100 },
      resolver: (_parent, args, ctx) => ctx.services.leads.list(args),
    },
  },
})
```

See [GraphQL Adapter](/protocols/graphql.md#resource-discovery) for relations,
policy integration, and pagination behavior.

GraphQL resources can also carry co-located policies. Place
`<resource>.graphql.policy.yaml` next to `<resource>.graphql.ts`, or use
`_policy.yaml` higher in the GraphQL discovery tree. The policy file is loaded
into Raffel's policy engine; each GraphQL field still opts into enforcement
with `authorize` or `authz` so the resolver can provide the exact
`action`/`resource` pair.

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

For HTTP routes discovered from `src/http` or `discovery.routes`, the default
export may also be an HTTP-style handler:

```ts
import type { HttpHandlerFunction } from 'raffel'

const handler: HttpHandlerFunction = async (c) => {
  return c.json({ id: c.req.param('id') })
}

export default handler
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

`addRest`/`addResource` register procedures using `resourceName.operation` and
expose them on the HTTP plane automatically: each operation is wired with the
generated method/path (e.g. `users.get` → `GET /users/:id`) and follows REST
conventions for success status codes (`POST` create → `201`, `DELETE` →
`204`). You can still consume the generated `routes` metadata if you need
custom routing.

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
