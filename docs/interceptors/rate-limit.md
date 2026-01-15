# Rate Limiting

Protect your server from abuse with configurable rate limiting.

---

## Basic Usage

```typescript
import { createServer, createRateLimitInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

// Global rate limit
server.use(createRateLimitInterceptor({
  windowMs: 60 * 1000,    // 1 minute
  maxRequests: 100,
}))
```

---

## Configuration Options

```typescript
createRateLimitInterceptor({
  // Time window in milliseconds
  windowMs: 60 * 1000,

  // Maximum requests per window
  maxRequests: 100,

  // Track at most N keys (memory driver only)
  maxUniqueKeys: 10_000,

  // If true, successful requests are not counted
  skipSuccessfulRequests: false,

  // Key generator (envelope + context)
  keyGenerator: (envelope, ctx) => {
    return ctx.auth?.principal ?? envelope.metadata['x-forwarded-for'] ?? 'anon'
  },

  // Driver (memory | filesystem | redis | custom)
  driver: { driver: 'redis', options: { client: redisClient, prefix: 'rl:' } },

  // Pattern-based rules
  rules: [
    { id: 'auth', pattern: 'auth.*', maxRequests: 10 },
    { id: 'admin', pattern: 'admin.**', windowMs: 60_000, maxRequests: 50 },
  ],
})
```

---

## Key Generation Strategies

### By IP Address

```typescript
createRateLimitInterceptor({
  keyGenerator: (envelope) => {
    return envelope.metadata['x-forwarded-for'] ?? 'unknown-ip'
  },
})
```

### By User ID

```typescript
createRateLimitInterceptor({
  keyGenerator: (envelope, ctx) => {
    return ctx.auth?.principal ?? envelope.metadata['x-forwarded-for'] ?? 'anon'
  },
})
```

### By API Key

```typescript
createRateLimitInterceptor({
  keyGenerator: (envelope) => {
    return envelope.metadata['x-api-key'] ?? 'missing-key'
  },
})
```

---

## Auth-Aware Limits

Different limits for authenticated vs anonymous users:

```typescript
import { createAuthRateLimiter } from 'raffel'

const rateLimit = createAuthRateLimiter({
  authenticated: { windowMs: 60_000, maxRequests: 1000 },
  anonymous: { windowMs: 60_000, maxRequests: 100 },
})

server.use(rateLimit)
```

---

## Token Bucket (Burst-Friendly)

```typescript
import { createTokenBucketLimiter } from 'raffel'

const bursty = createTokenBucketLimiter({
  bucketSize: 20,
  refillRate: 2, // tokens per second
  onRateLimited: ({ key, procedure }) => {
    console.warn(`Rate limited ${key} on ${procedure}`)
  },
})

server.use(bursty)
```

---

## Response Headers (HTTP)

The HTTP adapter maps rate limit info to standard headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1704067260
Retry-After: 45
```
