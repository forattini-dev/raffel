# Session Store

The Raffel Session Store injects a `ctx.session` object into every request, backed by a pluggable store (in-memory for dev, Redis for production).

Unlike the cookie session *authentication strategy* (`createCookieSessionStrategy`), the Session Store is a general-purpose data bucket — you can put anything in it (user ID, preferences, shopping cart, CSRF token, etc.) and it persists across requests.

---

## Quick Start

```typescript
import { createServer, createSessionInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.use(createSessionInterceptor({
  driver: 'memory',   // in-memory (dev)
  ttl: 3600,          // 1 hour
  cookie: { name: 'sid', secure: false },
}))

server.procedure('auth.login').handler(async ({ userId }, ctx) => {
  ctx.session.data.userId = userId
  ctx.session.touch()           // mark as dirty → will be saved
  return { ok: true }
})

server.procedure('auth.me').handler(async (_input, ctx) => {
  return { userId: ctx.session.data.userId ?? null }
})

server.procedure('auth.logout').handler(async (_input, ctx) => {
  ctx.session.destroy()         // deletes from store + clears cookie
  return { ok: true }
})

await server.start()
```

---

## Drivers

### Memory (development)

```typescript
server.use(createSessionInterceptor({
  driver: 'memory',
  ttl: 3600,
}))
```

Stores sessions in a JavaScript `Map`. **Not shared across instances** — use Redis in production.

### Redis (production)

```typescript
import { createRedisSessionDriver } from 'raffel'
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

server.use(createSessionInterceptor({
  driver: createRedisSessionDriver({ client: redis }),
  ttl: 7200,
  cookie: { name: 'sid', secure: true, sameSite: 'strict' },
}))
```

Compatible with any Redis client that exposes `get`, `set`, `del`, `expire`.

### Custom store

Implement the `SessionStore` interface:

```typescript
import type { SessionStore, SessionData } from 'raffel'

const pgStore: SessionStore = {
  async get(id) {
    const row = await db.query('SELECT data FROM sessions WHERE id=$1', [id])
    return row?.data ?? null
  },
  async set(id, data, ttl) {
    const exp = ttl ? new Date(Date.now() + ttl * 1000) : null
    await db.query(
      'INSERT INTO sessions(id,data,expires_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$2, expires_at=$3',
      [id, data, exp]
    )
  },
  async delete(id) {
    await db.query('DELETE FROM sessions WHERE id=$1', [id])
  },
  async touch(id, ttl) {
    if (!ttl) return
    const exp = new Date(Date.now() + ttl * 1000)
    await db.query('UPDATE sessions SET expires_at=$2 WHERE id=$1', [id, exp])
  },
}

server.use(createSessionInterceptor({ driver: pgStore, ttl: 3600 }))
```

---

## ServerOptions integration

You can configure the session store directly in `createServer()`:

```typescript
const server = createServer({
  port: 3000,
  session: {
    driver: 'memory',
    ttl: 3600,
    cookie: { name: 'sid' },
  },
})
```

> **Note:** When using `session` in `ServerOptions`, the interceptor is wired automatically.

---

## Session object API

`ctx.session` is a live `Session` handle:

```typescript
interface Session {
  readonly id: string           // session ID
  data: SessionData             // mutable data bag
  touch(): void                 // mark as dirty
  readonly isDirty: boolean
  destroy(): void               // delete + clear cookie
  readonly isDestroyed: boolean
  regenerate(): Promise<void>   // new session ID (e.g. after login)
}
```

### Common patterns

```typescript
// Store a value
ctx.session.data.userId = 'user_123'
ctx.session.touch()

// Read a value
const userId = ctx.session.data.userId as string | undefined

// Clear the session (logout)
ctx.session.destroy()

// Regenerate ID after privilege escalation (prevents session fixation)
await ctx.session.regenerate()
ctx.session.data.userId = newUserId
ctx.session.touch()
```

---

## Security options

### Signed session IDs

Sign session IDs with HMAC-SHA256 to prevent tampering:

```typescript
server.use(createSessionInterceptor({
  driver: 'redis',
  secret: process.env.SESSION_SECRET,  // at least 32 random bytes
  ttl: 3600,
}))
```

### Sliding-window TTL

Reset the session TTL on every request (keeps active users logged in):

```typescript
server.use(createSessionInterceptor({
  driver: 'redis',
  ttl: 1800,      // 30 minutes of inactivity
  rolling: true,  // reset TTL on every request
}))
```

---

## Config reference

```typescript
interface SessionConfig {
  driver: 'memory' | 'redis' | SessionStore
  ttl?: number              // seconds (default: 3600)
  rolling?: boolean         // sliding window (default: false)
  saveUninitialized?: boolean
  secret?: string           // HMAC signing key
  cookie?: {
    name?: string           // default: 'sid'
    maxAge?: number         // default: ttl
    httpOnly?: boolean      // default: true
    secure?: boolean        // default: true
    sameSite?: 'strict' | 'lax' | 'none'
    path?: string           // default: '/'
    domain?: string
  }
  redis?: {
    url?: string
    host?: string
    port?: number
    password?: string
    db?: number
    keyPrefix?: string      // default: 'raffel:session:'
  }
}
```

---

## Cookie Session Authentication

For *authenticating* requests using a session cookie (i.e. checking if the user is logged in), see [Cookie Session Strategy](/auth/overview.md#cookie-session).
