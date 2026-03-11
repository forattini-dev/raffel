# DEVX Migration

Use this guide when your Raffel app still looks adapter-centric:

- HTTP-first setup
- auth stored in ambient request state
- `ctx.db` or other broad top-level capabilities
- docs and tests added after routes are already live

The target model is:

- scaffold from a preset
- inspect before start
- use canonical context in handlers
- debug through `inspect`, `explain`, `doctor`, and `playground`
- generate contract checks from the runtime graph

---

## Old vs New

### Old

```ts
server.http.get('/users/:id', async (_input, c) => {
  const user = c.get('user')
  const db = c.get('db')
  return db.users.findById(c.req.param('id'), user.tenantId)
})
```

### New

```ts
server
  .procedure('users.get')
  .input(z.object({ id: z.string() }))
  .output(UserSchema)
  .http('/users/:id', 'GET')
  .policy({ auth: { scopes: ['users:read'] } })
  .handler(async (_input, ctx) => {
    ctx.auth.require({ scopes: ['users:read'] })

    const services = ctx.services as {
      users: { getById(id: string, tenantId?: string): Promise<unknown> }
    }

    return services.users.getById(ctx.input.params.id, ctx.auth.tenantId)
  })
```

What changed:

- contract-first procedure instead of raw adapter route as the main path
- `ctx.auth` instead of ambient `user`
- `ctx.input.params` instead of transport-specific param parsing
- `ctx.services` instead of a broad top-level `db`
- policy attached to the contract instead of informal checks in the handler

---

## Migration Steps

### 1. Start From A Runtime Preview

Before moving handlers, snapshot what the service exposes today:

```bash
raffel inspect src/server.ts
raffel doctor src/server.ts
```

This gives you a baseline for:

- HTTP routes
- public gRPC surface
- missing auth
- missing output schemas
- legacy compatibility-surface usage

### 2. Move Shared Dependencies Into `ctx.services`

Avoid exposing broad mutable capabilities directly as the default handler API.

Prefer:

```ts
server.provide('users', async () => createUsersService())
server.provide('audit', async () => createAuditService())
```

Then consume them through:

```ts
const services = ctx.services as {
  users: UsersService
  audit: AuditService
}
```

### 3. Move Identity Into `ctx.auth`

Avoid:

- `c.get('user')`
- `req.user`
- free-form claims bags as the primary contract

Prefer:

```ts
ctx.auth.require({ roles: ['admin'] })
ctx.auth.principalId
ctx.auth.roles
ctx.auth.scopes
```

### 4. Normalize Input Through `ctx.input`

Avoid spreading transport logic through every handler.

Prefer:

- `ctx.input.params`
- `ctx.input.query`
- `ctx.input.body`
- `ctx.input.metadata`

That keeps the handler stable even when the same operation is exposed over more
than one protocol.

### 5. Replace Manual Debugging With Tooling

Use:

```bash
raffel explain "users.get" src/server.ts
raffel playground src/server.ts --port 4301
raffel contract-tests src/server.ts
```

Instead of:

- hand-written curl collections as the only source of truth
- protocol-by-protocol local debugging
- docs generated after the fact

---

## Checklist

- scaffold new modules from an official preset when possible
- register auth in middleware/interceptors, not per-adapter bags
- attach policies to contracts
- prefer canonical context in new handlers
- keep `inspect` and `doctor` clean before rollout
- use `playground` for live transport debugging
- run `contract-tests` when an operation spans transports

---

## Compatibility Notes

Compatibility surfaces still exist and may remain useful during migration:

- `c.get(...)`
- `c.set(...)`
- raw adapter namespaces
- legacy route surfaces

Treat them as transition tools. Do not make them the new default for fresh code.
