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

## Configuration

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

- **[Metrics](metrics.md)** - Prometheus metrics
- **[Tracing](tracing.md)** - OpenTelemetry tracing
- **[DX](dx.md)** - Developer experience features
