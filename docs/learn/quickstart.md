# Quickstart

The official Raffel flow in 2026 is:

1. Scaffold from a preset.
2. Inspect the runtime before start.
3. Explain and doctor the exposed surface.
4. Use the local playground for live protocol calls.
5. Generate contract checks from the same graph.

---

## Scaffold First

```bash
# optional, for a global CLI
npm i -g raffel

npx raffel new api my-service
cd my-service
pnpm install
npx raffel inspect src/server.ts
npx raffel doctor src/server.ts
npx raffel playground src/server.ts --port 4301
npx raffel contract-tests src/server.ts
pnpm dev
```

The generated project already includes:

- auth middleware
- request IDs and logging
- health route
- docs/USD wiring
- starter tests
- package scripts as shortcuts, with the Raffel CLI as the official workflow

---

## Why This Flow

Raffel is not just an HTTP router. The same service contract can fan out to
HTTP, WebSocket, JSON-RPC, GraphQL, gRPC, TCP, UDP, streams, and channels.

That is why the recommended workflow starts with runtime inspection instead of
immediately opening a port:

- `raffel inspect` shows routes, procedures, channels, schemas, transports, and policies
- `raffel explain` answers why one surface exists or is missing
- `raffel doctor` catches missing auth, missing schemas, and legacy surfaces
- `raffel playground` gives one local UI for HTTP, GraphQL, JSON-RPC, gRPC, TCP, UDP, channels, and streams
- `raffel contract-tests` generates contract checks from the same runtime metadata

---

## Minimal Manual Server

If you want to start without scaffolding, keep the happy path explicit:

```ts
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

type UserServices = {
  users: {
    getById(id: string): Promise<{ id: string; name: string }>
  }
}

const server = createServer({
  port: 3000,
  basePath: '/api',
})

server
  .provide('users', async () => ({
    async getById(id: string) {
      return { id, name: 'Ada' }
    },
  }))

server
  .procedure('users.get')
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .http('/users/:id', 'GET')
  .policy({ auth: { scopes: ['users:read'] } })
  .handler(async (_input, ctx) => {
    ctx.auth.require({ scopes: ['users:read'] })

    const services = ctx.services as UserServices
    const id = ctx.input.params.id || String((ctx.input.body as { id?: string } | undefined)?.id ?? '')
    return services.users.getById(id)
  })

export default server
```

Then run:

```bash
raffel inspect src/server.ts
raffel explain "users.get" src/server.ts
raffel doctor src/server.ts --fail-on warning
raffel playground src/server.ts --port 4301
raffel contract-tests src/server.ts
```

---

## Spec-Driven Mocks

When another team needs your HTTP surface before the real service is deployed,
use the OpenAPI/USD output to spin up mocks from the same contract.

```ts
import { createMockServer } from 'raffel'
import server from './src/server'

server.enableUSD({
  info: { title: 'Users API', version: '1.0.0' },
})

const openapi = server.getOpenAPIDocument()
if (!openapi) throw new Error('OpenAPI unavailable')

await createMockServer({
  spec: openapi,
  port: 4100,
})
```

That way:

- the documented endpoints stay aligned with the mocked endpoints
- request validation still comes from the schema
- examples and generated fake data come from the same contract

---

## Canonical Context

Prefer the canonical runtime context in new code:

```ts
.handler(async (_input, ctx) => {
  const principal = ctx.auth.require({ roles: ['admin'] })

  ctx.logger.info({
    requestId: ctx.requestId,
    principalId: ctx.auth.principalId,
    protocol: ctx.protocol,
  }, 'handling request')

  return {
    principalId: typeof principal === 'string' ? principal : principal.id,
    params: ctx.input.params,
    query: ctx.input.query,
    metadata: ctx.input.metadata,
  }
})
```

Prefer:

- `ctx.auth`
- `ctx.input`
- `ctx.services`
- `ctx.logger`
- `ctx.signal`

Treat these as compatibility surfaces, not the main path:

- `c.get(...)`
- `c.set(...)`
- ad hoc request-local bags
- auth state injected as loose `user` objects

---

## What To Read Next

- [Developer Experience](/tooling/dx.md)
- [Mock Server](/tooling/mock-server.md)
- [Procedures (RPC)](/core/procedures.md)
- [Multi-Protocol Service Example](/guides/multi-protocol-service.md)
- [DEVX Migration](/migration/devx.md)
