<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Raffel** is a unified multi-protocol server runtime. One core, multiple transports.

The core is **protocol-agnostic**: it receives normalized messages (Envelope) and returns responses or streams. HTTP, gRPC, WebSocket, and TCP are just adapters that translate to/from the Envelope.

## Architecture

```
[Client] → [Adapter HTTP/WS/gRPC/TCP] → [Envelope] → [Router] → [Handler]
                                                         ↓
[Client] ← [Adapter HTTP/WS/gRPC/TCP] ← [Envelope] ← [Router] ←
```

### Core Abstractions

| Abstraction | Description |
|-------------|-------------|
| **Envelope** | Normalized message (id, procedure, type, payload, context) |
| **Context** | Request context (auth, tracing, cancellation via AbortSignal) |
| **Procedure** | Unary RPC: `(input, ctx) => Promise<output>` |
| **RaffelStream** | Custom stream with backpressure, multiplex, priority |
| **Event** | Pub/sub with configurable delivery guarantees |
| **Interceptor** | Middleware for cross-cutting concerns |

### Key Design Decisions

- **Procedure names**: Any string, adapters interpret (e.g., `users.create` → `POST /users`)
- **Streams**: Custom `RaffelStream` abstraction (not AsyncIterable alone)
- **Events**: Configurable per-event (best-effort, at-least-once, at-most-once)
- **Cancellation**: Native `AbortSignal`
- **IDs**: nanoid (compact, URL-safe)

## Commands

```bash
pnpm install          # Install dependencies
pnpm test             # Run tests (not configured yet)
```

## Documentation

- **docs/CORE_MODEL.md** - Complete core model specification

## Reference Implementations

The `node_modules/` directory contains cloned reference implementations:

| Category | Repos |
|----------|-------|
| HTTP Frameworks | express, fastify, hono, koa, polka |
| WebSocket | ws, uWebSockets.js, rpc-websockets |
| gRPC | grpc-node, protobuf.js |
| Serialization | msgpack-javascript, node-cbor |
| Streaming | streams, length-prefixed-stream |
| Realtime | livekit, mediasoup |

## Development Roadmap

1. ~~Define core model (Envelope, Context, abstractions)~~
2. Define schema/validation
3. Implement RaffelStream
4. Implement Router + Registry
5. Implement HTTP adapter
6. Implement WebSocket adapter
7. MVP: same handler exposed via HTTP + WS
