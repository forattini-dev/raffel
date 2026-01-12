/**
 * Raffel MCP - Prompts
 *
 * Pre-defined prompts for guiding AI code generation.
 */

import type { MCPPrompt, MCPPromptResult } from '../types.js'

// === Prompt Definitions ===

export const prompts: MCPPrompt[] = [
  // === Creation Prompts ===
  {
    name: 'create_rest_api',
    description: 'Build a complete REST API with Raffel including CRUD operations, validation, and error handling',
    arguments: [
      { name: 'resource', description: 'Resource name (e.g., users, products, orders)', required: true },
      { name: 'fields', description: 'Comma-separated field definitions (e.g., name:string, email:email, age:number)', required: false },
      { name: 'with_auth', description: 'Include authentication (yes/no)', required: false },
    ],
  },
  {
    name: 'create_realtime_server',
    description: 'Build a real-time server with WebSocket support, pub/sub channels, and streaming',
    arguments: [
      { name: 'use_case', description: 'Use case (chat, notifications, live-updates, gaming)', required: true },
      { name: 'channels', description: 'Channel names to create', required: false },
    ],
  },
  {
    name: 'create_grpc_service',
    description: 'Build a gRPC service with Raffel supporting unary and streaming methods',
    arguments: [
      { name: 'service_name', description: 'Service name (e.g., UserService, OrderService)', required: true },
      { name: 'methods', description: 'Method names to include', required: false },
    ],
  },
  {
    name: 'create_microservice',
    description: 'Build a production-ready microservice with health checks, metrics, tracing, and resilience',
    arguments: [
      { name: 'service_name', description: 'Service name', required: true },
      { name: 'dependencies', description: 'External dependencies (database, redis, api)', required: false },
    ],
  },

  // === Feature Prompts ===
  {
    name: 'add_authentication',
    description: 'Add authentication to an existing Raffel server with JWT or API key',
    arguments: [
      { name: 'auth_type', description: 'Authentication type (jwt, api-key, both)', required: true },
      { name: 'protected_routes', description: 'Routes to protect (e.g., users.*, admin.**)', required: false },
    ],
  },
  {
    name: 'add_caching',
    description: 'Add caching layer with configurable drivers (memory, Redis, S3DB)',
    arguments: [
      { name: 'driver', description: 'Cache driver (memory, redis, s3db)', required: true },
      { name: 'cached_procedures', description: 'Procedures to cache', required: false },
    ],
  },
  {
    name: 'add_rate_limiting',
    description: 'Add rate limiting with per-procedure or global limits',
    arguments: [
      { name: 'strategy', description: 'Strategy (global, per-procedure, per-user)', required: true },
      { name: 'limits', description: 'Rate limits configuration', required: false },
    ],
  },
  {
    name: 'add_observability',
    description: 'Add metrics (Prometheus) and distributed tracing (OpenTelemetry)',
    arguments: [
      { name: 'metrics_path', description: 'Metrics endpoint path', required: false },
      { name: 'tracer', description: 'Tracer type (console, jaeger, zipkin)', required: false },
    ],
  },

  // === Migration Prompts ===
  {
    name: 'migrate_from_express',
    description: 'Convert Express.js routes to Raffel procedures',
    arguments: [
      { name: 'express_code', description: 'Express route code to convert', required: true },
    ],
  },
  {
    name: 'migrate_from_fastify',
    description: 'Convert Fastify routes to Raffel procedures',
    arguments: [
      { name: 'fastify_code', description: 'Fastify route code to convert', required: true },
    ],
  },
  {
    name: 'migrate_from_trpc',
    description: 'Convert tRPC procedures to Raffel',
    arguments: [
      { name: 'trpc_code', description: 'tRPC router code to convert', required: true },
    ],
  },

  // === Debug Prompts ===
  {
    name: 'debug_middleware',
    description: 'Debug middleware/interceptor execution order and behavior',
    arguments: [
      { name: 'server_code', description: 'Server code with middleware to debug', required: true },
      { name: 'issue', description: 'Description of the issue', required: false },
    ],
  },
  {
    name: 'optimize_performance',
    description: 'Analyze Raffel server code and suggest performance optimizations',
    arguments: [
      { name: 'server_code', description: 'Server code to optimize', required: true },
      { name: 'bottleneck', description: 'Known bottleneck if any', required: false },
    ],
  },
]

// === Prompt Handlers ===

export function getPromptResult(
  name: string,
  args: Record<string, string> = {}
): MCPPromptResult | null {
  switch (name) {
    case 'create_rest_api': {
      const resource = args.resource || 'items'
      const fields = args.fields || 'name:string, description:string'
      const withAuth = args.with_auth === 'yes'

      return {
        description: `Create a REST API for ${resource}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Create a complete Raffel REST API for the "${resource}" resource.

Fields: ${fields}
Authentication: ${withAuth ? 'Yes, with JWT' : 'No'}

Requirements:
1. Use Zod for validation with proper field types
2. Include all CRUD operations (list, get, create, update, delete)
3. Add proper error handling with RaffelError
4. Add input/output validation for all procedures
${withAuth ? '5. Protect all mutating operations (create, update, delete) with authentication' : ''}

Use the raffel_create_server and raffel_create_procedure tools to generate the code.
Follow the Raffel API patterns for correct code structure.`,
            },
          },
        ],
      }
    }

    case 'create_realtime_server': {
      const useCase = args.use_case || 'chat'
      const channels = args.channels || 'public, private-user-{id}, presence-room-{id}'

      return {
        description: `Create a real-time ${useCase} server`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Create a Raffel real-time server for ${useCase}.

Channels: ${channels}

Requirements:
1. Enable WebSocket adapter
2. Set up pub/sub channels with proper authorization
3. Add streaming procedures for real-time data
4. Include presence tracking for presence channels
5. Add procedures for publishing messages

Use case specifics for "${useCase}":
${useCase === 'chat' ? '- Message history, user presence, typing indicators' : ''}
${useCase === 'notifications' ? '- Push notifications, read status, notification groups' : ''}
${useCase === 'live-updates' ? '- Real-time data sync, optimistic updates, conflict resolution' : ''}
${useCase === 'gaming' ? '- Game state sync, player actions, lobby management' : ''}

Use the raffel_create_server, raffel_create_stream, and raffel_get_adapter tools.`,
            },
          },
        ],
      }
    }

    case 'create_grpc_service': {
      const serviceName = args.service_name || 'UserService'
      const methods = args.methods || 'Create, Get, List, Update, Delete'

      return {
        description: `Create a gRPC ${serviceName}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Create a Raffel gRPC service named "${serviceName}".

Methods: ${methods}

Requirements:
1. Enable gRPC adapter with reflection
2. Add proper input/output schemas for all methods
3. Include streaming methods where appropriate (e.g., List as server stream)
4. Add error handling with proper gRPC status codes
5. Add TLS configuration comments

The service should follow gRPC best practices:
- Use proper naming conventions (PascalCase for service/methods)
- Include deadline/timeout handling
- Add metadata propagation

Use the raffel_get_adapter tool to understand gRPC mapping, then use raffel_create_server.`,
            },
          },
        ],
      }
    }

    case 'create_microservice': {
      const serviceName = args.service_name || 'my-service'
      const dependencies = args.dependencies || 'database, redis'

      return {
        description: `Create a production-ready ${serviceName} microservice`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Create a production-ready Raffel microservice named "${serviceName}".

Dependencies: ${dependencies}

Requirements:
1. Health checks (liveness and readiness probes)
2. Prometheus metrics endpoint
3. Distributed tracing with OpenTelemetry
4. Rate limiting and circuit breakers
5. Graceful shutdown handling
6. Dependency injection for ${dependencies}
7. Environment-based configuration
8. Structured logging

The service should be:
- Container-ready (12-factor app principles)
- Observable (metrics, logs, traces)
- Resilient (timeouts, retries, circuit breakers)

Use raffel_create_server with features: metrics, tracing, rate-limit.
Use raffel_add_middleware for resilience patterns.`,
            },
          },
        ],
      }
    }

    case 'add_authentication': {
      const authType = args.auth_type || 'jwt'
      const protectedRoutes = args.protected_routes || '*'

      return {
        description: `Add ${authType} authentication`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add authentication to an existing Raffel server.

Authentication Type: ${authType}
Protected Routes: ${protectedRoutes}

Requirements:
${authType === 'jwt' || authType === 'both' ? `
JWT Authentication:
- Bearer token validation
- Token refresh mechanism
- Role-based access control
- Token expiration handling
` : ''}
${authType === 'api-key' || authType === 'both' ? `
API Key Authentication:
- Header or query parameter extraction
- Key validation against database
- Rate limiting per key
- Key rotation support
` : ''}

Use raffel_add_middleware with type: auth-bearer or auth-apikey.
Use raffel_get_interceptor for detailed auth middleware options.`,
            },
          },
        ],
      }
    }

    case 'add_caching': {
      const driver = args.driver || 'memory'
      const cachedProcedures = args.cached_procedures || 'read operations'

      return {
        description: `Add ${driver} caching`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add caching layer to a Raffel server.

Cache Driver: ${driver}
Cached Procedures: ${cachedProcedures}

Requirements:
1. Set up ${driver} cache driver
2. Configure TTL per procedure type
3. Add cache invalidation on mutations
4. Handle cache stampede (request coalescing)
5. Add cache statistics/metrics

${driver === 'memory' ? '- Configure LRU eviction with max size' : ''}
${driver === 'redis' ? '- Configure Redis client with connection pooling' : ''}
${driver === 's3db' ? '- Configure S3DB cache bucket' : ''}

Use raffel_add_middleware with type: cache.
Use raffel_get_interceptor for cache interceptor options.`,
            },
          },
        ],
      }
    }

    case 'add_rate_limiting': {
      const strategy = args.strategy || 'global'
      const limits = args.limits || '100 requests per minute'

      return {
        description: `Add ${strategy} rate limiting`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add rate limiting to a Raffel server.

Strategy: ${strategy}
Limits: ${limits}

Requirements:
${strategy === 'global' ? `
- Apply single limit to all procedures
- Use sliding window algorithm
- Return rate limit headers
` : ''}
${strategy === 'per-procedure' ? `
- Different limits per procedure pattern
- Stricter limits for auth endpoints (5/min)
- Relaxed limits for read endpoints (1000/min)
- Standard limits for write endpoints (100/min)
` : ''}
${strategy === 'per-user' ? `
- Rate limit by authenticated user
- Fallback to IP for anonymous users
- Different limits by user tier/role
` : ''}

Use raffel_add_middleware with type: rate-limit or rate-limit-per-procedure.
Use raffel_get_interceptor for rate limit options.`,
            },
          },
        ],
      }
    }

    case 'add_observability': {
      const metricsPath = args.metrics_path || '/metrics'
      const tracer = args.tracer || 'console'

      return {
        description: `Add observability with ${tracer} tracing`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add observability to a Raffel server.

Metrics Path: ${metricsPath}
Tracer: ${tracer}

Requirements:
1. Prometheus metrics:
   - Request duration histogram
   - Request count by procedure
   - Error rate by procedure
   - Active connections gauge
   - Process metrics (CPU, memory, GC)

2. Distributed tracing (${tracer}):
   - W3C Trace Context propagation
   - Span creation per procedure
   - Error and exception tracking
   - Custom attributes (user ID, request ID)

3. Structured logging:
   - JSON format in production
   - Request/response correlation
   - Error context with stack traces

Use raffel_add_middleware with type: metrics and type: tracing.
Use raffel_get_interceptor for detailed options.`,
            },
          },
        ],
      }
    }

    case 'migrate_from_express': {
      const expressCode = args.express_code || ''

      return {
        description: 'Convert Express.js to Raffel',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Convert the following Express.js code to Raffel:

\`\`\`javascript
${expressCode || `app.get('/users', async (req, res) => {
  const users = await db.users.findMany()
  res.json(users)
})

app.post('/users', async (req, res) => {
  const user = await db.users.create({ data: req.body })
  res.status(201).json(user)
})

app.get('/users/:id', async (req, res) => {
  const user = await db.users.findUnique({ where: { id: req.params.id } })
  if (!user) return res.status(404).json({ error: 'Not found' })
  res.json(user)
})`}
\`\`\`

Conversion requirements:
1. Convert routes to Raffel procedures
2. Replace req.body with input parameter
3. Replace res.json with return statement
4. Convert middleware to Raffel interceptors
5. Add input/output validation with Zod
6. Use RaffelError for error responses

Use raffel_api_patterns to understand the correct Raffel patterns.`,
            },
          },
        ],
      }
    }

    case 'migrate_from_fastify': {
      const fastifyCode = args.fastify_code || ''

      return {
        description: 'Convert Fastify to Raffel',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Convert the following Fastify code to Raffel:

\`\`\`javascript
${fastifyCode || `fastify.get('/users', async (request, reply) => {
  return db.users.findMany()
})

fastify.post('/users', {
  schema: {
    body: { type: 'object', properties: { name: { type: 'string' } } }
  }
}, async (request, reply) => {
  return db.users.create({ data: request.body })
})`}
\`\`\`

Conversion requirements:
1. Convert routes to Raffel procedures
2. Convert Fastify schema to Zod schemas
3. Replace request.body with input parameter
4. Convert hooks to Raffel interceptors
5. Preserve validation behavior

Use raffel_api_patterns to understand the correct Raffel patterns.`,
            },
          },
        ],
      }
    }

    case 'migrate_from_trpc': {
      const trpcCode = args.trpc_code || ''

      return {
        description: 'Convert tRPC to Raffel',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Convert the following tRPC code to Raffel:

\`\`\`typescript
${trpcCode || `const appRouter = router({
  users: router({
    list: publicProcedure.query(() => db.users.findMany()),
    create: protectedProcedure
      .input(z.object({ name: z.string() }))
      .mutation(({ input }) => db.users.create({ data: input }))
  })
})`}
\`\`\`

Conversion requirements:
1. Convert tRPC procedures to Raffel procedures
2. Preserve Zod validation schemas
3. Convert tRPC middleware to Raffel interceptors
4. Convert router nesting to Raffel groups/modules
5. Handle protected procedures with auth middleware

Use raffel_api_patterns to understand the correct Raffel patterns.`,
            },
          },
        ],
      }
    }

    case 'debug_middleware': {
      const serverCode = args.server_code || ''
      const issue = args.issue || 'Middleware not executing in expected order'

      return {
        description: 'Debug middleware execution',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Debug the middleware/interceptor configuration in this Raffel server:

\`\`\`typescript
${serverCode || `const server = createServer()
  .procedure('users.list').handler(async () => [])
  .use(authMiddleware)  // Is this applied to users.list?
  .use(loggingMiddleware)
`}
\`\`\`

Issue: ${issue}

Please analyze:
1. Middleware execution order (onion model)
2. Whether middleware applies to which procedures
3. Common mistakes (middleware after procedures)
4. Pattern matching issues with forPattern/except
5. Suggested fixes

Use raffel_api_patterns with "Interceptor Composition" for reference.`,
            },
          },
        ],
      }
    }

    case 'optimize_performance': {
      const serverCode = args.server_code || ''
      const bottleneck = args.bottleneck || 'Unknown'

      return {
        description: 'Optimize Raffel server performance',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze and optimize this Raffel server for performance:

\`\`\`typescript
${serverCode || `// Server code to analyze`}
\`\`\`

Known bottleneck: ${bottleneck}

Please analyze and suggest optimizations for:
1. Caching opportunities (frequently accessed data)
2. Database query optimization (N+1 problems)
3. Streaming vs buffering for large responses
4. Middleware ordering (expensive middleware placement)
5. Connection pooling for providers
6. Rate limiting and bulkhead patterns
7. Async processing for slow operations

Use raffel_get_interceptor with cache, bulkhead, and other performance interceptors.`,
            },
          },
        ],
      }
    }

    default:
      return null
  }
}

// === Export Helpers ===

export function getPrompt(name: string): MCPPrompt | undefined {
  return prompts.find((p) => p.name === name)
}

export function listPrompts(): MCPPrompt[] {
  return prompts
}
