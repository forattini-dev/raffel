# API Key Authentication

API keys are ideal for service-to-service traffic or public APIs.

---

## Core Server (All Protocols)

```typescript
import { createAuthMiddleware, createApiKeyStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategies: [
    createApiKeyStrategy({
      headerName: 'x-api-key',
      verify: async (apiKey) => {
        const key = await db.apiKeys.findUnique({ where: { key: apiKey } })
        if (!key) return null
        return { authenticated: true, principal: key.ownerId, claims: { scopes: key.scopes } }
      },
    }),
  ],
})
```

---

## Static Keys (Development)

```typescript
import { createStaticApiKeyStrategy } from 'raffel'

const keys = new Map([
  ['dev-key', { authenticated: true, principal: 'dev' }],
])

const auth = createAuthMiddleware({
  strategies: [createStaticApiKeyStrategy(keys)],
})
```

---

## HTTP Module

The HTTP module uses `bearerAuth` for API keys as well:

```typescript
import { bearerAuth } from 'raffel/http'

app.use('/api/*', bearerAuth({
  prefix: 'ApiKey',
  verifyToken: async (apiKey) => {
    return await verifyApiKey(apiKey)
  },
}))
```
