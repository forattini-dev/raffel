# Events

Events are fire-and-forget messages. Raffel supports delivery guarantees with
configurable retry and deduplication policies.

## Delivery modes

- `best-effort`: no retries, errors are logged
- `at-least-once`: retry until ack or max attempts
- `at-most-once`: deduplicate by event id in a time window

## Example

```ts
server
  .event('emails.send')
  .delivery('at-least-once')
  .retryPolicy({ maxAttempts: 5, initialDelay: 1000 })
  .handler(async (payload, _ctx, ack) => {
    await sendEmail(payload)
    ack()
  })
```

For `at-most-once`, set `deduplicationWindow` and include stable event ids.

## Global defaults

You can set defaults for retry and deduplication at the router level:

```ts
import { createServer, createInMemoryEventDeliveryStore } from 'raffel'

const server = createServer({
  port: 3000,
  eventDelivery: {
    store: createInMemoryEventDeliveryStore(),
    defaultRetryPolicy: {
      maxAttempts: 5,
      initialDelay: 500,
      maxDelay: 30_000,
      backoffMultiplier: 2,
    },
    defaultDeduplicationWindow: 5 * 60 * 1000,
  },
})
```

For `at-least-once`, call `ack()` once the handler has safely processed the event.
