# Interceptors

Interceptors wrap handlers in an onion model and can be applied globally or
per route.

## Order of execution

1. Global interceptors (`server.use`)
2. Mount interceptors (`server.mount`)
3. Module interceptors (`module.use`)
4. Handler interceptors (`builder.use`)

## Basic example

```ts
server.use(async (_env, _ctx, next) => {
  const start = Date.now()
  const result = await next()
  console.log('took', Date.now() - start)
  return result
})
```

## Built-in interceptors

Available in `raffel/middleware`:

- `createRateLimitInterceptor`
- `createRequestIdInterceptor`
- `createLoggingInterceptor`
- `createTimeoutInterceptor`
- `createRetryInterceptor`
- `createCircuitBreakerInterceptor`
- `createCacheInterceptor`

Note: these utilities live under `middleware/` in this repo. If you publish the
package, expose a `./middleware` subpath (or re-export them from the root).

```ts
import {
  createLoggingInterceptor,
  createTimeoutInterceptor,
} from 'raffel/middleware'

server
  .use(createLoggingInterceptor())
  .use(createTimeoutInterceptor({ timeoutMs: 5000 }))
```

## Composition helpers

Use helpers to scope or combine interceptors:

- `compose`, `pipe`
- `when`, `forProcedures`, `forPattern`, `except`
- `branch`, `passthrough`

```ts
import { compose, forPattern } from 'raffel/middleware'

const authOnly = forPattern('admin.*', authInterceptor)
server.use(compose(authOnly, loggingInterceptor))
```

## Preset stacks

Quick stacks for common environments:

- `createProductionStack`
- `createDevelopmentStack`
- `createResilientStack`
- `createMinimalStack`

```ts
import { createProductionStack } from 'raffel/middleware'

for (const interceptor of createProductionStack()) {
  server.use(interceptor)
}
```

## Cache interceptor

Cache procedure results with pluggable drivers:

```ts
import { createCacheInterceptor } from 'raffel/middleware'
import { createCacheDriver } from 'raffel'

// With external driver
const driver = await createCacheDriver('memory', {
  maxSize: 5000,
  evictionPolicy: 'lru',
})

server.use(createCacheInterceptor({
  driver,
  ttlMs: 60000,
  keyGenerator: (procedure, input) => `${procedure}:${JSON.stringify(input)}`,
  shouldCache: (procedure) => procedure.startsWith('query.'),
}))

// Or with inline driver config
server.use(createCacheInterceptor({
  driverType: 'memory',
  driverOptions: { maxSize: 5000 },
  ttlMs: 60000,
}))
```

Supported drivers: `memory`, `file`, `redis`, `s3db`. See [Cache](cache.md) for full documentation.

## HTTP utilities

For HTTP-specific concerns, use the helper middleware in `raffel/middleware/http`:

- `createSecurityMiddleware` (security headers)
- `createCompressionMiddleware`

These functions wrap the Node `ServerResponse` and are used at the HTTP layer
(inside your own handlers or adapter).
