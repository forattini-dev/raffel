# Bearer / JWT

Bearer tokens are the most common auth mechanism for APIs and microservices.
Use `createBearerStrategy` for Raffel core and `bearerAuth` for the HTTP module.

---

## Core Server (All Protocols)

```typescript
import { createAuthMiddleware, createBearerStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        const payload = await verifyJwt(token)
        if (!payload) return null
        return { authenticated: true, principal: payload.sub, claims: payload }
      },
      headerName: 'authorization', // default
      tokenPrefix: 'Bearer ',       // default
    }),
  ],
})
```

Apply per procedure or globally:

```typescript
server.use(auth)
```

---

## HTTP Module

```typescript
import { bearerAuth } from 'raffel/http'

app.use('/api/*', bearerAuth({
  verifyToken: async (token) => {
    const payload = await verifyJwt(token)
    return payload ?? null
  },
  prefix: 'Bearer',          // default
  headerName: 'authorization',
  queryParam: 'access_token',
  contextKey: 'auth',
}))
```

---

## API Key via Bearer Prefix

```typescript
app.use('/api/*', bearerAuth({
  prefix: 'ApiKey',
  verifyToken: async (apiKey) => {
    return await verifyApiKey(apiKey)
  },
}))
```

---

## JWKS Verifier

`createJWKSVerifier` creates a reusable JWT verifier backed by a remote JWKS endpoint (e.g., Auth0, Keycloak, Google). Keys are fetched, cached, and rotated automatically using `jose`.

### Standalone usage

```typescript
import { createJWKSVerifier } from 'raffel'

const jwks = createJWKSVerifier({
  jwksUri: 'https://my-tenant.auth0.com/.well-known/jwks.json',
  issuer: 'https://my-tenant.auth0.com/',
  audience: 'https://api.myapp.com',
})

const claims = await jwks.verify(token)
console.log(claims.sub, claims.email)
```

### Composed with Bearer strategy

```typescript
import { createBearerStrategy, createAuthMiddleware, createJWKSVerifier } from 'raffel'

const jwks = createJWKSVerifier({
  jwksUri: 'https://my-tenant.auth0.com/.well-known/jwks.json',
  issuer: 'https://my-tenant.auth0.com/',
  audience: 'https://api.myapp.com',
})

server.use(createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        try {
          const claims = await jwks.verify(token)
          return { authenticated: true, principal: claims.sub as string, claims }
        } catch {
          return null
        }
      },
    }),
  ],
}))
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `jwksUri` | `string` | — | JWKS endpoint URL (required) |
| `issuer` | `string \| string[]` | — | Expected `iss` claim |
| `audience` | `string \| string[]` | — | Expected `aud` claim |
| `algorithms` | `string[]` | `['RS256', 'ES256']` | Allowed signing algorithms |
| `clockTolerance` | `string \| number` | — | Tolerance for `exp`/`nbf` validation |
| `timeoutMs` | `number` | `5000` | JWKS fetch timeout |
| `cacheMaxAge` | `number` | `300000` (5 min) | How long to cache JWKS keys |
| `cooldownDuration` | `number` | `30000` (30s) | Cooldown between fetch retries after failures |

### Cache management

```typescript
// Force re-fetch on next verify call
jwks.clearCache()
```
