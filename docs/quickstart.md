# Quickstart

Get running in 2 minutes.

## Install

```bash
pnpm add raffel
```

## Hello World

```typescript
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

Test it:

```bash
curl localhost:3000/hello -d '{"name":"World"}'
# → "Hello, World!"
```

Done. Your handler now works on HTTP, WebSocket, JSON-RPC, GraphQL, gRPC, TCP, and UDP.

---

## File-Based Routes

Even simpler - just drop files:

```typescript
// server.ts
import { createServer } from 'raffel'

await createServer({ port: 3000, discovery: true })
```

```typescript
// routes/hello.ts
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// routes/users/create.ts
export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

```
routes/
├── hello.ts         → /hello
└── users/
    └── create.ts    → /users.create
```

---

## Add Validation

Pass a Zod/Yup/Joi schema:

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

await createServer({
  port: 3000,
  routes: {
    'users.create': {
      input: z.object({
        name: z.string().min(2),
        email: z.string().email()
      }),
      handler: async (input) => ({
        id: crypto.randomUUID(),
        ...input
      })
    }
  }
})
```

Or in file-based routes:

```typescript
// routes/users/create.ts
import { z } from 'zod'

export const input = z.object({
  name: z.string().min(2),
  email: z.string().email()
})

export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

---

## Add Interceptors

```typescript
import { createServer, logging, timeout, rateLimit } from 'raffel'

await createServer({
  port: 3000,
  interceptors: [
    logging(),
    timeout(30000),
    rateLimit({ max: 100, window: '1m' })
  ],
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

---

## Add Auth

```typescript
import { createServer, bearer } from 'raffel'

await createServer({
  port: 3000,
  auth: bearer({ secret: process.env.JWT_SECRET }),
  routes: {
    // Public
    'health': () => ({ ok: true }),

    // Protected
    'users.me': {
      auth: true,
      handler: (_, ctx) => ({ id: ctx.auth.principal })
    }
  }
})
```

---

## Streaming

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

---

## Enable More Protocols

```typescript
await createServer({
  port: 3000,

  // All enabled by default, but you can customize:
  http: true,
  websocket: true,           // or '/ws' for custom path
  jsonrpc: '/rpc',
  graphql: '/graphql',
  grpc: { port: 50051 },
  tcp: { port: 9000 },
  udp: { port: 9001 },

  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

---

## Next Steps

- **[File Discovery](/file-system-discovery.md)** - Zero-config routing
- **[Interceptors](/interceptors.md)** - Rate limit, cache, retry
- **[Auth](/auth/overview.md)** - JWT, OAuth2, API keys
- **[Protocols](/protocols/http.md)** - Protocol-specific details
