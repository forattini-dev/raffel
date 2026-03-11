# Multi-Protocol Service Example

This example shows the current happy path for a Raffel service:

- one contract
- multiple transports
- canonical runtime context
- inspection-first workflow

---

## Goal

Expose one `users.profile` capability over:

- HTTP
- JSON-RPC
- GraphQL
- WebSocket

Keep auth, input, logging, and services on the canonical context:

- `ctx.auth`
- `ctx.input`
- `ctx.services`
- `ctx.logger`
- `ctx.signal`

---

## Server

```ts
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
  createRequestIdInterceptor,
  createLoggingInterceptor,
  createZodAdapter,
  registerValidator,
} from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

type UserRecord = {
  id: string
  name: string
  email: string
}

type Services = {
  users: {
    getProfile(id: string): Promise<UserRecord>
  }
  audit: {
    write(event: string, payload: Record<string, unknown>): Promise<void>
  }
}

const server = createServer({
  port: 3000,
  host: '127.0.0.1',
  basePath: '/api',
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
  graphql: { path: '/graphql', playground: false },
})

server
  .provide('users', async () => ({
    async getProfile(id: string) {
      return { id, name: 'Ada Lovelace', email: 'ada@example.com' }
    },
  }))
  .provide('audit', async () => ({
    async write(event, payload) {
      console.log(event, payload)
    },
  }))

server.use(createRequestIdInterceptor())
server.use(createLoggingInterceptor())
server.use(createAuthMiddleware({
  strategies: [createBearerStrategy({
    verify: async (token) => {
      if (token !== 'dev-token') return null
      return {
        authenticated: true,
        principal: {
          type: 'user',
          id: 'usr_123',
          roles: ['member'],
          scopes: ['users:read'],
        },
      }
    },
  })],
}))

server
  .procedure('users.profile')
  .input(z.object({ id: z.string() }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
  }))
  .http('/users/:id', 'GET')
  .graphql({ type: 'query' })
  .policy({
    auth: { scopes: ['users:read'] },
    timeout: { timeoutMs: 2000 },
  })
  .handler(async (_input, ctx) => {
    ctx.auth.require({ scopes: ['users:read'] })

    const services = ctx.services as Services
    const id = ctx.input.params.id || String((ctx.input.body as { id?: string } | undefined)?.id ?? '')

    ctx.logger.info({
      requestId: ctx.requestId,
      principalId: ctx.auth.principalId,
      protocol: ctx.protocol,
    }, 'loading user profile')

    const profile = await services.users.getProfile(id)

    await services.audit.write('users.profile.read', {
      actorId: ctx.auth.principalId,
      targetUserId: id,
      protocol: ctx.protocol,
    })

    return profile
  })

server.ws.channel('presence-users', {
  type: 'presence',
  description: 'Presence updates for the users area',
  tags: ['presence'],
})

export default server
```

---

## Why This Example Is Canonical

It keeps transport-specific concerns out of the handler body.

The handler does not read:

- raw HTTP headers manually
- `c.get('user')`
- `ctx.db`
- mutable request-local bags

Instead it uses:

- `ctx.auth.require(...)`
- `ctx.input.params`
- `ctx.services`
- `ctx.logger`

That is the contract the rest of Raffel tooling understands best.

---

## Workflow

```bash
raffel inspect src/server.ts
raffel explain "users.profile" src/server.ts
raffel doctor src/server.ts --fail-on warning
raffel playground src/server.ts --port 4301
raffel contract-tests src/server.ts
```

What each step gives you:

- `inspect`: all transport bindings for `users.profile`
- `explain`: effective auth, schemas, and diagnostics for one subject
- `doctor`: warnings before live traffic
- `playground`: live HTTP, GraphQL, JSON-RPC, WebSocket, and stream testing
- `contract-tests`: derived unauthorized/authorized/invalid-input checks

---

## HTTP Call

```bash
curl http://127.0.0.1:3000/api/users/usr_123 \
  -H "Authorization: Bearer dev-token"
```

## JSON-RPC Call

```bash
curl http://127.0.0.1:3000/api/rpc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "users.profile",
    "params": { "id": "usr_123" }
  }'
```

## GraphQL Call

```bash
curl http://127.0.0.1:3000/api/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-token" \
  -d '{
    "query": "query { usersProfile(id: \"usr_123\") { id name email } }"
  }'
```

---

## Next

If you are migrating older code that relies on adapter-specific state, continue
with [DEVX Migration](/guides/devx-migration.md).
