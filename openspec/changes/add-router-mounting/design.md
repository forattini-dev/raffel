## Context
Raffel already supports grouped registration via `group(prefix)` but does not provide a reusable router object that can be composed and mounted across servers or protocols.

## Goals / Non-Goals
- Goals: modular route bundles, prefix composition, deterministic middleware order, protocol-agnostic handler names
- Non-Goals: file-based route discovery (handled in a separate change)

## Decisions
- Decision: introduce a `RouterModule` builder with `procedure/stream/event/group/use` that stores relative registrations.
- Decision: add `server.mount(prefix, module)` to register a module with an additional prefix.
- Decision: interceptor order is `global -> mount -> module -> handler` for deterministic behavior.

## Risks / Trade-offs
- Extra API surface area may overlap with `group()`. Mitigate by documenting the distinction and keeping the API minimal.

## Migration Plan
- No breaking changes; existing registration APIs remain unchanged.

## Open Questions
- Should `RouterModule` support its own schema registry or delegate to the server on mount?
