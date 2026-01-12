# Providers (Dependency Injection)

Providers are singletons that get injected into the context of all handlers. Use them to share database clients, services, configurations, and other dependencies across your application.

**Key Features:**
- Singletons initialized once at server startup
- Async factories supported (await before accepting requests)
- Automatic injection into all handlers (manual and discovered)
- Shutdown hooks for cleanup (database disconnect, etc.)

## Quick Start

```typescript
import { createServer } from 'raffel'
import { PrismaClient } from '@prisma/client'

const server = createServer({
  port: 3000,
  providers: {
    db: () => new PrismaClient(),
  },
})

server
  .procedure('users.get')
  .handler(async (input, ctx) => {
    // Access provider via context
    return ctx.db.user.findUnique({
      where: { id: input.id }
    })
  })

await server.start()
```

## Defining Providers

### Via Options

```typescript
const server = createServer({
  port: 3000,
  providers: {
    // Simple factory function
    db: () => new PrismaClient(),

    // Async factory
    s3db: async () => {
      const { S3DB } = await import('s3db.js')
      return new S3DB({ bucket: 'my-bucket' })
    },

    // Plain object
    config: () => ({
      apiKey: process.env.API_KEY,
      environment: process.env.NODE_ENV,
    }),
  },
})
```

### Via Fluent API

```typescript
const server = createServer({ port: 3000 })
  .provide('db', () => new PrismaClient())
  .provide('s3db', () => new S3DB({ bucket: 'my-bucket' }))
  .provide('config', () => ({
    apiKey: process.env.API_KEY,
  }))
```

### With Shutdown Hooks

```typescript
const server = createServer({ port: 3000 })
  .provide(
    'db',
    () => new PrismaClient(),
    {
      onShutdown: async (db) => {
        await db.$disconnect()
      }
    }
  )
  .provide(
    'redis',
    () => new Redis(),
    {
      onShutdown: (redis) => redis.quit()
    }
  )
```

## Using in Handlers

### Manual Registration

```typescript
server
  .procedure('users.create')
  .handler(async (input, ctx) => {
    return ctx.db.user.create({
      data: input
    })
  })

server
  .procedure('users.list')
  .handler(async (_input, ctx) => {
    return ctx.db.user.findMany()
  })
```

### File-System Discovery

Providers are **automatically available** in all discovered routes. No imports needed!

#### Server Setup

```typescript
// server.ts
import { createServer } from 'raffel'
import { PrismaClient } from '@prisma/client'
import { S3DB } from 's3db.js'

const server = createServer({
  port: 3000,
  // Enable route discovery
  discovery: {
    http: './src/routes',
    rpc: './src/rpc',
  },
  // Define providers
  providers: {
    db: async () => {
      const prisma = new PrismaClient()
      await prisma.$connect()
      return prisma
    },
    s3db: () => new S3DB({ bucket: 'my-app' }),
    config: () => ({
      apiUrl: process.env.API_URL,
      environment: process.env.NODE_ENV,
    }),
  },
})

await server.start()
// All providers initialized, then routes discovered, then accepting requests
```

#### HTTP Routes (discovered)

```typescript
// src/routes/users/index.ts
export default {
  method: 'GET',
  handler: async (_input, ctx) => {
    // ctx.db available automatically!
    return ctx.db.user.findMany({
      take: 100,
    })
  }
}
```

```typescript
// src/routes/users/create.ts
import { z } from 'zod'

export const input = z.object({
  name: z.string(),
  email: z.string().email(),
})

export default {
  method: 'POST',
  handler: async (input, ctx) => {
    return ctx.db.user.create({
      data: input
    })
  }
}
```

```typescript
// src/routes/users/[id].ts
import { z } from 'zod'

export const input = z.object({
  id: z.string(),
})

export default {
  method: 'GET',
  handler: async (input, ctx) => {
    return ctx.db.user.findUnique({
      where: { id: input.id }
    })
  }
}
```

```typescript
// src/routes/users/[id]/delete.ts
export default {
  method: 'DELETE',
  handler: async (input, ctx) => {
    await ctx.db.user.delete({
      where: { id: input.id }
    })
    return { success: true }
  }
}
```

#### RPC Handlers (discovered)

```typescript
// src/rpc/analytics/track.ts
export default async function handler(input, ctx) {
  // Store event in S3DB
  await ctx.s3db.insert('events', {
    type: input.event,
    data: input.data,
    timestamp: Date.now(),
  })
  return { tracked: true }
}
```

#### Health Check Example

```typescript
// src/routes/health.ts
export default {
  method: 'GET',
  handler: async (_input, ctx) => {
    // Access multiple providers
    const dbHealthy = await ctx.db.$queryRaw`SELECT 1`

    return {
      status: 'ok',
      environment: ctx.config.environment,
      database: dbHealthy ? 'connected' : 'error',
    }
  }
}
```

#### Middleware with Providers

```typescript
// src/routes/_middleware.ts
export default async function middleware(ctx, next) {
  // Providers available in middleware too!
  const user = ctx.auth?.principal
    ? await ctx.db.user.findUnique({ where: { id: ctx.auth.principal } })
    : null

  ctx.currentUser = user
  return next()
}
```

## Accessing Providers Directly

After `server.start()`, you can access providers directly:

```typescript
await server.start()

// Useful for scripts, CLI tools, migrations
const db = server.providers.db as PrismaClient
const users = await db.user.findMany()
```

## TypeScript Support

For proper typing, extend the Context interface:

```typescript
// types/context.d.ts
import { PrismaClient } from '@prisma/client'
import { S3DB } from 's3db.js'

declare module 'raffel' {
  interface Context {
    db: PrismaClient
    s3db: S3DB
    config: {
      apiKey: string
      environment: string
    }
  }
}
```

Now `ctx.db`, `ctx.s3db`, etc. are fully typed in your handlers.

## Common Patterns

### Database Client

```typescript
import { PrismaClient } from '@prisma/client'

const server = createServer({ port: 3000 })
  .provide(
    'db',
    () => new PrismaClient(),
    { onShutdown: (db) => db.$disconnect() }
  )
```

### S3DB

```typescript
import { S3DB } from 's3db.js'

const server = createServer({ port: 3000 })
  .provide('s3db', () => new S3DB({
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
  }))
```

### Redis Cache

```typescript
import Redis from 'ioredis'

const server = createServer({ port: 3000 })
  .provide(
    'redis',
    () => new Redis(process.env.REDIS_URL),
    { onShutdown: (redis) => redis.quit() }
  )
```

### External API Client

```typescript
import { Client } from 'recker'

const server = createServer({ port: 3000 })
  .provide('apiClient', () => new Client({
    baseUrl: 'https://api.example.com',
    headers: {
      'Authorization': `Bearer ${process.env.API_KEY}`
    }
  }))
```

### Configuration

```typescript
const server = createServer({ port: 3000 })
  .provide('config', () => ({
    env: process.env.NODE_ENV ?? 'development',
    apiKey: process.env.API_KEY ?? '',
    features: {
      newDashboard: process.env.FEATURE_NEW_DASHBOARD === 'true',
    }
  }))
```

### Logger

```typescript
import { createLogger } from '@tetis-lair/tetis-logger'

const server = createServer({ port: 3000 })
  .provide('logger', () => createLogger({
    serviceName: 'my-service',
  }))
```

## How It Works

### Initialization Sequence

When you call `server.start()`:

```
server.start()
  │
  ├─1─► Initialize providers (in order)
  │     ├── await db factory()
  │     ├── await redis factory()
  │     └── await config factory()
  │
  ├─2─► Add provider interceptor to globalInterceptors
  │
  ├─3─► Discover routes (if discovery enabled)
  │     └── Load files from ./src/routes, ./src/rpc, etc.
  │
  └─4─► Start adapters (HTTP, WebSocket, etc.)
        └── Now accepting requests!
```

**Important:** The server only starts accepting requests **after** all providers are initialized. This ensures your database is connected before any request comes in.

### Request Flow

```
Request arrives
  │
  ├─► [Provider Interceptor]
  │   └── Inject db, redis, config into ctx
  │
  ├─► [Auth Interceptor]
  │   └── ctx.db available here!
  │
  ├─► [Rate Limit Interceptor]
  │
  └─► [Handler] (manual or discovered)
      └── ctx.db, ctx.redis, ctx.config all available
```

### Shutdown Sequence

```
server.stop()
  │
  ├─1─► Stop adapters (no more requests)
  │
  ├─2─► Stop discovery watcher
  │
  ├─3─► Shutdown providers (with hooks)
  │     ├── await db.onShutdown()
  │     ├── await redis.onShutdown()
  │     └── config has no hook, skip
  │
  └─4─► Done
```

## Lifecycle

1. **Initialization**: Providers are initialized when `server.start()` is called
2. **Injection**: An interceptor injects all providers into the context before each request
3. **Shutdown**: When `server.stop()` is called, `onShutdown` hooks are invoked in order

## Best Practices

1. **Use shutdown hooks** for resources that need cleanup (database connections, etc.)
2. **Keep providers simple** - they should be single-purpose
3. **Use TypeScript declaration merging** for proper typing
4. **Don't access providers before `start()`** - they won't be initialized
5. **Prefer async factories** for resources that need async initialization
