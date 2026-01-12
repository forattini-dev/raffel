/**
 * Raffel MCP - Interceptor Documentation
 *
 * All built-in interceptors with options, examples, and use cases.
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
    .handler(async (input, ctx) => {
      // ctx.auth.principal contains the authenticated user
      return ctx.auth.principal
    })`,
      },
      {
        title: 'API Key Authentication',
        code: `import { createServer, createAuthMiddleware, createApiKeyStrategy } from 'raffel'

const server = createServer()
  .use(createAuthMiddleware({
    strategies: [createApiKeyStrategy({
      verify: async (key) => {
        const app = await db.apiKeys.findByKey(key)
        return app ? { authenticated: true, principal: app.id } : null
      },
      headerName: 'x-api-key'
    })]
  }))`,
      },
      {
        title: 'Static API Key (Development)',
        code: `import { createServer, createAuthMiddleware, createStaticApiKeyStrategy } from 'raffel'

const keys = new Map([
  ['dev-key-123', { authenticated: true, principal: 'dev' }],
  ['test-key-456', { authenticated: true, principal: 'test' }]
])

const server = createServer()
  .use(createAuthMiddleware({
    strategies: [createStaticApiKeyStrategy(keys)]
  }))`,
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
        code: `import { createServer, createAuthzMiddleware, hasRole, hasAnyRole } from 'raffel'

const server = createServer()
  .use(createAuthzMiddleware({
    rules: [
      { pattern: 'admin.*', check: hasRole('admin') },
      { pattern: 'users.delete', check: hasAnyRole(['admin', 'moderator']) },
      { pattern: 'users.*', check: requireAuth() },
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
        name: 'keyGenerator',
        type: '(envelope, ctx) => string',
        required: false,
        description: 'Function to generate rate limit key (default: user or IP)',
      },
      {
        name: 'rules',
        type: 'RateLimitRule[]',
        required: false,
        description: 'Per-procedure rate limit rules with pattern matching',
      },
      {
        name: 'driver',
        type: 'string | RateLimitDriver',
        required: false,
        default: 'memory',
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
    maxRequests: 100,    // 100 requests per minute
  }))`,
      },
      {
        title: 'Per-Procedure Rules',
        code: `import { createServer, createRateLimitInterceptor } from 'raffel'

const server = createServer()
  .use(createRateLimitInterceptor({
    maxRequests: 100,
    rules: [
      { id: 'auth', pattern: 'auth.*', maxRequests: 5, windowMs: 60000 },
      { id: 'reports', pattern: 'reports.*', maxRequests: 10, windowMs: 3600000 },
    ]
  }))`,
      },
    ],
  },
  {
    name: 'retry',
    description:
      'Automatic retry with exponential backoff for transient failures. Use for downstream service calls.',
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
        name: 'initialDelay',
        type: 'number',
        required: false,
        default: '1000',
        description: 'Initial delay in ms before first retry',
      },
      {
        name: 'maxDelay',
        type: 'number',
        required: false,
        default: '30000',
        description: 'Maximum delay between retries',
      },
      {
        name: 'backoffMultiplier',
        type: 'number',
        required: false,
        default: '2',
        description: 'Multiplier for exponential backoff',
      },
      {
        name: 'retryOn',
        type: '(error) => boolean',
        required: false,
        description: 'Predicate to decide if error is retryable',
      },
    ],
    examples: [
      {
        title: 'Retry with Exponential Backoff',
        code: `import { createServer, forPattern, retry } from 'raffel'

const server = createServer()
  .use(forPattern('external.*', retry({
    maxAttempts: 3,
    initialDelay: 1000,
    backoffMultiplier: 2,
    retryOn: (err) => err.code === 'ECONNREFUSED' || err.status >= 500
  })))`,
      },
    ],
  },
  {
    name: 'circuitBreaker',
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
        default: '2',
        description: 'Successes before circuit closes',
      },
      {
        name: 'timeout',
        type: 'number',
        required: false,
        default: '30000',
        description: 'Time in ms before attempting to close',
      },
      {
        name: 'onStateChange',
        type: '(state) => void',
        required: false,
        description: 'Callback when circuit state changes',
      },
    ],
    examples: [
      {
        title: 'Circuit Breaker for External Service',
        code: `import { createServer, forPattern, circuitBreaker } from 'raffel'

const server = createServer()
  .use(forPattern('payments.*', circuitBreaker({
    failureThreshold: 5,   // Open after 5 failures
    successThreshold: 2,   // Close after 2 successes in half-open
    timeout: 30000,        // Try half-open after 30s
    onStateChange: (state) => {
      console.log(\`Circuit breaker state: \${state}\`)
      if (state === 'open') alertOps('Payment service circuit open!')
    }
  })))`,
      },
    ],
  },
  {
    name: 'timeout',
    description: 'Enforces deadline on handler execution. Rejects with DEADLINE_EXCEEDED if exceeded.',
    category: 'resilience',
    options: [
      {
        name: 'ms',
        type: 'number',
        required: true,
        description: 'Timeout in milliseconds',
      },
      {
        name: 'onTimeout',
        type: '(ctx) => void',
        required: false,
        description: 'Callback when timeout occurs',
      },
    ],
    examples: [
      {
        title: 'Global Timeout',
        code: `import { createServer, timeout } from 'raffel'

const server = createServer()
  .use(timeout({ ms: 30000 })) // 30 second timeout for all procedures`,
      },
      {
        title: 'Per-Procedure Timeout',
        code: `import { createServer, forPattern, timeout } from 'raffel'

const server = createServer()
  .use(forPattern('reports.*', timeout({ ms: 120000 }))) // 2 min for reports
  .use(timeout({ ms: 10000 })) // 10s default`,
      },
    ],
  },
  {
    name: 'bulkhead',
    description:
      'Limits concurrent executions to isolate failures. Prevents one slow procedure from consuming all resources.',
    category: 'resilience',
    options: [
      {
        name: 'maxConcurrent',
        type: 'number',
        required: true,
        description: 'Maximum concurrent executions',
      },
      {
        name: 'maxQueue',
        type: 'number',
        required: false,
        default: '0',
        description: 'Maximum requests to queue when at capacity',
      },
      {
        name: 'queueTimeout',
        type: 'number',
        required: false,
        description: 'Max time to wait in queue (ms)',
      },
    ],
    examples: [
      {
        title: 'Limit Concurrent Database Queries',
        code: `import { createServer, forPattern, bulkhead } from 'raffel'

const server = createServer()
  .use(forPattern('db.*', bulkhead({
    maxConcurrent: 10, // Max 10 concurrent DB queries
    maxQueue: 50,      // Queue up to 50 more
    queueTimeout: 5000 // Wait max 5s in queue
  })))`,
      },
    ],
  },
  {
    name: 'fallback',
    description:
      'Provides fallback response when handler fails. Useful for graceful degradation.',
    category: 'resilience',
    options: [
      {
        name: 'fallback',
        type: '(error, ctx) => unknown',
        required: true,
        description: 'Function returning fallback value',
      },
      {
        name: 'shouldFallback',
        type: '(error) => boolean',
        required: false,
        description: 'Predicate to decide if fallback should be used',
      },
    ],
    examples: [
      {
        title: 'Fallback to Cached Data',
        code: `import { createServer, forPattern, fallback } from 'raffel'

const server = createServer()
  .use(forPattern('prices.*', fallback({
    fallback: async (error, ctx) => {
      // Return cached data on failure
      return await cache.get(\`prices:\${ctx.procedure}\`) || { prices: [], stale: true }
    },
    shouldFallback: (err) => err.code === 'SERVICE_UNAVAILABLE'
  })))`,
      },
    ],
  },

  // === Observability ===
  {
    name: 'createMetricsInterceptor',
    description:
      'Auto-instruments all procedures with Prometheus-compatible metrics (latency, count, errors).',
    category: 'observability',
    options: [
      {
        name: 'registry',
        type: 'MetricRegistry',
        required: true,
        description: 'Metric registry for storing metrics',
      },
      {
        name: 'buckets',
        type: 'number[]',
        required: false,
        description: 'Histogram buckets for latency',
      },
      {
        name: 'labels',
        type: '(ctx) => Record<string, string>',
        required: false,
        description: 'Additional labels to add to metrics',
      },
    ],
    examples: [
      {
        title: 'Auto-Instrumentation',
        code: `import { createServer, createMetricRegistry, createMetricsInterceptor } from 'raffel'

const metrics = createMetricRegistry()
const server = createServer()
  .use(createMetricsInterceptor({ registry: metrics }))

// Metrics automatically collected:
// - raffel_procedure_duration_seconds (histogram)
// - raffel_procedure_total (counter)
// - raffel_procedure_errors_total (counter)

server.procedure('metrics.export')
  .handler(async () => exportPrometheus(metrics))`,
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
      {
        name: 'spanName',
        type: '(ctx) => string',
        required: false,
        description: 'Custom span name generator',
      },
      {
        name: 'attributes',
        type: '(ctx) => SpanAttributes',
        required: false,
        description: 'Additional span attributes',
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
  exporter: createJaegerExporter({ endpoint: 'http://localhost:14268/api/traces' })
})

const server = createServer()
  .use(createTracingInterceptor({ tracer }))`,
      },
    ],
  },
  {
    name: 'logging',
    description: 'Structured logging for request/response with configurable levels and formats.',
    category: 'observability',
    options: [
      {
        name: 'level',
        type: "'debug' | 'info' | 'warn' | 'error'",
        required: false,
        default: "'info'",
        description: 'Log level',
      },
      {
        name: 'format',
        type: "'json' | 'pretty'",
        required: false,
        default: "'json'",
        description: 'Log output format',
      },
      {
        name: 'includeInput',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Include request input in logs (careful with PII)',
      },
      {
        name: 'includeOutput',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Include response output in logs',
      },
    ],
    examples: [
      {
        title: 'Production Logging',
        code: `import { createServer, logging, forPattern, except } from 'raffel'

const server = createServer()
  .use(except('health.*', logging({
    level: 'info',
    format: 'json',
    includeInput: false,  // Don't log PII
    includeOutput: false
  })))`,
      },
    ],
  },

  // === Validation ===
  {
    name: 'createValidationInterceptor',
    description:
      'Validates input/output against registered schemas. Supports Zod, Yup, Joi, Ajv, fastest-validator.',
    category: 'validation',
    options: [
      {
        name: 'validateInput',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Validate request input',
      },
      {
        name: 'validateOutput',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Validate response output',
      },
      {
        name: 'onError',
        type: '(errors) => void',
        required: false,
        description: 'Callback on validation error',
      },
    ],
    examples: [
      {
        title: 'Zod Validation',
        code: `import { createServer, createValidationInterceptor, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer()
  .use(createValidationInterceptor({ validateInput: true, validateOutput: true }))
  .procedure('users.create')
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(2).max(100),
      age: z.number().min(18).optional()
    }))
    .output(z.object({
      id: z.string(),
      email: z.string(),
      name: z.string()
    }))
    .handler(async (input, ctx) => {
      // Input is already validated and typed!
      return await db.users.create(input)
    })`,
      },
    ],
  },

  // === Caching ===
  {
    name: 'cache',
    description:
      'Response caching with pluggable drivers (memory, file, Redis, S3DB). Supports TTL and invalidation.',
    category: 'caching',
    options: [
      {
        name: 'driver',
        type: 'CacheDriver',
        required: true,
        description: 'Cache driver instance',
      },
      {
        name: 'ttl',
        type: 'number',
        required: false,
        default: '60000',
        description: 'Time-to-live in milliseconds',
      },
      {
        name: 'keyGenerator',
        type: '(ctx, input) => string',
        required: false,
        description: 'Custom cache key generator',
      },
      {
        name: 'shouldCache',
        type: '(ctx, result) => boolean',
        required: false,
        description: 'Predicate to decide if response should be cached',
      },
    ],
    examples: [
      {
        title: 'In-Memory Caching',
        code: `import { createServer, forPattern, cache, createCacheMemoryDriver } from 'raffel'

const memoryCache = createCacheMemoryDriver({
  maxSize: 1000,
  evictionPolicy: 'lru'
})

const server = createServer()
  .use(forPattern('products.list', cache({
    driver: memoryCache,
    ttl: 5 * 60 * 1000, // 5 minutes
    keyGenerator: (ctx, input) => \`products:\${JSON.stringify(input)}\`
  })))`,
      },
      {
        title: 'Redis Distributed Cache',
        code: `import { createServer, forPattern, cache, createCacheRedisDriver } from 'raffel'
import Redis from 'ioredis'

const redisCache = createCacheRedisDriver({
  client: new Redis(process.env.REDIS_URL),
  prefix: 'cache:'
})

const server = createServer()
  .use(forPattern('*', cache({
    driver: redisCache,
    ttl: 60000,
    shouldCache: (ctx, result) => !ctx.auth // Don't cache authenticated responses
  })))`,
      },
    ],
  },
  {
    name: 'dedup',
    description:
      'Request deduplication to prevent duplicate processing of identical concurrent requests.',
    category: 'caching',
    options: [
      {
        name: 'windowMs',
        type: 'number',
        required: false,
        default: '1000',
        description: 'Deduplication window in milliseconds',
      },
      {
        name: 'keyGenerator',
        type: '(ctx, input) => string',
        required: false,
        description: 'Custom dedup key generator',
      },
    ],
    examples: [
      {
        title: 'Prevent Double Submit',
        code: `import { createServer, forPattern, dedup } from 'raffel'

const server = createServer()
  .use(forPattern('orders.create', dedup({
    windowMs: 5000, // 5 second window
    keyGenerator: (ctx, input) => \`order:\${ctx.auth.principal.id}:\${input.idempotencyKey}\`
  })))`,
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
        code: `import { createServer, compose, timeout, logging, cache } from 'raffel'

const productionStack = compose(
  timeout({ ms: 30000 }),
  logging({ level: 'info', format: 'json' }),
  cache({ driver: memoryCache, ttl: 60000 })
)

const server = createServer()
  .use(productionStack)`,
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
        type: '(ctx) => boolean',
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
        title: 'Environment-Based Middleware',
        code: `import { createServer, when, logging } from 'raffel'

const server = createServer()
  .use(when(
    () => process.env.NODE_ENV === 'development',
    logging({ level: 'debug', format: 'pretty', includeInput: true })
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
        type: 'string | string[]',
        required: true,
        description: 'Glob pattern(s) to match (e.g., "users.*", "admin.**")',
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
    description: 'Applies interceptor to all procedures except those matching patterns.',
    category: 'composition',
    options: [
      {
        name: 'pattern',
        type: 'string | string[]',
        required: true,
        description: 'Pattern(s) to exclude',
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
        code: `import { createServer, except, logging } from 'raffel'

const server = createServer()
  .use(except('health.*', logging({ level: 'info' })))`,
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
        type: '(ctx) => boolean',
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
        code: `import { createServer, branch, cache } from 'raffel'

const server = createServer()
  .use(branch(
    (ctx) => !ctx.auth?.authenticated,
    cache({ driver: publicCache, ttl: 300000 }),  // 5 min for public
    cache({ driver: privateCache, ttl: 60000 })   // 1 min for authenticated
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

export function getInterceptor(name: string): InterceptorDoc | undefined {
  return interceptors.find((i) => i.name === name)
}

export function listInterceptors(category?: string): InterceptorDoc[] {
  if (category) {
    return interceptors.filter((i) => i.category === category)
  }
  return interceptors
}
