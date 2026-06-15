# Developer Experience

Raffel's DEVX golden path is built on one source of truth: the runtime
inspection graph.

The same graph feeds:

- `server.preview()`
- `raffel inspect`
- `raffel explain`
- `raffel doctor`
- `raffel playground`
- `raffel contract-tests`

That means the CLI, docs, playground, and contract automation all see the same
routes, procedures, channels, schemas, policies, and diagnostics.

Frameworks built on top of Raffel should extend that same graph instead of
building a separate runtime metadata model.

---

## Official Workflow

```bash
# optional, for a global CLI
npm i -g raffel

npx raffel new api my-service
cd my-service
pnpm install
npx raffel inspect src/server.ts
npx raffel explain "users.list" src/server.ts
npx raffel doctor src/server.ts
npx raffel playground src/server.ts --port 4301
npx raffel contract-tests src/server.ts
pnpm dev
```

Use this workflow in that order:

1. scaffold a service with a preset
2. inspect the runtime graph before listening
3. explain one subject when something looks wrong
4. run doctor to catch risky surface area
5. use the playground for live protocol calls
6. generate contract checks before CI or release

---

## Coverage Gate

```bash
pnpm run test:coverage:full
```

The full gate runs unit and integration tests together and applies a 90%
threshold to statements, branches, functions, and lines. Its include list is
explicit: deterministic core/runtime modules such as router/registry, policy
matching, runtime planning, validation, sanitizers, JSON server storage, docs UI
helpers, and shared utilities.

Use source-wide coverage reports for audit and prioritization. Do not treat
optional adapters, CLI tooling, protocol servers, or external-service
integrations as part of the release coverage gate unless their test environment
is also provisioned.

---

## Inspect

`raffel inspect` renders the canonical runtime preview:

```bash
raffel inspect src/server.ts
```

Use it to confirm:

- HTTP routes and methods
- GraphQL fields
- JSON-RPC procedures
- gRPC service/method bindings
- WebSocket channels and stream surfaces
- effective auth/timeouts/rate limits
- missing schemas or legacy-path warnings

If the runtime graph is wrong, fix that first. Do not debug downstream tooling
before the graph is clean.

---

## Framework Extensions

Frameworks can attach namespaced metadata to `server.preview()` via
`ServerPlugin.inspect()`.

```ts
server.usePlugin({
  name: 'purple',
  inspect: ({ preview }) => ({
    namespace: 'purple',
    title: 'Purple Runtime',
    nodes: [
      {
        id: 'purple:summary',
        kind: 'summary',
        label: 'Purple Summary',
        data: {
          operationCount: preview.operations.length,
        },
      },
    ],
  }),
})
```

That keeps framework DX tied to the canonical graph:

- app/runtime summaries come from one source of truth
- framework-specific CLIs can read `preview.extensions`
- future first-party tooling can consume the same extension surface

See [Framework Plugins](/tooling/framework-plugins.md).

---

## Explain And Doctor

Explain one subject:

```bash
raffel explain "users.profile" src/server.ts
raffel explain "GET /api/users/:id" src/server.ts
raffel explain "demo.Users.GetUser" src/server.ts
```

Run doctor:

```bash
raffel doctor src/server.ts --fail-on warning
```

Doctor checks are graph-driven, so they work before live traffic:

- missing auth on external HTTP/gRPC surface
- missing output schemas
- conflicting bindings
- legacy compatibility-surface usage

---

## Playground

The local playground is protocol-aware and backed by the same graph:

```bash
raffel playground src/server.ts --port 4301
```

It gives one local UI for:

- HTTP
- GraphQL
- JSON-RPC
- gRPC unary + streaming sessions
- TCP request/stream bindings
- UDP datagram handlers
- WebSocket channels
- stream sessions

Use it when you need one place to:

- edit headers and metadata
- inspect request payloads derived from schemas
- open long-lived gRPC or TCP sessions without switching tools
- probe raw UDP handlers from the same local UI used for contract surfaces
- test channel subscribe/publish flows
- inspect response payloads and live event sessions

---

## Contract Tests

Generate contract checks from runtime metadata:

```bash
raffel contract-tests src/server.ts
```

The generated suite derives checks such as:

- unauthorized access for protected surfaces
- authorized access expectations
- invalid-input checks from schemas
- cross-transport invariants for shared operations

This is especially useful when one operation is exposed over multiple
transports and you want the same auth, validation, and request-identity
expectations everywhere.

---

## OpenAPI And Mock Loops

Raffel's DEVX flow is not only about live servers. The same contract can also
feed docs and mocks.

Typical loop:

1. build the service
2. inspect the runtime graph
3. generate OpenAPI/USD from the same server
4. start a spec-driven mock server for downstream teams or local integration

```ts
import { createMockServer } from 'raffel'
import server from './server'

server.enableUSD({
  info: { title: 'Orders API', version: '1.0.0' },
})

const openapi = server.getOpenAPIDocument()
if (!openapi) throw new Error('OpenAPI unavailable')

await createMockServer({
  spec: openapi,
  port: 4100,
})
```

That keeps your docs, mock endpoints, and runtime surface tied to one source of
truth instead of three parallel setups.

---

## Canonical App Code

The DX tooling is strongest when app code stays on the canonical runtime
contract:

```ts
.handler(async (_input, ctx) => {
  ctx.auth.require({ scopes: ['orders:read'] })

  const services = ctx.services as {
    orders: { listByUser(userId: string): Promise<unknown[]> }
  }

  return services.orders.listByUser(ctx.auth.principalId!)
})
```

Prefer:

- `ctx.auth`
- `ctx.input`
- `ctx.services`
- `ctx.logger`
- `ctx.signal`

Avoid making these the default path in new code:

- `ctx.db`
- ambient `user` bags
- `c.get('user')`
- mutable request-local state as app architecture

---

## Presets

Use the closest official preset instead of building from an empty directory:

- `raffel new api`
- `raffel new realtime`
- `raffel new rpc`
- `raffel new gateway`
- `raffel new internal-service`

Each preset is opinionated on purpose. It reduces the number of decisions the
service author has to make before getting to a clean inspected runtime.
