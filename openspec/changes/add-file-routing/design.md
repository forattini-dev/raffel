## Context
Raffel lacks a convention for discovering routes from a filesystem layout, which makes large projects harder to organize and keeps protocol mappings manual.

## Goals / Non-Goals
- Goals: deterministic path-to-handler mapping, protocol-agnostic canonical names, simple handler export contract
- Non-Goals: framework-specific conventions or hot-reload tooling

## Decisions
- Decision: introduce a route loader that scans a root directory and maps path segments to handler namespaces (e.g., `users/create.ts` -> `users.create`).
- Decision: each route file exports a `route` object with `kind` (`procedure|stream|event`) and a `handler`, plus optional metadata (schema, description, interceptors, delivery).
- Decision: route discovery produces RouterModules so it composes with mounting and prefixes.

## Risks / Trade-offs
- Dynamic import of route files may affect startup time; mitigate with caching and minimal directory walking options.

## Migration Plan
- No breaking changes; file-based routing is optional and additive.

## Open Questions
- Should `index.ts` map to the parent namespace (e.g., `users/index.ts` -> `users`) or be disallowed?
