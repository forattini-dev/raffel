import {
  cacheNamespacePrefix,
  isCacheRecord,
  type CacheCircuitBreakerOptions,
  type CacheLayer,
  type CacheRecord,
} from './tiered.js'
import {
  DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
  DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
} from './defaults.js'

export interface RedisCacheLayerClient {
  get(key: string): Promise<string | null>
  set?(key: string, value: string, ...args: any[]): Promise<unknown>
  pSetEx?(key: string, milliseconds: number, value: string): Promise<unknown>
  del(key: string | string[]): Promise<number>
  scan?(cursor: string | number, ...args: any[]): Promise<
    | [string | number, string[]]
    | { cursor: string | number; keys: string[] }
  >
  keys?(pattern: string): Promise<string[]>
  incr?(key: string): Promise<number>
  eval?(script: string, ...args: any[]): Promise<unknown>
  quit?(): Promise<unknown>
}

export interface RedisCacheLayerOptions {
  id: string
  client: RedisCacheLayerClient
  /** Redis Cluster master clients to scan for namespace, prefix, and tag invalidation. */
  scanClients?: () => readonly RedisCacheLayerClient[]
  ttlMs: number
  prefix?: string
  /** Redis Cluster hash tag used to colocate values and generation fences. */
  clusterHashTag?: string
  scanCount?: number
  closeOnShutdown?: boolean
  clientStyle?: 'ioredis' | 'node-redis'
  allowBlockingClear?: boolean
  readTimeoutMs?: number
  operationTimeoutMs?: number
  circuitBreaker?: CacheCircuitBreakerOptions
  setWithTtl?: (
    client: RedisCacheLayerClient,
    key: string,
    value: string,
    ttlMs: number,
  ) => Promise<unknown>
}

function escapeRedisGlob(value: string): string {
  return value.replace(/[\\*?\[\]]/g, '\\$&')
}

const COMMIT_FILL_SCRIPT = `
local current = redis.call('GET', KEYS[1]) or '0'
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`

/** Redis/Valkey layer that delegates capacity and eviction to the provider. */
export function createRedisCacheLayer(options: RedisCacheLayerOptions): CacheLayer {
  let prefix = 'raffel:cache:'
  if (options.prefix !== undefined) {
    try {
      encodeURIComponent(options.prefix)
    } catch {
      throw new Error('Redis/Valkey prefix must contain valid Unicode')
    }
    prefix = `p${Buffer.byteLength(options.prefix)}:${options.prefix}`
  }
  if (options.clusterHashTag?.includes('{') || options.clusterHashTag?.includes('}')) {
    throw new Error('Redis/Valkey clusterHashTag cannot contain braces')
  }
  if (Boolean(options.clusterHashTag) !== Boolean(options.scanClients)) {
    throw new Error(
      'Redis/Valkey Cluster requires both clusterHashTag and scanClients',
    )
  }
  const storagePrefix = options.clusterHashTag
    ? `${prefix}{${options.clusterHashTag}}:`
    : prefix
  const dataPrefix = `${storagePrefix}d:`
  const fullKey = (key: string) => dataPrefix + key
  const generationKey = (namespace: string) => (
    `${storagePrefix}m:g:${Buffer.from(namespace).toString('base64url')}`
  )
  const supportsDistributedFillFencing = Boolean(options.client.incr && options.client.eval)
  const supportsInvalidation = Boolean(
    options.scanClients ||
    options.client.scan ||
    (options.allowBlockingClear && options.client.keys)
  )
  let hits = 0
  let misses = 0

  async function setWithNativeTtl(key: string, value: string, ttlMs: number): Promise<void> {
    if (options.setWithTtl) {
      await options.setWithTtl(options.client, key, value, ttlMs)
      return
    }
    if (options.client.pSetEx) {
      await options.client.pSetEx(key, ttlMs, value)
      return
    }
    if (!options.client.set) throw new Error('Redis/Valkey client does not implement SET')
    if (options.clientStyle === 'node-redis') {
      await options.client.set(key, value, { PX: ttlMs })
      return
    }
    await options.client.set(key, value, 'PX', ttlMs)
  }

  async function scanBatches(
    pattern: string,
    visit: (client: RedisCacheLayerClient, keys: string[]) => Promise<void>,
  ): Promise<void> {
    const clients = options.scanClients?.() ?? [options.client]
    if (clients.length === 0) {
      throw new Error('Redis/Valkey scanClients returned no cluster masters')
    }
    for (const client of clients) {
      if (!client.scan) {
        if (options.allowBlockingClear && client.keys) {
          const keys = await client.keys(pattern)
          if (keys.length > 0) await visit(client, keys)
          continue
        }
        throw new Error('Redis/Valkey namespace invalidation requires SCAN support')
      }
      let cursor = '0'
      do {
        const result = options.clientStyle === 'node-redis' || client.pSetEx
          ? await client.scan(cursor, {
              MATCH: pattern,
              COUNT: options.scanCount ?? 100,
            })
          : await client.scan(
            cursor,
            'MATCH', pattern,
            'COUNT', options.scanCount ?? 100,
          )
        const next = Array.isArray(result) ? result[0] : result.cursor
        const keys = Array.isArray(result) ? result[1] : result.keys
        cursor = String(next)
        if (keys.length > 0) await visit(client, keys)
      } while (cursor !== '0')
    }
  }

  async function deleteScannedKeys(
    client: RedisCacheLayerClient,
    keys: string[],
  ): Promise<number> {
    if (!options.scanClients) return client.del(keys)
    const deleted = await Promise.all(keys.map((key) => client.del(key)))
    return deleted.reduce((total, count) => total + count, 0)
  }

  async function deletePattern(pattern: string): Promise<number> {
    let deleted = 0
    await scanBatches(pattern, async (client, keys) => {
      deleted += await deleteScannedKeys(client, keys)
    })
    return deleted
  }

  function storedRecord(
    record: CacheRecord,
    ttlMs: number,
    staleMs: number,
  ): CacheRecord {
    const expiresAt = Date.now() + ttlMs
    return {
      ...record,
      expiresAt,
      staleUntil: staleMs > 0 ? expiresAt + staleMs : undefined,
    }
  }

  async function commitFillAtomically(
    key: string,
    record: CacheRecord,
    ttlMs: number,
    staleMs: number,
    token: unknown,
    namespace: string,
  ): Promise<boolean> {
    const encoded = JSON.stringify(storedRecord(record, ttlMs, staleMs))
    const providerKey = fullKey(key)
    const generation = generationKey(namespace)
    const duration = String(ttlMs + staleMs)
    const result = options.clientStyle === 'node-redis' || options.client.pSetEx
      ? await options.client.eval!(COMMIT_FILL_SCRIPT, {
          keys: [generation, providerKey],
          arguments: [String(token), encoded, duration],
        })
      : await options.client.eval!(
          COMMIT_FILL_SCRIPT,
          2,
          generation,
          providerKey,
          String(token),
          encoded,
          duration,
        )
    return Number(result) === 1
  }

  return {
    id: options.id,
    capabilities: {
      distributedFillFencing: supportsDistributedFillFencing,
      prefixInvalidation: supportsInvalidation ? 'scan' : false,
      tagInvalidation: supportsInvalidation ? 'scan' : false,
    },
    ttlMs: options.ttlMs,
    readTimeoutMs: options.readTimeoutMs ?? 100,
    operationTimeoutMs: options.operationTimeoutMs ?? DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
    circuitBreaker: options.circuitBreaker ?? {
      failureThreshold: DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
      cooldownMs: DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
    },
    async get(key) {
      const providerKey = fullKey(key)
      const encoded = await options.client.get(providerKey)
      if (!encoded) {
        misses++
        return undefined
      }
      let record: CacheRecord
      try {
        record = JSON.parse(encoded) as CacheRecord
        if (!isCacheRecord(record)) throw new Error('Invalid cache record')
      } catch {
        await options.client.del(providerKey)
        misses++
        return undefined
      }
      if (Date.now() >= (record.staleUntil ?? record.expiresAt)) {
        await options.client.del(providerKey)
        misses++
        return undefined
      }
      hits++
      return record
    },
    async set(key, record, ttlMs, staleMs = 0) {
      const stored = storedRecord(record, ttlMs, staleMs)
      await setWithNativeTtl(fullKey(key), JSON.stringify(stored), ttlMs + staleMs)
    },
    ...(supportsDistributedFillFencing ? {
      async beginFill(_key: string, namespace: string) {
        return await options.client.get(generationKey(namespace)) ?? '0'
      },
      async isFillCurrent(token: unknown, namespace: string) {
        const current = await options.client.get(generationKey(namespace)) ?? '0'
        return current === String(token)
      },
      commitFill: commitFillAtomically,
      async bumpGeneration(namespace: string) {
        await options.client.incr!(generationKey(namespace))
      },
    } : {}),
    async delete(key) {
      await options.client.del(fullKey(key))
    },
    async clearNamespace(namespace) {
      const namespacePrefix = dataPrefix + cacheNamespacePrefix(namespace)
      await deletePattern(`${escapeRedisGlob(namespacePrefix)}*`)
    },
    async invalidatePrefix(logicalPrefix, namespace) {
      const namespacePrefix = dataPrefix + cacheNamespacePrefix(namespace)
      const pattern = `${escapeRedisGlob(namespacePrefix + logicalPrefix)}*`
      return { mode: 'physical', deleted: await deletePattern(pattern) }
    },
    async invalidateTag(tag, namespace) {
      const namespacePrefix = dataPrefix + cacheNamespacePrefix(namespace)
      const pattern = `${escapeRedisGlob(namespacePrefix)}*`
      let deleted = 0
      await scanBatches(pattern, async (client, keys) => {
        const records = await Promise.all(keys.map(async (key) => {
          const encoded = await client.get(key)
          if (!encoded) return undefined
          try {
            const record = JSON.parse(encoded) as CacheRecord
            return isCacheRecord(record) ? record : undefined
          } catch {
            return undefined
          }
        }))
        const matches = keys.filter((_key, index) => records[index]?.tags?.includes(tag))
        if (matches.length > 0) deleted += await deleteScannedKeys(client, matches)
      })
      return { mode: 'physical', deleted }
    },
    stats() {
      return { totalItems: 0, hits, misses }
    },
    async shutdown() {
      if (options.closeOnShutdown) await options.client.quit?.()
    },
  }
}
