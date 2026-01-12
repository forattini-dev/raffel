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
