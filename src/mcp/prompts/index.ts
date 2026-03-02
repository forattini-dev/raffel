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
    description: 'Add authentication to an existing Raffel server. Supports: jwt, api-key, oauth2, oidc, session, combined',
    arguments: [
      { name: 'auth_type', description: 'Authentication type: jwt, api-key, oauth2, oidc, session, combined', required: true },
      { name: 'protected_routes', description: 'Routes to protect (e.g., users.*, admin.**)', required: false },
      { name: 'provider', description: 'OAuth2/OIDC provider: google, github, microsoft (only for oauth2/oidc)', required: false },
      { name: 'with_session', description: 'Persist OAuth2/OIDC state in sessions (yes/no)', required: false },
    ],
  },
  {
    name: 'add_caching',
    description: 'Add caching layer with configurable drivers (memory, Redis)',
    arguments: [
      { name: 'driver', description: 'Cache driver (memory, redis)', required: true },
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

  // === New Feature Prompts ===
  {
    name: 'add_oauth2',
    description: 'Add OAuth2 social login to a Raffel server (Google, GitHub, Microsoft, Apple, Facebook)',
    arguments: [
      { name: 'provider', description: 'OAuth2 provider (google, github, microsoft, apple, facebook)', required: true },
      { name: 'with_sessions', description: 'Use session store to persist auth state (yes/no)', required: false },
    ],
  },
  {
    name: 'add_sessions',
    description: 'Add session store to a Raffel server with memory, Redis, or s3db driver',
    arguments: [
      { name: 'driver', description: 'Session driver (memory, redis, s3db)', required: true },
      { name: 'ttl', description: 'Session TTL in seconds', required: false },
      { name: 'rolling', description: 'Use sliding-window TTL (yes/no)', required: false },
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
      const provider = args.provider || 'google'
      const withSession = args.with_session !== 'no'

      // Normalize aliases
      const normalizedType =
        authType === 'jwt' ? 'bearer-jwt'
        : authType === 'both' ? 'combined'
        : authType // api-key, oauth2, oidc, session, combined, bearer-jwt

      // Map prompt type to raffel_implement_auth method
      const implementMethod =
        normalizedType === 'bearer-jwt' || normalizedType === 'jwt' ? 'bearer-jwt'
        : normalizedType === 'api-key' ? 'api-key'
        : normalizedType === 'oauth2' ? 'oauth2'
        : normalizedType === 'oidc' ? 'oidc'
        : normalizedType === 'session' ? 'session'
        : 'combined'

      const needsProvider = implementMethod === 'oauth2' || implementMethod === 'oidc'
      const providerLine = needsProvider ? `\nOAuth2/OIDC Provider: ${provider}` : ''
      const sessionLine = needsProvider ? `\nPersist in session: ${withSession ? 'Yes' : 'No'}` : ''

      return {
        description: `Add ${authType} authentication`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add authentication to an existing Raffel server.

Authentication Type: ${authType}
Protected Routes: ${protectedRoutes}${providerLine}${sessionLine}

Steps:
1. Call raffel_implement_auth with method: "${implementMethod}"${needsProvider ? `, provider: "${provider}"` : ''}${needsProvider && withSession ? `, withSession: true` : ''} to get the complete implementation guide
2. Follow the step-by-step instructions: install packages, set env vars, create the auth module, wire it into the server
3. Apply auth middleware with publicProcedures: [] listing any routes that should stay open
4. Protect specific routes with requireAuth(ctx) inside handlers or use createAuthzMiddleware for RBAC

${implementMethod === 'bearer-jwt' ? `
JWT requirements:
- createBearerStrategy with a verify() function that validates the token
- jwt.sign() on login, jwt.verify() on each request
- publicProcedures: ['auth.login', 'health.check']
` : ''}
${implementMethod === 'api-key' ? `
API key requirements:
- createApiKeyStrategy with a validate() function (DB lookup or env-var set)
- Never return the raw key after creation — store only the hash
- X-API-Key header extraction by default
` : ''}
${implementMethod === 'oauth2' ? `
OAuth2 requirements:
- Register app on ${provider} developer console, get CLIENT_ID + CLIENT_SECRET
- auth.authorize → redirects user to ${provider}
- auth.callback → exchanges code, upserts user${withSession ? ', stores userId in session' : ''}
- CSRF protection via generateState()
` : ''}
${implementMethod === 'oidc' ? `
OIDC requirements:
- Same as OAuth2 but createOIDCStrategy auto-discovers endpoints from issuer
- tokens.idTokenClaims contains verified user identity without extra HTTP call
- Validate nonce to prevent replay attacks
` : ''}
${implementMethod === 'session' ? `
Session requirements:
- createSessionInterceptor with driver: 'memory' (dev) or Redis (prod)
- ctx.session.regenerate() after login (prevents session fixation)
- ctx.session.destroy() on logout
` : ''}
${implementMethod === 'combined' ? `
Combined requirements:
- createAuthMiddleware accepts multiple strategies — tried in order
- Bearer JWT for SPA/mobile, API Key for server-to-server
- Sessions for OAuth2 callback state, not as the primary auth mechanism
` : ''}

Use raffel_get_interceptor to inspect options for any strategy or middleware.`,
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

    case 'add_oauth2': {
      const provider = args.provider || 'google'
      const withSessions = args.with_sessions === 'yes' || args.with_sessions !== 'no'
      const providerCapitalized = provider.charAt(0).toUpperCase() + provider.slice(1)

      return {
        description: `Add ${providerCapitalized} OAuth2 to Raffel`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add ${providerCapitalized} OAuth2 social login to an existing Raffel server.

Requirements:
1. Use createOAuth2Strategy with provider: '${provider}'
2. Add authorization endpoint that redirects to ${providerCapitalized}
3. Add callback endpoint that exchanges code for tokens
4. Add CSRF state parameter protection
${withSessions ? '5. Use session store to persist user auth state across requests' : '5. Return JWT token after successful OAuth2 flow'}
6. Handle token refresh if refresh token is provided

Environment variables needed:
- ${provider.toUpperCase()}_CLIENT_ID
- ${provider.toUpperCase()}_CLIENT_SECRET
${withSessions ? '- SESSION_SECRET (for signing session IDs)' : '- JWT_SECRET (for signing access tokens)'}

Use raffel_get_interceptor with createOAuth2Strategy and ${withSessions ? 'createSessionInterceptor' : 'createBearerStrategy'} for implementation details.`,
            },
          },
        ],
      }
    }

    case 'add_sessions': {
      const driver = args.driver || 'memory'
      const ttl = args.ttl || '3600'
      const rolling = args.rolling === 'yes'

      return {
        description: `Add ${driver} session store`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Add session store to a Raffel server.

Driver: ${driver}
TTL: ${ttl} seconds
Rolling window: ${rolling ? 'Yes' : 'No'}

Requirements:
1. Import createSessionInterceptor${driver !== 'memory' ? ` and create${driver.charAt(0).toUpperCase() + driver.slice(1)}SessionDriver` : ''} from 'raffel'
${driver === 'redis' ? '2. Accept Redis client as dependency (e.g., ioredis or @redis/client)\n3. Configure connection using REDIS_URL env var' : ''}
${driver === 's3db' ? '2. Accept s3db resource as dependency\n3. Sessions stored in S3 with manual TTL via expires_at field' : ''}
4. Register interceptor with server.use()
5. Show example handlers using ctx.session.data (set, get, destroy)
${rolling ? '6. Configure rolling: true for sliding window TTL' : ''}
7. Add proper cookie settings (secure, httpOnly, sameSite)

Use raffel_get_interceptor with name: createSessionInterceptor for full API reference.`,
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
