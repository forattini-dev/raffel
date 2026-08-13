# Raffel: streaming, long polling, service communication, and AI

Date: 2026-08-13
Query: "Já temos documentações sobre SSE, long polling e streams com fs-discovery, facilidades para comunicação entre serviços e possivelmente AI?"
Scope: Current Raffel implementation and repository documentation, plus the official SSE and MCP transport references needed to evaluate the public guidance. This is a documentation and capability audit; it does not propose compatibility promises for APIs that do not exist yet.

## Executive Summary

Raffel already has a substantial streaming surface, but the user journey is fragmented.

- Server-to-client streams work over HTTP as SSE and over WebSocket, TCP, and gRPC as stream envelopes/native streams.
- File-system discovery supports stream handlers under `src/streams` with `input`, `output`, `meta`, and a default handler.
- Raffel does not have a named long-polling abstraction or a dedicated long-polling guide. A normal HTTP handler can implement the pattern manually, but the framework does not currently standardize wait timeouts, cursors, retry hints, or client behavior.
- Service-to-service building blocks exist across HTTP, gRPC, TCP, WebSocket, events, OAuth2 client credentials, API keys, resilience interceptors, tracing, and providers. There is no single decision guide or first-class typed outbound HTTP client.
- AI support is strongest through MCP: integrated procedures-as-tools, standalone MCP servers, Streamable HTTP, progress notifications, resource subscriptions, sampling, elicitation, and an AI documentation assistant. Generic LLM token streaming can use Raffel SSE or WebSocket streams, but there is no dedicated AI streaming guide or provider-neutral LLM adapter.
- Several existing examples need correction before being presented as a canonical guide: the file-based stream example in `docs/core/streams.md` uses an outdated path/export convention, and the browser example in `examples/04-streams-server.ts` uses `onmessage` even though Raffel emits a named `data` event.

The highest-value next step is a single "Real-time, async jobs, and service communication" guide backed by runnable fs-discovery examples, followed by a typed SSE client/resumability story and a complete MCP tasks story.

## Official Sources

- [Raffel Streams](https://github.com/forattini-dev/raffel/blob/main/docs/core/streams.md) — official stream model, directions, protocols, backpressure, cancellation, and SSE format.
- [Raffel File-System Discovery](https://github.com/forattini-dev/raffel/blob/main/docs/routing/file-system.md) — official discovery directories and handler export conventions.
- [Raffel HTTP Adapter](https://github.com/forattini-dev/raffel/blob/main/docs/protocols/http.md) — official HTTP mapping for procedures, streams, and events.
- [Raffel WebSocket Adapter](https://github.com/forattini-dev/raffel/blob/main/docs/protocols/websocket.md) — official request, stream, cancellation, and channel envelopes.
- [Raffel gRPC Adapter](https://github.com/forattini-dev/raffel/blob/main/docs/protocols/grpc.md) — official unary/server/client/bidirectional stream mapping.
- [Raffel TCP Adapter](https://github.com/forattini-dev/raffel/blob/main/docs/protocols/tcp.md) — official framed service-to-service transport and streaming model.
- [Raffel Events](https://github.com/forattini-dev/raffel/blob/main/docs/core/events.md) — official fire-and-forget and delivery-guarantee model.
- [Building MCP Servers with Raffel](https://github.com/forattini-dev/raffel/blob/main/docs/guides/mcp-server.md) — official AI/MCP server guide and transport recommendations.
- [Raffel AI Assistant](https://github.com/forattini-dev/raffel/blob/main/docs/reference/mcp.md) — official built-in AI assistant documentation.
- [MDN: Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) — browser platform reference for `EventSource` and SSE.
- [MCP TypeScript SDK: Server transports](https://ts.sdk.modelcontextprotocol.io/server) — official MCP SDK guidance that recommends Streamable HTTP and treats the old HTTP+SSE transport as compatibility-only.
- [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) — official polling/status model for long-running AI operations.

## Hotlinks

- [Current Raffel stream protocol matrix](https://github.com/forattini-dev/raffel/blob/main/docs/core/streams.md#protocol-support)
- [Current Raffel SSE section](https://github.com/forattini-dev/raffel/blob/main/docs/core/streams.md#http-sse-streaming)
- [Current fs-discovery stream section](https://github.com/forattini-dev/raffel/blob/main/docs/routing/file-system.md#streams)
- [MCP Streamable HTTP in Raffel](https://github.com/forattini-dev/raffel/blob/main/docs/guides/mcp-server.md#streamable-http-remote-servers)
- [MCP resource subscriptions in Raffel](https://github.com/forattini-dev/raffel/blob/main/docs/guides/mcp-server.md#resource-subscriptions)

## Key Findings

### 1. SSE and general streams are implemented and documented

`server.stream(name)` accepts an async generator for server streams. The HTTP adapter exposes it as `GET /streams/{name}`, writes `Content-Type: text/event-stream`, disables cache and Nginx buffering, and emits named `data`, `end`, and `error` events. The same registered stream can be exposed through WebSocket, TCP, and gRPC according to its direction.

The core implementation also has cancellation via `ctx.signal` and an internal `RaffelStream` abstraction with bounded buffering/backpressure.

What is missing from the public SSE story:

- a canonical browser example using `addEventListener('data', ...)`;
- a Node/client helper returning an `AsyncIterable`;
- event IDs and `Last-Event-ID` resume behavior;
- retry directives and reconnect policy;
- heartbeat comments for idle connections;
- deployment recipes for proxy/read timeouts and connection limits;
- an explicit authentication matrix for cookie, query-token, and `fetch` with headers.

### 2. fs-discovery supports streams, but the docs disagree about the convention

The current loader reads stream files from `src/streams` and recognizes named exports `input`, `output`, and `meta`, plus the default handler. `meta.direction` selects `server`, `client`, or `bidi`.

`docs/routing/file-system.md` shows the correct directory and broadly correct handler shape. However, `docs/core/streams.md` still shows `routes/metrics/live.stream.ts` with `inputSchema` and `outputSchema`. That example does not match the current `src/streams` loader contract, which reads `input` and `output`.

There is also no complete fs-discovery SSE example containing all of these together:

- Zod input and output;
- descriptions/examples for generated USD/OpenAPI documentation;
- `ctx.signal` cancellation and cleanup in `finally`;
- HTTP/EventSource consumption;
- WebSocket client consumption;
- auth and tracing;
- a test.

### 3. Long polling is not a first-class Raffel capability

No public API, implementation module, or documentation page names long polling. It can be constructed with a normal HTTP handler that waits for either a change or a timeout and returns one response; the client must immediately repeat the request with a cursor/version. That is a recipe, not a Raffel-managed transport.

This distinction needs to be explicit:

| Need | Recommended mechanism |
|---|---|
| One request, one eventual response | Procedure/HTTP request |
| Repeated HTTP requests, each waiting for a change | Manual long polling recipe |
| One HTTP connection, many server updates | SSE server stream |
| Both sides send repeatedly | WebSocket, gRPC bidi, or TCP stream |
| Start work and inspect status later | Async job/task resource with polling |
| Send and do not wait for a result | Raffel event |

A first-class long-poll helper is optional. A documented async-job contract (`POST` start, `GET` status/result with `pollAfterMs`, cancel endpoint, idempotency key) would likely create more value than a transport-specific builder.

### 4. Service-to-service capabilities exist, but there is no single paved road

Raffel provides the server-side pieces:

- HTTP procedures and SSE;
- gRPC including all stream directions;
- framed TCP streams for low-overhead internal traffic;
- WebSocket RPC/streams/channels;
- fire-and-forget events with retry/deduplication semantics;
- timeout, retry, circuit breaker, bulkhead, and fallback interceptors;
- API-key and OAuth2 client-credentials authentication;
- `tracedFetch` and gRPC metadata injection for distributed tracing;
- dependency injection through `ctx.services`.

The missing product-level story is an outbound client surface. The repository explicitly documents that Raffel has no built-in HTTP client; users generally use `fetch`, optionally wrapped in `tracedFetch`. The bundled `createRaffelClient` is a WebSocket client. Consequently, schemas registered on service A do not yet automatically generate or type a resilient HTTP client used by service B.

A consolidated guide should show recommended stacks rather than treating protocols independently:

- request/response: HTTP or gRPC unary + timeout + retry only for idempotent calls + circuit breaker + trace propagation;
- live server updates: SSE + cancellation + heartbeat/resume expectations;
- duplex low-latency: WebSocket/gRPC bidi;
- durable asynchronous work: broker-backed application service or event delivery store, idempotency, status resource;
- internal low-overhead traffic: gRPC or TCP, with explicit framing/security/operations trade-offs.

### 5. AI support exists through MCP; generic model streaming is only a pattern today

Raffel can:

- expose procedures as MCP tools in integrated mode;
- build standalone MCP tools/resources/prompts;
- serve remote clients over Streamable HTTP;
- report progress and logging notifications;
- notify resource subscribers;
- request client-side LLM sampling when supported;
- perform elicitation when supported;
- expose documentation through a docs-focused MCP server;
- run its built-in Raffel AI assistant.

For new remote MCP servers, the Raffel and official MCP SDK docs both prefer Streamable HTTP; legacy MCP SSE exists for older clients.

The codebase contains MCP task types and handlers for `tasks/list`, `tasks/get`, `tasks/result`, and `tasks/cancel`, but the inspected protocol code has no path that inserts a task into its task store. Tasks are also absent from the public MCP support table and guide. This should be treated as incomplete internal scaffolding, not a documented production capability, until task creation/execution, persistence/TTL, tests, and docs are complete.

For a normal AI endpoint that streams tokens, a Raffel server stream can yield deltas over SSE:

```ts
// src/streams/ai/chat.ts
import { z } from 'zod'

export const input = z.object({ prompt: z.string().min(1) })
export const output = z.object({ type: z.enum(['delta', 'usage']), value: z.string() })
export const meta = {
  direction: 'server' as const,
  description: 'Stream model output as incremental deltas.',
}

export default async function* chat(input, ctx) {
  const response = await ctx.services.llm.stream(input.prompt, { signal: ctx.signal })
  for await (const delta of response) {
    yield { type: 'delta', value: delta }
  }
}
```

That is framework-level transport composition, not yet an official AI provider abstraction. The guide should say so and keep model SDK details behind a provider in `ctx.services`.

## API / CLI / Config Details

### Canonical fs-discovery server stream

```ts
// src/streams/orders/watch.ts
import { z } from 'zod'

export const input = z.object({
  orderId: z.string().uuid(),
})

export const output = z.object({
  orderId: z.string().uuid(),
  status: z.enum(['pending', 'paid', 'shipped']),
  version: z.number().int(),
})

export const meta = {
  direction: 'server' as const,
  description: 'Watch order status changes.',
  auth: 'required' as const,
}

export default async function* watch(input, ctx) {
  const subscription = await ctx.services.orders.subscribe(input.orderId)
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

```bash
curl -N 'http://localhost:3000/streams/orders/watch?orderId=0190f3b1-62da-7a26-90f5-0b37bdce7a4e'
```

Because Raffel emits a named `data` event, the browser listener should be:

```ts
const source = new EventSource('/streams/orders/watch?orderId=...')

source.addEventListener('data', (event) => {
  console.log(JSON.parse(event.data))
})

source.addEventListener('end', () => source.close())
```

### Manual long-poll recipe

```ts
// src/http/jobs/[id]/updates/get.ts
import { z } from 'zod'

export const input = z.object({
  id: z.string().uuid(),
  after: z.coerce.number().int().min(0).default(0),
})

export default async function updates(input, ctx) {
  const update = await ctx.services.jobs.waitForUpdate({
    jobId: input.id,
    after: input.after,
    timeoutMs: 25_000,
    signal: ctx.signal,
  })

  return update ?? { changed: false, version: input.after, pollAfterMs: 500 }
}
```

This needs application-level storage/pub-sub and must be bounded by a timeout below the proxy timeout. The client repeats using the returned version/cursor and applies backoff/jitter after errors.

## Version Notes

- The audit reflects the repository on 2026-08-13.
- The official MCP ecosystem recommends Streamable HTTP for new remote integrations; Raffel's `startSse()` is a legacy compatibility transport, distinct from Raffel application streams exposed as SSE.
- MCP task semantics are evolving independently of ordinary Raffel HTTP streams. Do not conflate MCP task polling with a generic Raffel long-poll transport.

## Gotchas

- A stream is one HTTP response carrying many events, not many HTTP responses.
- Browser `EventSource` only performs GET and cannot set arbitrary headers. Cookie auth, query credentials with explicit risk controls, or a `fetch`-based streaming client are different deployment choices.
- Raffel emits `event: data`; `EventSource.onmessage` does not handle custom named events. Use `addEventListener('data', ...)` unless the server changes to unnamed/message events.
- Current application SSE has no event ID/resume/heartbeat layer. Automatic `EventSource` reconnection can reconnect the socket, but it cannot recover missed application events without server support.
- SSE is server-to-client only. Client/bidirectional streams require WebSocket, TCP, or gRPC.
- Backpressure inside `RaffelStream` does not by itself document or guarantee replay across network disconnects.
- Long polling consumes one request slot per waiting client; enforce maximum wait duration, cancellation, concurrency limits, and randomized client retry delays.
- Retry mutating calls only when the operation is idempotent or protected by an idempotency key.
- In-memory event/task state is not durable across process restarts or multiple replicas.
- AI token deltas, MCP progress notifications, MCP tasks, and generic application events are separate contracts and should be documented separately.

## Open Questions

1. Should Raffel standardize an async-job resource contract before adding a specific long-polling builder?
2. Should `raffel/client` gain an HTTP/SSE `AsyncIterable` client with headers, cancellation, reconnection, event IDs, and schema-derived types?
3. Should application SSE gain heartbeat, `id`, `retry`, `Last-Event-ID`, and pluggable replay storage?
4. Should fs-discovered stream output schemas support TypeScript inference, as HTTP procedure outputs now do?
5. Should events be discoverable from `src/events`, resolving the current conflict between the events guide and the fs-discovery guide?
6. What durability guarantees should MCP tasks have, and how are tasks created from a tool call?
7. Is the intended AI surface provider-neutral (`ctx.services.llm`) or a set of official adapters for specific model SDKs?
8. Should service-to-service clients be generated from USD/OpenAPI/proto, or should Raffel remain server-focused and document external client generation?

## Source-by-Source Notes

### Raffel Streams

Accurately describes the async-iterable model, protocol direction matrix, cancellation, backpressure, and SSE/WebSocket envelopes. Its file-based example is stale relative to the current fs-discovery loader.

### Raffel File-System Discovery

Correctly identifies `src/streams` and `meta.direction`, and the code/type definitions confirm `input` and `output` named exports. It needs a complete real-world stream example and cross-links to consumers.

### Raffel HTTP Adapter

Documents the `GET /streams/{name}` mapping and query-to-input behavior. It does not document browser consumption, reconnect/replay behavior, authentication constraints, or proxy operations in enough depth.

### Raffel WebSocket, gRPC, and TCP

These pages establish that Raffel supports server, client, and bidirectional communication outside HTTP SSE. They are useful protocol references but do not form a service-to-service selection guide.

### Raffel MCP documentation

Strong coverage exists for tools, resources, prompts, integrated mode, progress, subscriptions, and transports. The AI story should link these pages with ordinary Raffel streams and async jobs without presenting legacy MCP SSE as the default for new remote servers.

### MDN SSE

Confirms the browser `EventSource` programming model and one-way server push. It is the appropriate external reference for browser behavior.

### Official MCP docs

The official SDK recommends Streamable HTTP for remote servers, while the task specification defines a status/result polling model for long-running AI operations. These are separate from generic application SSE and should remain distinct in Raffel terminology.

## Recommended Next Steps

1. Correct the stale stream examples: use `src/streams`, `input`, `output`, and `addEventListener('data', ...)`.
2. Add `docs/guides/real-time-and-async.md` with a decision table and runnable examples for polling, long polling, SSE, WebSocket/bidi, async jobs, and events.
3. Add `docs/guides/service-to-service.md` covering protocol choice, auth, deadlines, tracing, idempotency, retry/circuit/bulkhead/fallback, and deployment limits.
4. Add `docs/guides/ai-streaming.md` covering token deltas over SSE/WebSocket, provider injection through `ctx.services`, cancellation, usage/final events, and the boundary with MCP.
5. Add a tested HTTP/SSE client helper before promising reconnect/resume ergonomics.
6. Design event IDs, heartbeat, replay storage, and `Last-Event-ID` semantics as an explicit contract.
7. Either finish MCP task creation/lifecycle/persistence/docs or hide the incomplete task surface until it is ready.
8. Add runnable examples and integration tests for fs-discovered SSE and AI token streaming, including client disconnect cleanup.
