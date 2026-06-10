# Logging

Structured, protocol-agnostic logging with the logging interceptor.

---

## Quick Start

```typescript
import { createServer, createLoggingInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.use(createLoggingInterceptor())

server.procedure('users.create')
  .handler(async (input) => {
    return createUser(input)
  })
```

---

## Injecting your own logger

By default Raffel logs through a built-in [pino](https://getpino.io) instance.
Pass `logger` to `createServer` to route **all** of Raffel's logs — internal
adapters and core, the request-scoped `ctx.logger`, and the `ctx.log` provider —
through your own logger instead. Use it to share one format/destination with the
host service (e.g. a single JSON stream in Datadog).

```typescript
import pino from 'pino'
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  logger: pino(), // your instance — every Raffel log flows through it
})
```

`logger` accepts either:

- a **`pino.Logger`** (rich path): component loggers become
  `logger.child({ component })` and request loggers `logger.child({ requestId })`,
  preserving every binding end to end; or
- a **`LoggerFactory`** (`(component: string) => LoggerPort`): the abstract,
  pino-independent path. `trace`→`debug` and `fatal`→`error` are mapped onto the
  four-method `LoggerPort`.

> **Memory:** injecting a logger never multiplies allocations. Component loggers
> are process-scoped singletons (one per module), and the request logger is
> materialized lazily — at most one child per request, and only when the handler
> actually logs.

---

## Loggers in handlers

Two loggers reach every handler, both flowing through the injected base logger:

| Access | Scope | Carries | Use for |
|---|---|---|---|
| `ctx.logger` | per-request | `requestId` | correlating logs to a single request |
| `ctx.log` | app singleton | `component: 'app'` | app/background logging not tied to a request |

```typescript
server.http.get('/users/:id', async (input, ctx) => {
  ctx.logger.info({ id: input.id }, 'fetching user') // includes requestId
  ctx.log.info('cache warm started')                 // includes component: 'app'
  return getUser(input.id)
})
```

`ctx.log` is a built-in [provider](/tooling/providers.md) — an app-scoped child
of the base logger, created once at startup. Override it by declaring your own
`log` provider:

```typescript
createServer({
  port: 3000,
  providers: {
    log: () => myCustomAppLogger,
  },
})
```

---

## Format & level via environment

Even without injecting a logger, the built-in pino respects:

- `LOG_LEVEL` — `trace` | `debug` | `info` | `warn` | `error` | `silent`
  (default: `debug` in dev, `info` in production).
- `LOG_FORMAT=json` — force JSON output even in development (dev otherwise uses
  pretty-printing). Set this when shipping aggregated logs to a JSON sink so
  Raffel's output is indistinguishable from the host service's.

This is the zero-config way to make Raffel's logs format-compatible with a host
service that also uses pino, without injecting a logger instance.

---

## Configuration

The logging **interceptor** below is independent of the base logger above: it
emits one structured request/response line per call. Its own `logger` option
defaults to Raffel's base logger, so injecting a server `logger` also redirects
interceptor output.

```typescript
createLoggingInterceptor({
  // Log level
  level: 'info', // 'trace' | 'debug' | 'info' | 'warn' | 'error'

  // Output format
  format: process.env.NODE_ENV === 'production' ? 'json' : 'pretty',

  // Include payload/response
  includePayload: false,
  includeResponse: false,

  // Include protocol metadata (headers, etc.)
  includeMetadata: true,

  // Headers to redact when logging metadata
  sensitiveHeaders: ['authorization', 'cookie', 'x-api-key'],

  // Skip procedures by pattern
  excludeProcedures: ['health.*', 'metrics.*'],

  // Custom filter
  filter: ({ envelope }) => envelope.metadata['x-monitoring'] !== 'true',

  // Custom logger
  logger: customLogger,
})
```

---

## Filtering Logs

Use `filter` when you need full context:

```typescript
createLoggingInterceptor({
  filter: ({ envelope, ctx, duration, error }) => {
    if (envelope.metadata['x-internal-service'] === 'true') return false
    if (ctx.auth?.principal === 'system') return false
    return true
  },
})
```

---

## Metadata Redaction

Metadata is redacted automatically when `includeMetadata` is enabled:

```typescript
createLoggingInterceptor({
  includeMetadata: true,
  sensitiveHeaders: ['authorization', 'cookie', 'x-api-key'],
})
```

---

## HTTP Access Logs

For HTTP access logs, use the DX middleware:

```typescript
import { createProductionHttpLoggingMiddleware } from 'raffel'

const httpLogging = createProductionHttpLoggingMiddleware()

const server = createServer({
  port: 3000,
  http: {
    middleware: [
      (req, res) =>
        new Promise((resolve) => httpLogging(req, res, () => resolve(false))),
    ],
  },
})
```

---

## Next Steps

- **[Metrics](/observability/metrics.md)** - Prometheus metrics
- **[Tracing](/observability/tracing.md)** - OpenTelemetry tracing
- **[DX](/tooling/dx.md)** - Developer experience features
