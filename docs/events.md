# Events

Events are fire-and-forget messages for asynchronous communication. Unlike procedures,
events don't return a response to the caller. Raffel supports configurable delivery
guarantees with retry and deduplication policies.

## Basic Example

```ts
server
  .event('audit.log')
  .handler(async (payload, ctx) => {
    await writeAuditLog(payload)
  })
```

Call the event:

```bash
# HTTP
curl -X POST http://localhost:3000/events/audit.log \
  -H 'Content-Type: application/json' \
  -d '{"action":"login","userId":"usr_123"}'
# Returns: HTTP 202 Accepted

# WebSocket
{"type":"event","procedure":"audit.log","payload":{"action":"login","userId":"usr_123"}}
```

## Event Builder API

```ts
server
  .event('emails.send')
  .input(z.object({ to: z.string(), subject: z.string(), body: z.string() }))
  .description('Send an email notification')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 5, initialDelay: 1000 })
  .use(rateLimitInterceptor)
  .handler(async (payload, ctx, ack) => {
    await sendEmail(payload)
    ack()  // Acknowledge successful processing
  })
```

### Builder Methods

| Method | Description |
|--------|-------------|
| `.input(schema)` | Define input validation schema (Zod) |
| `.description(text)` | Add description for documentation |
| `.delivery(mode)` | Set delivery guarantee mode |
| `.retryPolicy(policy)` | Configure retry behavior for at-least-once |
| `.deduplicationWindow(ms)` | Set dedup window for at-most-once |
| `.use(interceptor)` | Add interceptor/middleware |
| `.handler(fn)` | Define the event handler function |

## Delivery Guarantees

Raffel supports three delivery modes:

### Best-Effort (default)

No retries, errors are logged but not retried. Fastest option when message loss
is acceptable.

```ts
server
  .event('analytics.track')
  .delivery('best-effort')
  .handler(async (payload) => {
    await trackEvent(payload)
    // If this fails, the event is lost
  })
```

Use for:
- Analytics events
- Non-critical logging
- Real-time metrics

### At-Least-Once

Retries until the handler calls `ack()` or max attempts reached. The handler may
be called multiple times for the same event, so it should be idempotent.

```ts
server
  .event('payments.process')
  .delivery('at-least-once')
  .retryPolicy({
    maxAttempts: 5,
    initialDelay: 1000,      // First retry after 1s
    maxDelay: 60000,         // Cap at 1 minute
    backoffMultiplier: 2,    // Exponential: 1s, 2s, 4s, 8s, 16s
  })
  .handler(async (payload, ctx, ack) => {
    // Process the payment
    await processPayment(payload)

    // Only ack after successful processing
    ack()
  })
```

Use for:
- Payment processing
- Email sending
- Critical notifications
- Data synchronization

### At-Most-Once

Deduplicates by event ID within a time window. The event is processed at most once,
even if sent multiple times.

```ts
server
  .event('user.welcome')
  .delivery('at-most-once')
  .deduplicationWindow(5 * 60 * 1000)  // 5 minutes
  .handler(async (payload) => {
    await sendWelcomeEmail(payload.userId)
  })
```

Use for:
- Welcome emails
- One-time notifications
- Webhook deduplication

## Retry Policy

Configure retry behavior for at-least-once events:

```ts
interface RetryPolicy {
  maxAttempts: number       // Maximum retry attempts (default: 5)
  initialDelay: number      // Initial delay in ms (default: 1000)
  maxDelay: number          // Maximum delay in ms (default: 60000)
  backoffMultiplier: number // Backoff multiplier (default: 2)
}
```

### Backoff Calculation

The delay for attempt N is calculated as:

```
delay = min(initialDelay * (backoffMultiplier ^ (N-1)), maxDelay)
```

Example with default settings:
- Attempt 1: 1s
- Attempt 2: 2s
- Attempt 3: 4s
- Attempt 4: 8s
- Attempt 5: 16s

## Acknowledgment (ack)

The `ack` function signals successful processing for at-least-once events:

```ts
server
  .event('orders.fulfill')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    try {
      await fulfillOrder(payload.orderId)
      ack()  // Success - no more retries
    } catch (err) {
      // Don't ack - the event will be retried
      throw err
    }
  })
```

Important notes:
- Call `ack()` **after** successful processing, not before
- If you don't call `ack()`, the event will be retried
- `ack()` is a no-op for best-effort and at-most-once events

## Event Delivery Store

By default, Raffel uses an in-memory store for retry and deduplication state. For
production, you should implement a persistent store:

```ts
import { createServer, createInMemoryEventDeliveryStore } from 'raffel'

// In-memory (development)
const memoryStore = createInMemoryEventDeliveryStore()

// Custom store interface
interface EventDeliveryStore {
  getRetryState(eventId: string): Promise<RetryState | null>
  setRetryState(eventId: string, state: RetryState): Promise<void>
  deleteRetryState(eventId: string): Promise<void>
  isDuplicate(eventId: string): Promise<boolean>
  markDuplicate(eventId: string, ttlMs: number): Promise<void>
}
```

### Redis Store Example

```ts
const redisStore: EventDeliveryStore = {
  async getRetryState(eventId) {
    const data = await redis.get(`retry:${eventId}`)
    return data ? JSON.parse(data) : null
  },

  async setRetryState(eventId, state) {
    await redis.set(`retry:${eventId}`, JSON.stringify(state), 'EX', 3600)
  },

  async deleteRetryState(eventId) {
    await redis.del(`retry:${eventId}`)
  },

  async isDuplicate(eventId) {
    return await redis.exists(`dedup:${eventId}`) === 1
  },

  async markDuplicate(eventId, ttlMs) {
    await redis.set(`dedup:${eventId}`, '1', 'PX', ttlMs)
  },
}
```

## Global Configuration

Set default retry and deduplication policies at the server level:

```ts
const server = createServer({
  port: 3000,
  eventDelivery: {
    store: createInMemoryEventDeliveryStore(),
    defaultRetryPolicy: {
      maxAttempts: 5,
      initialDelay: 500,
      maxDelay: 30000,
      backoffMultiplier: 2,
    },
    defaultDeduplicationWindow: 5 * 60 * 1000,  // 5 minutes
  },
})
```

Per-event settings override global defaults:

```ts
server
  .event('critical.alert')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 10, initialDelay: 100 })  // Override defaults
  .handler(...)
```

## Protocol Mapping

| Protocol | Event Endpoint | Response |
|----------|----------------|----------|
| HTTP | `POST /events/{name}` | 202 Accepted |
| WebSocket | `{"type":"event","procedure":"..."}` | No response |
| TCP | `{"type":"event","procedure":"..."}` | No response |
| JSON-RPC | Notification (no id) | HTTP 204 |

## File-Based Events

Events can be defined in the routes directory:

```ts
// routes/notifications/send.event.ts
import { z } from 'zod'

export const meta = {
  description: 'Send a push notification',
  delivery: 'at-least-once' as const,
  retryPolicy: {
    maxAttempts: 3,
    initialDelay: 500,
  },
}

export const inputSchema = z.object({
  userId: z.string(),
  title: z.string(),
  body: z.string(),
})

export default async function handler(input, ctx, ack) {
  await pushNotification(input)
  ack()
}
```

## Comparison

| Feature | Procedure | Event |
|---------|-----------|-------|
| Response | Yes (sync) | No (async) |
| Retry | No | Configurable |
| Delivery guarantee | None | best-effort, at-least-once, at-most-once |
| Use case | Queries, mutations | Background jobs, notifications |

## Best Practices

1. **Make handlers idempotent** for at-least-once delivery:
   ```ts
   handler(async (payload, ctx, ack) => {
     // Use idempotency key to prevent duplicate processing
     const processed = await checkIdempotencyKey(payload.id)
     if (processed) {
       ack()
       return
     }
     await processEvent(payload)
     ack()
   })
   ```

2. **Use stable event IDs** for deduplication:
   ```ts
   // Client should send a stable ID
   { "eventId": "order_123_welcome", "userId": "usr_456" }
   ```

3. **Log failures** before retrying:
   ```ts
   handler(async (payload, ctx, ack) => {
     try {
       await process(payload)
       ack()
     } catch (err) {
       console.error('Event failed, will retry:', err)
       throw err
     }
   })
   ```

4. **Set appropriate retry limits** based on the operation:
   - Transient failures (network): high retries, short delays
   - Business failures (invalid data): low retries or none

5. **Use at-most-once** for one-time actions that can't be undone:
   ```ts
   .event('user.delete')
   .delivery('at-most-once')
   .deduplicationWindow(24 * 60 * 60 * 1000)  // 24 hours
   ```

6. **Consider dead letter queues** for events that exhaust retries:
   ```ts
   handler(async (payload, ctx, ack) => {
     if (ctx.retryAttempt >= 4) {
       await sendToDeadLetterQueue(payload)
       ack()  // Don't retry anymore
       return
     }
     await process(payload)
     ack()
   })
   ```
