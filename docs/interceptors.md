# Interceptors

Interceptors are middleware functions that wrap handlers in an onion model. They can
be applied globally or per route, and work across all protocols (HTTP, WebSocket, TCP,
gRPC, JSON-RPC).

## Basic Concept

```
Request → [Interceptor 1] → [Interceptor 2] → [Handler] → [Interceptor 2] → [Interceptor 1] → Response
```

Each interceptor receives the request, can modify it, call `next()` to continue the
chain, and modify the response on the way back.

## Order of Execution

1. **Global interceptors** (`server.use`)
2. **Mount interceptors** (`server.mount`)
3. **Module interceptors** (`module.use`)
4. **Handler interceptors** (`builder.use`)

```ts
// Global - runs first
server.use(loggingInterceptor)

// Mount level
server.mount('admin', adminModule, { interceptors: [adminAuthInterceptor] })

// Module level
const module = createRouterModule()
module.use(moduleInterceptor)

// Handler level - runs last (closest to handler)
server
  .procedure('users.get')
  .use(cacheInterceptor)
  .handler(...)
```

## Creating Interceptors

```ts
import type { Interceptor, Envelope, Context } from 'raffel'

const timingInterceptor: Interceptor = async (envelope, ctx, next) => {
  const start = Date.now()

  try {
    const result = await next()
    console.log(`${envelope.procedure} took ${Date.now() - start}ms`)
    return result
  } catch (error) {
    console.log(`${envelope.procedure} failed after ${Date.now() - start}ms`)
    throw error
  }
}

server.use(timingInterceptor)
```

## Built-in Interceptors

Raffel provides production-ready interceptors for common patterns.

### Rate Limiting

Limit request rates per client/IP/user:

```ts
import { createRateLimitInterceptor } from 'raffel'

const rateLimit = createRateLimitInterceptor({
  windowMs: 60000,    // 1 minute window
  maxRequests: 100,   // 100 requests per window
  keyGenerator: (envelope, ctx) => ctx.auth?.principal ?? ctx.clientIp ?? 'anonymous',
})

server.use(rateLimit)
```

Use drivers to share limits across instances:

```ts
import { createRateLimitInterceptor, createRateLimitDriver } from 'raffel'

const driver = await createRateLimitDriver('redis', {
  client: redisClient,
  prefix: 'rl:',
})

const rateLimit = createRateLimitInterceptor({
  windowMs: 60000,
  maxRequests: 100,
  driver,
})

server.use(rateLimit)
```

`driver` accepts a driver instance, a driver type (`'memory' | 'filesystem' | 'redis'`),
or a driver config object.

### Request ID

Add unique request IDs for tracing:

```ts
import { createRequestIdInterceptor, createCorrelatedRequestIdInterceptor } from 'raffel'

// Basic request ID
server.use(createRequestIdInterceptor())

// With prefix
server.use(createPrefixedRequestIdInterceptor('api'))
// IDs like: api_abc123...

// Correlated (preserves incoming correlation ID)
server.use(createCorrelatedRequestIdInterceptor())
```

### Logging

Request/response logging with configurable detail:

```ts
import {
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createDebugLoggingInterceptor,
} from 'raffel'

// Basic logging
server.use(createLoggingInterceptor())

// Production (redacted sensitive headers)
server.use(createProductionLoggingInterceptor())

// Debug (verbose output)
server.use(createDebugLoggingInterceptor())
```

### Timeout

Enforce request timeouts:

```ts
import {
  createTimeoutInterceptor,
  createCascadingTimeoutInterceptor,
  createDeadlinePropagationInterceptor,
} from 'raffel'

// Fixed timeout
server.use(createTimeoutInterceptor({ timeoutMs: 5000 }))

// Cascading (shorter timeouts for downstream calls)
server.use(createCascadingTimeoutInterceptor({
  timeoutMs: 10000,
  downstreamBuffer: 500,  // Reserve 500ms for response
}))

// Deadline propagation (respect incoming deadline)
server.use(createDeadlinePropagationInterceptor())
```

### Retry

Automatic retry with backoff strategies:

```ts
import { createRetryInterceptor, createSelectiveRetryInterceptor } from 'raffel'

// Basic retry
server.use(createRetryInterceptor({
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffStrategy: 'exponential',  // 'linear', 'exponential', 'decorrelated'
  jitter: true,
}))

// AWS-style decorrelated jitter (prevents thundering herd)
server.use(createRetryInterceptor({
  backoffStrategy: 'decorrelated',
  maxAttempts: 5,
}))

// Selective retry for specific procedures
server.use(createSelectiveRetryInterceptor({
  procedures: ['external.*', 'payment.*'],
  config: { maxAttempts: 5 },
}))

// With observability hook
server.use(createRetryInterceptor({
  onRetry: ({ attempt, error, delayMs, procedure }) => {
    logger.warn({ attempt, procedure, delayMs }, `Retrying: ${error.message}`)
  },
}))
```

### Circuit Breaker

Prevent cascading failures by failing fast:

```ts
import {
  createCircuitBreakerInterceptor,
  createProcedureCircuitBreaker,
  createCircuitBreakerManager,
} from 'raffel'

// Basic circuit breaker
server.use(createCircuitBreakerInterceptor({
  failureThreshold: 5,    // Open after 5 failures
  successThreshold: 3,    // Close after 3 successes in half-open
  resetTimeoutMs: 30000,  // Try to recover after 30s
  windowMs: 60000,        // Failure counting window
}))

// Per-procedure configuration
server.use(createProcedureCircuitBreaker({
  default: { failureThreshold: 5 },
  procedures: {
    'external.payment': { failureThreshold: 3, resetTimeoutMs: 60000 },
    'external.email': { failureThreshold: 10 },
  },
}))

// With monitoring
const cbManager = createCircuitBreakerManager({
  failureThreshold: 5,
  onStateChange: (state, procedure) => {
    metrics.gauge('circuit_breaker', state === 'open' ? 1 : 0, { procedure })
  },
})
server.use(cbManager.interceptor)

// Check circuit states
console.log(cbManager.getStates())
// Map { 'users.get' => 'closed', 'external.api' => 'open' }
```

Circuit breaker states:
- **CLOSED**: Normal operation, requests pass through
- **OPEN**: Circuit tripped, requests fail fast
- **HALF-OPEN**: Testing recovery, limited requests allowed

### Bulkhead (Concurrency Limiter)

Limit concurrent executions to prevent resource exhaustion:

```ts
import {
  createBulkheadInterceptor,
  createProcedureBulkhead,
  createBulkheadManager,
} from 'raffel'

// Basic concurrency limit
server.use(createBulkheadInterceptor({
  concurrency: 10,
}))

// With queue for overflow
server.use(createBulkheadInterceptor({
  concurrency: 5,
  maxQueueSize: 100,    // Queue up to 100 requests
  queueTimeout: 30000,  // Timeout after 30s in queue
}))

// Per-procedure limits
server.use(createProcedureBulkhead({
  default: { concurrency: 10, maxQueueSize: 50 },
  procedures: {
    'reports.generate': { concurrency: 2 },  // Heavy operation
    'files.upload': { concurrency: 5, maxQueueSize: 100 },
  },
}))

// With monitoring
const bhManager = createBulkheadManager({
  concurrency: 5,
  maxQueueSize: 100,
})
server.use(bhManager.interceptor)

setInterval(() => {
  for (const [proc, { active, queued }] of bhManager.getStats()) {
    metrics.gauge('bulkhead.active', active, { procedure: proc })
    metrics.gauge('bulkhead.queued', queued, { procedure: proc })
  }
}, 1000)
```

### Deduplication

Prevent duplicate requests:

```ts
import { createDedupInterceptor, createReadOnlyDedupInterceptor } from 'raffel'

// Deduplicate all requests
server.use(createDedupInterceptor({
  ttlMs: 60000,
  keyGenerator: (envelope) => `${envelope.procedure}:${JSON.stringify(envelope.payload)}`,
}))

// Deduplicate only read operations
server.use(createReadOnlyDedupInterceptor())
```

### Size Limiting

Limit request/response sizes:

```ts
import {
  createSizeLimitInterceptor,
  createRequestSizeLimitInterceptor,
  createResponseSizeLimitInterceptor,
  SizeLimitPresets,
} from 'raffel'

// Both directions
server.use(createSizeLimitInterceptor({
  maxRequestSize: 1024 * 1024,    // 1MB
  maxResponseSize: 10 * 1024 * 1024, // 10MB
}))

// Request only
server.use(createRequestSizeLimitInterceptor({ maxSize: 1024 * 1024 }))

// Response only
server.use(createResponseSizeLimitInterceptor({ maxSize: 10 * 1024 * 1024 }))

// Presets
server.use(createSizeLimitInterceptor(SizeLimitPresets.small)) // 100KB
server.use(createSizeLimitInterceptor(SizeLimitPresets.api))   // 1MB
server.use(createSizeLimitInterceptor(SizeLimitPresets.file))  // 50MB
```

### Cache

Cache procedure results:

```ts
import { createCacheInterceptor, createCacheDriver } from 'raffel'

// With external driver
const driver = await createCacheDriver('memory', {
  maxSize: 5000,
  evictionPolicy: 'lru',
})

server.use(createCacheInterceptor({
  driver,
  ttlMs: 60000,
  keyGenerator: (envelope) => `${envelope.procedure}:${JSON.stringify(envelope.payload)}`,
  procedures: ['query.**'],
}))

// Or with inline driver config
server.use(createCacheInterceptor({
  driverType: 'memory',
  driverOptions: { maxSize: 5000 },
  ttlMs: 60000,
}))
```

Cache interceptors apply across protocols, including REST resources and HTTP
path overrides routed through the core.

See [Cache](cache.md) for full driver documentation.

### Fallback

Provide fallback responses on errors:

```ts
import { createFallbackInterceptor } from 'raffel'

server.use(createFallbackInterceptor({
  fallback: (envelope, error) => {
    // Return default data on error
    return { data: [], error: error.message }
  },
  shouldFallback: (error) => error.code === 'UNAVAILABLE',
}))
```

## Composition Helpers

Helpers to scope or combine interceptors:

### compose / pipe

Chain multiple interceptors:

```ts
import { compose, pipe } from 'raffel'

// compose: right-to-left (innermost first)
const composed = compose(auth, logging, rateLimit)

// pipe: left-to-right (first runs first)
const piped = pipe(rateLimit, logging, auth)

server.use(composed)
```

### when

Conditional application:

```ts
import { when } from 'raffel'

// Apply only if condition is true
server.use(when(
  (envelope) => envelope.procedure.startsWith('admin.'),
  adminAuthInterceptor
))
```

### forProcedures / forPattern

Apply to specific procedures:

```ts
import { forProcedures, forPattern } from 'raffel'

// Exact matches
server.use(forProcedures(['users.create', 'users.update'], validationInterceptor))

// Pattern matching
server.use(forPattern('admin.*', adminAuthInterceptor))
server.use(forPattern('external.**', retryInterceptor))
```

### except

Exclude specific procedures:

```ts
import { except } from 'raffel'

// Apply to all except health checks
server.use(except(['health', 'health.live', 'health.ready'], loggingInterceptor))
```

### branch

Route to different interceptors:

```ts
import { branch } from 'raffel'

server.use(branch(
  (envelope) => envelope.procedure.startsWith('admin.'),
  adminInterceptor,  // if true
  userInterceptor    // if false
))
```

### passthrough

No-op interceptor for conditional chains:

```ts
import { passthrough, when } from 'raffel'

// Use passthrough as default case
server.use(when(
  (env) => env.metadata['x-premium'] === 'true',
  premiumInterceptor,
  passthrough
))
```

## Preset Stacks

Pre-configured interceptor stacks for common scenarios:

```ts
import {
  createProductionStack,
  createDevelopmentStack,
  createResilientStack,
  createMinimalStack,
} from 'raffel'

// Production: logging, request ID, rate limiting, timeout
for (const interceptor of createProductionStack()) {
  server.use(interceptor)
}

// Development: verbose logging, no rate limiting
for (const interceptor of createDevelopmentStack()) {
  server.use(interceptor)
}

// Resilient: retry, circuit breaker, timeout
for (const interceptor of createResilientStack()) {
  server.use(interceptor)
}

// Minimal: just request ID
for (const interceptor of createMinimalStack()) {
  server.use(interceptor)
}
```

## HTTP Utilities

HTTP-specific middleware for security and compression:

```ts
import { createSecurityMiddleware, createCompressionMiddleware } from 'raffel/middleware/http'

// Security headers (HSTS, CSP, etc.)
const security = createSecurityMiddleware({
  hsts: true,
  noSniff: true,
  frameOptions: 'DENY',
})

// Response compression
const compression = createCompressionMiddleware({
  threshold: 1024,  // Only compress > 1KB
})
```

These wrap Node.js `ServerResponse` and are used at the HTTP layer.
Compression negotiates `Accept-Encoding` (br/gzip/deflate), sets
`Content-Encoding`, and adds `Vary: Accept-Encoding`.

## Best Practices

1. **Order matters**: Place interceptors in logical order:
   ```ts
   server
     .use(requestIdInterceptor)    // First: assign ID
     .use(loggingInterceptor)      // Log with ID
     .use(authInterceptor)         // Auth before business logic
     .use(rateLimitInterceptor)    // Rate limit after auth
     .use(cacheInterceptor)        // Cache after auth
   ```

2. **Keep interceptors focused**: Each interceptor should do one thing well.

3. **Handle errors appropriately**: Always re-throw errors unless you're intentionally
   swallowing them.

4. **Use pattern matching**: Instead of checking procedure names manually, use
   `forPattern` for cleaner code.

5. **Monitor interceptors**: Add observability hooks to track interceptor behavior:
   ```ts
   const retry = createRetryInterceptor({
     onRetry: ({ attempt, procedure }) => {
       metrics.increment('retries', { procedure, attempt })
     },
   })
   ```

6. **Test interceptors**: Test interceptors in isolation and in combination:
   ```ts
   const mockNext = jest.fn().mockResolvedValue({ data: 'ok' })
   const result = await interceptor(envelope, ctx, mockNext)
   expect(mockNext).toHaveBeenCalled()
   ```
