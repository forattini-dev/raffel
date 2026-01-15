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

All built-ins are protocol-agnostic and available from `raffel` (root) or
`raffel/middleware`.

### Rate Limiting

```ts
import { createRateLimitInterceptor } from 'raffel'

server.use(createRateLimitInterceptor({
  windowMs: 60000,
  maxRequests: 100,
  keyGenerator: (_env, ctx) => ctx.auth?.principal ?? ctx.requestId,
}))
```

Use a shared driver when you need distributed limits:

```ts
import { createRateLimitInterceptor, createRateLimitDriver } from 'raffel'

const driver = await createRateLimitDriver('redis', { client: redisClient })

server.use(createRateLimitInterceptor({
  windowMs: 60000,
  maxRequests: 100,
  driver,
}))
```

### Request ID

```ts
import {
  createRequestIdInterceptor,
  createPrefixedRequestIdInterceptor,
  createCorrelatedRequestIdInterceptor,
} from 'raffel'

server.use(createRequestIdInterceptor())
server.use(createPrefixedRequestIdInterceptor('api'))
server.use(createCorrelatedRequestIdInterceptor())
```

### Logging

```ts
import { createLoggingInterceptor } from 'raffel'

server.use(createLoggingInterceptor({
  includePayload: true,
  includeResponse: true,
}))
```

### Timeout

```ts
import {
  createTimeoutInterceptor,
  createCascadingTimeoutInterceptor,
  createDeadlinePropagationInterceptor,
} from 'raffel'

server.use(createTimeoutInterceptor({ defaultMs: 5000 }))
server.use(createCascadingTimeoutInterceptor({ defaultMs: 10000 }))
server.use(createDeadlinePropagationInterceptor())
```

### Retry

```ts
import { createRetryInterceptor } from 'raffel'

server.use(createRetryInterceptor({
  maxAttempts: 3,
  backoffStrategy: 'exponential',
  initialDelayMs: 100,
}))
```

### Circuit Breaker

```ts
import { createCircuitBreakerInterceptor } from 'raffel'

server.use(createCircuitBreakerInterceptor({
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
}))
```

### Bulkhead

```ts
import { createBulkheadInterceptor } from 'raffel'

server.use(createBulkheadInterceptor({
  concurrency: 10,
  maxQueueSize: 50,
}))
```

### Cache

```ts
import { createCacheInterceptor, createCacheDriver } from 'raffel'

const driver = await createCacheDriver('memory', { maxSize: 5000 })

server.use(createCacheInterceptor({
  driver,
  ttlMs: 60000,
  procedures: ['query.**'],
}))
```

### Fallback

```ts
import { createFallbackInterceptor } from 'raffel'

server.use(createFallbackInterceptor({
  response: { status: 'unavailable' },
  when: (error) => (error as any).code === 'UNAVAILABLE',
}))
```

### More Details

See dedicated pages for details:
- [Response Envelope](interceptors/envelope.md)
- [Rate Limit](interceptors/rate-limit.md)
- [Retry](interceptors/retry.md)
- [Timeout](interceptors/timeout.md)
- [Circuit Breaker](interceptors/circuit-breaker.md)
- [Bulkhead](interceptors/bulkhead.md)
- [Fallback](interceptors/fallback.md)
- [Cache](cache.md)

Deduplication and size limits are available via `createDedupInterceptor` and
`createSizeLimitInterceptor` (see API reference).

## Composition Helpers

Helpers to scope or combine interceptors:

### compose

Chain multiple interceptors:

```ts
import { compose } from 'raffel'

// compose: left-to-right (outermost first)
const composed = compose(auth, logging, rateLimit)

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
server.use(createProductionStack())

// Development: verbose logging, no rate limiting
server.use(createDevelopmentStack())

// Resilient: retry, circuit breaker, timeout
server.use(createResilientStack())

// Minimal: just request ID
server.use(createMinimalStack())
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
