# Cache

Raffel provides a pluggable cache system with multiple driver support for different use cases.

## Available Drivers

| Driver | Best For | Features |
|:--|:--|:--|
| `memory` | Single instance, high performance | LRU/FIFO, compression, memory limits, container-aware |
| `file` | Persistence across restarts | File-based, size limits, compression |
| `redis` | Distributed caching | Any Redis-compatible client, key prefixing |
| `s3db` | Durable distributed cache | S3-based, high durability |

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

## S3DB Driver

S3-based distributed cache for high durability requirements.

```ts
import { createCacheDriver } from 'raffel'
import { S3DB } from 's3db.js'

const s3db = new S3DB({ bucket: 'my-bucket' })

const cache = await createCacheDriver('s3db', {
  s3db: s3db,
  resource: 'cache',        // S3DB resource name
  prefix: 'v1:',           // Key prefix (optional)
})
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
const cache = await createCacheDriver('s3db', options)
```

### Sync Creation

For cases where async is not possible (memory and file only):

```ts
import { createCacheDriverSync } from 'raffel'

const cache = createCacheDriverSync('memory', options)
const cache = createCacheDriverSync('file', options)
// Note: redis and s3db require async initialization
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
  CacheS3DBDriver,
  createCacheMemoryDriver,
  createCacheFileDriver,
  createCacheRedisDriver,
  createCacheS3DBDriver,
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
