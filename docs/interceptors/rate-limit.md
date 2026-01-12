# Rate Limiting

Protect your server from abuse with configurable rate limiting.

---

## Basic Usage

```typescript
import { createServer, createRateLimitInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

// Global rate limit
server.use(createRateLimitInterceptor({
  windowMs: 60 * 1000,    // 1 minute window
  maxRequests: 100,        // 100 requests per window
}))
```

---

## Configuration Options

```typescript
createRateLimitInterceptor({
  // Time window in milliseconds
  windowMs: 60 * 1000,  // 1 minute

  // Maximum requests per window
  maxRequests: 100,

  // Key generator for identifying clients
  keyGenerator: (ctx) => {
    // Default: uses ctx.headers['x-forwarded-for'] || ctx.ip
    return ctx.auth?.userId || ctx.ip
  },

  // Custom message when rate limited
  message: 'Too many requests, please try again later',

  // Skip rate limiting for certain requests
  skip: (ctx) => {
    // Skip for admin users
    return ctx.auth?.roles?.includes('admin')
  },

  // Headers to include in response
  headers: true,  // X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset

  // Store implementation (default: in-memory)
  store: new RedisRateLimitStore({ url: process.env.REDIS_URL }),
})
```

---

## Per-Procedure Rate Limits

Apply different limits to different procedures:

```typescript
// Strict limit for authentication
server.procedure('auth.login')
  .use(createRateLimitInterceptor({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    maxRequests: 5,             // Only 5 attempts
  }))
  .handler(async (input) => {
    // ...
  })

// Relaxed limit for read operations
server.procedure('posts.list')
  .use(createRateLimitInterceptor({
    windowMs: 60 * 1000,
    maxRequests: 1000,
  }))
  .handler(async () => {
    // ...
  })
```

---

## Key Generation Strategies

### By IP Address (Default)

```typescript
createRateLimitInterceptor({
  keyGenerator: (ctx) => {
    return ctx.headers['x-forwarded-for'] || ctx.ip
  },
})
```

### By User ID

```typescript
createRateLimitInterceptor({
  keyGenerator: (ctx) => {
    // Rate limit by user if authenticated, otherwise by IP
    return ctx.auth?.userId || ctx.ip
  },
})
```

### By API Key

```typescript
createRateLimitInterceptor({
  keyGenerator: (ctx) => {
    return ctx.headers['x-api-key'] || ctx.ip
  },
})
```

### Composite Keys

```typescript
createRateLimitInterceptor({
  keyGenerator: (ctx) => {
    // Separate limits per user per endpoint
    return `${ctx.auth?.userId || ctx.ip}:${ctx.procedure}`
  },
})
```

---

## Response Headers

When `headers: true`:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1704067260
```

When rate limited:

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704067260
Retry-After: 45
```

---

## Response When Limited

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests, please try again later",
    "retryAfter": 45
  }
}
```

---

## Storage Backends

### In-Memory (Default)

Good for single-instance deployments:

```typescript
createRateLimitInterceptor({
  // Default: in-memory Map
  store: undefined,
})
```

### Redis

For distributed deployments:

```typescript
import { createRedisRateLimitStore } from 'raffel'

createRateLimitInterceptor({
  store: createRedisRateLimitStore({
    url: process.env.REDIS_URL!,
    prefix: 'rl:',
  }),
})
```

### Custom Store

Implement the `RateLimitStore` interface:

```typescript
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{
    count: number
    resetAt: number
  }>
  reset(key: string): Promise<void>
}

class CustomStore implements RateLimitStore {
  async increment(key: string, windowMs: number) {
    // Your implementation
    return { count: 1, resetAt: Date.now() + windowMs }
  }

  async reset(key: string) {
    // Your implementation
  }
}
```

---

## Sliding Window vs Fixed Window

### Fixed Window (Default)

Simpler, resets at fixed intervals:

```typescript
createRateLimitInterceptor({
  windowMs: 60 * 1000,
  maxRequests: 100,
  algorithm: 'fixed-window',
})
```

### Sliding Window

Smoother rate limiting:

```typescript
createRateLimitInterceptor({
  windowMs: 60 * 1000,
  maxRequests: 100,
  algorithm: 'sliding-window',
})
```

---

## Skip Conditions

```typescript
createRateLimitInterceptor({
  skip: (ctx) => {
    // Skip for internal services
    if (ctx.headers['x-internal-service'] === 'true') {
      return true
    }

    // Skip for admin users
    if (ctx.auth?.roles?.includes('admin')) {
      return true
    }

    // Skip for specific procedures
    if (ctx.procedure === 'health.check') {
      return true
    }

    return false
  },
})
```

---

## Tiered Rate Limits

Different limits based on user tier:

```typescript
const tierLimits = {
  free: 100,
  pro: 1000,
  enterprise: 10000,
}

createRateLimitInterceptor({
  windowMs: 60 * 1000,
  maxRequests: (ctx) => {
    const tier = ctx.auth?.tier || 'free'
    return tierLimits[tier]
  },
})
```

---

## Cost-Based Rate Limiting

Some operations cost more than others:

```typescript
const procedureCosts = {
  'posts.list': 1,
  'posts.create': 5,
  'reports.generate': 20,
}

createRateLimitInterceptor({
  windowMs: 60 * 1000,
  maxRequests: 100,
  cost: (ctx) => {
    return procedureCosts[ctx.procedure] || 1
  },
})
```

---

## Monitoring

Track rate limit hits:

```typescript
createRateLimitInterceptor({
  windowMs: 60 * 1000,
  maxRequests: 100,
  onLimit: (ctx, info) => {
    console.log(`Rate limited: ${info.key}`, {
      procedure: ctx.procedure,
      count: info.count,
      limit: info.limit,
    })
    // Send to metrics
    metrics.increment('rate_limit_hit', {
      procedure: ctx.procedure,
      key: info.key,
    })
  },
})
```

---

## Error Handling

```typescript
import { RateLimitError } from 'raffel'

try {
  await client.call('api.endpoint')
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Retry after ${err.retryAfter} seconds`)
  }
}
```

---

## Next Steps

- **[Circuit Breaker](circuit-breaker.md)** — Fail fast on repeated errors
- **[Bulkhead](bulkhead.md)** — Limit concurrent requests
- **[Timeout](timeout.md)** — Request deadlines
