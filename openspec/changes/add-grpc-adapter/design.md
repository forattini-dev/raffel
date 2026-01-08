## Context
Raffel currently supports HTTP, WebSocket, TCP, and JSON-RPC. gRPC requires an adapter that can translate proto-defined services into the Envelope model while preserving metadata, deadlines, and streaming semantics.

## Goals / Non-Goals
- Goals: full unary + streaming support, service.method mapping, metadata propagation, TLS credentials configuration
- Non-Goals: code generation tooling, grpc-web support

## Decisions
- Decision: use `@grpc/grpc-js` with `@grpc/proto-loader` for runtime proto loading.
- Decision: map gRPC methods to `service.method` procedure names (dot-separated). If a proto package is present, prefix the service name with the package (e.g. `pkg.Service.method`).
- Decision: map gRPC metadata into Envelope.metadata (string-only) and attach deadlines/cancellation to Context.
- Decision: emit gRPC status codes derived from Raffel error codes, with details in status message.

## Risks / Trade-offs
- Streaming mappings require careful backpressure and cancellation handling; map to RaffelStream where possible.
- Proto loader adds runtime dependency and startup cost; mitigate with cache and explicit loader options.

## Migration Plan
- Additive: no breaking changes to existing adapters.

## Open Questions
- Should package prefixes be configurable (include/exclude) when mapping procedure names?
