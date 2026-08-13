# Real-time and asynchronous interactions

Raffel exposes several interaction styles, but they do not offer the same
delivery guarantee. Choose the smallest contract that matches the business
requirement, then make storage, cancellation, authentication, and deployment
ownership explicit.

## Decision matrix

| Interaction | Choose it when | Delivery and recovery | Application-owned infrastructure |
|---|---|---|---|
| Polling | Changes are infrequent and seconds of latency are acceptable. | Every request is independent; the client compares versions or timestamps. | Current state and any conditional-read token. |
| Long Poll Interaction | The client needs lower latency but infrastructure must remain ordinary HTTP. | One request waits for one change or timeout, then ends. | A change source backed by application storage or pub-sub. |
| Live Stream over SSE | A server continuously pushes updates to browsers or simple HTTP clients. | Live delivery only. Reconnect hints do not replay missed records. | The live producer and any state needed after a disconnect. |
| Resumable Stream | A consumer must continue after disconnect without silently missing records. | Opaque Resume Cursor, at-least-once replay, then live delivery; expired cursors recover through a Stream Snapshot. | Durable Stream Source, Replay Provider, Stream Snapshot, retention, and deduplication policy. |
| WebSocket duplex | Client and server both send independent messages with low latency. | Connection-scoped envelopes; durability is not implied. | Session state, fan-out, and durable history when required. |
| gRPC duplex | Typed internal clients need bidirectional streaming over HTTP/2. | Connection-scoped protobuf messages; durability is not implied. | Client generation, service discovery, and durable history when required. |
| Asynchronous job resource | Work outlives the initiating request and clients need observable status or cancellation. | `202 Accepted`, a job URL, and later reads or stream updates. | Durable job state, worker or broker, idempotency, retention, and cancellation semantics. |
| Event | The caller should receive acceptance rather than a business response. | Best effort, at most once, or at least once according to the event contract. | Side-effect idempotency and a production delivery store or broker when durability matters. |

Start with polling when it is sufficient. Choose long polling to reduce empty
requests, a Live Stream for current connection updates, and a Resumable Stream
only when replay is a real product requirement. Use duplex transports only
when messages genuinely flow independently in both directions.

## Live Stream over SSE with fs-discovery

A Live Stream has a handler because the connection itself drives production:

```ts
// src/streams/orders/live.ts
import { z } from 'zod'

export const input = z.object({
  region: z.string(),
})

export const output = z.object({
  orderId: z.string(),
  status: z.string(),
})

export const meta = {
  description: 'Live order updates for one region',
  direction: 'server' as const,
  controls: {
    heartbeatMs: 15_000,
    retryMs: 2_000,
    maxDurationMs: 55 * 60_000,
    idleTimeoutMs: 60_000,
  },
}

export default async function* liveOrders(input, ctx) {
  const subscription = await ctx.services.orders.subscribe(input.region)
  try {
    for await (const update of subscription) {
      if (ctx.signal.aborted) break
      yield update
    }
  } finally {
    await subscription.close()
  }
}
```

Raffel emits named SSE events. Browser code must listen for `data`; native
`message` handling does not receive this named event:

```ts
const source = new EventSource('/streams/orders/live?region=br')

source.addEventListener('data', (event) => {
  applyOrderUpdate(JSON.parse(event.data))
})

source.addEventListener('end', () => source.close())
source.addEventListener('error', () => reportDisconnected())
```

The `retryMs` hint tells `EventSource` when to reconnect. Live reconnection is not replay:
records produced while disconnected may be absent. A heartbeat is
transport traffic, not a business record, and does not create durability.

## Resumable Stream with fs-discovery

A Source-Backed Resumable Stream exports its contracts and provider reference,
but no default handler. The provider drives initial, replay, and live reads:

```ts
// src/streams/orders/resumable.ts
import { z } from 'zod'

export const input = z.object({
  region: z.string(),
  cursor: z.string().optional(),
})

export const output = z.object({
  orderId: z.string(),
  status: z.string(),
})

export const snapshot = z.object({
  region: z.string(),
  orders: z.array(output),
})

export const resumable = {
  provider: 'orderChanges',
  delivery: 'at-least-once' as const,
  cursor: { header: 'Last-Event-ID' as const, query: 'cursor' },
  expiredCursor: { event: 'snapshot' as const },
}
```

Register the application-owned source and replay implementation during server
composition:

```ts
server.provide('orderChanges', () => createOrderChangesProvider(database, bus), {
  onShutdown: provider => provider.close(),
})
```

The provider emits `{ cursor, data }` Stream Records. Raffel treats the cursor
as opaque, maps it to the SSE `id`, performs at-least-once replay, and then
continues from the Durable Stream Source. Duplicate records can occur at the
replay/live boundary, so consumers must apply records idempotently.

An expired cursor is a deliberate recovery outcome, not a transient error:

```ts
source.addEventListener('snapshot', (event) => {
  replaceRegionState(JSON.parse(event.data))
  // event.lastEventId is the application-provided continuation cursor.
})
```

The application decides retention and produces the current Stream Snapshot.
Raffel does not build an event store, consume a broker in the background, or
manufacture missing history.

## Long Poll Interaction is still one HTTP response

Long polling requires application storage or pub-sub. Raffel bounds the wait,
propagates cancellation, and documents the cursor contract; it cannot detect a
future business change without an application change source.

```ts
// src/http/orders/updates/get.ts
import { z } from 'zod'
import { runLongPoll } from 'raffel/http'

export const input = z.object({
  cursor: z.string().nullable().default(null),
})

export const output = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('change'),
    cursor: z.string(),
    retryAfterMs: z.number(),
    data: z.unknown(),
  }),
  z.object({
    outcome: z.literal('timeout'),
    cursor: z.string().nullable(),
    retryAfterMs: z.number(),
  }),
])

export const meta = {
  httpPath: '/orders/updates',
  httpMethod: 'GET' as const,
  longPoll: {
    cursor: { input: 'cursor', output: 'cursor', semantics: 'exclusive' as const },
    waitMs: 25_000,
    retryMs: 1_000,
    timeoutOutcome: 'timeout' as const,
  },
}

export default function getOrderUpdate(input, ctx) {
  return runLongPoll({
    cursor: input.cursor,
    waitMs: meta.longPoll.waitMs,
    retryMs: meta.longPoll.retryMs,
    signal: ctx.signal,
    wait: ({ after, signal }) => ctx.services.orderChanges.waitAfter(after, { signal }),
  })
}
```

Each timeout or change completes one HTTP response. The client decides whether
to issue the next request, preserving the returned exclusive cursor.

## Duplex streams

Choose WebSocket when browser or heterogeneous clients need independent
bidirectional messages. Choose gRPC duplex when controlled internal clients can
share protobuf contracts and HTTP/2 infrastructure. Neither transport turns a
Live Stream into durable replay. If resumability matters, design a durable
application protocol or use the supported SSE Resumable Stream contract.

WebSocket adapts Raffel Resume Cursor fields through envelope metadata, while
the current gRPC adapter reports that Resumable Stream metadata is unsupported.
Generated projection diagnostics make this distinction visible.

## Asynchronous jobs and events

For work that may run for minutes, accept a command with `202`, persist a job,
and return `Location: /jobs/{id}`. Model `GET /jobs/{id}` and cancellation as
ordinary HTTP resources. Updates can be polling, long polling, or a stream, but
the worker, broker, job record, idempotency key, and retention policy remain
application responsibilities.

Use an Event when the caller only needs acceptance. The handler must tolerate
the configured delivery guarantee. In-memory retry or deduplication state is
appropriate for development, not a substitute for durable production work.

## Authentication and browser constraints

Authenticate and authorize before starting a stream. EventSource cannot set an Authorization header.
Prefer same-origin secure cookies when that fits
the threat model, or use a fetch-based SSE client that can set headers. A token
in the query string can leak through browser history, access logs, metrics, and
referrers, so use it only under an explicit security policy with short-lived
credentials.

WebSocket browser clients also cannot set arbitrary handshake headers; use an
approved cookie, subprotocol, or short-lived connection credential. Internal
gRPC clients should use transport credentials and propagate the caller identity
according to the service trust boundary.

## Deployment checklist

- Set the proxy idle timeout above the expected quiet period and heartbeat
  interval. Disable proxy buffering for SSE and verify end-to-end flushing.
- Use `heartbeatMs` for liveness, not durability. Keep `maxDurationMs` below any
  hard load-balancer lifetime so reconnects are controlled.
- Observe `ctx.signal.aborted` and release subscriptions, sockets, database
  cursors, and timers in `finally` blocks.
- Define per-instance, per-tenant, and per-principal connection limits. Include
  reconnect storms and browser HTTP/1.1 connection limits in capacity tests.
- Budget file descriptors, memory, broker consumers, and load-balancer targets
  for long-lived connections. Use draining shutdown and readiness transitions.
- Verify authentication expiry during long connections and decide whether to
  terminate, refresh out of band, or require reconnect.
- Test duplicate delivery, cursor expiration, snapshot replacement, proxy
  timeout, cancellation, and instance termination before production rollout.

The invariant is simple: Raffel owns transport coordination and contract
projection; the application owns business state, durability, and recovery data.
