# OpenID Connect (OIDC)

OIDC builds on OAuth2 with identity tokens and discovery.

---

## HTTP Module

```typescript
import { oidc, discoverOidcProvider } from 'raffel/http'

const provider = await discoverOidcProvider({
  issuer: 'https://accounts.google.com',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
})

app.use('/auth/*', oidc({
  providers: [provider],
  transactionSecret: process.env.OAUTH_TRANSACTION_SECRET,
  onSuccess: async (tokens, userInfo, _provider, c) => {
    c.set('user', userInfo)
    return c.redirect('/dashboard')
  },
}))
```

Raffel verifies ID-token signatures through the provider JWKS and validates the
issuer, audience, algorithm, expiry, and nonce. Back-channel logout tokens use
the same cryptographic verification, have a bounded age, and are protected
against replay.

---

## Core Strategy

```typescript
import { createOIDCStrategy, createAuthMiddleware } from 'raffel'

const oidc = createOIDCStrategy({
  issuer: 'https://accounts.google.com',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
  scopes: ['openid', 'email', 'profile'],
})

server.use(createAuthMiddleware({ strategies: [oidc] }))
```

---

## Pair with authorization policies

OIDC identifies the user; the [policy engine](/policies/README.md) authorizes their actions. Wire them together:

```ts
const server = createServer({
  port: 3000,
  policy: {
    principal: { from: 'oidc' },       // ← reads ctx.auth with OIDC claim conventions
    policies: [/* ... */],
  },
})
```

The OIDC adapter prefers OIDC-standard claims:

| Principal field | Sourced from |
|---|---|
| `id` | `claims.sub` (preferred) → `ctx.auth.principalId` → `ctx.auth.principal` |
| `tenantId` | `ctx.auth.tenantId` → `claims.tid` → `claims.org_id` |
| `scopes` | `ctx.auth.scopes` → `claims.scope` (space-split) |
| `groups` | `claims.groups` (preferred) → `claims.roles` → `ctx.auth.roles` |
| `attrs` | full `claims` |

Policies are [fully opt-in](/policies/README.md) — OIDC works with or without them configured.
