import type { PatternDoc } from '../types.js'

export const corePatterns: PatternDoc[] = [
  // === Pattern 1: Server Builder ===
  {
    name: 'Server Builder (Fluent API)',
    description:
      'The createServer() function returns a builder with fluent chainable methods. The server is configured through method chaining, NOT by passing a large options object.',
    components: [
      'createServer',
      'procedure',
      'stream',
      'event',
      'use',
      'group',
      'mount',
      'provide',
    ],
    signature: `createServer(options?)
  .use(interceptor)              // Add global interceptor
  .provide('name', factory)      // Register provider (DI)
  .procedure('name')             // Start procedure builder
    .input(schema)               // Input validation
    .output(schema)              // Output validation
    .handler(fn)                 // Handler function
  .stream('name')                // Start stream builder
    .handler(fn)
  .event('name')                 // Start event builder
    .delivery('at-least-once')
    .handler(fn)
  .group('prefix')               // Group with shared prefix
    .procedure('name').handler(fn)
  .mount('/path', module)        // Mount router module
  .start()                       // Start the server`,
    correctExamples: [
      {
        title: 'Basic Server with Procedures',
        code: `import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .procedure('users.list')
    .handler(async (_input, ctx) => {
      const services = ctx.services as {
        users: { list(): Promise<unknown[]> }
      }
      return services.users.list()
    })

  .procedure('users.get')
    .handler(async ({ id }, ctx) => {
      const services = ctx.services as {
        users: { get(id: string): Promise<unknown> }
      }
      return services.users.get(id)
    })

  .procedure('users.create')
    .handler(async (input, ctx) => {
      const services = ctx.services as {
        users: { create(data: unknown): Promise<unknown> }
      }
      return services.users.create(input)
    })

await server.start()`,
      },
      {
        title: 'Server with Middleware and Validation',
        code: `import { createServer, createAuthMiddleware, createBearerStrategy, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })
  .use(createAuthMiddleware({
    strategies: [createBearerStrategy({ verify: verifyToken })]
  }))

  .procedure('users.create')
    .input(z.object({
      name: z.string().min(2),
      email: z.string().email()
    }))
    .output(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string()
    }))
    .handler(async (input, ctx) => {
      const services = ctx.services as {
        users: { create(data: unknown): Promise<unknown> }
      }
      return services.users.create(input)
    })

await server.start()`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Passing handlers in constructor',
        code: `// WRONG - Don't pass handlers as constructor options
const server = createServer({
  port: 3000,
  procedures: {  // This doesn't exist!
    'users.list': async () => db.users.findMany()
  }
})`,
        description:
          'Raffel uses fluent builder pattern, not a constructor with all options.',
      },
      {
        title: 'Wrong: Calling handler() before procedure()',
        code: `// WRONG - Must call procedure() first
const server = createServer()
  .handler(async () => {})  // Error: handler() requires procedure() first
  .procedure('users.list')`,
        description: 'handler() is a method on ProcedureBuilder, not on the server.',
      },
      {
        title: 'Wrong: Missing handler()',
        code: `// WRONG - Every procedure needs a handler
const server = createServer()
  .procedure('users.list')
    .input(z.object({ limit: z.number() }))
  .procedure('users.get')  // Error: previous procedure has no handler!
    .handler(async () => {})`,
        description: 'Each procedure() must end with handler() before starting a new one.',
      },
    ],
    why: 'The fluent builder pattern provides type safety, discoverability, and clear visual structure. Each chain represents a complete handler definition.',
  },

  // === Pattern 2: Handler Functions ===
  {
    name: 'Handler Functions',
    description:
      'Handlers are async functions that receive (input, ctx) and return a value. The context provides auth, tracing, signal, deadline, and the call() function for inter-procedure calls.',
    components: ['ProcedureHandler', 'StreamHandler', 'EventHandler', 'Context'],
    signature: `// Procedure: (input: T, ctx: Context) => Promise<R>
async function handler(input, ctx) {
  // Access context properties:
  // ctx.auth - authentication info
  // ctx.tracing - trace/span IDs
  // ctx.signal - AbortSignal for cancellation
  // ctx.deadline - request deadline
  // ctx.requestId - unique request ID
  // ctx.call('procedure', data) - call other procedures
  // ctx.extensions - typed extensions

  return result
}

// Stream (generator): async function*(input, ctx) { yield chunk }
// Event: (payload, ctx, ack?) => void | Promise<void>`,
    correctExamples: [
      {
        title: 'Procedure Handler with Context',
        code: `server.procedure('users.getProfile')
  .handler(async (input, ctx) => {
    // Check authentication
    if (!ctx.auth.authenticated) {
      throw new RaffelError('UNAUTHENTICATED', 'Login required')
    }

    // Use authenticated user
    const userId = ctx.auth.principal.id

    // Call another procedure
    const settings = await ctx.call('users.getSettings', { userId })

    return { user: ctx.auth.principal, settings }
  })`,
      },
      {
        title: 'Handler with Cancellation',
        code: `server.procedure('reports.generate')
  .handler(async (input, ctx) => {
    const report = []

    for (const chunk of dataSource) {
      // Check if request was cancelled
      if (ctx.signal.aborted) {
        throw new RaffelError('CANCELLED', 'Report generation cancelled')
      }

      report.push(await processChunk(chunk))
    }

    return report
  })`,
      },
      {
        title: 'Stream Handler (Generator)',
        code: `server.stream('logs.tail')
  .handler(async function* (input, ctx) {
    const { filter } = input

    while (!ctx.signal.aborted) {
      const logs = await getNewLogs(filter)

      for (const log of logs) {
        yield log  // Send to client
      }

      await sleep(1000)
    }
  })`,
      },
      {
        title: 'Event Handler with Ack',
        code: `server.event('orders.process')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    try {
      await processOrder(payload)
      ack()  // Acknowledge successful processing
    } catch (error) {
      // Don't ack - will be retried
      throw error
    }
  })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Express-style (req, res)',
        code: `// WRONG - Raffel doesn't use req/res pattern
server.procedure('users.list')
  .handler(async (req, res) => {
    res.json(await db.users.findMany())  // Wrong!
  })`,
        description: 'Raffel handlers return values directly, not via res.json().',
      },
      {
        title: 'Wrong: Missing async',
        code: `// WRONG - Handlers should be async
server.procedure('users.list')
  .handler((input, ctx) => {
    return db.users.findMany()  // Returns Promise, but handler not async
  })`,
        description:
          'Always use async functions for handlers, even if returning a Promise.',
      },
      {
        title: 'Wrong: Arrow function for stream',
        code: `// WRONG - Streams must be generator functions
server.stream('logs.tail')
  .handler(async (input, ctx) => {
    return createStream()  // Wrong! Must use function*
  })`,
        description: 'Stream handlers must be async generator functions (function*).',
      },
    ],
    why: 'The (input, ctx) signature is consistent across all handler types. Context provides everything needed without global state or request objects.',
  },

  // === Pattern 3: Middleware Composition ===
  {
    name: 'Interceptor Composition',
    description:
      'Interceptors (middleware) wrap handler execution in an onion model. They can be applied globally, per-pattern, or per-procedure. Use composition helpers for conditional application.',
    components: [
      'use',
      'compose',
      'pipe',
      'when',
      'forPattern',
      'forProcedures',
      'except',
      'branch',
    ],
    signature: `// Interceptor signature
type Interceptor = (envelope, ctx, next) => Promise<unknown>

// Apply globally
server.use(interceptor)

// Apply per-pattern
server.use(forPattern('admin.*', interceptor))

// Apply conditionally
server.use(when(predicate, interceptor))

// Compose multiple
server.use(compose(i1, i2, i3))

// Exclude patterns
server.use(except('health.*', interceptor))`,
    correctExamples: [
      {
        title: 'Global Middleware Stack',
        code: `import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
  createRateLimitInterceptor,
  createMetricsInterceptor,
  compose
} from 'raffel'

const server = createServer()
  .use(compose(
    createMetricsInterceptor({ registry: metrics }),
    createRateLimitInterceptor({ maxRequests: 100 }),
    createAuthMiddleware({ strategies: [createBearerStrategy({ verify: verifyToken })] })
  ))`,
      },
      {
        title: 'Pattern-Based Middleware',
        code: `import { createServer, forPattern, except, createRateLimitInterceptor } from 'raffel'

const server = createServer()
  // Strict rate limit for auth endpoints
  .use(forPattern('auth.*', createRateLimitInterceptor({
    maxRequests: 5,
    windowMs: 60000
  })))

  // Normal rate limit, excluding health checks
  .use(except('health.*', createRateLimitInterceptor({
    maxRequests: 100,
    windowMs: 60000
  })))`,
      },
      {
        title: 'Conditional Middleware',
        code: `import { createServer, when, branch, createLoggingInterceptor } from 'raffel'

const server = createServer()
  // Only in development
  .use(when(
    () => process.env.NODE_ENV === 'development',
    createLoggingInterceptor()
  ))

  // Different caching by auth status
  .use(branch(
    (ctx) => ctx.auth?.authenticated,
    cache({ ttl: 60000 }),   // Authenticated: 1 min
    cache({ ttl: 300000 })   // Anonymous: 5 min
  ))`,
      },
      {
        title: 'Custom Interceptor',
        code: `// Create a custom interceptor
const timingInterceptor = async (envelope, ctx, next) => {
  const start = Date.now()

  try {
    const result = await next()
    const duration = Date.now() - start
    console.log(\`\${envelope.procedure} took \${duration}ms\`)
    return result
  } catch (error) {
    const duration = Date.now() - start
    console.log(\`\${envelope.procedure} failed after \${duration}ms\`)
    throw error
  }
}

server.use(timingInterceptor)`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Express-style middleware',
        code: `// WRONG - Raffel interceptors are not (req, res, next)
server.use((req, res, next) => {
  console.log(req.url)
  next()
})`,
        description:
          'Raffel interceptors receive (envelope, ctx, next) and must return next() result.',
      },
      {
        title: 'Wrong: Not awaiting/returning next()',
        code: `// WRONG - Must return the result of next()
server.use(async (envelope, ctx, next) => {
  console.log('before')
  next()  // Missing return!
  console.log('after')
})`,
        description: 'Always return await next() to properly chain interceptors.',
      },
      {
        title: 'Wrong: Middleware after procedures',
        code: `// WRONG - Middleware should come before procedures
const server = createServer()
  .procedure('users.list').handler(async () => [])
  .use(authMiddleware)  // Too late! Won't apply to users.list`,
        description:
          'Apply .use() before defining procedures, or use forPattern/forProcedures.',
      },
    ],
    why: 'The onion model ensures interceptors wrap handlers cleanly. Composition helpers provide fine-grained control without complex conditionals.',
  },

  // === Pattern 4: Providers (Dependency Injection) ===
  {
    name: 'Providers (Dependency Injection)',
    description:
      'Providers register singleton dependencies that are initialized at server.start(). In new code, prefer consuming them via ctx.services instead of broad top-level bags. Do not use providers as a substitute for framework lifecycle plugins.',
    components: ['provide', 'ProviderFactory', 'onShutdown'],
    signature: `.provide('name', factoryFn, options?)

// Factory receives ResolvedProviders of already-registered providers
type ProviderFactory<T> = (deps: ResolvedProviders) => T | Promise<T>

// Options
{
  onShutdown?: (instance: T) => Promise<void>  // Cleanup on server.stop()
}

// Preferred access in handlers
const services = ctx.services as {
  db: PrismaClient
  redis: Redis
}`,
    correctExamples: [
      {
        title: 'Database Provider',
        code: `import { createServer } from 'raffel'
import { PrismaClient } from '@prisma/client'

const server = createServer()
  .provide('db', async () => {
    const prisma = new PrismaClient()
    await prisma.$connect()
    return prisma
  }, {
    onShutdown: async (prisma) => {
      await prisma.$disconnect()
    }
  })

  .procedure('users.list')
    .handler(async (input, ctx) => {
      const services = ctx.services as { db: PrismaClient }
      return await services.db.users.findMany()
    })`,
      },
      {
        title: 'Multiple Providers',
        code: `import { createServer } from 'raffel'
import Redis from 'ioredis'

const server = createServer()
  // Redis provider
  .provide('redis', () => new Redis(process.env.REDIS_URL), {
    onShutdown: (redis) => redis.quit()
  })

  // Cache depends on Redis
  .provide('cache', ({ redis }) => ({
    get: (key) => redis.get(key).then(JSON.parse),
    set: (key, val, ttl) => redis.setex(key, ttl, JSON.stringify(val))
  }))

  .procedure('data.get')
    .handler(async ({ key }, ctx) => {
      // Try cache first
      const cached = await ctx.cache.get(key)
      if (cached) return cached

      // Fetch and cache
      const data = await fetchData(key)
      await ctx.cache.set(key, data, 300)
      return data
    })`,
      },
      {
        title: 'External API Client Provider',
        code: `import { createServer } from 'raffel'
import { Client } from 'recker'

const server = createServer()
  .provide('stripeApi', () => new Client({
    baseUrl: 'https://api.stripe.com/v1',
    headers: { Authorization: \`Bearer \${process.env.STRIPE_KEY}\` },
    retry: { attempts: 3 }
  }))

  .procedure('payments.create')
    .handler(async (input, ctx) => {
      return await ctx.stripeApi.post('/charges', { body: input })
    })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Global variable instead of provider',
        code: `// WRONG - Don't use global variables
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()  // Global, no lifecycle management!

const server = createServer()
  .procedure('users.list')
    .handler(async () => db.users.findMany())`,
        description:
          "Global variables don't get proper cleanup on server.stop() and can't be typed in context.",
      },
      {
        title: 'Wrong: Creating client in handler',
        code: `// WRONG - Creates new connection per request
server.procedure('users.list')
  .handler(async () => {
    const db = new PrismaClient()  // Connection created per request!
    return await db.users.findMany()
  })`,
        description:
          'Creating clients in handlers wastes resources. Use providers for singletons.',
      },
    ],
    why: 'Providers ensure proper lifecycle management (connect on start, cleanup on stop), dependency resolution, and type-safe access in handlers. They are for dependencies, not framework boot kernels.',
  },

  // === Pattern 5: Server Plugins ===
  {
    name: 'Server Plugins',
    description:
      'Server plugins extend the Raffel runtime itself. Use them to register framework-owned handlers, run startup/shutdown orchestration, and attach namespaced metadata to server.preview().',
    components: ['ServerPlugin', 'usePlugin', 'plugins', 'preview'],
    signature: `type ServerPlugin = {
  name: string
  register?: ({ server }) => void
  beforeStart?: ({ server, providers, signal }) => void | Promise<void>
  afterStart?: ({ server, providers, signal }) => void | Promise<void>
  beforeStop?: ({ server, providers, signal }) => void | Promise<void>
  afterStop?: ({ server, providers, signal }) => void | Promise<void>
  inspect?: ({ server, providers, preview }) => RuntimeInspectionContribution | RuntimeInspectionContribution[] | void
}

createServer({
  port: 3000,
  plugins: [myPlugin],
})

server.usePlugin(myPlugin)`,
    correctExamples: [
      {
        title: 'Framework Plugin',
        code: `import { createServer, type ServerPlugin } from 'raffel'

const frameworkPlugin: ServerPlugin = {
  name: 'purple',

  register({ server }) {
    server.procedure('purple.health').handler(async () => ({ ok: true }))
  },

  async beforeStart({ providers }) {
    const services = providers as { db?: { ping(): Promise<void> } }
    await services.db?.ping()
  },

  inspect: ({ preview }) => ({
    namespace: 'purple',
    title: 'Purple Runtime',
    nodes: [
      {
        id: 'purple:summary',
        kind: 'summary',
        label: 'Purple Summary',
        data: { operationCount: preview.operations.length },
      },
    ],
  }),
}

const server = createServer({ port: 3000, plugins: [frameworkPlugin] })`,
      },
      {
        title: 'Providers + Plugins',
        code: `const server = createServer({ port: 3000 })
  .provide('db', () => createDatabase())
  .usePlugin({
    name: 'runtime-bootstrap',
    beforeStart: async ({ providers }) => {
      const services = providers as { db: { migrate(): Promise<void> } }
      await services.db.migrate()
    },
  })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Boot logic inside provider setup semantics',
        code: `// WRONG - This mixes DI and runtime orchestration
defineProvider({
  async setup({ server, db }) {
    server.procedure('purple.health').handler(async () => 'ok')
    await db.migrate()
  },
})`,
        description:
          'If the abstraction registers handlers or orchestrates startup, it should be a ServerPlugin, not a provider.',
      },
      {
        title: 'Wrong: Registering plugin after start',
        code: `const server = createServer({ port: 3000 })

await server.start()
server.usePlugin(myPlugin) // Error`,
        description:
          'Plugins must be registered before server.start() so registration and lifecycle are deterministic.',
      },
    ],
    why: 'Plugins give frameworks a stable extension surface without forcing them to create a second runtime around Raffel.',
  },
]
