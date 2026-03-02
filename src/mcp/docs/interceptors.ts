/**
 * Raffel MCP - Interceptor Documentation
 *
 * Built-in interceptors with options, examples, and use cases.
 */

import type { InterceptorDoc } from '../types.js'

export const interceptors: InterceptorDoc[] = [
  // === Auth ===
  {
    name: 'createAuthMiddleware',
    description:
      'Authentication middleware that validates requests using configurable strategies (Bearer tokens, API keys, etc.).',
    category: 'auth',
    options: [
      {
        name: 'strategies',
        type: 'AuthStrategy[]',
        required: true,
        description: 'Authentication strategies to try in order',
      },
      {
        name: 'publicProcedures',
        type: 'string[]',
        required: false,
        description: 'Procedures that skip authentication',
      },
      {
        name: 'onError',
        type: '(error, envelope) => void',
        required: false,
        description: 'Hook for strategy errors (non-fatal)',
      },
    ],
    examples: [
      {
        title: 'Bearer Token Authentication',
        code: `import { createServer, createAuthMiddleware, createBearerStrategy } from 'raffel'

const server = createServer()
  .use(createAuthMiddleware({
    strategies: [createBearerStrategy({
      verify: async (token) => {
        const payload = await verifyJwt(token)
        return payload ? { authenticated: true, principal: payload.sub, claims: payload } : null
      }
    })]
  }))
  .procedure('users.me')
    .handler(async (_input, ctx) => {
      return { userId: ctx.auth?.principal }
    })`,
      },
    ],
  },
  {
    name: 'createAuthzMiddleware',
    description: 'Authorization middleware that enforces access rules after authentication.',
    category: 'auth',
    options: [
      {
        name: 'rules',
        type: 'AuthzRule[]',
        required: true,
        description: 'Array of authorization rules to evaluate',
      },
      {
        name: 'defaultAllow',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Allow access if no rule matches',
      },
    ],
    examples: [
      {
        title: 'Role-Based Access Control',
        code: `import { createServer, createAuthzMiddleware, hasRole, hasAnyRole, requireAuth } from 'raffel'

const server = createServer()
  .use(createAuthzMiddleware({
    rules: [
      { pattern: 'admin.*', check: hasRole('admin') },
      { pattern: 'users.delete', check: hasAnyRole(['admin', 'moderator']) },
      { pattern: 'users.*', check: requireAuth },
    ]
  }))`,
      },
    ],
  },

  // === Resilience ===
  {
    name: 'createRateLimitInterceptor',
    description:
      'Rate limiting using sliding window algorithm. Supports global limits and per-procedure rules.',
    category: 'resilience',
    options: [
      {
        name: 'windowMs',
        type: 'number',
        required: false,
        default: '60000',
        description: 'Time window in milliseconds',
      },
      {
        name: 'maxRequests',
        type: 'number',
        required: false,
        default: '100',
        description: 'Maximum requests per window',
      },
      {
        name: 'maxUniqueKeys',
        type: 'number',
        required: false,
        description: 'Maximum unique keys to track',
      },
      {
        name: 'skipSuccessfulRequests',
        type: 'boolean',
        required: false,
        description: 'If true, successful requests are not counted',
      },
      {
        name: 'keyGenerator',
        type: '(envelope, ctx) => string',
        required: false,
        description: 'Function to generate rate limit key (default: user or metadata)',
      },
      {
        name: 'rules',
        type: 'RateLimitRule[]',
        required: false,
        description: 'Per-procedure rate limit rules with pattern matching',
      },
      {
        name: 'driver',
        type: 'RateLimitDriverConfig | RateLimitDriver',
        required: false,
        description: 'Storage driver (memory, filesystem, redis, or custom)',
      },
    ],
    examples: [
      {
        title: 'Basic Rate Limiting',
        code: `import { createServer, createRateLimitInterceptor } from 'raffel'

const server = createServer()
  .use(createRateLimitInterceptor({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  }))`,
      },
    ],
  },
  {
    name: 'createRetryInterceptor',
    description:
      'Automatic retry with backoff for transient failures. Use for downstream service calls.',
    category: 'resilience',
    options: [
      {
        name: 'maxAttempts',
        type: 'number',
        required: false,
        default: '3',
        description: 'Maximum retry attempts',
      },
      {
        name: 'initialDelayMs',
        type: 'number',
        required: false,
        default: '100',
        description: 'Initial delay in ms before first retry',
      },
      {
        name: 'maxDelayMs',
        type: 'number',
        required: false,
        default: '10000',
        description: 'Maximum delay between retries',
      },
      {
        name: 'backoffStrategy',
        type: "'linear' | 'exponential' | 'decorrelated'",
        required: false,
        default: "'exponential'",
        description: 'Backoff strategy',
      },
      {
        name: 'retryableCodes',
        type: 'string[]',
        required: false,
        description: 'Error codes that should trigger retry',
      },
      {
        name: 'shouldRetry',
        type: '(error, attempt) => boolean',
        required: false,
        description: 'Custom retry predicate',
      },
    ],
    examples: [
      {
        title: 'Retry External Calls',
        code: `import { createServer, forPattern, createRetryInterceptor } from 'raffel'

const server = createServer()
  .use(forPattern('external.*', createRetryInterceptor({
    maxAttempts: 3,
    initialDelayMs: 200,
    retryableCodes: ['UNAVAILABLE', 'DEADLINE_EXCEEDED'],
  })))`,
      },
    ],
  },
  {
    name: 'createCircuitBreakerInterceptor',
    description:
      'Circuit breaker pattern to prevent cascading failures. Opens circuit after threshold failures.',
    category: 'resilience',
    options: [
      {
        name: 'failureThreshold',
        type: 'number',
        required: false,
        default: '5',
        description: 'Failures before circuit opens',
      },
      {
        name: 'successThreshold',
        type: 'number',
        required: false,
        default: '3',
        description: 'Successes before circuit closes',
      },
      {
        name: 'resetTimeoutMs',
        type: 'number',
        required: false,
        default: '30000',
        description: 'Time in ms before attempting recovery',
      },
      {
        name: 'windowMs',
        type: 'number',
        required: false,
        default: '60000',
        description: 'Failure counting window in ms',
      },
      {
        name: 'failureCodes',
        type: 'string[]',
        required: false,
        description: 'Error codes that count as failures',
      },
      {
        name: 'onStateChange',
        type: '(state, procedure) => void',
        required: false,
        description: 'Callback when circuit state changes',
      },
    ],
    examples: [
      {
        title: 'Circuit Breaker for External Service',
        code: `import { createServer, forPattern, createCircuitBreakerInterceptor } from 'raffel'

const server = createServer()
  .use(forPattern('payments.*', createCircuitBreakerInterceptor({
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  })))`,
      },
    ],
  },
  {
    name: 'createTimeoutInterceptor',
    description: 'Enforces deadline on handler execution (DEADLINE_EXCEEDED on timeout).',
    category: 'resilience',
    options: [
      {
        name: 'defaultMs',
        type: 'number',
        required: false,
        default: '30000',
        description: 'Default timeout in ms',
      },
      {
        name: 'procedures',
        type: 'Record<string, number>',
        required: false,
        description: 'Per-procedure timeouts',
      },
      {
        name: 'patterns',
        type: 'Record<string, number>',
        required: false,
        description: 'Pattern-based timeouts',
      },
    ],
    examples: [
      {
        title: 'Global Timeout',
        code: `import { createServer, createTimeoutInterceptor } from 'raffel'

const server = createServer()
  .use(createTimeoutInterceptor({ defaultMs: 30000 }))`,
      },
    ],
  },
  {
    name: 'createBulkheadInterceptor',
    description:
      'Limits concurrent executions to isolate failures. Prevents one slow procedure from consuming all resources.',
    category: 'resilience',
    options: [
      {
        name: 'concurrency',
        type: 'number',
        required: true,
        description: 'Maximum concurrent executions',
      },
      {
        name: 'maxQueueSize',
        type: 'number',
        required: false,
        default: '0',
        description: 'Maximum requests to queue when at capacity',
      },
      {
        name: 'queueTimeout',
        type: 'number',
        required: false,
        default: '0',
        description: 'Max time to wait in queue (ms)',
      },
      {
        name: 'onReject',
        type: '(procedure) => void',
        required: false,
        description: 'Callback when a request is rejected',
      },
    ],
    examples: [
      {
        title: 'Limit Concurrent Database Queries',
        code: `import { createServer, forPattern, createBulkheadInterceptor } from 'raffel'

const server = createServer()
  .use(forPattern('db.*', createBulkheadInterceptor({
    concurrency: 10,
    maxQueueSize: 50,
    queueTimeout: 5000,
  })))`,
      },
    ],
  },
  {
    name: 'createFallbackInterceptor',
    description:
      'Provides fallback response when handler fails. Useful for graceful degradation.',
    category: 'resilience',
    options: [
      {
        name: 'response',
        type: 'unknown',
        required: false,
        description: 'Static fallback response',
      },
      {
        name: 'handler',
        type: '(ctx, error) => unknown',
        required: false,
        description: 'Dynamic fallback handler',
      },
      {
        name: 'when',
        type: '(error) => boolean',
        required: false,
        description: 'Predicate to decide if fallback should be used',
      },
    ],
    examples: [
      {
        title: 'Fallback to Cached Data',
        code: `import { createServer, forPattern, createFallbackInterceptor } from 'raffel'

const server = createServer()
  .use(forPattern('prices.*', createFallbackInterceptor({
    handler: async (_ctx, error) => {
      return await cache.get('prices') || { prices: [], stale: true, reason: error.message }
    },
    when: (err) => (err as any).code === 'UNAVAILABLE',
  })))`,
      },
    ],
  },

  // === Observability ===
  {
    name: 'createMetricsInterceptor',
    description:
      'Auto-instruments procedures with metrics (latency, count, errors).',
    category: 'observability',
    options: [
      {
        name: 'registry',
        type: 'MetricRegistry',
        required: true,
        description: 'Metric registry for storing metrics',
      },
    ],
    examples: [
      {
        title: 'Auto-Instrumentation',
        code: `import { createServer, createMetricRegistry, createMetricsInterceptor } from 'raffel'

const metrics = createMetricRegistry()
const server = createServer()
  .use(createMetricsInterceptor(metrics))`,
      },
    ],
  },
  {
    name: 'createTracingInterceptor',
    description:
      'Distributed tracing with OpenTelemetry-compatible spans. Propagates trace context via W3C headers.',
    category: 'observability',
    options: [
      {
        name: 'tracer',
        type: 'Tracer',
        required: true,
        description: 'Tracer instance for creating spans',
      },
    ],
    examples: [
      {
        title: 'Jaeger Tracing',
        code: `import {
  createServer,
  createTracer,
  createJaegerExporter,
  createTracingInterceptor
} from 'raffel'

const tracer = createTracer({
  serviceName: 'my-api',
  exporters: [createJaegerExporter({ serviceName: 'my-api' })],
})

const server = createServer()
  .use(createTracingInterceptor(tracer))`,
      },
    ],
  },
  {
    name: 'createLoggingInterceptor',
    description: 'Structured logging for request/response with configurable levels and formats.',
    category: 'observability',
    options: [
      {
        name: 'level',
        type: "'trace' | 'debug' | 'info' | 'warn' | 'error'",
        required: false,
        default: "'info'",
        description: 'Log level',
      },
      {
        name: 'format',
        type: "'json' | 'pretty'",
        required: false,
        default: "'pretty'",
        description: 'Log output format',
      },
      {
        name: 'includePayload',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Include request payload in logs',
      },
      {
        name: 'includeResponse',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Include response payload in logs',
      },
      {
        name: 'includeMetadata',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Include metadata (headers) in logs',
      },
      {
        name: 'excludeProcedures',
        type: 'string[]',
        required: false,
        description: 'Procedure patterns to exclude',
      },
    ],
    examples: [
      {
        title: 'Production Logging',
        code: `import { createServer, createLoggingInterceptor, except } from 'raffel'

const server = createServer()
  .use(except(['health.*'], createLoggingInterceptor({
    level: 'info',
    format: 'json',
    includeMetadata: false,
  })))`,
      },
    ],
  },

  // === Validation ===
  {
    name: 'createValidationInterceptor',
    description:
      'Validates input/output against a schema for a specific handler.',
    category: 'validation',
    options: [
      {
        name: 'schema',
        type: 'HandlerSchema',
        required: true,
        description: 'Schema with input/output validators',
      },
    ],
    examples: [
      {
        title: 'Zod Validation',
        code: `import { createServer, createValidationInterceptor } from 'raffel'
import { z } from 'zod'

const schema = {
  input: z.object({ email: z.string().email() }),
  output: z.object({ id: z.string(), email: z.string() }),
}

const server = createServer()
  .procedure('users.create')
    .use(createValidationInterceptor(schema))
    .handler(async (input) => createUser(input))`,
      },
    ],
  },

  // === Caching ===
  {
    name: 'createCacheInterceptor',
    description:
      'Response caching with pluggable drivers. Supports TTL, stale-while-revalidate, and invalidation.',
    category: 'caching',
    options: [
      {
        name: 'ttlMs',
        type: 'number',
        required: false,
        default: '60000',
        description: 'Time-to-live in milliseconds',
      },
      {
        name: 'driver',
        type: 'CacheDriver',
        required: false,
        description: 'Cache driver instance (memory, redis, file)',
      },
      {
        name: 'procedures',
        type: 'string[]',
        required: false,
        description: 'Procedures to include (glob patterns supported)',
      },
      {
        name: 'excludeProcedures',
        type: 'string[]',
        required: false,
        description: 'Procedures to exclude',
      },
      {
        name: 'keyGenerator',
        type: '(envelope) => string',
        required: false,
        description: 'Custom cache key generator',
      },
    ],
    examples: [
      {
        title: 'Redis Cache',
        code: `import { createServer } from 'raffel'
import { createCacheInterceptor } from 'raffel/middleware'
import { createDriver } from 'raffel/cache'

const redisDriver = await createDriver('redis', { client: redis })
const cache = createCacheInterceptor({ ttlMs: 60000, driver: redisDriver })

const server = createServer().use(cache)`,
      },
    ],
  },
  {
    name: 'createDedupInterceptor',
    description:
      'Request deduplication to prevent duplicate processing of identical concurrent requests.',
    category: 'caching',
    options: [
      {
        name: 'ttlMs',
        type: 'number',
        required: false,
        default: '30000',
        description: 'TTL for pending requests',
      },
      {
        name: 'keyGenerator',
        type: '(envelope, ctx) => string',
        required: false,
        description: 'Custom dedup key generator',
      },
      {
        name: 'procedures',
        type: 'string[]',
        required: false,
        description: 'Procedures to deduplicate (glob patterns)',
      },
    ],
    examples: [
      {
        title: 'Prevent Double Submit',
        code: `import { createServer, forPattern, createDedupInterceptor } from 'raffel'

const server = createServer()
  .use(forPattern('orders.create', createDedupInterceptor()))`,
      },
    ],
  },

  // === Composition ===
  {
    name: 'compose',
    description: 'Composes multiple interceptors into a single interceptor (onion model).',
    category: 'composition',
    options: [
      {
        name: 'interceptors',
        type: 'Interceptor[]',
        required: true,
        description: 'Array of interceptors to compose',
      },
    ],
    examples: [
      {
        title: 'Compose Production Stack',
        code: `import { createServer, compose, createTimeoutInterceptor, createLoggingInterceptor } from 'raffel'

const productionStack = compose(
  createTimeoutInterceptor({ defaultMs: 30000 }),
  createLoggingInterceptor({ level: 'info', format: 'json' })
)

const server = createServer().use(productionStack)`,
      },
    ],
  },
  {
    name: 'when',
    description: 'Conditionally applies an interceptor based on a predicate.',
    category: 'composition',
    options: [
      {
        name: 'predicate',
        type: '(envelope, ctx) => boolean',
        required: true,
        description: 'Condition to evaluate',
      },
      {
        name: 'interceptor',
        type: 'Interceptor',
        required: true,
        description: 'Interceptor to apply if predicate is true',
      },
    ],
    examples: [
      {
        title: 'Environment-Based Logging',
        code: `import { createServer, when, createLoggingInterceptor } from 'raffel'

const server = createServer()
  .use(when(
    () => process.env.NODE_ENV === 'development',
    createLoggingInterceptor({ level: 'debug', format: 'pretty' })
  ))`,
      },
    ],
  },
  {
    name: 'forPattern',
    description: 'Applies interceptor only to procedures matching a glob pattern.',
    category: 'composition',
    options: [
      {
        name: 'pattern',
        type: 'string',
        required: true,
        description: 'Glob pattern to match (e.g., "users.*", "admin.**")',
      },
      {
        name: 'interceptor',
        type: 'Interceptor',
        required: true,
        description: 'Interceptor to apply',
      },
    ],
    examples: [
      {
        title: 'Pattern-Based Rate Limiting',
        code: `import { createServer, forPattern, createRateLimitInterceptor } from 'raffel'

const server = createServer()
  .use(forPattern('public.*', createRateLimitInterceptor({ maxRequests: 1000 })))
  .use(forPattern('admin.*', createRateLimitInterceptor({ maxRequests: 100 })))
  .use(forPattern('auth.login', createRateLimitInterceptor({ maxRequests: 5 })))`,
      },
    ],
  },
  {
    name: 'except',
    description: 'Applies interceptor to all procedures except those matching names.',
    category: 'composition',
    options: [
      {
        name: 'procedures',
        type: 'string[]',
        required: true,
        description: 'Procedures to exclude',
      },
      {
        name: 'interceptor',
        type: 'Interceptor',
        required: true,
        description: 'Interceptor to apply',
      },
    ],
    examples: [
      {
        title: 'Exclude Health Checks from Logging',
        code: `import { createServer, except, createLoggingInterceptor } from 'raffel'

const server = createServer()
  .use(except(['health.check'], createLoggingInterceptor({ level: 'info' })))`,
      },
    ],
  },
  {
    name: 'branch',
    description: 'Branches execution based on condition, applying different interceptors.',
    category: 'composition',
    options: [
      {
        name: 'predicate',
        type: '(envelope, ctx) => boolean',
        required: true,
        description: 'Condition to branch on',
      },
      {
        name: 'onTrue',
        type: 'Interceptor',
        required: true,
        description: 'Interceptor for true branch',
      },
      {
        name: 'onFalse',
        type: 'Interceptor',
        required: false,
        description: 'Interceptor for false branch (passthrough if not specified)',
      },
    ],
    examples: [
      {
        title: 'Different Caching by Auth Status',
        code: `import { createServer, branch, createCacheInterceptor } from 'raffel'

const server = createServer()
  .use(branch(
    (_env, ctx) => !ctx.auth?.authenticated,
    createCacheInterceptor({ ttlMs: 300000 }),  // 5 min for public
    createCacheInterceptor({ ttlMs: 60000 })    // 1 min for authenticated
  ))`,
      },
    ],
  },
]

export const interceptorsByCategory = {
  auth: interceptors.filter((i) => i.category === 'auth'),
  resilience: interceptors.filter((i) => i.category === 'resilience'),
  observability: interceptors.filter((i) => i.category === 'observability'),
  validation: interceptors.filter((i) => i.category === 'validation'),
  caching: interceptors.filter((i) => i.category === 'caching'),
  composition: interceptors.filter((i) => i.category === 'composition'),
}

// OAuth2 and OIDC strategies are added alongside the auth interceptors
;(interceptors as InterceptorDoc[]).push(
  {
    name: 'createOAuth2Strategy',
    description:
      'OAuth2 authentication strategy for social login (Google, GitHub, Microsoft, Apple, Facebook). Validates Bearer tokens by calling the userinfo endpoint.',
    category: 'auth',
    options: [
      { name: 'provider', type: "'google' | 'github' | 'microsoft' | 'apple' | 'facebook' | 'custom'", required: false, description: 'Provider preset' },
      { name: 'clientId', type: 'string', required: true, description: 'OAuth2 client ID' },
      { name: 'clientSecret', type: 'string', required: true, description: 'OAuth2 client secret' },
      { name: 'redirectUri', type: 'string', required: true, description: 'Redirect URI after authorization' },
      { name: 'scopes', type: 'string[]', required: false, description: 'OAuth2 scopes to request' },
      { name: 'tokenValidation', type: "'userinfo' | 'introspection' | 'none'", required: false, default: "'userinfo'", description: 'How to validate access tokens' },
    ],
    examples: [
      {
        title: 'Google OAuth2 Social Login',
        code: `import { createServer, createAuthMiddleware, createOAuth2Strategy, generateState } from 'raffel'

const googleAuth = createOAuth2Strategy({
  provider: 'google',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
})

const server = createServer({ port: 3000 })
server.use(createAuthMiddleware({ strategies: [googleAuth] }))

server.procedure('auth.authorize').handler(async (_input, ctx) => {
  const state = generateState()
  ctx.session.data.oauthState = state
  ctx.session.touch()
  return { redirect: googleAuth.getAuthorizationUrl({ state }) }
})

server.procedure('auth.callback').handler(async ({ code, state }, ctx) => {
  if (state !== ctx.session.data.oauthState) throw new RaffelError('INVALID_STATE', 'Bad state')
  const tokens = await googleAuth.exchangeCode(code)
  const userInfo = await googleAuth.getUserInfo(tokens.accessToken)
  return { user: userInfo, accessToken: tokens.accessToken }
})`,
      },
    ],
  },
  {
    name: 'createOIDCStrategy',
    description:
      'OpenID Connect authentication strategy with auto-discovery. Discovers endpoints from .well-known/openid-configuration and validates ID tokens.',
    category: 'auth',
    options: [
      { name: 'issuer', type: 'string', required: true, description: 'OIDC issuer URL (used for auto-discovery)' },
      { name: 'clientId', type: 'string', required: true, description: 'OIDC client ID' },
      { name: 'clientSecret', type: 'string', required: true, description: 'OIDC client secret' },
      { name: 'redirectUri', type: 'string', required: true, description: 'Redirect URI after authorization' },
      { name: 'audience', type: 'string', required: false, description: 'Audience for ID token validation (default: clientId)' },
      { name: 'validateIdToken', type: 'boolean', required: false, default: 'true', description: 'Whether to validate ID token claims' },
      { name: 'clockSkew', type: 'number', required: false, default: '60', description: 'Clock skew tolerance in seconds' },
    ],
    examples: [
      {
        title: 'OIDC with Auto-Discovery',
        code: `import { createServer, createAuthMiddleware, createOIDCStrategy } from 'raffel'

const oidc = createOIDCStrategy({
  issuer: 'https://accounts.google.com',
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/auth/callback',
})

const server = createServer({ port: 3000 })
server.use(createAuthMiddleware({ strategies: [oidc] }))

server.procedure('auth.callback').handler(async ({ code }) => {
  const tokens = await oidc.exchangeCode(code)  // validates ID token
  const claims = await oidc.validateIdToken(tokens.idToken!)
  return { sub: claims.sub, email: claims.email }
})`,
      },
    ],
  },
  {
    name: 'createSessionInterceptor',
    description:
      'Session store interceptor. Injects ctx.session into every handler with get/set/destroy operations. Backed by memory (dev), Redis (prod), s3db (serverless), or custom stores.',
    category: 'auth',
    options: [
      { name: 'driver', type: "'memory' | 'redis' | 's3db' | SessionStore", required: true, description: 'Storage backend' },
      { name: 'ttl', type: 'number', required: false, default: '3600', description: 'Session TTL in seconds' },
      { name: 'rolling', type: 'boolean', required: false, default: 'false', description: 'Sliding window TTL (reset on each access)' },
      { name: 'secret', type: 'string', required: false, description: 'HMAC signing key for session IDs' },
      { name: 'cookie.name', type: 'string', required: false, default: "'sid'", description: 'Cookie name' },
      { name: 'cookie.secure', type: 'boolean', required: false, default: 'true', description: 'HTTPS-only cookie' },
    ],
    examples: [
      {
        title: 'Memory store (development)',
        code: `import { createServer, createSessionInterceptor } from 'raffel'

const server = createServer({ port: 3000 })
server.use(createSessionInterceptor({ driver: 'memory', ttl: 3600 }))

server.procedure('auth.login').handler(async ({ userId }, ctx) => {
  ctx.session.data.userId = userId
  ctx.session.touch()
  return { ok: true }
})

server.procedure('auth.me').handler(async (_input, ctx) => {
  return { userId: ctx.session.data.userId ?? null }
})`,
      },
      {
        title: 'Redis store (production)',
        code: `import { createServer, createSessionInterceptor, createRedisSessionDriver } from 'raffel'
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const server = createServer({ port: 3000 })
server.use(createSessionInterceptor({
  driver: createRedisSessionDriver({ client: redis }),
  ttl: 7200,
  rolling: true,
  secret: process.env.SESSION_SECRET,
  cookie: { name: 'sid', secure: true, sameSite: 'lax' },
}))`,
      },
      {
        title: 's3db store (serverless)',
        code: `import { createServer, createSessionInterceptor, createS3dbSessionDriver } from 'raffel'

const sessionsResource = s3db.resource('sessions')
const server = createServer({ port: 3000 })
server.use(createSessionInterceptor({
  driver: createS3dbSessionDriver({ resource: sessionsResource }),
  ttl: 3600,
}))`,
      },
    ],
  }
)

export function getInterceptor(name: string): InterceptorDoc | undefined {
  return interceptors.find((i) => i.name === name)
}

export function listInterceptors(category?: string): InterceptorDoc[] {
  if (category) {
    return interceptors.filter((i) => i.category === category)
  }
  return interceptors
}
