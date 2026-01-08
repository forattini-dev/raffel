# Change: Add event delivery guarantees

## Why
Event delivery modes (at-least-once/at-most-once) are documented but currently behave as best-effort, which risks data loss and breaks expectations.

## What Changes
- Implement delivery guarantees for events (best-effort, at-least-once, at-most-once)
- Add retry scheduling and deduplication with configurable policies
- Introduce a pluggable event delivery store with an in-memory default
- Add tests covering delivery semantics and retry/dedup behavior

## Impact
- Affected specs: event-delivery
- Affected code: src/core/router.ts, src/core/registry.ts, src/types/handlers.ts, new event delivery module
