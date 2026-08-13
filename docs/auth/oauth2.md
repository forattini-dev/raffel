# OAuth2

Raffel supports OAuth2 for third-party login and API access.
Use the HTTP middleware for web flows or the core strategy for protocol-agnostic use.

---

## HTTP Module (Web Flow)

```typescript
import { oauth2 } from 'raffel/http'

app.use('/auth/*', oauth2({
  transactionSecret: process.env.OAUTH_TRANSACTION_SECRET,
  providers: [
    {
      name: 'github',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scopes: ['read:user', 'user:email'],
    },
  ],
  onSuccess: async (tokens, provider, c) => {
    // Persist tokens + create session
    return c.redirect('/dashboard')
  },
}))
```

The web flow stores state and PKCE data in a short-lived signed HttpOnly cookie.
Use HTTPS outside loopback. If TLS terminates at a trusted reverse proxy, set
`transactionCookie: { secure: true }` explicitly.

---

## Core Strategy (Protocol-Agnostic)

```typescript
import { createOAuth2Strategy, createAuthMiddleware } from 'raffel'

const oauth2 = createOAuth2Strategy({
  provider: 'github',
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
  scopes: ['read:user', 'user:email'],
})

server.use(createAuthMiddleware({ strategies: [oauth2] }))

// Build your auth endpoints
server.procedure('auth.login').handler(async () => ({
  url: oauth2.getAuthorizationUrl({ state: createState() }),
}))

server.procedure('auth.callback').handler(async ({ code }) => {
  const tokens = await oauth2.exchangeCode(code)
  return { tokens }
})
```

---

## Provider Presets

Raffel ships with shortcuts for popular providers:

```typescript
import { createGoogleOAuth2Strategy, createGitHubOAuth2Strategy } from 'raffel'
```

---

## Client Credentials

`createClientCredentialsStrategy` handles machine-to-machine (M2M) authentication via the OAuth2 client credentials grant. It has a dual role:

1. **Inbound**: validates `Authorization: Basic <base64>` headers against known client ID/secret pairs
2. **Outbound**: exchanges credentials for access tokens at a token endpoint (with automatic caching)

### Setup

```typescript
import { createClientCredentialsStrategy, createAuthMiddleware } from 'raffel'

const m2m = createClientCredentialsStrategy({
  tokenEndpoint: 'https://auth.example.com/oauth/token',
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  scopes: ['read', 'write'],
})

// Validate inbound Basic auth from other services
server.use(createAuthMiddleware({ strategies: [m2m] }))
```

### Outbound token exchange

```typescript
// Acquire a cached token for calling another service
const tokens = await m2m.exchangeClientCredentials()
console.log(tokens.accessToken, tokens.expiresIn)

// Request with specific scopes
const tokens = await m2m.exchangeClientCredentials(['read:users'])

// Clear cached tokens
m2m.clearTokenCache()
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tokenEndpoint` | `string` | — | Token endpoint URL (required) |
| `clientId` | `string` | — | Client ID (required) |
| `clientSecret` | `string` | — | Client secret (required) |
| `scopes` | `string[]` | `[]` | Default scopes for token exchange |
| `audience` | `string` | — | Token audience |
| `extraParams` | `Record<string, string>` | — | Additional token request parameters |
| `tokenCaching` | `boolean` | `true` | Cache tokens until expiry |
| `tokenExpiryBuffer` | `number` | `60` | Seconds before expiry to consider stale |
| `timeoutMs` | `number` | `10000` | Fetch timeout |

Token caching deduplicates by sorted scope set — requesting the same scopes twice returns the cached token.

---

## Refresh Interceptor

`createRefreshInterceptor` automatically refreshes expired access tokens using an httpOnly refresh token cookie. Place it before `createAuthMiddleware` in the interceptor chain.

### Flow

```
Request → Refresh Interceptor → Auth Middleware → Handler
               ↓
  1. Validate access token via strategy.authenticate()
  2. If expired/missing, read refresh token from cookie/header
  3. Call strategy.refreshToken(refreshToken)
  4. Inject new access token into envelope
  5. Optionally rotate refresh token cookie
  6. Continue to auth middleware
```

### Setup

```typescript
import { createRefreshInterceptor, createOAuth2Strategy, createAuthMiddleware } from 'raffel'

const oauth2 = createOAuth2Strategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
})

server.use(createRefreshInterceptor({ strategy: oauth2 }))
server.use(createAuthMiddleware({ strategies: [oauth2] }))
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strategy` | `OAuth2StrategyWithFlow` | — | OAuth2 strategy (required) |
| `accessTokenHeader` | `string` | `'authorization'` | Header containing the access token |
| `accessTokenPrefix` | `string` | `'Bearer '` | Token prefix |
| `refreshToken.headerName` | `string` | `'x-refresh-token'` | Fallback header for refresh token |
| `refreshToken.cookieName` | `string` | `'refresh_token'` | Cookie name |
| `refreshToken.cookie` | `RefreshTokenCookieOptions` | `{ path: '/', httpOnly: true, sameSite: 'Lax' }` | Cookie attributes for rotated token |
| `refreshOnMissingAccessToken` | `boolean` | `true` | Attempt refresh when no access token |
| `verifyRefreshedToken` | `boolean` | `true` | Re-verify after refresh |
| `rotateRefreshToken` | `boolean` | `true` | Update cookie when provider returns new refresh token |
| `setAuthContext` | `boolean` | `true` | Populate `ctx.auth` after refresh |
| `onRefreshed` | `(tokens, envelope, ctx) => void` | — | Callback after successful refresh |

### Custom cookie settings

```typescript
server.use(createRefreshInterceptor({
  strategy: oauth2,
  refreshToken: {
    cookieName: 'rt',
    cookie: {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    },
  },
}))
```

---

## Pair with authorization policies

OAuth2 establishes *who* the request is — the [policy engine](/policies/README.md) uses that identity to decide *what* they're allowed to do. Configure the policy module to read from `ctx.auth` populated by this interceptor:

```ts
const server = createServer({
  port: 3000,
  policy: {
    principal: { from: 'oauth2' },     // ← reads ctx.auth + ctx.auth.claims
    policies: [
      {
        id: 'admins-everything',
        effect: 'allow',
        principals: ['group:admins'],   // matches roles claim 'admins'
        actions: ['**'],
        resources: ['**'],
      },
    ],
  },
})
```

Default mapping from `ctx.auth` claims:

| Principal field | Sourced from |
|---|---|
| `id` | `ctx.auth.principalId` ?? `ctx.auth.principal` ?? `claims.sub` |
| `tenantId` | `ctx.auth.tenantId` ?? `claims.tid` (Azure AD style) |
| `scopes` | `ctx.auth.scopes` ?? `claims.scope` (space-split) |
| `groups` | `ctx.auth.roles` ?? `claims.groups` ?? `claims.roles` |
| `attrs` | full `claims` object |

Override with a custom mapper if your provider uses different claim names:

```ts
policy: {
  principal: {
    from: 'oauth2',
    map: (_raw, ctx) => ({
      id: ctx.auth.claims.sub as string,
      tenantId: (ctx.auth.claims['custom:tenant'] as string) ?? null,
      scopes: (ctx.auth.claims.permissions as string[]) ?? [],
      groups: (ctx.auth.claims['cognito:groups'] as string[]) ?? [],
    }),
  },
}
```

Policies are [fully opt-in](/policies/README.md) — OAuth2 alone is enough for authentication.
