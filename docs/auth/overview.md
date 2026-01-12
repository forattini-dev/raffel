# Authentication Overview

Raffel provides a protocol-agnostic auth layer via interceptors and strategy helpers.
You can attach auth globally or per-procedure and it works across HTTP, WebSocket,
JSON-RPC, gRPC, GraphQL, TCP, and UDP.

---

## Quick Start

```typescript
import { createServer, createAuthMiddleware, createBearerStrategy } from 'raffel'

const server = createServer({ port: 3000 })

const auth = createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        const payload = await verifyJwt(token)
        if (!payload) return null
        return { authenticated: true, principal: payload.sub, claims: payload }
      },
    }),
  ],
})

server.procedure('health.check').handler(async () => ({ ok: true }))

server
  .procedure('users.me')
  .use(auth)
  .handler(async (_input, ctx) => ({ userId: ctx.auth?.principal }))
```

---

## Strategies

| Strategy | Use Case | Docs |
|:---------|:---------|:-----|
| Bearer / JWT | Stateless APIs | [Bearer](bearer.md) |
| API Key | Service-to-service | [API Key](api-key.md) |
| OAuth2 | Third-party login | [OAuth2](oauth2.md) |
| OpenID Connect | Enterprise SSO | [OIDC](oidc.md) |
| Session | Cookies | [Sessions](sessions.md) |

---

## Multiple Strategies

```typescript
import { createAuthMiddleware, createBearerStrategy, createApiKeyStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategies: [
    createBearerStrategy({ verify: verifyJwt }),
    createApiKeyStrategy({ verify: verifyApiKey }),
  ],
  publicProcedures: ['health.check'],
})
```

The middleware tries each strategy until one returns an auth result.

---

## Auth Context

After authentication, `ctx.auth` follows this shape:

```ts
interface AuthContext {
  authenticated: boolean
  principal?: string
  claims?: Record<string, unknown>
}
```

If you return `roles` from a strategy, Raffel stores them in `claims.roles`.

---

## Authorization (RBAC)

Use the built-in authorization middleware for role-based access:

```typescript
import { createAuthzMiddleware } from 'raffel'

const authz = createAuthzMiddleware({
  rules: [
    { procedure: 'admin.*', roles: ['admin'] },
    { procedure: 'billing.*', roles: ['finance', 'admin'] },
  ],
})

server.procedure('admin.users.list').use(auth).use(authz).handler(...)
```

Helper utilities:

```typescript
import { Errors, requireAuth, hasRole } from 'raffel'

server.procedure('users.me').use(auth).handler(async (_input, ctx) => {
  const authContext = requireAuth(ctx)
  if (!hasRole(ctx, 'user')) {
    throw Errors.forbidden('User role required')
  }
  return { userId: authContext.principal }
})
```
