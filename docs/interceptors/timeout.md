# Timeout

Enforce request deadlines to prevent hanging requests.

---

## Basic Usage

```typescript
import { createServer, createTimeoutInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

// Default timeout (30s)
server.use(createTimeoutInterceptor())

server.procedure('slow.operation')
  .handler(async (input) => {
    return await slowOperation(input)
  })
```

---

## Configuration

```typescript
createTimeoutInterceptor({
  // Default timeout in ms
  defaultMs: 30_000,

  // Per-procedure overrides
  procedures: {
    'health.check': 1_000,
    'reports.generate': 120_000,
  },

  // Pattern-based overrides
  patterns: {
    'batch.**': 120_000,
    'report.*': 60_000,
  },
})
```

---

## Deadline Propagation

The interceptor sets `ctx.deadline` (ms since epoch). Nested calls honor the
earliest deadline:

```typescript
server.procedure('order.create')
  .use(createTimeoutInterceptor({ defaultMs: 5_000 }))
  .handler(async (input, ctx) => {
    if (ctx.deadline && Date.now() > ctx.deadline) {
      throw new Error('Deadline exceeded')
    }

    // Pass signal to downstream calls
    const response = await fetch(input.url, { signal: ctx.signal })
    return response.json()
  })
```

---

## Phase Tracking

Use timeout phases to diagnose where time is spent:

```typescript
import { setTimeoutPhase } from 'raffel'

server.procedure('report.generate')
  .use(createTimeoutInterceptor({ defaultMs: 60_000 }))
  .handler(async (input, ctx) => {
    setTimeoutPhase(ctx, 'downstream')
    const data = await fetchReportData(input)

    setTimeoutPhase(ctx, 'handler')
    return buildReport(data)
  })
```

---

## Error Response

When timeout occurs, Raffel throws `DEADLINE_EXCEEDED`:

```json
{
  "error": {
    "code": "DEADLINE_EXCEEDED",
    "message": "Request timed out after 30000ms (phase: handler)"
  }
}
```

---

## Next Steps

- **[Retry](retry.md)** - Automatic retry with backoff
- **[Circuit Breaker](circuit-breaker.md)** - Fail fast on repeated errors
- **[Bulkhead](bulkhead.md)** - Limit concurrent requests
