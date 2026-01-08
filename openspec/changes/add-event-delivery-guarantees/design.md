## Context
Raffel documents event delivery guarantees (best-effort, at-least-once, at-most-once), but the current implementation always behaves as best-effort. The change introduces real delivery semantics without coupling the core to any transport.

## Goals / Non-Goals
- Goals:
  - Enforce delivery guarantees with retries and deduplication.
  - Keep delivery state pluggable for future durable stores.
  - Preserve the existing event handler signature and envelope model.
- Non-Goals:
  - Implement a production-grade persistent store in this change.
  - Add new transport adapters or change protocol mappings.

## Decisions
- Decision: Introduce an event delivery engine that owns retries and deduplication.
  - Rationale: Keeps routing logic focused and isolates delivery concerns.
- Decision: Define a store interface for delivery state with an in-memory default.
  - Rationale: Allows future persistent implementations without changing core APIs.
- Decision: Use exponential backoff for at-least-once retries.
  - Rationale: Aligns with existing retry policy shape and reduces load during failures.

## Risks / Trade-offs
- In-memory store is not durable across restarts; at-least-once becomes best-effort after a crash.
- Retry scheduling adds background timers; needs careful cleanup on shutdown.

## Migration Plan
- No migration required for existing handlers; default behavior remains best-effort unless delivery is configured.

## Open Questions
- Should at-least-once default retry policy be configurable globally?
- Should at-most-once deduplication use a configurable clock source for tests?
