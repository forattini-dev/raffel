import {
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
  quit?(): Promise<unknown>
}

export interface RedisCacheLayerOptions {
  id: string
  client: RedisCacheLayerClient
  ttlMs: number
  prefix?: string
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

/** Redis/Valkey layer that delegates capacity and eviction to the provider. */
export function createRedisCacheLayer(options: RedisCacheLayerOptions): CacheLayer {
  const prefix = options.prefix ?? 'raffel:cache:'
  const fullKey = (key: string) => prefix + key
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

  return {
    id: options.id,
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
      const expiresAt = Date.now() + ttlMs
      const stored: CacheRecord = {
        ...record,
        expiresAt,
        staleUntil: staleMs > 0 ? expiresAt + staleMs : undefined,
      }
      await setWithNativeTtl(fullKey(key), JSON.stringify(stored), ttlMs + staleMs)
    },
    async delete(key) {
      await options.client.del(fullKey(key))
    },
    async clearNamespace(namespace) {
      const pattern = `${prefix}${namespace}:*`
      if (!options.client.scan) {
        if (options.allowBlockingClear && options.client.keys) {
          const keys = await options.client.keys(pattern)
          if (keys.length > 0) await options.client.del(keys)
          return
        }
        throw new Error('Redis/Valkey namespace invalidation requires SCAN support')
      }
      let cursor = '0'
      do {
        const result = options.clientStyle === 'node-redis' || options.client.pSetEx
          ? await options.client.scan(cursor, {
              MATCH: pattern,
              COUNT: options.scanCount ?? 100,
            })
          : await options.client.scan(
              cursor,
              'MATCH', pattern,
              'COUNT', options.scanCount ?? 100,
            )
        const next = Array.isArray(result) ? result[0] : result.cursor
        const keys = Array.isArray(result) ? result[1] : result.keys
        cursor = String(next)
        if (keys.length > 0) await options.client.del(keys)
      } while (cursor !== '0')
    },
    stats() {
      return { totalItems: 0, hits, misses }
    },
    async shutdown() {
      if (options.closeOnShutdown) await options.client.quit?.()
    },
  }
}
