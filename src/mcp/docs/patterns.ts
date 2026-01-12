/**
 * Raffel MCP - API Patterns Documentation
 *
 * CRITICAL: These patterns teach AI how to correctly construct Raffel code.
 * Each pattern shows correct and incorrect examples to prevent invalid code generation.
 */

import type { PatternDoc } from '../types.js'

export const patterns: PatternDoc[] = [
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
    .handler(async (input, ctx) => {
      return await db.users.findMany()
    })

  .procedure('users.get')
    .handler(async ({ id }, ctx) => {
      return await db.users.findUnique({ where: { id } })
    })

  .procedure('users.create')
    .handler(async (input, ctx) => {
      return await db.users.create({ data: input })
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
      return await db.users.create({ data: input })
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
      'Providers register singleton dependencies that are initialized at server.start() and available in ctx. Use for database clients, cache connections, external APIs.',
    components: ['provide', 'ProviderFactory', 'onShutdown'],
    signature: `.provide('name', factoryFn, options?)

// Factory receives ResolvedProviders of already-registered providers
type ProviderFactory<T> = (deps: ResolvedProviders) => T | Promise<T>

// Options
{
  onShutdown?: (instance: T) => Promise<void>  // Cleanup on server.stop()
}

// Access in handlers
ctx.db     // If registered as 'db'
ctx.redis  // If registered as 'redis'`,
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
      // ctx.db is PrismaClient, fully typed!
      return await ctx.db.users.findMany()
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
    why: 'Providers ensure proper lifecycle management (connect on start, cleanup on stop), dependency resolution, and type-safe access in handlers.',
  },

  // === Pattern 5: Router Modules ===
  {
    name: 'Router Modules',
    description:
      'Router modules encapsulate related procedures for modular code organization. They can be mounted at a path prefix and composed with module-specific interceptors.',
    components: ['createRouterModule', 'mount', 'loadRouterModule'],
    signature: `// Create a module
const usersModule = createRouterModule()
  .use(moduleInterceptor)
  .procedure('list').handler(fn)
  .procedure('get').handler(fn)

// Mount on server
server.mount('/users', usersModule)

// File-based discovery
// src/http/users.ts exports default createRouterModule()...
// Auto-loaded as users.*`,
    correctExamples: [
      {
        title: 'Creating a Router Module',
        code: `// src/modules/users.ts
import { createRouterModule } from 'raffel'
import { z } from 'zod'

export const usersModule = createRouterModule()
  .procedure('list')
    .output(z.array(UserSchema))
    .handler(async (input, ctx) => {
      return await ctx.db.users.findMany()
    })

  .procedure('get')
    .input(z.object({ id: z.string() }))
    .output(UserSchema)
    .handler(async ({ id }, ctx) => {
      return await ctx.db.users.findUnique({ where: { id } })
    })

  .procedure('create')
    .input(CreateUserSchema)
    .output(UserSchema)
    .handler(async (input, ctx) => {
      return await ctx.db.users.create({ data: input })
    })`,
      },
      {
        title: 'Mounting Modules',
        code: `// src/server.ts
import { createServer } from 'raffel'
import { usersModule } from './modules/users'
import { ordersModule } from './modules/orders'
import { adminModule } from './modules/admin'

const server = createServer()
  // Mount modules at prefixes
  .mount('/users', usersModule)   // users.list, users.get, users.create
  .mount('/orders', ordersModule) // orders.list, orders.get, ...
  .mount('/admin', adminModule, {
    interceptors: [requireAdmin]  // Module-specific middleware
  })`,
      },
      {
        title: 'File-Based Discovery',
        code: `// src/http/users.ts (file-based routing)
import { createRouterModule } from 'raffel'

export default createRouterModule()
  .procedure('list')
    .handler(async (_, ctx) => ctx.db.users.findMany())

  .procedure('create')
    .handler(async (input, ctx) => ctx.db.users.create({ data: input }))

// Server auto-discovers:
// src/http/users.ts → users.list, users.create
// src/http/orders.ts → orders.list, orders.create

import { createServer, loadRouterModule } from 'raffel'

const server = createServer({ discovery: true })
await server.start()`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Using server methods in module',
        code: `// WRONG - Modules don't have server methods
const module = createRouterModule()
  .start()  // Error! Modules don't have start()
  .provide('db', fn)  // Error! Modules don't have provide()`,
        description: 'Router modules only have procedure/stream/event/use methods.',
      },
      {
        title: 'Wrong: Mounting without prefix',
        code: `// WRONG - mount() requires a prefix
server.mount(usersModule)  // Error! Missing prefix

// CORRECT
server.mount('/users', usersModule)`,
        description: 'The first argument to mount() must be the path prefix.',
      },
    ],
    why: 'Router modules enable clean separation of concerns, team ownership of domains, and modular testing.',
  },

  // === Pattern 6: Validation Schemas ===
  {
    name: 'Validation Schemas',
    description:
      'Input and output validation using your preferred validator (Zod, Yup, Joi, Ajv). Register the validator once, then use schemas in procedure definitions.',
    components: ['registerValidator', 'input', 'output', 'createValidationInterceptor'],
    signature: `// 1. Register validator (once, at startup)
import { z } from 'zod'
import { registerValidator, createZodAdapter } from 'raffel'

registerValidator(createZodAdapter(z))

// 2. Use schemas in procedures
.procedure('name')
  .input(z.object({ ... }))   // Validates request
  .output(z.object({ ... }))  // Validates response
  .handler(fn)`,
    correctExamples: [
      {
        title: 'Zod Validation',
        code: `import { createServer, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

// Register Zod adapter
registerValidator(createZodAdapter(z))

// Define schemas
const CreateUserInput = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  age: z.number().min(0).optional()
})

const UserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  age: z.number().optional(),
  createdAt: z.date()
})

const server = createServer()
  .procedure('users.create')
    .input(CreateUserInput)
    .output(UserOutput)
    .handler(async (input, ctx) => {
      // input is typed as { name: string, email: string, age?: number }
      return await ctx.db.users.create({ data: input })
    })`,
      },
      {
        title: 'Yup Validation',
        code: `import { createServer, registerValidator, createYupAdapter } from 'raffel'
import * as yup from 'yup'

registerValidator(createYupAdapter(yup))

const CreateOrderInput = yup.object({
  items: yup.array().of(yup.object({
    productId: yup.string().required(),
    quantity: yup.number().positive().integer().required()
  })).min(1).required(),
  shippingAddress: yup.string().required()
})

server.procedure('orders.create')
  .input(CreateOrderInput)
  .handler(async (input, ctx) => {
    return await ctx.db.orders.create({ data: input })
  })`,
      },
      {
        title: 'Multiple Validators',
        code: `import { registerValidator, createZodAdapter, createJoiAdapter } from 'raffel'
import { z } from 'zod'
import Joi from 'joi'

// Register multiple adapters
registerValidator(createZodAdapter(z))
registerValidator(createJoiAdapter(Joi), 'joi')

// Use Zod (default)
.procedure('users.create')
  .input(z.object({ name: z.string() }))

// Use Joi explicitly
.procedure('orders.create')
  .input(Joi.object({ total: Joi.number() }), { validator: 'joi' })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Using schema without registering adapter',
        code: `// WRONG - Forgot to register the adapter
import { z } from 'zod'

server.procedure('users.create')
  .input(z.object({ name: z.string() }))  // Error! No adapter registered`,
        description: 'Must call registerValidator(createZodAdapter(z)) first.',
      },
      {
        title: 'Wrong: Manual validation in handler',
        code: `// WRONG - Don't validate manually
server.procedure('users.create')
  .handler(async (input, ctx) => {
    // Unnecessary - use .input() instead
    const result = schema.safeParse(input)
    if (!result.success) throw new Error('Invalid')
    return await db.create(result.data)
  })`,
        description: 'Use .input() and .output() for automatic validation.',
      },
    ],
    why: 'Declarative validation is cleaner, generates OpenAPI specs, provides consistent error responses, and types handlers automatically.',
  },

  // === Pattern 7: Error Handling ===
  {
    name: 'Error Handling',
    description:
      'Use RaffelError for typed errors with codes. Error codes map to HTTP status codes automatically. Use error hooks for global error handling.',
    components: ['RaffelError', 'ErrorCodes', 'Errors', 'error hook'],
    signature: `// Throw typed errors
throw new RaffelError(code, message, details?)

// Error codes
ErrorCodes = {
  INVALID_ARGUMENT,    // 400
  UNAUTHENTICATED,     // 401
  PERMISSION_DENIED,   // 403
  NOT_FOUND,           // 404
  ALREADY_EXISTS,      // 409
  RESOURCE_EXHAUSTED,  // 429
  INTERNAL,            // 500
  UNAVAILABLE,         // 503
  DEADLINE_EXCEEDED    // 504
}

// Global error hook
.error(async (error, ctx) => { ... })`,
    correctExamples: [
      {
        title: 'Throwing Typed Errors',
        code: `import { RaffelError, ErrorCodes } from 'raffel'

server.procedure('users.get')
  .handler(async ({ id }, ctx) => {
    const user = await ctx.db.users.findUnique({ where: { id } })

    if (!user) {
      throw new RaffelError(
        ErrorCodes.NOT_FOUND,
        \`User \${id} not found\`,
        { userId: id }
      )
    }

    return user
  })

server.procedure('users.create')
  .handler(async (input, ctx) => {
    const existing = await ctx.db.users.findByEmail(input.email)

    if (existing) {
      throw new RaffelError(
        ErrorCodes.ALREADY_EXISTS,
        'Email already registered',
        { email: input.email }
      )
    }

    return await ctx.db.users.create({ data: input })
  })`,
      },
      {
        title: 'Using Errors Helper',
        code: `import { Errors } from 'raffel'

server.procedure('orders.process')
  .handler(async (input, ctx) => {
    if (!ctx.auth.authenticated) {
      throw Errors.unauthenticated('Login required')
    }

    if (!ctx.auth.principal.roles.includes('admin')) {
      throw Errors.permissionDenied('Admin access required')
    }

    const order = await ctx.db.orders.findUnique({ where: { id: input.id } })
    if (!order) {
      throw Errors.notFound(\`Order \${input.id} not found\`)
    }

    return await processOrder(order)
  })`,
      },
      {
        title: 'Global Error Hook',
        code: `const server = createServer()
  .error(async (error, ctx) => {
    // Log all errors
    console.error({
      requestId: ctx.requestId,
      procedure: ctx.procedure,
      error: error.message,
      code: error.code,
      stack: error.stack
    })

    // Report to error tracking
    if (error.code === 'INTERNAL') {
      await Sentry.captureException(error)
    }

    // Don't modify the error - just observe
  })`,
      },
      {
        title: 'Per-Procedure Error Hook',
        code: `server.procedure('payments.charge')
  .error(async (error, ctx) => {
    // Payment-specific error handling
    await ctx.db.payments.update({
      where: { id: ctx.paymentId },
      data: { status: 'failed', error: error.message }
    })
  })
  .handler(async (input, ctx) => {
    ctx.paymentId = input.paymentId
    return await stripe.charges.create(input)
  })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Throwing plain Error',
        code: `// WRONG - Use RaffelError for proper error codes
server.procedure('users.get')
  .handler(async ({ id }) => {
    const user = await db.findUser(id)
    if (!user) {
      throw new Error('User not found')  // Returns 500, not 404!
    }
  })`,
        description:
          'Plain Error becomes INTERNAL (500). Use RaffelError with proper code.',
      },
      {
        title: 'Wrong: Catching and re-throwing incorrectly',
        code: `// WRONG - Loses error code
server.procedure('users.create')
  .handler(async (input) => {
    try {
      return await db.create(input)
    } catch (e) {
      throw new Error(e.message)  // Loses original error code!
    }
  })`,
        description: 'Re-throw RaffelError or create new one with proper code.',
      },
    ],
    why: 'Typed errors ensure consistent error responses across protocols. HTTP, gRPC, and WebSocket all map errors correctly from error codes.',
  },

  // === Pattern 8: Streaming ===
  {
    name: 'Streaming',
    description:
      'Streaming handlers use async generators to yield data progressively. Use createStream() for more control over backpressure and multiplexing.',
    components: ['stream', 'createStream', 'RaffelStream', 'ServerStreamHandler'],
    signature: `// Simple generator
.stream('name')
  .handler(async function* (input, ctx) {
    yield chunk1
    yield chunk2
  })

// With RaffelStream for control
.stream('name')
  .handler(async function* (input, ctx) {
    const stream = createStream({ highWaterMark: 100 })

    // Write from external source
    source.on('data', (chunk) => stream.write(chunk))
    source.on('end', () => stream.end())

    // Yield from stream
    for await (const chunk of stream) {
      yield chunk
    }
  })`,
    correctExamples: [
      {
        title: 'Simple Server Stream',
        code: `server.stream('logs.tail')
  .handler(async function* (input, ctx) {
    const { filter, limit = 100 } = input
    let count = 0

    while (!ctx.signal.aborted && count < limit) {
      const logs = await getNewLogs(filter)

      for (const log of logs) {
        yield log
        count++
      }

      await sleep(1000)
    }
  })`,
      },
      {
        title: 'Stream with Backpressure',
        code: `import { createStream } from 'raffel'

server.stream('data.export')
  .handler(async function* (input, ctx) {
    const stream = createStream({
      highWaterMark: 50  // Buffer up to 50 items
    })

    // Producer
    const cursor = ctx.db.records.findMany({ cursor: true })
    for await (const record of cursor) {
      // write() returns false if buffer is full
      const ready = stream.write(record)
      if (!ready) {
        // Wait for consumer to catch up
        await stream.drain()
      }
    }
    stream.end()

    // Consumer
    for await (const chunk of stream) {
      yield chunk
    }
  })`,
      },
      {
        title: 'Bidirectional Stream',
        code: `server.stream('chat.room', { direction: 'bidi' })
  .handler(async function* (inputStream, ctx) {
    const output = createStream()

    // Handle incoming messages
    ;(async () => {
      for await (const message of inputStream) {
        // Process and broadcast
        const saved = await ctx.db.messages.create({ data: message })
        output.write({ type: 'message', data: saved })
      }
    })()

    // Yield outgoing messages
    for await (const msg of output) {
      yield msg
    }
  })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Regular async function for stream',
        code: `// WRONG - Streams must be generators
server.stream('logs.tail')
  .handler(async (input, ctx) => {
    return [log1, log2, log3]  // Returns array, not stream!
  })`,
        description:
          'Use async function* (generator) for streaming, not regular async function.',
      },
      {
        title: 'Wrong: Blocking generator',
        code: `// WRONG - Blocks without yielding
server.stream('data.process')
  .handler(async function* (input, ctx) {
    const allData = await fetchAllData()  // Waits for ALL data
    for (const item of allData) {
      yield item
    }
  })`,
        description:
          'Yield progressively as data becomes available, not after fetching all.',
      },
    ],
    why: 'Generators enable progressive data transfer without loading everything in memory. Backpressure prevents fast producers from overwhelming slow consumers.',
  },

  // === Pattern 9: Events ===
  {
    name: 'Event Delivery',
    description:
      'Events are fire-and-forget by default. Use delivery guarantees (at-least-once, at-most-once) for reliability. Ack function confirms successful processing.',
    components: ['event', 'delivery', 'retryPolicy', 'deduplicationWindow', 'ack'],
    signature: `.event('name')
  .delivery('at-least-once')     // Retry until ack
  .retryPolicy({                  // Retry config
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  })
  .handler(async (payload, ctx, ack) => {
    await process(payload)
    ack()  // Acknowledge success
  })`,
    correctExamples: [
      {
        title: 'Best-Effort Event (Default)',
        code: `server.event('analytics.pageView')
  .handler(async (payload, ctx) => {
    // Fire and forget - no retry
    await analytics.track(payload)
  })

// Emit from a procedure
server.procedure('pages.view')
  .handler(async (input, ctx) => {
    await ctx.emit('analytics.pageView', { page: input.path, userId: ctx.auth?.principal })
    return { ok: true }
  })`,
      },
      {
        title: 'At-Least-Once Delivery',
        code: `server.event('orders.created')
  .delivery('at-least-once')
  .retryPolicy({
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  })
  .handler(async (payload, ctx, ack) => {
    // Process order - will retry if fails
    await sendConfirmationEmail(payload)
    await updateInventory(payload)

    // Acknowledge successful processing
    ack()
  })`,
      },
      {
        title: 'At-Most-Once with Deduplication',
        code: `server.event('payments.processed')
  .delivery('at-most-once')
  .deduplicationWindow(60000)  // 1 minute window
  .handler(async (payload, ctx) => {
    // Will only process once even if emitted multiple times
    await notifyUser(payload)
  })`,
      },
      {
        title: 'Event with Error Handling',
        code: `server.event('notifications.send')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 3 })
  .handler(async (payload, ctx, ack) => {
    try {
      await sendPushNotification(payload)
      ack()
    } catch (error) {
      if (error.code === 'DEVICE_NOT_REGISTERED') {
        // Don't retry - device is invalid
        await ctx.db.devices.delete({ where: { id: payload.deviceId } })
        ack()  // Acknowledge to stop retries
      }
      // Other errors: don't ack, will retry
      throw error
    }
  })`,
      },
    ],
    wrongExamples: [
      {
        title: 'Wrong: Ack before processing',
        code: `// WRONG - Ack should be after successful processing
server.event('orders.process')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    ack()  // Too early! What if processing fails?
    await processOrder(payload)
  })`,
        description:
          'Only call ack() after successful processing to enable retries on failure.',
      },
      {
        title: 'Wrong: Not handling ack parameter',
        code: `// WRONG - at-least-once requires ack
server.event('critical.event')
  .delivery('at-least-once')
  .handler(async (payload, ctx) => {
    // Missing ack parameter - will retry forever!
    await process(payload)
  })`,
        description:
          'For at-least-once, always include and call the ack parameter.',
      },
    ],
    why: 'Event delivery guarantees ensure critical events are processed reliably. Ack pattern enables exactly-once processing semantics.',
  },
]

export function getPattern(name: string): PatternDoc | undefined {
  return patterns.find((p) => p.name.toLowerCase().includes(name.toLowerCase()))
}

export function listPatterns(): PatternDoc[] {
  return patterns
}

export function searchPatterns(query: string): PatternDoc[] {
  const lowerQuery = query.toLowerCase()
  return patterns.filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.components.some((c) => c.toLowerCase().includes(lowerQuery))
  )
}
