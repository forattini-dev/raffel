# Project Context

## Purpose
Raffel is a unified multi-protocol server runtime: one protocol-agnostic core with multiple transports. The core accepts normalized Envelopes and returns responses or streams, while adapters translate HTTP/gRPC/WebSocket/TCP traffic to/from the Envelope model.

## Tech Stack
- TypeScript (ES2022), Node.js ESM (tsconfig `module`/`moduleResolution`: `NodeNext`)
- pnpm for package management, `tsc` for builds/type checks
- Node's built-in test runner (`node:test`) against compiled output in `dist/`
- Libraries: `nanoid` (IDs), `pino` + `pino-pretty` (logging)

## Project Conventions

### Code Style
- ESM imports with explicit `.js` extensions for local modules
- No semicolons, single quotes, 2-space indentation, trailing commas
- Prefer `export type` for type-only exports and keep shared types in `src/types`
- Strict TypeScript (`strict: true`) and explicit public API types

### Architecture Patterns
- Protocol-agnostic core with adapters per transport (HTTP/WS/gRPC/TCP)
- Core abstractions: Envelope, Context, Procedure (unary), RaffelStream (duplex), Event, Interceptor
- Registry + Router model for handler lookup and dispatch
- Context propagation is immutable; cancellation uses native `AbortSignal`

### Testing Strategy
- Unit tests live alongside source (e.g., `src/**/*.test.ts`)
- Tests run via `pnpm test` which builds with `tsc` and executes `node --test dist/**/*.test.js`
- Assertions use Node's `assert/strict`

### Git Workflow
- TBD: branching/commit conventions not defined yet (recommend small, focused commits)

## Domain Context
- The Envelope is the normalized message unit (id, procedure, type, payload, metadata, context)
- Procedures are unary RPC, streams use RaffelStream with backpressure/multiplex/priority, events support configurable delivery guarantees
- Adapters are responsible for protocol-specific mapping to/from Envelopes

## Important Constraints
- Core must remain protocol-agnostic; adapters handle protocol-specific concerns
- ESM-only build output (`dist`) and exported entry points defined in `package.json`
- IDs use `nanoid`; metadata is string-only; cancellation via `AbortSignal`

## External Dependencies
- `nanoid` for ID generation
- `pino` / `pino-pretty` for logging
- No external services/APIs integrated yet
