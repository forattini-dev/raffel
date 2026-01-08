# Change: Add gRPC adapter

## Why
Raffel targets a unified multi-protocol runtime; gRPC is a core requirement for service-to-service APIs and must map cleanly into the existing Envelope model.

## What Changes
- Add a gRPC adapter using `@grpc/grpc-js` with proto loading and metadata mapping
- Support unary, server streaming, client streaming, and bidirectional streaming handlers
- Add server builder configuration for gRPC with TLS credentials
- Add tests and docs for gRPC usage and mapping behavior

## Impact
- Affected specs: grpc-adapter
- Affected code: src/adapters, src/server, src/types, docs
