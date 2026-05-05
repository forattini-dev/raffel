import type { PatternDoc } from '../types.js'

export const advancedPatterns: PatternDoc[] = [
  // === Pattern 6: Router Modules ===
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
    .handler(async (_input, ctx) => {
      const services = ctx.services as { users: { list(): Promise<unknown[]> } }
      return services.users.list()
    })

  .procedure('get')
    .input(z.object({ id: z.string() }))
    .output(UserSchema)
    .handler(async ({ id }, ctx) => {
      const services = ctx.services as { users: { get(id: string): Promise<unknown> } }
      return services.users.get(id)
    })

  .procedure('create')
    .input(CreateUserSchema)
    .output(UserSchema)
    .handler(async (input, ctx) => {
      const services = ctx.services as { users: { create(data: unknown): Promise<unknown> } }
      return services.users.create(input)
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
    .handler(async (_, ctx) => {
      const services = ctx.services as { users: { list(): Promise<unknown[]> } }
      return services.users.list()
    })

  .procedure('create')
    .handler(async (input, ctx) => {
      const services = ctx.services as { users: { create(data: unknown): Promise<unknown> } }
      return services.users.create(input)
    })

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
      const services = ctx.services as {
        users: { create(args: { data: unknown }): Promise<unknown> }
      }
      return await services.users.create({ data: input })
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
    const services = ctx.services as {
      orders: { create(args: { data: unknown }): Promise<unknown> }
    }
    return await services.orders.create({ data: input })
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
  DEADLINE_EXCEEDED    // 408
}

// Global error hook
onError: (error, protocol, ctx) => { ... }`,
    correctExamples: [
      {
        title: 'Throwing Typed Errors',
        code: `import { RaffelError, ErrorCodes } from 'raffel'

server.procedure('users.get')
  .handler(async ({ id }, ctx) => {
    const services = ctx.services as { users: { get(id: string): Promise<unknown> } }
    const user = await services.users.get(id)

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
    const services = ctx.services as {
      users: {
        findByEmail(email: string): Promise<unknown>
        create(data: unknown): Promise<unknown>
      }
    }
    const existing = await services.users.findByEmail(input.email)

    if (existing) {
      throw new RaffelError(
        ErrorCodes.ALREADY_EXISTS,
        'Email already registered',
        { email: input.email }
      )
    }

    return await services.users.create(input)
  })`,
      },
      {
        title: 'Using Errors Helper',
        code: `import { Errors } from 'raffel'

server.procedure('orders.process')
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) {
      throw Errors.unauthenticated('Login required')
    }

    if (!ctx.auth?.roles?.includes('admin')) {
      throw Errors.permissionDenied('Admin access required')
    }

    const services = ctx.services as {
      orders: { get(id: string): Promise<unknown> }
    }
    const order = await services.orders.get(input.id)
    if (!order) {
      throw Errors.notFound(\`Order \${input.id} not found\`)
    }

    return await processOrder(order)
  })`,
      },
      {
        title: 'Global Error Hook',
        code: `const server = createServer({
  onError: async (error, protocol, ctx) => {
    // Log all errors
    console.error({
      requestId: ctx?.requestId,
      protocol,
      error: error.message,
      code: (error as any).code,
      stack: error.stack
    })

    // Report to error tracking
    if ((error as any).code === 'INTERNAL_ERROR') {
      await Sentry.captureException(error)
    }
  }
})`,
      },
      {
        title: 'Per-Procedure Error Hook',
        code: `server.procedure('payments.charge')
  .error(async (error, ctx) => {
    // Payment-specific error handling
    const services = ctx.services as {
      payments: {
        update(args: { where: { id: string }, data: Record<string, unknown> }): Promise<unknown>
      }
    }
    await services.payments.update({
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
    const services = ctx.services as {
      records: { streamCursor(input: unknown): AsyncIterable<unknown> }
    }
    const cursor = services.records.streamCursor(input)
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
        const services = ctx.services as {
          messages: { create(data: unknown): Promise<unknown> }
        }
        const saved = await services.messages.create(message)
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
    await ctx.emit('analytics.pageView', { page: input.path, userId: ctx.auth?.principalId })
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
        const services = ctx.services as {
          devices: { delete(args: { where: { id: string } }): Promise<unknown> }
        }
        await services.devices.delete({ where: { id: payload.deviceId } })
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
