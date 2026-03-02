# Authentication Guide

A complete guide to securing your Raffel server. Covers every built-in strategy and how to compose them.

---

## How it works

Authentication in Raffel is interceptor-based. An interceptor runs before every handler, inspects the envelope, and either populates `ctx.auth` or throws `UNAUTHENTICATED`.

```
Request → Auth Interceptor → Handler
               ↓
         ctx.auth = { authenticated, principal, claims }
```

Authentication is protocol-agnostic: the same setup works for HTTP, WebSocket, JSON-RPC, gRPC, and TCP.

---

## 1. Bearer Token (JWT)

The most common pattern for APIs. The client sends:

```
Authorization: Bearer <token>
```

```typescript
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
  requireAuth,
} from 'raffel'

const server = createServer({ port: 3000 })

server.use(createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        // Use your JWT library here
        const payload = await myJwt.verify(token, process.env.JWT_SECRET!)
        if (!payload) return null
        return {
          authenticated: true,
          principal: payload.sub,
          claims: { email: payload.email, roles: payload.roles },
        }
      },
    }),
  ],
  publicProcedures: ['health.check', 'auth.login'],
}))
```

### Reading auth in handlers

```typescript
server.procedure('users.me').handler(async (_input, ctx) => {
  const auth = requireAuth(ctx)  // throws UNAUTHENTICATED if not authenticated
  return {
    userId: auth.principal,
    email: auth.claims?.email,
  }
})
```

---

## 2. API Key

For server-to-server communication. The client sends:

```
X-API-Key: sk_live_...
```

```typescript
import { createApiKeyStrategy } from 'raffel'

server.use(createAuthMiddleware({
  strategies: [
    createApiKeyStrategy({
      verify: async (key) => {
        const apiKey = await db.apiKeys.findByKey(key)
        if (!apiKey) return null
        return {
          authenticated: true,
          principal: apiKey.serviceId,
          claims: { scopes: apiKey.scopes },
        }
      },
    }),
  ],
}))
```

---

## 3. OAuth2

Let users sign in with Google, GitHub, Microsoft, Apple, or Facebook.

### Setup

```typescript
import { createOAuth2Strategy, generateState } from 'raffel'

const googleAuth = createOAuth2Strategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
  scopes: ['openid', 'email', 'profile'],
})

// The strategy validates Bearer tokens by calling the userinfo endpoint
server.use(createAuthMiddleware({ strategies: [googleAuth] }))
```

### Authorization flow endpoints

```typescript
// Step 1: Redirect to provider
server.procedure('auth.oauth2.authorize').handler(async (_input, ctx) => {
  const state = generateState()
  // Store state in session to prevent CSRF
  ctx.session.data.oauthState = state
  ctx.session.touch()

  const url = googleAuth.getAuthorizationUrl({ state })
  return { redirect: url }
})

// Step 2: Handle callback
server.procedure('auth.oauth2.callback').handler(async ({ code, state }, ctx) => {
  // Verify CSRF state
  if (state !== ctx.session.data.oauthState) {
    throw new RaffelError('INVALID_STATE', 'Invalid OAuth state')
  }

  const tokens = await googleAuth.exchangeCode(code)
  const userInfo = await googleAuth.getUserInfo(tokens.accessToken)

  // Store user in session
  ctx.session.data.userId = userInfo.sub
  ctx.session.data.email = userInfo.email
  ctx.session.touch()

  return { ok: true, user: userInfo }
})

// Token refresh
server.procedure('auth.oauth2.refresh').handler(async ({ refreshToken }) => {
  const tokens = await googleAuth.refreshToken(refreshToken)
  return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn }
})
```

### Available providers

```typescript
// Google
createOAuth2Strategy({ provider: 'google', clientId, clientSecret, redirectUri })

// GitHub
createOAuth2Strategy({ provider: 'github', clientId, clientSecret, redirectUri })

// Microsoft (with tenant)
createMicrosoftOAuth2Strategy({ clientId, clientSecret, redirectUri, tenant: 'my-tenant' })

// Apple
createAppleOAuth2Strategy({ clientId, clientSecret, redirectUri })

// Facebook
createFacebookOAuth2Strategy({ clientId, clientSecret, redirectUri })

// Custom provider
createOAuth2Strategy({
  provider: 'custom',
  clientId, clientSecret, redirectUri,
  authorizationUrl: 'https://auth.example.com/oauth/authorize',
  tokenUrl: 'https://auth.example.com/oauth/token',
  userInfoUrl: 'https://auth.example.com/oauth/userinfo',
})
```

---

## 4. OIDC (OpenID Connect)

Auto-discovers endpoints from `.well-known/openid-configuration`. Validates ID tokens.

```typescript
import { createOIDCStrategy } from 'raffel'

const oidc = createOIDCStrategy({
  issuer: 'https://accounts.google.com',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
})

server.use(createAuthMiddleware({ strategies: [oidc] }))

// On callback — validates ID token automatically
server.procedure('auth.callback').handler(async ({ code }) => {
  const tokens = await oidc.exchangeCode(code) // validates ID token
  const claims = await oidc.validateIdToken(tokens.idToken!)
  return { sub: claims.sub, email: claims.email }
})
```

### OIDC providers

```typescript
// Auth0
createOIDCStrategy({ issuer: 'https://my-tenant.auth0.com/', clientId, clientSecret, redirectUri })

// Keycloak
createOIDCStrategy({ issuer: 'https://auth.company.com/realms/my-realm', ... })

// Okta
createOIDCStrategy({ issuer: 'https://my-org.okta.com', ... })

// Any OIDC-compliant provider
createOIDCStrategy({ issuer: 'https://sso.example.com', ... })
```

---

## 5. Cookie Session Strategy

For browser-based apps that authenticate via a session cookie (traditional web flow).

```typescript
import { createCookieSessionStrategy } from 'raffel'

server.use(createAuthMiddleware({
  strategies: [
    createCookieSessionStrategy({
      cookieName: 'session',
      secret: process.env.COOKIE_SECRET,
      validate: async (sessionId) => {
        const data = await sessionStore.get(sessionId)
        if (!data?.userId) return null
        return { authenticated: true, principal: data.userId as string }
      },
    }),
  ],
}))
```

For full session management (storing arbitrary data per session), see [Session Store](/auth/sessions.md).

---

## 6. Composite Authentication

Try multiple strategies in order — the first one that succeeds wins.

```typescript
server.use(createAuthMiddleware({
  strategies: [
    // 1. Try JWT bearer first
    createBearerStrategy({ verify: verifyJwt }),
    // 2. Fall back to API key
    createApiKeyStrategy({ verify: verifyApiKey }),
    // 3. Fall back to cookie session
    createCookieSessionStrategy({ validate: validateSession }),
  ],
  publicProcedures: ['health.check'],
}))
```

---

## Role-Based Access Control (RBAC)

Add an authorization interceptor after authentication:

```typescript
import { createAuthzMiddleware } from 'raffel'

server.use(createAuthzMiddleware({
  rules: [
    { procedure: 'admin.*', roles: ['admin'] },
    { procedure: 'billing.*', roles: ['admin', 'billing'] },
    { procedure: 'users.delete', roles: ['admin'] },
  ],
  defaultAllow: false,
}))
```

### Per-handler role check

```typescript
import { hasRole, hasAnyRole, requireAuth } from 'raffel'

server.procedure('admin.stats').handler(async (_input, ctx) => {
  requireAuth(ctx)
  if (!hasRole(ctx, 'admin')) {
    throw new RaffelError('PERMISSION_DENIED', 'Admin only')
  }
  return getStats()
})
```

---

## Per-route vs global

```typescript
// Global (applies to all procedures)
server.use(createAuthMiddleware({ strategies: [bearer] }))

// Per-procedure
server
  .procedure('users.me')
  .use(createAuthMiddleware({ strategies: [bearer] }))
  .handler(...)

// Per-module
const adminModule = createRouterModule()
  .use(createAuthMiddleware({ strategies: [bearer] }))
  .use(createAuthzMiddleware({ rules: [{ procedure: '*', roles: ['admin'] }] }))
```

---

## Auth helpers reference

| Helper | Description |
|--------|-------------|
| `requireAuth(ctx)` | Returns `AuthContext`, throws `UNAUTHENTICATED` if not authenticated |
| `hasRole(ctx, role)` | Returns `true` if user has the role |
| `hasAnyRole(ctx, roles)` | Returns `true` if user has any of the roles |
| `hasAllRoles(ctx, roles)` | Returns `true` if user has all roles |
| `generateState()` | Generate CSRF state for OAuth2 flows |
| `generateNonce()` | Generate nonce for OIDC flows |

---

## See also

- [Bearer Token](/auth/bearer.md)
- [API Key](/auth/api-key.md)
- [OAuth2](/auth/oauth2.md)
- [OIDC](/auth/oidc.md)
- [Session Store](/auth/sessions.md)
