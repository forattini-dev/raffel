# Timeout

Enforce request deadlines to prevent hanging requests.

---

## Basic Usage

```typescript
import { createServer, createTimeoutInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

// Global timeout
server.use(createTimeoutInterceptor({ timeout: 30000 }))

server.procedure('slow.operation')
  .handler(async (input) => {
    // Throws TimeoutError if takes > 30s
    return await slowOperation(input)
  })
```

---

## Configuration

```typescript
createTimeoutInterceptor({
  // Timeout in milliseconds
  timeout: 30000,

  // Custom error message
  message: 'Request timed out',

  // Called on timeout
  onTimeout: (ctx) => {
    console.log(`Timeout: ${ctx.procedure}`)
  },

  // Skip timeout for certain requests
  skip: (ctx) => {
    return ctx.procedure === 'batch.process'
  },
})
```

---

## Per-Procedure Timeouts

```typescript
// Fast endpoint
server.procedure('health.check')
  .use(createTimeoutInterceptor({ timeout: 1000 }))
  .handler(async () => ({ ok: true }))

// Slow endpoint with longer timeout
server.procedure('reports.generate')
  .use(createTimeoutInterceptor({ timeout: 120000 }))  // 2 minutes
  .handler(async (input) => {
    return await generateReport(input)
  })
```

---

## Deadline Propagation

Timeouts propagate through the context:

```typescript
server.procedure('order.create')
  .use(createTimeoutInterceptor({ timeout: 5000 }))
  .handler(async (input, ctx) => {
    // Check remaining time
    const remaining = ctx.deadline - Date.now()
    console.log(`${remaining}ms remaining`)

    // Pass deadline to downstream calls
    const inventory = await ctx.call('inventory.check', input.items, {
      timeout: remaining - 500,  // Leave 500ms buffer
    })

    return { orderId: 'xxx', inventory }
  })
```

---

## AbortSignal Integration

Use the context signal for cancellation:

```typescript
server.procedure('download.file')
  .use(createTimeoutInterceptor({ timeout: 60000 }))
  .handler(async (input, ctx) => {
    // Pass signal to fetch
    const response = await fetch(input.url, {
      signal: ctx.signal,
    })

    // Stream with signal
    const stream = response.body
    const reader = stream.getReader()

    while (true) {
      // Check if cancelled
      if (ctx.signal.aborted) {
        reader.cancel()
        throw new Error('Download cancelled')
      }

      const { done, value } = await reader.read()
      if (done) break
      // Process chunk
    }
  })
```

---

## Graceful Cleanup

Handle timeout cleanup:

```typescript
server.procedure('database.query')
  .use(createTimeoutInterceptor({ timeout: 10000 }))
  .handler(async (input, ctx) => {
    const connection = await db.connect()

    try {
      // Register cleanup
      ctx.signal.addEventListener('abort', () => {
        connection.cancel()
        connection.release()
      })

      return await connection.query(input.sql)
    } finally {
      connection.release()
    }
  })
```

---

## Error Response

When timeout occurs:

```json
{
  "error": {
    "code": "TIMEOUT",
    "message": "Request timed out after 30000ms"
  }
}
```

HTTP status: `408 Request Timeout` or `504 Gateway Timeout`

---

## Dynamic Timeouts

Set timeout based on request:

```typescript
createTimeoutInterceptor({
  timeout: (ctx) => {
    // Different timeouts based on operation
    if (ctx.procedure.startsWith('batch.')) {
      return 120000  // 2 minutes for batch
    }
    if (ctx.procedure.startsWith('report.')) {
      return 60000   // 1 minute for reports
    }
    return 30000     // 30s default
  },
})
```

---

## With Retry

Timeout works with retry interceptor:

```typescript
server.procedure('flaky.service')
  .use(createTimeoutInterceptor({ timeout: 5000 }))
  .use(createRetryInterceptor({
    maxRetries: 3,
    retryOn: (error) => error.code === 'TIMEOUT',
  }))
  .handler(async (input) => {
    // Each attempt has 5s timeout
    // Will retry up to 3 times on timeout
    return await flakyService.call(input)
  })
```

---

## Monitoring

```typescript
createTimeoutInterceptor({
  timeout: 30000,
  onTimeout: (ctx, elapsed) => {
    metrics.increment('request_timeout', {
      procedure: ctx.procedure,
    })
    metrics.histogram('timeout_elapsed', elapsed, {
      procedure: ctx.procedure,
    })
  },
})
```

---

## Next Steps

- **[Retry](retry.md)** — Automatic retry with backoff
- **[Circuit Breaker](circuit-breaker.md)** — Fail fast on repeated errors
- **[Bulkhead](bulkhead.md)** — Limit concurrent requests
