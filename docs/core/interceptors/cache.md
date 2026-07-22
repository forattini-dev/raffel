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
    profiles: {
      // Bounded-stale, fastest path for reference data local to one process.
      reference: { layers: ['l1'], coherence: 'ttl', ttlMs: 60_000 },
      // One shared store for data that must be invalidated across replicas.
      invalidatable: {
        layers: ['l3'],
        coherence: 'shared-invalidation',
        ttlMs: 30 * 60_000,
      },
    },
    rules: [
      { match: 'catalog.reference.**', enabled: true, profile: 'reference' },
      { match: 'catalog.**', enabled: true, profile: 'invalidatable' },
      { match: 'catalog.private.**', enabled: false },
    ],
  },
})
```

`id` is optional; omitted ids become `l1`, `l2`, and so on based on their
configured position. Disabled layers are removed from the hot path. A named
profile selects an ordered subset of the same physical layers; it does not
create another cache motor. Profiles are compiled and validated at startup,
must preserve the global layer order, and add no per-request driver filtering.
Selecting a profile at route level also enables caching, so declarative and
filesystem routes do not need to repeat `enabled: true`.

`coherence: 'ttl'` explicitly accepts per-process bounded staleness.
`coherence: 'shared-invalidation'` requires exactly one provider layer whose runtime
capabilities include distributed fill fencing plus tag and prefix invalidation;
Raffel rejects the profile when the provider is bound if those promises are
missing. `coherence: 'backplane'` is reserved for a future invalidation bus and
is rejected today instead of silently promising cross-process L1/L2 coherence.

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

With ioredis Cluster, supply a fresh list of masters for non-blocking
cluster-wide invalidation:

```ts
const valkey = new Redis.Cluster([
  { host: process.env.VALKEY_HOST!, port: Number(process.env.VALKEY_PORT ?? 6379) },
], {
  redisOptions: { password: process.env.VALKEY_PASSWORD || undefined },
})

server.provide('sharedCache', () => createRedisCacheLayer({
  id: 'l3',
  client: valkey,
  clusterHashTag: 'catalog-api',
  scanClients: () => valkey.nodes('master'),
  ttlMs: 60 * 60_000,
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

`ServerCacheConfig.namespace` is the arbitrary service prefix and should be
unique for every service sharing the same cache server. The adapter's `prefix`
is an optional outer deployment/application prefix. They compose without
colliding; for example, `prefix: 'prod:closer:'` plus
`namespace: 'billing-api'` stores keys below
`p12:prod:closer:d:billing-api:`. Custom provider prefixes are length-framed and
service namespaces are percent-encoded, so arbitrary delimiters cannot make
one service overlap another. Namespace clear, tag invalidation, and logical
prefix invalidation cannot cross that service boundary.

Redis data uses a `d:` keyspace while fencing metadata uses `m:`. Internal
generation counters therefore cannot collide with any legal cached record.

For Redis/Valkey Cluster, `clusterHashTag` places cache values and their
generation fence in the same hash slot, which is required by the atomic Lua
commit. Give each service its own adapter/hash tag to avoid concentrating
unrelated services in one slot. Cluster-wide `SCAN` is a separate concern:
the adapter traverses every client returned by `scanClients` and deletes keys
one at a time on their owning master to avoid cross-slot `DEL` commands.
Cluster configuration is deliberately all-or-nothing: `clusterHashTag` and
`scanClients` must be supplied together, otherwise adapter creation fails.

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
    profile: 'invalidatable',
    ttlMs: { l1: 30_000, l2: 5 * 60_000, l3: 30 * 60_000 },
    staleMs: { l1: 10_000, l2: 60_000 },
    keyFormat: 'v2',
    keys: ['filter.status', 'page', 'pageSize'],
    tags: (_input, ctx, result) => [
      `tenant:${ctx.auth.tenantId}`,
      ...((result as { items: Array<{ node: string }> }).items
        .map((item) => `node:${item.node}`)),
    ],
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
  cache: {
    profile: 'invalidatable',
    keyFormat: 'v2',
    keys: ['filter.status', 'page'],
    ttlMs: 60_000,
  },
}

export default async function handler() {
  return loadCatalog()
}
```

`scope: 'auto'` is the default: anonymous requests share an anonymous entry;
authenticated requests are partitioned by tenant and principal. Use
`scope: 'public'` only for data that is intentionally identical for everyone.

### Readable v2 keys

Legacy keys remain the default when `keys` is omitted, so existing deployments
do not cold-invalidate their cache. Set `keyFormat: 'v2'`, or declare `keys`,
to use named and typed dimensions:

```text
procedure:catalog.list:k2:v1:tenant:stone:principal:user-1:
  p.filter.status=s:open|p.page=n:2
```

Selectors use their configured order:

- `filter.status` reads a nested field from the procedure input;
- `#tenant` reads `ctx.input.metadata.tenant` (transport-neutral metadata);
- `@X-Cohort` reads an HTTP header case-insensitively.

Route registration compiles selector kinds and dot-path segments into an
immutable key plan once. The request path only reads the selected values; it
does not split paths or reinterpret selector syntax.

Dimensions distinguish strings, numbers, booleans, null, undefined, dates,
arrays, and objects. Object keys are stable-sorted and values are escaped.
`maxKeyLength` keeps the structural prefix readable and replaces only an
overflowing dimension tail with a Base64URL SHA-256 digest. If the configured
cap cannot hold the structural prefix plus that digest, caching is bypassed
instead of emitting a key that violates the cap.

Readable key dimensions are operational data: do not select authorization,
cookies, tokens, emails, documents, free-text searches, or other secrets/PII.
Use `maxKeyLength` for storage bounds, not as a redaction mechanism.

Identity semantics are shared by procedure and HTTP caches:

| Scope | Authenticated | No credentials | Rejected credentials |
|:--|:--|:--|:--|
| `auto` | tenant + principal | `anonymous` | bypass |
| `anonymous` | bypass | `anonymous` | bypass |
| `tenant` | tenant | bypass | bypass |
| `principal` | tenant + principal | bypass | bypass |
| `public` | `public` | `public` | `public` |

`credentialsPresented` on `ctx.auth` is the protocol-neutral signal for a
custom authentication adapter. Built-in strategies expose a lightweight
`credentialsPresented(envelope, ctx)` probe, including custom API-key header
names and query credentials, without authenticating a public route. Custom
strategies should implement the same optional probe. Raffel also recognizes
authorization/cookie metadata and HTTP headers. `public` is an explicit developer trust contract:
it intentionally shares one representation across authenticated and anonymous
callers. Use `auto` for routes whose response becomes richer after login.

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

A fill ticket is captured before the handler runs. Exact, tag, prefix, or
namespace invalidation advances its generation, so a handler that finishes
after that invalidation cannot republish the stale result. The Redis/Valkey
adapter adds a namespace generation plus atomic compare-and-set commit when the
client exposes `GET`, `INCR`, and `EVAL` (standard ioredis/node-redis clients
do). Consequently, a shared-provider-only profile also rejects stale fills and
stale single-flight joins across replicas. A custom provider can expose the
same `beginFill` / `isFillCurrent` / `commitFill` / `bumpGeneration`
operations and advertise `capabilities.distributedFillFencing: true`; partial
or explicitly disabled contracts are rejected. Local layers in front of a shared provider require a
backplane to evict already-cached values in other processes.

Custom physical providers can import `cacheNamespacePrefix(namespace)` when
implementing namespace/tag/prefix scans; it applies the same collision-free
framing used by the tiered motor.

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

// All records carrying a coarse dependency tag
const byTag = await server.cache?.invalidateTag('node:stone')

// A logical key prefix inside this cache namespace
const byPrefix = await server.cache?.invalidatePrefix('procedure:catalog.list:')

// This server instance's complete cache namespace
await server.cache?.clear()
```

`invalidateProcedure` remains as a deprecated compatibility shim. It requires
reconstructing the exact input, identity, key format, and selector options;
new write paths should use dependency tags or a logical prefix instead.

`invalidateTag` and `invalidatePrefix` return a structured result containing
the strategy and per-layer counts. Each layer advertises its strategy through
`capabilities`: memory tags are `indexed`; memory prefixes, filesystem, and the
built-in Redis/Valkey adapter are `scan`; custom providers may use `logical`, `indexed`, `scan`, or
`false`. The Redis/Valkey scan uses non-blocking `SCAN`, reads candidate record
tags, and physically deletes matches. Prefix input is always logical and
namespace-scoped, never an arbitrary provider key. Empty prefixes are rejected.

Prefer coarse dependencies for large lists: tag lists with `tenant:` or
`node:`, tag details with `lead:<id>`, then invalidate the node plus detail on a
write. Result-aware callbacks remain available when granular dependencies are
actually useful. If a tag callback throws, Raffel logs the failure, returns the
valid handler response, and skips caching that result.

L1 and L2 are local to each process. Without pub/sub invalidation, other
instances converge when their TTL expires. For invalidatable multi-replica
data, select a shared-provider-only profile until a backplane is configured.
The Redis/Valkey adapter scans the supplied client, or every master returned by
`scanClients` for a cluster, before reporting prefix/tag deletion counts.

### HttpApp middleware

```ts
import { csvCodec, createToonCodec, jsonCodec } from 'raffel'
import { HttpApp, createHttpCacheMiddleware } from 'raffel/http'
import { createMemoryCacheLayer, createTieredCache } from 'raffel/cache'

const codecs = [jsonCodec, csvCodec, createToonCodec(toon)]

const cache = createTieredCache({
  namespace: 'http-app',
  layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
})

const app = new HttpApp()
app.use('/catalog/*', createHttpCacheMiddleware(cache, {
  keyFormat: 'v2',
  maxKeyLength: 240,
  orderInsensitiveQueryParams: ['tag'],
  varyHeaders: ['accept', 'x-export-format', 'x-cohort'],
  representationCodecs: codecs,
  varyHeaderNormalizers: {
    'x-export-format': (value) => value.trim().toLowerCase(),
  },
}))
```

The HTTP middleware defaults to GET/HEAD and successful responses. It bypasses
`private`, `no-store`, `Set-Cookie`, event streams, oversized bodies, and
credential-bearing requests without a canonical runtime identity. Bodies are
read incrementally with a 1 MiB limit and a one-second deadline by default, so
an unbounded stream cannot block cache admission. Configure those guards with
`maxBodyBytes` and `bodyReadTimeoutMs`.

With `keyFormat: 'v2'`, query names are sorted canonically. Repeated values
keep their original order because `?sort=name&sort=date` can differ from the
reverse order. Only names listed in `orderInsensitiveQueryParams` sort their
repeated values. The escaped route path is structural and remains readable
even when the dimension tail is shortened. Header names are lower-cased and sorted. When `accept` is in
`varyHeaders`, `representationCodecs` stores the resolved codec name (`json`,
`csv`, `toon`, and so on), allowing equivalent `Accept` strings to share one
entry. Custom semantic headers can provide a `varyHeaderNormalizers` function.
Any response `Vary` header not covered by `varyHeaders` still prevents cache
admission.

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
