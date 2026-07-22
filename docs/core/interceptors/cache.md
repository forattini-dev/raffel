# Cache

Raffel provides a pluggable cache system with multiple driver support for different use cases.

## Available Drivers

| Driver | Best For | Features |
|:--|:--|:--|
| `memory` | Single instance, high performance | LRU/FIFO, compression, memory limits, container-aware |
| `file` | Persistence across restarts | File-based, size limits, compression |
| `redis` | Distributed caching | Any Redis-compatible client, key prefixing |

## Quick Start

```ts
import { createCacheDriver } from 'raffel'

// Memory driver (default)
const cache = await createCacheDriver('memory', {
  maxSize: 5000,
  evictionPolicy: 'lru',
})

// Basic operations
await cache.set('users:123', { name: 'Alice' }, 60000) // 1 minute TTL
const result = await cache.get('users:123')
console.log(result?.entry.value) // { name: 'Alice' }

await cache.delete('users:123')
await cache.clear() // Clear all
await cache.clear('users:') // Clear by prefix
```

## Hierarchical response cache (L1 + L2 + L3)

The server response cache uses one ordered motor for all layers:

1. L1 is an in-process memory cache. Its defaults are 16 MiB, 10,000 entries,
   LRU eviction, and reference-preserving reads.
2. L2 is a local filesystem cache. Its defaults are 64 MiB and 50,000 files.
3. L3 is an optional provider layer. Redis/Valkey owns its own capacity and
   eviction configuration.

The global flag only enables the infrastructure. A route is cached when a
matching rule or a route-level override enables it.

```ts
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  cache: {
    enabled: true,
    namespace: 'catalog-api',
    layers: [
      { id: 'l1', driver: 'memory', enabled: true, ttlMs: 60_000 },
      {
        id: 'l2',
        driver: 'fs',
        enabled: true,
        ttlMs: 10 * 60_000,
        directory: '.raffel/cache',
      },
      {
        id: 'l3',
        driver: 'provider',
        enabled: true,
        ttlMs: 60 * 60_000,
        timeoutMs: 100,
        operationTimeoutMs: 1_000,
        provider: 'sharedCache',
      },
    ],
    rules: [
      { match: 'catalog.**', enabled: true },
      { match: 'catalog.private.**', enabled: false },
    ],
  },
})
```

`id` is optional; omitted ids become `l1`, `l2`, and so on based on their
configured position. Disabled layers are removed from the hot path.

### Redis or Valkey as L3

Raffel receives an already configured Redis-compatible client. Connection
strings, credentials, TLS, cluster discovery, reconnect policy, and connection
pooling therefore stay with `ioredis`, `node-redis`, or the client chosen by the
application. Install that client in the application; Raffel does not add it as
a runtime dependency.

With `ioredis`, the same setup supports a local Redis/Valkey container, ACL
credentials, and TLS URLs:

```ts
import Redis from 'ioredis'
import { createRedisCacheLayer } from 'raffel/cache'

// Examples:
// redis://localhost:6379/0
// redis://default:password@localhost:6379/0
// rediss://default:password@cache.example.com:6379/0
const redis = new Redis(process.env.REDIS_URL!)

server.provide('sharedCache', () => createRedisCacheLayer({
  id: 'l3',
  client: redis,
  ttlMs: 60 * 60_000,
  prefix: 'my-service:',
}))
```

For AWS ElastiCache for Valkey/Redis OSS, pass the endpoint, authentication
token or ACL credentials, and TLS configuration to the client:

```ts
const valkey = new Redis({
  host: process.env.VALKEY_HOST,
  port: Number(process.env.VALKEY_PORT ?? 6379),
  username: process.env.VALKEY_USERNAME || undefined,
  password: process.env.VALKEY_PASSWORD || undefined,
  tls: process.env.VALKEY_TLS === 'true' ? {} : undefined,
})

server.provide('sharedCache', () => createRedisCacheLayer({
  id: 'l3',
  client: valkey,
  ttlMs: 60 * 60_000,
}))
```

Passwordless deployments work by omitting `username` and `password`. For AWS
IAM authentication, token generation and renewal belong to the selected
client's connection/authentication setup; the resulting connected client is
used by the same cache adapter.

The node-redis client is also supported:

```ts
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

server.provide('sharedCache', () => createRedisCacheLayer({
  id: 'l3',
  client: redis,
  clientStyle: 'node-redis',
  ttlMs: 60 * 60_000,
}))
```

The adapter stores `ttlMs + staleMs` with Redis/Valkey's native `PX` TTL. It
does not assume a maximum L3 size and does not close a user-owned client unless
`closeOnShutdown: true` is explicitly set.

Both ioredis-style `SET ... PX` and node-redis `pSetEx` clients are supported.
Namespace invalidation requires non-blocking `SCAN`; a blocking `KEYS` fallback
is available only with `allowBlockingClear: true`.

### Route configuration

Fluent, direct, declarative, mounted-module, HTTP-namespace, and discovered
procedures all use the same cache motor.

```ts
server.procedure('catalog.list')
  .cache({
    enabled: true,
    ttlMs: { l1: 30_000, l2: 5 * 60_000, l3: 30 * 60_000 },
    staleMs: { l1: 10_000, l2: 60_000 },
  })
  .handler(async (input, ctx) => listCatalog(input, ctx))

server.procedures({
  'catalog.featured': {
    cache: { enabled: true, ttlMs: 60_000 },
    handler: async () => featuredProducts(),
  },
})
```

For filesystem discovery:

```ts
export const meta = {
  cache: { enabled: true, ttlMs: 60_000 },
}

export default async function handler() {
  return loadCatalog()
}
```

`scope: 'auto'` is the default: anonymous requests share an anonymous entry;
authenticated requests are partitioned by tenant and principal. Use
`scope: 'public'` only for data that is intentionally identical for everyone.

### TTL behavior

Fixed TTL is the default. L1 and L2 use one shared expiration wheel per layer,
not one timer per key. L2 rebuilds that wheel from persisted metadata on
startup. L3 delegates physical expiry to the provider. A hit promoted from a
lower layer receives a fresh upper-layer TTL. `staleMs` enables a bounded stale
window; it is off by default.

Lower-layer writes are write-behind, coalesced per key, bounded, and ordered for
the same key. Invalidation is placed on the same ordering barrier, so a pending
write cannot resurrect deleted data. Cache failures fail open so the request
handler can still run. Reads time out after 250 ms by default (100 ms for the
Redis/Valkey adapter and server provider layers), mutations after one second,
and three consecutive read failures open a 10-second circuit. Override these
with `timeoutMs`, `operationTimeoutMs`, and `circuitBreaker` on a layer, or with
`readTimeoutMs` and `operationTimeoutMs` when constructing `createTieredCache`
directly.

If an unabortable layer operation exceeds its deadline, that key (or namespace
for `clear`) is fenced off in the affected layer. A late write is compensated
with a delete before the fence is released, so timed-out work cannot republish
an invalidated entry. Reads and newer lower-layer writes skip the fence and the
request path continues through the remaining layers or handler.

Procedure values must be JSON-safe plain data. `Response`, `Date`, `Buffer`,
`Map`, class instances, cyclic objects, and other values that cannot round-trip
identically through L2/L3 are not admitted. Raw `Response` objects should use
the `HttpApp` middleware below. When a procedure nevertheless returns a native
`Response`, each concurrent single-flight waiter receives its own clone rather
than sharing one consumable body.

### Invalidation

```ts
// Exact logical key when you already have it
await server.cache?.invalidate(key)

// Exact procedure/input/identity entry
await server.cache?.invalidateProcedure('catalog.list', input, ctx)

// This server instance's complete cache namespace
await server.cache?.clear()
```

L1 and L2 are local to each process. Without pub/sub invalidation, other
instances converge when their TTL expires.

### HttpApp middleware

```ts
import { HttpApp, createHttpCacheMiddleware } from 'raffel/http'
import { createMemoryCacheLayer, createTieredCache } from 'raffel/cache'

const cache = createTieredCache({
  namespace: 'http-app',
  layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
})

const app = new HttpApp()
app.use('/catalog/*', createHttpCacheMiddleware(cache))
```

The HTTP middleware defaults to GET/HEAD and successful responses. It bypasses
`private`, `no-store`, `Set-Cookie`, event streams, oversized bodies, and
credential-bearing requests without a canonical runtime identity. Bodies are
read incrementally with a 1 MiB limit and a one-second deadline by default, so
an unbounded stream cannot block cache admission. Configure those guards with
`maxBodyBytes` and `bodyReadTimeoutMs`.

## Memory Driver

High-performance in-memory cache with advanced features ported from Recker.

### Configuration

```ts
import { createCacheDriver } from 'raffel'

const cache = await createCacheDriver('memory', {
  // Size limits
  maxSize: 10000,           // Max entries (default: 10000)
  maxMemoryBytes: 100_000_000, // Max memory in bytes
  // OR
  maxMemoryPercent: 0.25,   // Max % of available memory

  // Eviction policy
  evictionPolicy: 'lru',    // 'lru' (default) or 'fifo'

  // Compression
  compression: {
    enabled: true,
    threshold: 1024,        // Compress values > 1KB
    level: 6,               // Compression level (1-9)
  },

  // Statistics
  enableStats: true,        // Track hits/misses/etc.

  // Callbacks
  onEvict: ({ key, reason }) => {
    console.log(`Evicted ${key}: ${reason}`)
  },
  onPressure: ({ level, used, max }) => {
    console.warn(`Memory pressure: ${level}`)
  },
})
```

### Memory-Aware Caching

The memory driver is container-aware and can automatically detect memory limits in Docker/Kubernetes environments:

```ts
// Uses cgroup v1/v2 detection in containers
const cache = await createCacheDriver('memory', {
  maxMemoryPercent: 0.5, // Use 50% of container memory
})

// Get memory stats
const stats = cache.getMemoryStats?.()
// {
//   currentMemoryBytes: 45_000_000,
//   maxMemoryBytes: 100_000_000,
//   entryCount: 2500,
//   avgEntrySize: 18000
// }
```

### Eviction Policies

**LRU (Least Recently Used)** - Default policy, evicts items that haven't been accessed recently:

```ts
const cache = await createCacheDriver('memory', {
  maxSize: 3,
  evictionPolicy: 'lru',
})

await cache.set('a', 1, 60000)
await cache.set('b', 2, 60000)
await cache.set('c', 3, 60000)

await cache.get('a') // Access 'a' - moves to recently used

await cache.set('d', 4, 60000) // Evicts 'b' (least recently used)
```

**FIFO (First In First Out)** - Evicts oldest entries first:

```ts
const cache = await createCacheDriver('memory', {
  maxSize: 3,
  evictionPolicy: 'fifo',
})

await cache.set('a', 1, 60000)
await cache.set('b', 2, 60000)
await cache.set('c', 3, 60000)

await cache.get('a') // Doesn't matter for FIFO

await cache.set('d', 4, 60000) // Evicts 'a' (oldest)
```

### Compression

Enable compression for large values to save memory:

```ts
const cache = await createCacheDriver('memory', {
  compression: {
    enabled: true,
    threshold: 1024,  // Only compress values > 1KB
    level: 6,         // Balance between speed and ratio
  },
})

// Get compression stats
const compressionStats = cache.getCompressionStats?.()
// {
//   enabled: true,
//   compressedItems: 150,
//   savedBytes: 2_500_000,
//   compressionRatio: 0.35
// }
```

## File Driver

File-system based cache that persists across process restarts.

```ts
import { createCacheDriver } from 'raffel'

const cache = await createCacheDriver('file', {
  directory: '.cache',      // Cache directory
  maxFiles: 10000,          // Max cached files
  maxSizeBytes: 100_000_000, // Max total size
  compression: {
    enabled: true,
    threshold: 1024,
  },
})
```

## Redis Driver

Works with any Redis-compatible client (ioredis, node-redis, etc.).

```ts
import { createCacheDriver } from 'raffel'
import Redis from 'ioredis'

const redis = new Redis()

const cache = await createCacheDriver('redis', {
  client: redis,            // Your Redis client
  prefix: 'myapp:cache:',   // Key prefix (optional)
  compression: {
    enabled: true,
    threshold: 1024,
  },
})
```

### Duck-Typed Interface

The driver works with any client implementing these methods:

```ts
interface RedisLikeClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, 'PX', ttl: number): Promise<unknown>
  del(key: string | string[]): Promise<number>
  keys(pattern: string): Promise<string[]>
  exists(key: string | string[]): Promise<number>
}
```

## Using with Cache Interceptor

The cache drivers integrate seamlessly with the cache interceptor:

```ts
import { createServer, createCacheDriver } from 'raffel'
import { createCacheInterceptor } from 'raffel/middleware'

const driver = await createCacheDriver('memory', {
  maxSize: 5000,
  evictionPolicy: 'lru',
})

const server = createServer({ port: 3000 })

server.use(createCacheInterceptor({
  driver,
  ttlMs: 60000, // 1 minute default TTL
  keyGenerator: (procedure, input) => `${procedure}:${JSON.stringify(input)}`,
  shouldCache: (procedure) => procedure.startsWith('query.'),
}))
```

### Quick Driver Creation

For simpler cases, specify the driver type directly:

```ts
server.use(createCacheInterceptor({
  driverType: 'memory',
  driverOptions: {
    maxSize: 5000,
    evictionPolicy: 'lru',
  },
  ttlMs: 60000,
}))
```

## Factory Functions

### Async Creation (Recommended)

Lazy loads driver code for better tree-shaking:

```ts
import { createCacheDriver } from 'raffel'

const cache = await createCacheDriver('memory', options)
const cache = await createCacheDriver('file', options)
const cache = await createCacheDriver('redis', options)
```

### Sync Creation

For cases where async is not possible (memory and file only):

```ts
import { createCacheDriverSync } from 'raffel'

const cache = createCacheDriverSync('memory', options)
const cache = createCacheDriverSync('file', options)
// Note: redis requires async initialization
```

### From Config Object

```ts
import { createCacheDriverFromConfig } from 'raffel'

const cache = await createCacheDriverFromConfig({
  driver: 'memory',
  options: { maxSize: 5000 },
})
```

## CacheDriver Interface

All drivers implement this interface:

```ts
interface CacheDriver {
  readonly name: string

  // Core operations
  get(key: string): Promise<CacheGetResult | undefined>
  set(key: string, value: unknown, ttlMs: number, tags?: string[]): Promise<void>
  delete(key: string): Promise<void>
  clear(prefix?: string): Promise<void>

  // Optional operations
  has?(key: string): Promise<boolean>
  keys?(pattern?: string): Promise<string[]>
  stats?(): CacheStats
  shutdown?(): Promise<void>
}

interface CacheGetResult {
  entry: CacheEntry
  metadata?: Record<string, unknown>
}

interface CacheEntry {
  value: unknown
  createdAt: number
  expiresAt: number
  tags?: string[]
}
```

## Direct Driver Imports

For advanced use cases, import drivers directly:

```ts
import {
  CacheMemoryDriver,
  CacheFileDriver,
  CacheRedisDriver,
  createCacheMemoryDriver,
  createCacheFileDriver,
  createCacheRedisDriver,
} from 'raffel'

// Using class directly
const cache = new CacheMemoryDriver({
  maxSize: 5000,
  evictionPolicy: 'lru',
})

// Using factory function
const cache = createCacheMemoryDriver({
  maxSize: 5000,
})
```

## Statistics

Track cache performance with the stats API:

```ts
const cache = await createCacheDriver('memory', {
  enableStats: true,
})

// Use the cache...
await cache.set('key', 'value', 60000)
await cache.get('key') // hit
await cache.get('missing') // miss

const stats = cache.stats?.()
// {
//   hits: 1,
//   misses: 1,
//   hitRate: 0.5,
//   sets: 1,
//   deletes: 0,
//   evictions: 0,
//   size: 1
// }
```

## Best Practices

1. **Choose the right driver** - Use `memory` for single instances, `redis` for distributed systems
2. **Set appropriate limits** - Always configure `maxSize` or `maxMemoryBytes` to prevent unbounded growth
3. **Use LRU for hot data** - LRU keeps frequently accessed data in cache
4. **Enable compression for large values** - Saves memory at the cost of CPU
5. **Monitor stats** - Track hit rates to tune cache sizes
6. **Use prefixes** - Namespace your keys to avoid collisions
7. **Handle shutdown gracefully** - Call `shutdown()` to clean up resources
