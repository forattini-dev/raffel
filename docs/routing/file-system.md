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
- `src/http/posts/[[...slug]].ts` -> `posts/:slug*?`
- `src/http/posts/[[slug]].ts` -> `posts/:slug?`

For verb-convention HTTP handlers, `[...slug]` matches one or more path segments
and `[[...slug]]` also matches the route prefix with no remainder. The full
remainder is available as `ctx.params.slug`. If you want gRPC `service.method`
names, name the file with a dot. Outside the HTTP route plane, dynamic segments
remain part of the route name and are not interpreted by protocol adapters.

## Handler exports

Each handler file exports a default function and optional metadata.

```ts
import { z } from 'zod'

export const input = z.object({ id: z.string() })
export const output = z.object({ name: z.string() })

// The route remains executable, but is omitted from generated docs/contracts.
export const hidden = true

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

`hidden` is scoped to this request file. It removes the operation from USD,
OpenAPI, GraphQL, JSON-RPC, gRPC, and stream documentation projections without
disabling the runtime route. It is therefore not an authorization mechanism;
protect internal routes with authentication and policy as usual. The equivalent
long-form metadata is `meta: { docs: { hidden: true } }`.

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

## Schemas and metadata for HTTP procedures

Ordinary HTTP procedures discovered from `src/http`, `src/rpc`, and Routes Roots
carry their own input/output schemas and OpenAPI metadata. This is **not** the
same mechanism as REST Auto-CRUD (`src/rest/*.ts`, documented in
[`routing/auto-crud.md`](./auto-crud.md)). REST resource files derive every CRUD
operation from a single `export const schema`; discovered HTTP procedures attach
one `input`/`output` pair per handler file.

Everything is **inline in the handler file** — there is no separate `.meta.ts`
per handler and no `schema.input`/`schema.output` wrapper. (`schema` is reserved
for `.rest.ts` resource files.) The only sibling files that participate are a
`<handler>.md` description file and a directory-level `_meta.ts`; both are
covered below.

### Export convention

A handler file exports the schemas as named exports and everything else under
`meta`:

```ts
// src/http/users/create.ts
import { z } from 'zod'

// Input/output schemas — named exports, top-level (NOT under `meta`)
export const input = z.object({
  name: z.string().min(2),
  email: z.string().email(),
})

export const output = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
})

export const meta = {
  summary: 'Create a user',
  description: 'Creates a user account and returns the persisted record.',
  tags: ['Users'],
  auth: 'required',
  roles: ['admin'],
  httpSuccessStatus: 201,
}

export default async function handler(input, ctx) {
  const user = await ctx.services.users.create(input)
  return user
}
```

`export const input` / `export const output` are the exact names read by the
loader. It maps them onto the route as `inputSchema`/`outputSchema`, and at
registration time they are entered into the shared `SchemaRegistry` under the
route name (e.g. `users/create`). The OpenAPI generator then looks the route up
by name (`schemaRegistry.get('users/create')`), so the schemas surface as the
request body / response schema and, for path/query params, as parameters. No
input schema means the endpoint is still generated without typed request data.

### Automatic TypeScript response inference

For an on-disk TypeScript procedure route, `output` is optional for structural
documentation. When it is absent, Raffel uses the project's TypeScript program
to inspect the default handler's awaited return type and converts that type to
JSON Schema for USD/OpenAPI:

```ts
// src/http/health/get.ts
export default async function handler() {
  return {
    healthy: true,
    service: 'accounts',
    checks: [{ name: 'database', ok: true }],
  }
}
```

The generated response schema includes `healthy`, `service`, and the nested
`checks` item shape without requiring `export const output`. Inference supports
primitives, objects, arrays, tuples, imported TypeScript types, optional fields,
literal unions/enums, and `Date`.

An explicit `output` always wins. It is still required when the response should
be validated at runtime or the contract needs information TypeScript types do
not carry, such as examples, validator-native formats, refinements, or numeric
and string constraints. Inferred schemas are documentation-only and never
enable an output validation interceptor. Property JSDoc is preserved as the
field description when available.

Inference falls back to the generic `object` response for `any`, `unknown`, HTTP
`Response` wrappers, unrepresentable dynamic types, virtual discovery sources,
and deployments where only compiled JavaScript is available. Keep an explicit
`output` for those cases.

For discovered GET routes, a property whose name matches a dynamic file-system
segment becomes a required path parameter; the remaining properties become
query parameters. Zod properties are required by default and `.optional()`
makes them optional. Descriptions, examples, defaults, enums, formats, patterns,
and numeric/string limits remain part of both the USD and OpenAPI contracts and
are rendered by the documentation UI:

```ts
// src/http/clients/[clientId]/get.ts
import { z } from 'zod'

export const input = z.object({
  clientId: z.string()
    .uuid()
    .describe('Client identifier')
    .meta({ examples: ['2f7db329-7616-4fe2-bf3b-f9600046b198'] }),

  after: z.string()
    .min(3)
    .optional()
    .describe('Use the `endCursor` returned by the previous page.')
    .meta({ examples: ['cursor_123'] }),

  limit: z.coerce.number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Maximum number of clients to return.'),
})

export default async function handler(input, ctx) {
  return ctx.services.clients.find(input)
}
```

`.meta({ examples: [...] })` uses Zod 4 metadata. `.describe()` works with Zod
3 and 4. A path parameter is always required by OpenAPI; model an optional
identifier as a separate route or as a query parameter.

Remember to register a validator adapter once at startup (see
[Schemas and validators](#schemas-and-validators)); without it the schemas are
documented but not enforced at request time.

### Documentation metadata

`meta` fields consumed by the OpenAPI generator:

| Field | Purpose |
| --- | --- |
| `summary` | One-line title shown on the endpoint card. Falls back to the route name when omitted. |
| `description` | Long description (markdown). Can also come from a sibling `.md` file — see below. |
| `tags` | Grouping tags. The nearest `_meta.ts` `tag` is prepended automatically. |
| `contentType` / `contentTypes` | Request/response content-type hints. |

A sibling markdown file named after the handler is loaded automatically as the
`description`, and **takes precedence** over `meta.description`:

```
src/http/users/
  create.ts
  create.md   # becomes the OpenAPI description for POST /users
```

Directory-level metadata lives in `_meta.ts` and groups every endpoint in that
tree under one tag:

```ts
// src/http/users/_meta.ts
export default {
  tag: 'Users',
  summary: 'User management',
  description: '## User Management API\n\nCRUD operations for user accounts.',
  order: 10,
}
```

The `_meta.ts` `tag` is added to each handler's `tags` automatically, so you
only need `meta.tags` on a handler when it belongs to an additional group.

### Auth requirement

`meta.auth` sets the authentication requirement on the procedure:

- `'required'` — request must be authenticated
- `'optional'` — auth is checked when present but not required
- `'none'` — no auth check (default)

`meta.roles` restricts to specific roles when auth is `'required'` or
`'optional'`. The directory-tree `_auth.ts` (see [Authentication](#authentication))
supplies the strategy that verifies the credential. Authorization beyond simple
role checks (tenant scoping, ownership, permissions) belongs in Raffel policies
— either co-located `<handler>.policy.yaml` files or `.authz()` — not in `meta`.

### Same endpoint: HTTP procedure vs REST Auto-CRUD

The same `POST /users` can be modeled either way. Pick the discovered HTTP
procedure when the operation is bespoke; pick REST Auto-CRUD when you want the
full CRUD surface generated from one schema.

```ts
// Discovered HTTP procedure — src/http/users/create.ts
import { z } from 'zod'

export const input = z.object({ name: z.string(), email: z.string().email() })
export const output = z.object({ id: z.string(), name: z.string() })
export const meta = { summary: 'Create a user', auth: 'required', httpSuccessStatus: 201 }

export default async (input, ctx) => ctx.services.users.create(input)
```

```ts
// REST Auto-CRUD — src/rest/users.ts (generates list/get/create/update/delete)
import { z } from 'zod'

export const schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2),
  email: z.string().email(),
})

export const adapter = prisma.user

export const config = {
  operations: ['list', 'get', 'create'],
  auth: { create: 'required' },
}
```

Key differences:

- **Schema shape.** HTTP procedures declare `input`/`output` per file; REST
  resources declare one `schema` and derive request/response shapes per
  operation.
- **Surface.** One HTTP file = one endpoint; one REST file = the whole CRUD set
  plus optional actions.
- **Persistence.** REST Auto-CRUD wires an `adapter`; discovered HTTP procedures
  call whatever you write in the handler body.

See [`routing/auto-crud.md`](./auto-crud.md) for the full REST resource surface.

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
import { z } from 'zod'

export const input = z.object({ service: z.string().min(1) })
export const output = z.object({ line: z.string(), timestamp: z.string().datetime() })
export const meta = {
  direction: 'server' as const,
  description: 'Follow service logs until the client disconnects.',
  tags: ['Logs'],
}

export default async function* handler(input, ctx) {
  const connection = await tailLogs(input.service)
  try {
    for await (const line of connection) {
      if (ctx.signal.aborted) break
      yield { line, timestamp: new Date().toISOString() }
    }
  } finally {
    await connection.close()
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
