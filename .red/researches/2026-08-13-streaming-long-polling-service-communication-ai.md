# Raffel: streaming, long polling, service communication, and AI

Original audit: 2026-08-13

Current-state review: 2026-08-14, after [Spec #200](https://github.com/forattini-dev/raffel/issues/200)

This report routes maintainers and agents to the current capability sources. It
retains the decisions produced by the original audit without caching the
pre-implementation state that Spec #200 replaced.

## Current capability status

Raffel now provides one server-first model for live delivery, bounded HTTP
waiting, and opt-in recovery:

- **Live Stream** is the default connection-scoped stream. File-system
  discovery uses `src/streams` with `input`, `output`, `meta`, and a default
  handler.
- **Operational controls** add heartbeat comments, retry hints, maximum
  connection duration, idle timeout, cancellation, and cleanup without implying
  replay.
- **Long Poll Interaction** remains ordinary HTTP. `runLongPoll` bounds one
  wait, propagates cancellation, preserves an opaque exclusive Poll Cursor, and
  returns change or timeout continuation metadata.
- **Source-Backed Resumable Stream** is opt-in. The application supplies a
  Durable Stream Source, Replay Provider, opaque Resume Cursors, retention, and
  deduplication policy. Delivery across reconnects is at least once.
- **Stream Snapshot** is the application-provided recovery outcome for an
  expired Resume Cursor. HTTP/SSE emits it as the named `snapshot` event.
- **Contract projections** keep USD canonical and report HTTP/SSE, WebSocket,
  and gRPC preservation, adaptation, or unsupported semantics explicitly.
- **AI workload streaming** uses the same application stream capabilities and
  injected services. Raffel does not own a model SDK or AI runtime.

## Canonical project sources

Read these sources when implementing or explaining current behavior:

- `docs/core/streams.md` — stream API, controls, resumability, snapshots, long
  polling, protocol matrix, and SSE framing.
- `docs/guides/realtime-and-async.md` — decision path and canonical
  fs-discovery examples.
- `docs/guides/service-to-service.md` — server-first communication, auth,
  deadlines, tracing, resilience, idempotency, and deployment limits.
- `docs/guides/ai-workload-streaming.md` — typed model events, cancellation,
  safe errors, live versus resumable delivery, and the MCP boundary.
- `docs/routing/file-system.md` — discovery directories and export conventions.
- `docs/spec/usd-1.0.0.md` and `docs/spec/usd-schema-1.0.0.json` — canonical
  capability contract and machine-readable extensions.
- `.red/CONTEXT.md` — authoritative Raffel vocabulary and product boundary.

The documented examples above are synchronized with strict TypeScript fixtures
and exercised by focused unit tests. Browser snippets are typechecked with DOM
types; production proxy and browser behavior still requires deployment-specific
verification.

## Resolved by Spec #200

The completed Spec settled the original audit's central questions:

1. Application SSE has heartbeat, `retry`, SSE `id`, `Last-Event-ID`, and an
   optional query fallback where the Resumable Stream contract enables them.
2. Replay state remains application-owned through Replay Providers and Durable
   Stream Sources; Raffel does not create a hidden in-memory production store.
3. Long polling has an explicit contract and helper while remaining one HTTP
   request and one HTTP response.
4. Current fs-discovery examples use `src/streams`, named schema exports, a
   default handler only for Live Streams, and `addEventListener('data', ...)`.
5. Real-time, service-to-service, and AI workload guidance is published and
   linked from the documentation sidebar.
6. AI remains a workload using general Raffel capabilities rather than a
   provider-specific framework surface.
7. USD remains the Capability Contract; OpenAPI and protocol descriptions are
   projections with visible diagnostics for semantic loss.

## Operational invariants

- A stream is one response carrying multiple events, not multiple HTTP
  responses.
- A Live Stream reconnect can restore a socket but cannot recover missed
  business records.
- A Resumable Stream recovers using opaque application cursors and tolerates
  duplicates at the replay/live boundary.
- Browser `EventSource` performs GET and cannot set arbitrary authorization
  headers. Same-origin cookies, short-lived query credentials under an explicit
  policy, and a fetch-based client have different security properties.
- Raffel emits named application SSE events. Listen with
  `addEventListener('data', ...)`, `addEventListener('snapshot', ...)`, and the
  documented terminal listeners.
- SSE is server-to-client. Use WebSocket, TCP, or gRPC for client or
  bidirectional streaming.
- Long polling consumes a request slot while it waits. Bound duration and
  concurrency, propagate cancellation, and apply client retry jitter.
- In-memory event, replay, or job state does not survive process replacement or
  coordinate replicas.
- MCP progress, MCP Tasks, AI business events, and application SSE are separate
  contracts.

## Remaining decisions

These items are candidates for separate Specs; none is part of the completed
streaming contract:

1. **Asynchronous job resource contract** — decide whether Raffel should
   standardize start, status, result, cancellation, idempotency, retention, and
   progress metadata while applications continue to own workers and storage.
2. **Stream output inference** — decide whether fs-discovered stream handlers
   should receive TypeScript output-schema inference comparable to HTTP routes.
3. **Event discovery** — settle whether `src/events` becomes a canonical
   discovery directory and align the events and fs-discovery guides.
4. **MCP Tasks** — define task creation, lifecycle, persistence/TTL, result,
   cancellation, authorization, and documentation in an independent Spec.
5. **Deployment verification** — decide whether canonical examples should gain
   mandatory browser/proxy integration coverage in addition to their current
   strict compilation and unit execution.

Two directions are already closed by the product boundary rather than pending:

- Raffel remains server-first; applications choose outbound HTTP/SSE clients,
  generated clients, brokers, and service discovery.
- Applications inject model adapters; Raffel does not ship provider-specific
  model SDK integrations as part of the streaming surface.

## External references

- [MDN Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
  — browser `EventSource` behavior and connection constraints.
- [MCP TypeScript SDK server transports](https://ts.sdk.modelcontextprotocol.io/server)
  — Streamable HTTP guidance for remote MCP servers.
- [MCP Tasks specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
  — the separate status/result model for long-running MCP operations.

## Maintenance rule

Treat implementation, the canonical public guides, USD, and `.red/CONTEXT.md`
as the live sources. Update this report when those sources change a capability
or product boundary; preserve historical context through Git rather than by
leaving superseded present-tense claims in agent-readable prose.
