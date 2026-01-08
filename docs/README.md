# Raffel

Raffel is a unified multi-protocol server runtime. It keeps the core protocol-agnostic
and lets adapters translate HTTP, WebSocket, TCP, JSON-RPC, and gRPC traffic into the
same Envelope model.

## Why Raffel

- One handler model for all transports
- Clean separation between core and adapters
- Delivery guarantees for events
- Streaming with backpressure
- Modular routing and file-based discovery
- Hot reload for filesystem handlers in development
- Middleware stacks and built-in interceptors

## Quick start

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server
  .procedure('health.check')
  .handler(async () => ({ ok: true }))

await server.start()
```

## What is inside

| Area | Notes |
|:--|:--|
| Core | Envelope, Context, Router, Registry |
| Protocols | HTTP, WebSocket, TCP, JSON-RPC, gRPC, GraphQL |
| Routing | Router modules and mount prefixes |
| Discovery | File-system discovery with middleware, auth, and hot reload |
| Reliability | at-least-once and at-most-once events |
| Cache | Pluggable drivers: memory (LRU/FIFO), file, Redis, S3DB |
| Tooling | Zod validation plus OpenAPI and GraphQL generators |

## Next steps

- [Quickstart](quickstart.md)
- [Core model](core-model.md)
- [Router modules](router-modules.md)
- [Route discovery](route-discovery.md)
- [File-system discovery](file-system-discovery.md)
- [Discovery cheatsheet](discovery-cheatsheet.md)
- [Interceptors](interceptors.md)
- [Cache](cache.md)
- [GraphQL](protocols/graphql.md)
- [Channels](protocols/channels.md)
