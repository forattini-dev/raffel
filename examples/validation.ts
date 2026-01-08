/**
 * Schema Validation Example
 *
 * Demonstrates how to use Zod schemas for type-safe input/output validation
 * in Raffel handlers.
 */

import {
  createRegistry,
  createRouter,
  createHttpAdapter,
  createValidationInterceptor,
  createSchemaValidationInterceptor,
  createSchemaRegistry,
  z,
  type InferInput,
  type InferOutput,
  type HandlerSchema,
} from '../src/index.js'

// === Define Schemas ===

// User schema with validation rules
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
})

// Create user input schema (id is generated)
const CreateUserInputSchema = UserSchema.omit({ id: true })

// Create user output schema
const CreateUserOutputSchema = UserSchema

// Type inference from schemas
type CreateUserInput = z.infer<typeof CreateUserInputSchema>
type CreateUserOutput = z.infer<typeof CreateUserOutputSchema>

// === Setup Registry ===

const registry = createRegistry()
const router = createRouter(registry)
const schemaRegistry = createSchemaRegistry()

// === Method 1: Handler-level validation interceptor ===

const greetSchema: HandlerSchema<{ name: string }, { message: string }> = {
  input: z.object({ name: z.string().min(1, 'Name is required') }),
  output: z.object({ message: z.string() }),
}

registry.procedure(
  'greet',
  async (input: InferInput<typeof greetSchema>) => {
    return { message: `Hello, ${input.name}!` }
  },
  {
    description: 'Greet a user by name',
    interceptors: [createValidationInterceptor(greetSchema)],
  }
)

// === Method 2: Global schema registry ===

// Register schema separately from handler
schemaRegistry.register('users.create', {
  input: CreateUserInputSchema,
  output: CreateUserOutputSchema,
})

// Add global validation interceptor
router.use(createSchemaValidationInterceptor(schemaRegistry))

// Handler without explicit validation (handled by global interceptor)
registry.procedure('users.create', async (input: CreateUserInput): Promise<CreateUserOutput> => {
  // Input is already validated at this point
  return {
    id: crypto.randomUUID(),
    ...input,
    role: input.role ?? 'user',
  }
})

// === Method 3: Complex validation patterns ===

const searchSchema: HandlerSchema = {
  input: z.object({
    query: z.string().min(1).max(500),
    filters: z
      .object({
        category: z.string().optional(),
        minPrice: z.number().positive().optional(),
        maxPrice: z.number().positive().optional(),
        tags: z.array(z.string()).max(10).optional(),
      })
      .optional(),
    pagination: z.object({
      page: z.number().int().positive().default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    sort: z
      .object({
        field: z.string(),
        order: z.enum(['asc', 'desc']).default('asc'),
      })
      .optional(),
  }),
  output: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        score: z.number(),
      })
    ),
    total: z.number(),
    page: z.number(),
    pages: z.number(),
  }),
}

schemaRegistry.register('search', searchSchema)

registry.procedure('search', async (input) => {
  const { pagination } = input as z.infer<(typeof searchSchema)['input']>
  // Simulated search results
  return {
    results: [
      { id: '1', title: 'Result 1', score: 0.95 },
      { id: '2', title: 'Result 2', score: 0.87 },
    ],
    total: 2,
    page: pagination.page,
    pages: 1,
  }
})

// === Method 4: Union types and discriminated unions ===

const notificationSchema: HandlerSchema = {
  input: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('email'),
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    z.object({
      type: z.literal('sms'),
      phone: z.string().regex(/^\+[1-9]\d{1,14}$/),
      message: z.string().max(160),
    }),
    z.object({
      type: z.literal('push'),
      deviceToken: z.string(),
      title: z.string(),
      body: z.string(),
      data: z.record(z.string()).optional(),
    }),
  ]),
}

schemaRegistry.register('notify', notificationSchema)

registry.procedure('notify', async (input) => {
  const notification = input as z.infer<(typeof notificationSchema)['input']>

  switch (notification.type) {
    case 'email':
      console.log(`Sending email to ${notification.to}`)
      break
    case 'sms':
      console.log(`Sending SMS to ${notification.phone}`)
      break
    case 'push':
      console.log(`Sending push to ${notification.deviceToken}`)
      break
  }

  return { sent: true }
})

// === Method 5: Transformations and coercion ===

const dateRangeSchema: HandlerSchema = {
  input: z.object({
    // Coerce string dates to Date objects
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    // Transform to lowercase
    timezone: z.string().toLowerCase().default('utc'),
  }),
}

schemaRegistry.register('analytics.query', dateRangeSchema)

registry.procedure('analytics.query', async (input) => {
  const { startDate, endDate, timezone } = input as z.infer<(typeof dateRangeSchema)['input']>

  return {
    period: `${startDate.toISOString()} to ${endDate.toISOString()}`,
    timezone,
    data: [],
  }
})

// === Start Server ===

const httpAdapter = createHttpAdapter(router, { port: 3000 })

async function main() {
  await httpAdapter.start()

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║             Raffel Validation Example Server                 ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  HTTP Server: http://localhost:3000                          ║
║                                                              ║
║  Try these requests:                                         ║
║                                                              ║
║  1. Valid greet request:                                     ║
║     curl -X POST http://localhost:3000/greet \\               ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"name": "World"}'                                 ║
║                                                              ║
║  2. Invalid greet request (empty name):                      ║
║     curl -X POST http://localhost:3000/greet \\               ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"name": ""}'                                      ║
║                                                              ║
║  3. Create user:                                             ║
║     curl -X POST http://localhost:3000/users.create \\        ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"name": "John", "email": "john@example.com"}'     ║
║                                                              ║
║  4. Invalid user (bad email):                                ║
║     curl -X POST http://localhost:3000/users.create \\        ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"name": "John", "email": "not-an-email"}'         ║
║                                                              ║
║  5. Search with pagination:                                  ║
║     curl -X POST http://localhost:3000/search \\              ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"query": "test", "pagination": {"page": 1}}'      ║
║                                                              ║
║  6. Send notification (discriminated union):                 ║
║     curl -X POST http://localhost:3000/notify \\              ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"type": "email", "to": "a@b.com",                 ║
║            "subject": "Hi", "body": "Hello!"}'               ║
║                                                              ║
║  7. Analytics with date coercion:                            ║
║     curl -X POST http://localhost:3000/analytics.query \\     ║
║       -H "Content-Type: application/json" \\                  ║
║       -d '{"startDate": "2025-01-01", "endDate": "2025-12-31"}'║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await httpAdapter.stop()
    process.exit(0)
  })
}

main().catch(console.error)
