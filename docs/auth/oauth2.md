# OAuth2

Raffel supports OAuth2 for third-party login and API access.
Use the HTTP middleware for web flows or the core strategy for protocol-agnostic use.

---

## HTTP Module (Web Flow)

```typescript
import { oauth2 } from 'raffel/http'

app.use('/auth/*', oauth2({
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
