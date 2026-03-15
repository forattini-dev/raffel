# Providers (Dependency Injection)

Providers let you initialize shared dependencies once at startup and expose
them to handlers.

Use them for:

- domain services
- database clients
- cache clients
- API clients
- configuration objects

In the 2026 Raffel golden path, providers are still the startup mechanism, but
the recommended handler surface is `ctx.services`, not broad top-level bags like
`ctx.db`.

---

## Official Model

Think about providers in two layers:

1. `server.provide(...)` registers startup-time singletons
2. handlers consume those dependencies through the canonical runtime context

Prefer this:

```ts
type Services = {
  users: {
    getById(id: string): Promise<{ id: string; name: string } | null>
  }
  audit: {
    write(event: string, payload: unknown): Promise<void>
  }
}

const server = createServer({ port: 3000 })
  .provide('users', () => createUsersService())
  .provide('audit', () => createAuditService())

server
  .procedure('users.get')
  .handler(async (_input, ctx) => {
    const services = ctx.services as Services
    return services.users.getById(ctx.input.params.id)
  })
```

Treat these as compatibility surfaces during migration, not the main path:

- `ctx.db`
- `ctx.redis`
- `ctx.config`

They still work in many places, but the docs now recommend `ctx.services`
because it is clearer, smaller, and more capability-based.

---

## Quick Start

```ts
import { createServer } from 'raffel'
import { PrismaClient } from '@prisma/client'

type Services = {
  users: {
    list(): Promise<unknown[]>
    get(id: string): Promise<unknown>
  }
}

const server = createServer({ port: 3000 })
  .provide('users', async () => {
    const prisma = new PrismaClient()
    await prisma.$connect()

    return {
      async list() {
        return prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
      },
      async get(id: string) {
        return prisma.user.findUnique({ where: { id } })
      },
    }
  }, {
    onShutdown: async () => {
      // close underlying resources inside the provider if needed
    },
  })

server
  .procedure('users.list')
  .handler(async (_input, ctx) => {
    const services = ctx.services as Services
    return services.users.list()
  })
```

---

## Registering Providers

### Via Options

```ts
const server = createServer({
  port: 3000,
  providers: {
    users: () => createUsersService(),
    cache: () => createCacheClient(),
    config: () => ({
      apiKey: process.env.API_KEY,
      environment: process.env.NODE_ENV,
    }),
  },
})
```

### Via Fluent API

```ts
const server = createServer({ port: 3000 })
  .provide('users', () => createUsersService())
  .provide('payments', () => createPaymentsService())
  .provide('config', () => ({
    region: process.env.AWS_REGION,
  }))
```

### With Dependencies Between Providers

Factories receive already-resolved providers.

```ts
const server = createServer({ port: 3000 })
  .provide('redis', () => createRedisClient())
  .provide('cache', ({ redis }) => ({
    get: (key: string) => redis.get(key),
    set: (key: string, value: string) => redis.set(key, value),
  }))
```

### With Shutdown Hooks

```ts
const server = createServer({ port: 3000 })
  .provide('db', () => new PrismaClient(), {
    onShutdown: async (db) => {
      await db.$disconnect()
    },
  })
```

---

## Using Providers In Handlers

### Preferred: `ctx.services`

```ts
type Services = {
  users: {
    create(input: { name: string; email: string }): Promise<unknown>
  }
  audit: {
    write(event: string, payload: unknown): Promise<void>
  }
}

server
  .procedure('users.create')
  .handler(async (input, ctx) => {
    ctx.auth.require({ scopes: ['users:write'] })

    const services = ctx.services as Services
    const user = await services.users.create(input)

    await services.audit.write('users.created', {
      actorId: ctx.auth.principalId,
      user,
    })

    return user
  })
```

### Why `ctx.services` Is Better

- smaller public surface for handlers
- easier audit and review of what the handler depends on
- more consistent with `ctx.auth`, `ctx.input`, `ctx.logger`, and `ctx.signal`
- better fit for cross-protocol handlers than transport-specific or ambient
  state

---

## File-System Discovery

Providers remain available when using discovery-based routing.

```ts
const server = createServer({
  port: 3000,
  discovery: {
    http: './src/routes',
    rpc: './src/rpc',
  },
  providers: {
    users: () => createUsersService(),
    audit: () => createAuditService(),
  },
})
```

Then consume them through the canonical context:

```ts
// src/routes/users/[id].ts
type Services = {
  users: { get(id: string): Promise<unknown> }
}

export default {
  method: 'GET',
  handler: async (_input, ctx) => {
    const services = ctx.services as Services
    return services.users.get(ctx.input.params.id)
  },
}
```

---

## Health Checks And Operational Dependencies

If you need direct infrastructure checks, keep them behind a named service
boundary when possible.

```ts
type Services = {
  health: {
    database(): Promise<boolean>
    cache(): Promise<boolean>
  }
}

server.procedure('health.ready').handler(async (_input, ctx) => {
  const services = ctx.services as Services

  return {
    database: await services.health.database(),
    cache: await services.health.cache(),
  }
})
```

This keeps app code from turning into a bag of raw clients.

---

## Compatibility Notes

Existing code may still rely on top-level provider injection such as:

- `ctx.db`
- `ctx.redis`
- `ctx.config`

That pattern is still available in compatibility flows and older examples.
New docs, new scaffolds, and new examples now prefer:

- explicit provider registration
- canonical context access
- `ctx.services` in app code

If you are migrating older code, see [DEVX Migration](/migration/devx.md).
