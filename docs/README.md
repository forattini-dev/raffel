# ⚡ Raffel

> **One function. Seven protocols. Zero config.**

```typescript
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`,
    'users.create': async (input) => ({ id: crypto.randomUUID(), ...input }),
  }
})
```

That's it. Your handlers now work on **HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, and UDP**.

```bash
# HTTP
curl localhost:3000/hello -d '{"name":"World"}'

# WebSocket
wscat -c ws://localhost:3000 -x '{"procedure":"hello","payload":{"name":"World"}}'

# JSON-RPC
curl localhost:3000/rpc -d '{"jsonrpc":"2.0","method":"hello","params":{"name":"World"}}'
```

---

## File-Based Routes (Zero Code)

Drop files, get endpoints:

```
routes/
├── hello.ts           → hello
├── users/
│   ├── create.ts      → users.create
│   └── [id].ts        → users.get (with params)
└── _middleware.ts     → applies to all
```

```typescript
// routes/hello.ts
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// server.ts
import { createServer } from 'raffel'

await createServer({ port: 3000, discovery: true })
```

---

## What You Get

| Feature | Built-in |
|:--------|:---------|
| **7 Protocols** | HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP |
| **Validation** | Zod, Yup, Joi (optional) |
| **Auth** | JWT, API Key, OAuth2, Sessions |
| **Resilience** | Rate limit, Circuit breaker, Retry, Timeout |
| **Observability** | Prometheus, OpenTelemetry, Logging |
| **Real-time** | Channels, Presence, Broadcasting |
| **DX** | Hot reload, Auto-discovery, REST Auto-CRUD |

---

## Quick Examples

### Streaming

```typescript
await createServer({
  port: 3000,
  streams: {
    'logs.tail': async function* ({ file }) {
      for await (const line of readLines(file)) {
        yield { line, ts: Date.now() }
      }
    }
  }
})
```

### With Validation

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

await createServer({
  port: 3000,
  routes: {
    'users.create': {
      input: z.object({ name: z.string(), email: z.string().email() }),
      handler: async (input) => ({ id: crypto.randomUUID(), ...input })
    }
  }
})
```

### With Interceptors

```typescript
import { createServer, rateLimit, timeout, logging } from 'raffel'

await createServer({
  port: 3000,
  interceptors: [logging(), timeout(30000), rateLimit({ max: 100 })],
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

### With Auth

```typescript
import { createServer, bearer } from 'raffel'

await createServer({
  port: 3000,
  auth: bearer({ secret: process.env.JWT_SECRET }),
  routes: {
    'public.health': () => ({ ok: true }),
    'protected.me': {
      auth: true,
      handler: (_, ctx) => ({ userId: ctx.auth.principal })
    }
  }
})
```

---

## Next Steps

<div class="grid-3">
<a href="#/quickstart" class="card">
<div class="icon">🚀</div>
<h4>Quickstart</h4>
<p>5 minutes to your first server</p>
</a>

<a href="#/file-system-discovery" class="card">
<div class="icon">📂</div>
<h4>File Routes</h4>
<p>Zero-config file-based routing</p>
</a>

<a href="#/protocols/http" class="card">
<div class="icon">🌐</div>
<h4>Protocols</h4>
<p>HTTP, WebSocket, gRPC, and more</p>
</a>
</div>

---

<div style="text-align: center; padding: 2rem 0;">
<strong>⚡ Write once. Run everywhere.</strong>
</div>
