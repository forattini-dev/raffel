# Authentication Overview

Raffel provides a flexible authentication system that works across all protocols.

---

## Quick Start

```typescript
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
} from 'raffel'

const server = createServer({ port: 3000 })

// Create auth middleware with JWT strategy
const auth = createAuthMiddleware({
  strategy: createBearerStrategy({
    secret: process.env.JWT_SECRET!,
    algorithm: 'HS256',
  }),
})

// Public endpoint
server.procedure('health.check')
  .handler(async () => ({ ok: true }))

// Protected endpoint
server.procedure('users.me')
  .use(auth)
  .handler(async (input, ctx) => {
    return { userId: ctx.auth!.userId }
  })

await server.start()
```

---

## Authentication Strategies

Raffel supports multiple authentication strategies:

| Strategy | Use Case | Token Location |
|:---------|:---------|:---------------|
| **[Bearer (JWT)](bearer.md)** | Stateless APIs, microservices | `Authorization: Bearer <token>` |
| **[API Key](api-key.md)** | Service-to-service, public APIs | Header or query param |
| **[OAuth2](oauth2.md)** | Third-party login, social auth | OAuth flow |
| **[OpenID Connect](oidc.md)** | Enterprise SSO, identity | OIDC flow |
| **[Session](sessions.md)** | Traditional web apps | Cookie-based |

---

## Bearer / JWT Authentication

Most common for APIs:

```typescript
import { createAuthMiddleware, createBearerStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategy: createBearerStrategy({
    secret: process.env.JWT_SECRET!,
    algorithm: 'HS256',  // or 'RS256' for asymmetric

    // Optional: custom token extraction
    extractToken: (ctx) => {
      // Default: Authorization header
      return ctx.headers.authorization?.replace('Bearer ', '')
    },

    // Optional: custom claims validation
    validate: async (payload) => {
      // Check if user still exists, not banned, etc.
      const user = await db.users.findUnique({ where: { id: payload.sub } })
      if (!user || user.banned) return null
      return { userId: user.id, roles: user.roles }
    },
  }),
})
```

---

## API Key Authentication

For service-to-service or public API access:

```typescript
import { createAuthMiddleware, createApiKeyStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategy: createApiKeyStrategy({
    // Where to find the API key
    header: 'X-API-Key',        // or
    query: 'api_key',           // or
    cookie: 'api_key',

    // Validate the key
    validate: async (key) => {
      const apiKey = await db.apiKeys.findUnique({
        where: { key, active: true },
        include: { user: true },
      })
      if (!apiKey) return null
      return { userId: apiKey.userId, scopes: apiKey.scopes }
    },
  }),
})
```

---

## Multiple Strategies

Combine strategies with fallback:

```typescript
const auth = createAuthMiddleware({
  strategies: [
    // Try JWT first
    createBearerStrategy({ secret: process.env.JWT_SECRET! }),
    // Fall back to API key
    createApiKeyStrategy({
      header: 'X-API-Key',
      validate: async (key) => { /* ... */ },
    }),
  ],
  // How to combine results
  mode: 'first-match',  // or 'all-match' for requiring all
})
```

---

## Context After Authentication

After auth middleware, `ctx.auth` contains:

```typescript
interface AuthContext {
  authenticated: boolean
  userId?: string
  email?: string
  roles?: string[]
  scopes?: string[]
  expiresAt?: Date
  claims?: Record<string, unknown>  // Raw JWT claims
}
```

Usage in handlers:

```typescript
server.procedure('admin.users.list')
  .use(auth)
  .handler(async (input, ctx) => {
    // Check authentication
    if (!ctx.auth?.authenticated) {
      throw new UnauthorizedError('Not authenticated')
    }

    // Check authorization
    if (!ctx.auth.roles?.includes('admin')) {
      throw new ForbiddenError('Admin access required')
    }

    return await db.users.findMany()
  })
```

---

## Role-Based Access Control

Create reusable RBAC middleware:

```typescript
const requireRole = (...roles: string[]) => {
  return async (ctx: Context, next: () => Promise<void>) => {
    if (!ctx.auth?.authenticated) {
      throw new UnauthorizedError('Authentication required')
    }

    const hasRole = roles.some(role => ctx.auth!.roles?.includes(role))
    if (!hasRole) {
      throw new ForbiddenError(`Required roles: ${roles.join(', ')}`)
    }

    return next()
  }
}

// Usage
server.procedure('admin.settings')
  .use(auth)
  .use(requireRole('admin', 'superadmin'))
  .handler(async (input, ctx) => {
    // Only admins can access
  })
```

---

## Scope-Based Access Control

For API key or OAuth scopes:

```typescript
const requireScope = (...scopes: string[]) => {
  return async (ctx: Context, next: () => Promise<void>) => {
    if (!ctx.auth?.authenticated) {
      throw new UnauthorizedError('Authentication required')
    }

    const hasScope = scopes.every(scope => ctx.auth!.scopes?.includes(scope))
    if (!hasScope) {
      throw new ForbiddenError(`Required scopes: ${scopes.join(', ')}`)
    }

    return next()
  }
}

// Usage
server.procedure('users.delete')
  .use(auth)
  .use(requireScope('users:write', 'users:delete'))
  .handler(async ({ userId }) => {
    await db.users.delete({ where: { id: userId } })
  })
```

---

## Protocol-Specific Notes

### HTTP
```typescript
// Authorization header
Authorization: Bearer eyJhbGc...

// API key header
X-API-Key: sk_live_xxx
```

### WebSocket
```typescript
// Pass token in connection URL or first message
const ws = new WebSocket('ws://localhost:3000/ws?token=eyJhbGc...')

// Or in first message
ws.send(JSON.stringify({
  type: 'auth',
  token: 'eyJhbGc...'
}))
```

### gRPC
```typescript
// Metadata
const metadata = new grpc.Metadata()
metadata.add('authorization', 'Bearer eyJhbGc...')
client.call(request, metadata)
```

---

## Session Authentication

For traditional web applications:

```typescript
import {
  createSessionMiddleware,
  createRedisSessionStore,
} from 'raffel'

const session = createSessionMiddleware({
  store: createRedisSessionStore({
    url: process.env.REDIS_URL!,
    prefix: 'sess:',
  }),
  cookie: {
    name: 'sid',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
})

server.use(session)

server.procedure('auth.login')
  .input(z.object({ email: z.string(), password: z.string() }))
  .handler(async (input, ctx) => {
    const user = await authenticate(input.email, input.password)
    if (!user) throw new UnauthorizedError('Invalid credentials')

    // Set session
    ctx.session.userId = user.id
    ctx.session.roles = user.roles

    return { success: true }
  })
```

---

## Optional Authentication

Allow both authenticated and unauthenticated access:

```typescript
const optionalAuth = createAuthMiddleware({
  strategy: createBearerStrategy({ secret: process.env.JWT_SECRET! }),
  optional: true,  // Don't throw if no token
})

server.procedure('posts.list')
  .use(optionalAuth)
  .handler(async (input, ctx) => {
    if (ctx.auth?.authenticated) {
      // Show private posts for authenticated users
      return db.posts.findMany({ where: { OR: [{ public: true }, { authorId: ctx.auth.userId }] } })
    }
    // Only public posts for anonymous
    return db.posts.findMany({ where: { public: true } })
  })
```

---

## Next Steps

- **[JWT / Bearer](bearer.md)** — JWT configuration and validation
- **[API Key](api-key.md)** — API key authentication
- **[OAuth2](oauth2.md)** — OAuth2 flows
- **[Sessions](sessions.md)** — Cookie-based sessions with Redis
