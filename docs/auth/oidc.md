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
  onSuccess: async (tokens, userInfo, _provider, c) => {
    c.set('user', userInfo)
    return c.redirect('/dashboard')
  },
}))
```

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
