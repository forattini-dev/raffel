import type { RedisLikeClient } from './types.js'
import type { CacheLayer, CacheRecord } from './tiered.js'

export interface RedisCacheLayerOptions {
  id: string
  client: RedisLikeClient
  ttlMs: number
  prefix?: string
  scanCount?: number
  closeOnShutdown?: boolean
}

/** Redis/Valkey layer that delegates capacity and eviction to the provider. */
export function createRedisCacheLayer(options: RedisCacheLayerOptions): CacheLayer {
  const prefix = options.prefix ?? 'raffel:cache:'
  const fullKey = (key: string) => prefix + key
  let hits = 0
  let misses = 0

  return {
    id: options.id,
    ttlMs: options.ttlMs,
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
      await options.client.set(
        fullKey(key),
        JSON.stringify(stored),
        'PX',
        ttlMs + staleMs,
      )
    },
    async delete(key) {
      await options.client.del(fullKey(key))
    },
    async clearNamespace(namespace) {
      if (!options.client.scan) return
      const pattern = `${prefix}${namespace}:*`
      let cursor = '0'
      do {
        const [next, keys] = await options.client.scan(
          cursor,
          'MATCH', pattern,
          'COUNT', options.scanCount ?? 100,
        )
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
