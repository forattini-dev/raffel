# Bulkhead Interceptor

Limit concurrent execution per procedure to prevent overload.

---

## Basic Usage

```typescript
import { createServer, createBulkheadInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.use(createBulkheadInterceptor({
  concurrency: 10,
}))
```

---

## With Queue

```typescript
createBulkheadInterceptor({
  concurrency: 5,
  maxQueueSize: 100,
  queueTimeout: 30_000,
  onReject: (procedure) => {
    metrics.increment('bulkhead.rejected', { procedure })
  },
  onQueued: () => metrics.increment('bulkhead.queued'),
  onDequeued: () => metrics.increment('bulkhead.dequeued'),
})
```

---

## Per-Procedure Bulkheads

```typescript
import { createProcedureBulkhead } from 'raffel'

const bulkhead = createProcedureBulkhead({
  default: { concurrency: 10, maxQueueSize: 50 },
  procedures: {
    'reports.generate': { concurrency: 2 },
    'files.upload': { concurrency: 5, maxQueueSize: 100 },
  },
})

server.use(bulkhead)
```

---

## Error Codes

Bulkhead overload results in:

- `BULKHEAD_OVERFLOW` when capacity is exceeded
- `BULKHEAD_QUEUE_TIMEOUT` when a queued request times out

These errors map to HTTP 503 by default.
