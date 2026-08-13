# Server-first service-to-service communication

Raffel is a server runtime, not an outbound client or broker. It exposes
inbound protocol surfaces, authenticates and traces requests, runs handlers,
and applies server-side resilience controls. Application code chooses its HTTP,
gRPC, database, or broker clients and injects them through `server.provide()`.

Raffel does not generate an outbound client from USD or OpenAPI. Contract
projections document the service that accepts traffic; they do not provision
service discovery, connection pools, brokers, or remote credentials.

## Decision matrix

| Need | Recommended inbound surface | Why | Important boundary |
|---|---|---|---|
| Request/response | HTTP procedure or resource; JSON-RPC for command-style APIs; gRPC unary for controlled typed clients. | Clear deadline, status, auth, and tracing lifecycle. | The caller owns its client, retry policy, and discovery. |
| Live updates | Live Stream over SSE; Resumable Stream only when replay is required. | One-way server updates fit HTTP infrastructure. | The application owns producers and durable history. |
| Duplex communication | WebSocket for heterogeneous clients; gRPC duplex for protobuf and HTTP/2 environments. | Both peers can send independent messages. | A connection is not a durable queue. |
| Durable asynchronous work | HTTP job resource plus an application worker or broker; Event for acceptance-only commands. | Work can outlive the initiating request and remain observable. | The application owns brokers, workers, and durable job state. |
| Internal low-overhead traffic | gRPC for typed calls; framed TCP for a deliberate custom protocol; UDP only for loss-tolerant datagrams. | Avoids unnecessary representation overhead in controlled networks. | Framing, compatibility, security, discovery, and durability remain explicit. |

Prefer the most conventional protocol that meets the requirement. Protocol
fusion lets one Raffel process receive several kinds of traffic; it is not a
reason to expose every capability on every transport.

## Compose outbound dependencies as services

Keep remote clients outside route files and inject narrow application ports:

```ts
const server = createServer({ port: 3000 })

server.provide('billing', ({ services }) => {
  return createBillingClient({
    baseUrl: services.config.billingUrl,
    credentials: services.secrets.billing,
  })
}, {
  onShutdown: client => client.close(),
})
```

The inbound handler depends on the application port, not on Raffel pretending
to be a remote SDK:

```ts
// src/http/orders/create/post.ts
import { z } from 'zod'

export const input = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  idempotencyKey: z.string(),
})

export const output = z.object({
  orderId: z.string(),
  paymentId: z.string(),
})

export const meta = {
  httpPath: '/orders',
  httpMethod: 'POST' as const,
}

export default async function createOrder(input, ctx) {
  const payment = await ctx.services.billing.charge({
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    signal: ctx.signal,
    deadline: ctx.deadline,
  })
  return { orderId: input.orderId, paymentId: payment.id }
}
```

The client implementation decides DNS or service discovery, pooling, TLS,
serialization, remote error mapping, and connection lifecycle. Passing
`ctx.signal` and the remaining deadline lets a disconnected or timed-out inbound
request stop work that no longer has a consumer.

## Deadline and cancellation budget

Every hop needs a finite deadline. Use a Raffel timeout policy or interceptor
for inbound execution, observe `ctx.deadline`, and pass only the remaining
budget to the application client. A downstream timeout must be shorter than the
upstream deadline so the service still has time to translate and return the
failure.

`ctx.signal` is the cancellation boundary for handler work and streams. Pass it
to `fetch`, database drivers, broker waits, and application iterators. Clean up
in `finally`; cancellation is expected control flow, not an operational error.

gRPC callers should set a native call deadline. WebSocket clients can send the
absolute `x-deadline` metadata supported by Raffel envelopes. For HTTP, define a
local timeout and propagate the remaining budget with the convention agreed by
your services; do not assume an arbitrary proxy header is honored automatically.

## Authentication and authorization between services

Authenticate each inbound surface at its trust boundary. Common internal
choices are mTLS workload identity, a short-lived signed bearer token, or a
rotated API key when stronger identity is unavailable. Network location alone
is not an identity.

Map missing or invalid identity to `UNAUTHENTICATED` and insufficient scope or
role to `PERMISSION_DENIED`. Authorize the business capability after identity
verification, and propagate end-user identity only when the downstream service
needs delegated authorization. Otherwise use the calling workload identity and
record the original actor in audited context.

Do not forward raw public credentials through every service. Exchange them for
an internal credential or use a trusted identity plane, and constrain audience,
issuer, expiry, and scopes at every hop.

## Distributed tracing

With tracing enabled, Raffel extracts W3C `traceparent`, `tracestate`, and
`baggage` from inbound HTTP metadata; gRPC and WebSocket carry the same context
through their metadata paths. Keep baggage small, non-secret, and bounded.

Raffel still does not own the outbound call. Use the chosen client and inject
the active trace headers explicitly:

```ts
import { injectTraceHeaders } from 'raffel'

const headers = injectTraceHeaders(tracer, {
  'content-type': 'application/json',
})

await fetch(url, {
  method: 'POST',
  headers,
  body,
  signal,
})
```

For gRPC, inject equivalent call metadata from the active span. Preserve the
same request ID for log correlation, but do not confuse a request ID with trace
parentage. Record remote target, status, latency, retry attempt, and circuit
state without placing credentials or business payloads in span attributes.

## Retries and idempotency

Retry only idempotent calls or calls protected by an idempotency key. Reads are
usually retryable when they have no side effects; creates, payments, emails, and
broker publishes are not safe merely because the transport failed before a
response arrived.

`createRetryInterceptor` reruns the inbound handler. Therefore every side
effect performed before the failure can happen again. Apply it selectively,
bound attempts and elapsed time, add jitter, honor the deadline, and restrict
codes to transient failures. If a handler calls a downstream service, the
application client may instead own a narrower retry around that one operation.
Never stack independent retry loops at every layer without a shared attempt
budget.

An idempotency key must have application semantics: persist the key with the
result or in-progress state, scope it to the caller and operation, reject key
reuse with different input, and retain it longer than the maximum retry window.

## Server-side resilience controls

Raffel's interceptors protect inbound execution; they are not a service mesh or
remote client:

- `createCircuitBreakerInterceptor` fails an inbound procedure quickly after
  its configured handler failures. Scope it deliberately; one procedure-level
  circuit may aggregate several underlying dependencies.
- `createBulkheadInterceptor` bounds concurrent handler execution and queue
  size so one capability cannot consume every worker, socket, or database slot.
- `createFallbackInterceptor` may return a safe local degraded result. A
  fallback must be contract-compatible, observable, and must never fabricate a
  successful payment, write, or authorization decision.
- Timeout, rate limit, and retry controls need one coherent budget. Queuing plus
  retries must not exceed the caller deadline.

Circuit state held only in one process differs across replicas. Decide whether
per-instance isolation is acceptable or whether an external mesh/client policy
owns the cross-instance view. A bulkhead limit must align with downstream pool
capacity, not just available CPU.

## Durable asynchronous work

For work that outlives a request, persist a job before returning `202 Accepted`
and expose a status resource. Use a broker or worker system selected by the
application. Events can accept commands, but Raffel's transport acceptance does
not prove the business work completed.

The application owns brokers, workers, and durable job state, including:

- transactional enqueue or an outbox when database state and publication must
  agree;
- idempotent consumers and poison-message handling;
- retry and dead-letter policy;
- progress, cancellation, retention, and access control;
- production delivery storage instead of an in-memory fallback.

Live or Resumable Streams can expose job progress. They do not replace the job
record or broker, and resumability still requires the application Replay
Provider and Durable Stream Source.

## Deployment limits

- Put an explicit load balancer and protocol policy in front of every exposed
  port. Confirm HTTP/2, WebSocket upgrades, SSE flushing, body limits, and idle
  timeouts independently.
- Make service discovery and client-side pool limits match autoscaling and
  readiness behavior. Remove an instance from discovery before shutdown.
- Use connection draining long enough for ordinary requests and a bounded
  reconnect policy for streams; do not wait forever for long-lived sessions.
- Budget file descriptors, HTTP/2 streams, WebSocket sessions, gRPC channels,
  TCP sockets, broker consumers, and database connections per replica.
- Apply health and readiness checks without routing business traffic to a
  process that has not initialized its providers.
- Version custom TCP/UDP frames and protobuf messages compatibly. UDP is
  best-effort: loss, duplication, and reordering are application concerns.
- Verify DNS changes, certificate rotation, credential expiry, retry storms,
  partial regional failure, and rolling deployment in load tests.

## Review checklist

Before approving a service-to-service path, answer these questions:

1. Which service owns the contract and which side owns the client?
2. What is the end-to-end deadline, and how does cancellation reach every wait?
3. Which identity and authorization decision cross the boundary?
4. How are `traceparent`, `tracestate`, baggage, and request IDs propagated?
5. Is the operation idempotent, or where is the idempotency record stored?
6. Which layer owns retry, circuit breaking, bulkheads, and fallback?
7. Who owns durable work, replay, dead letters, and operational recovery?
8. What happens during overload, dependency failure, and connection draining?

If any answer is “Raffel probably handles it automatically,” make the ownership
explicit before shipping.
