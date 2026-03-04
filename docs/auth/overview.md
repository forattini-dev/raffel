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
| Client Credentials | Machine-to-machine (M2M) | [OAuth2 → Client Credentials](oauth2.md#client-credentials) |
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

---

## Helpers & Interceptors

| Name | Type | Description |
|:-----|:-----|:------------|
| `createJWKSVerifier` | Helper | JWKS-backed JWT verifier with caching ([Bearer → JWKS](bearer.md#jwks-verifier)) |
| `createRefreshInterceptor` | Interceptor | Automatic access token refresh via httpOnly cookie ([OAuth2 → Refresh](oauth2.md#refresh-interceptor)) |
| `generateState()` | Utility | Generate CSRF state for OAuth2 flows |
| `generateNonce()` | Utility | Generate nonce for OIDC flows |
| `requireAuth(ctx)` | Utility | Returns `AuthContext`, throws `UNAUTHENTICATED` if not authenticated |
| `hasRole(ctx, role)` | Utility | Returns `true` if user has the role |
| `hasAnyRole(ctx, roles)` | Utility | Returns `true` if user has any of the roles |
| `hasAllRoles(ctx, roles)` | Utility | Returns `true` if user has all roles |
