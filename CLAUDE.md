
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Raffel** is a unified multi-protocol server runtime. One core, multiple transports.

The core is **protocol-agnostic**: it receives normalized messages (Envelope) and returns responses or streams. HTTP, gRPC, WebSocket, and TCP are just adapters that translate to/from the Envelope.

## Architecture (Hexagonal)

```
┌─────────────────────────────────────────────────────────┐
│ bootstrap/          (composition root)                   │
│   create-server · config-normalization · protocol-wiring │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ application/      (orchestration)                   │  │
│  │   registration · lifecycle · discovery · preview    │  │
│  │                                                     │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ core/           (domain — zero external deps) │  │  │
│  │  │   Registry · Router · Envelope · EventDelivery│  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ ports/outbound/  (interfaces only)            │  │  │
│  │  │   LoggerPort · SessionStore · CacheDriver     │  │  │
│  │  │   RateLimitDriver · ValidatorAdapter          │  │  │
│  │  │   EventDeliveryStore · ChannelPresencePort    │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  adapters/inbound/     adapters/outbound/                │
│    http · websocket      session/{memory,redis}          │
│    grpc · tcp · udp      rate-limit/{memory,redis,fs}    │
│    jsonrpc               cache/{memory,file,redis}       │
│                          logger/pino                     │
└─────────────────────────────────────────────────────────┘
```

### Boundary Rules

1. `core/` has zero imports from adapters/, bootstrap/, application/
2. `application/` depends on core/ and ports/ — never on concrete outbound adapters
3. `ports/` defines interfaces only — no implementation logic
4. `bootstrap/` is the composition root — wires everything together

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
pnpm vitest run       # Run all tests
pnpm tsc --noEmit     # Type-check without emitting
```

## Key Directories

| Directory | Purpose |
|:----------|:--------|
| `src/core/` | Domain logic (Registry, Router, EventDelivery) |
| `src/ports/outbound/` | Port interfaces (LoggerPort, SessionStore, etc.) |
| `src/application/` | Orchestration (registration, lifecycle, discovery) |
| `src/bootstrap/` | Composition root (createServer, config, wiring) |
| `src/adapters/inbound/` | Protocol adapters (HTTP, WS, gRPC, TCP, UDP, JSON-RPC) |
| `src/adapters/outbound/` | Driver implementations (session, cache, rate-limit, logger) |
| `src/server/` | Builder, router-module, handler-builders, types |
| `src/http/` | Standalone HttpApp (Hono-compatible) |
| `src/middleware/` | Protocol-agnostic interceptors |
| `src/channels/` | Pusher-like channel management |
| `src/validation/` | Multi-validator support (Zod, Yup, Joi, AJV) |

## Documentation

- **docs/architecture.md** - Full architecture docs with hexagonal diagram
- **docs/CORE_MODEL.md** - Complete core model specification
