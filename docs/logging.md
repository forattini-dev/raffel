# Logging

Structured logging for observability and debugging.

---

## Quick Start

```typescript
import { createServer, createLoggingInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.use(createLoggingInterceptor())

server.procedure('users.create')
  .handler(async (input) => {
    // Logs: { procedure: 'users.create', duration: 45, status: 'success' }
    return createUser(input)
  })
```

---

## Configuration

```typescript
createLoggingInterceptor({
  // Log level
  level: 'info',  // 'debug' | 'info' | 'warn' | 'error'

  // What to log
  logRequest: true,
  logResponse: true,
  logErrors: true,

  // Include request/response bodies
  logBody: process.env.NODE_ENV !== 'production',

  // Sensitive fields to redact
  redact: ['password', 'token', 'apiKey', 'secret'],

  // Custom logger
  logger: customLogger,

  // Skip logging for certain requests
  skip: (ctx) => ctx.procedure === 'health.check',
})
```

---

## Log Format

### Request Log

```json
{
  "level": "info",
  "time": "2024-01-01T00:00:00.000Z",
  "msg": "Request received",
  "requestId": "abc123",
  "procedure": "users.create",
  "protocol": "http",
  "method": "POST",
  "path": "/users.create",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0..."
}
```

### Response Log

```json
{
  "level": "info",
  "time": "2024-01-01T00:00:00.045Z",
  "msg": "Request completed",
  "requestId": "abc123",
  "procedure": "users.create",
  "duration": 45,
  "status": "success",
  "statusCode": 200
}
```

### Error Log

```json
{
  "level": "error",
  "time": "2024-01-01T00:00:00.045Z",
  "msg": "Request failed",
  "requestId": "abc123",
  "procedure": "users.create",
  "duration": 45,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "stack": "Error: Invalid email..."
  }
}
```

---

## Context Logging

Log within handlers:

```typescript
server.procedure('users.create')
  .handler(async (input, ctx) => {
    // Access the logger from context
    ctx.log.info('Creating user', { email: input.email })

    try {
      const user = await db.users.create({ data: input })
      ctx.log.info('User created', { userId: user.id })
      return user
    } catch (err) {
      ctx.log.error('Failed to create user', { error: err })
      throw err
    }
  })
```

---

## Log Levels

```typescript
ctx.log.debug('Detailed debugging info')
ctx.log.info('General information')
ctx.log.warn('Warning message')
ctx.log.error('Error message')
```

Set level via environment:

```bash
LOG_LEVEL=debug node server.js
```

---

## Custom Logger

Use your own logger (Pino, Winston, etc.):

```typescript
import pino from 'pino'

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
})

createLoggingInterceptor({
  logger: {
    debug: (msg, data) => logger.debug(data, msg),
    info: (msg, data) => logger.info(data, msg),
    warn: (msg, data) => logger.warn(data, msg),
    error: (msg, data) => logger.error(data, msg),
  },
})
```

---

## Sensitive Data Redaction

Automatically redact sensitive fields:

```typescript
createLoggingInterceptor({
  redact: [
    'password',
    'token',
    'apiKey',
    'secret',
    'authorization',
    'cookie',
    'creditCard',
    'ssn',
  ],
  redactValue: '[REDACTED]',
})
```

Input:
```json
{ "email": "user@example.com", "password": "secret123" }
```

Logged:
```json
{ "email": "user@example.com", "password": "[REDACTED]" }
```

---

## Request ID Propagation

Every request gets a unique ID:

```typescript
server.procedure('orders.create')
  .handler(async (input, ctx) => {
    // ctx.id contains the request ID
    console.log(ctx.id)  // 'abc123'

    // Pass to downstream services
    await paymentService.charge(input, {
      headers: { 'X-Request-Id': ctx.id },
    })

    return { orderId: 'xyz' }
  })
```

The ID is included in all logs and response headers:

```http
HTTP/1.1 200 OK
X-Request-Id: abc123
```

---

## Correlation Across Services

For microservices, propagate the request ID:

```typescript
server.procedure('orders.create')
  .handler(async (input, ctx) => {
    // The request ID is automatically propagated
    // when using Raffel's HTTP client

    const inventory = await ctx.call('inventory.check', {
      productId: input.productId,
    })

    // Both services log with the same requestId
    return { orderId: 'xyz', inStock: inventory.available }
  })
```

---

## Environment-Based Configuration

```typescript
createLoggingInterceptor({
  level: process.env.LOG_LEVEL || 'info',

  // Pretty print in development
  format: process.env.NODE_ENV === 'development' ? 'pretty' : 'json',

  // Log bodies only in development
  logBody: process.env.NODE_ENV !== 'production',

  // Always log errors with stack traces
  logErrors: true,
})
```

---

## Filtering Logs

Skip logging for certain requests:

```typescript
createLoggingInterceptor({
  skip: (ctx) => {
    // Don't log health checks
    if (ctx.procedure === 'health.check') return true

    // Don't log internal monitoring
    if (ctx.headers['x-monitoring'] === 'true') return true

    return false
  },
})
```

---

## Performance Considerations

For high-throughput scenarios:

```typescript
createLoggingInterceptor({
  // Only log errors in production
  level: process.env.NODE_ENV === 'production' ? 'error' : 'debug',

  // Sample logs (1 in 100)
  sample: 0.01,

  // Async logging (non-blocking)
  async: true,

  // Batch logs
  batch: {
    size: 100,
    timeout: 1000,
  },
})
```

---

## Integration with Log Aggregators

### JSON Lines Format

Default for production, compatible with:
- Datadog
- Splunk
- Elasticsearch
- Loki

### OpenTelemetry Logs

```typescript
import { createOtelLoggingInterceptor } from 'raffel'

server.use(createOtelLoggingInterceptor({
  serviceName: 'my-service',
  endpoint: 'http://otel-collector:4317',
}))
```

---

## Next Steps

- **[Metrics](metrics.md)** — Prometheus metrics
- **[Tracing](tracing.md)** — OpenTelemetry tracing
- **[DX](dx.md)** — Developer experience features
