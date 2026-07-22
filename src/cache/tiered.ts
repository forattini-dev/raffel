import { ExpirationWheel } from './expiration-wheel.js'
import { WriteBehindQueue, type WriteBehindQueueOptions } from './write-behind-queue.js'
import {
  DEFAULT_L1_MAX_ENTRIES,
  DEFAULT_L1_MAX_MEMORY_BYTES,
} from './defaults.js'

export type MaybePromise<T> = T | Promise<T>

export interface CacheRecord<T = unknown> {
  value: T
  sizeBytes?: number
  createdAt: number
  expiresAt: number
  staleUntil?: number
  version: number
}

export interface CacheLayer {
  readonly id: string
  readonly ttlMs?: number
  readonly writeBehind?: WriteBehindQueueOptions
  get(key: string): MaybePromise<CacheRecord | undefined>
  set(key: string, record: CacheRecord, ttlMs: number, staleMs?: number): MaybePromise<void>
  delete(key: string): MaybePromise<void>
  clearNamespace(namespace: string): MaybePromise<void>
  stats?(): CacheLayerStats
  shutdown?(): MaybePromise<void>
}

export interface CacheLayerStats {
  totalItems: number
  memoryUsageBytes?: number
  storageUsageBytes?: number
  hits?: number
  misses?: number
}

export interface CacheLookup<T = unknown> {
  value: T
  layer: string
  stale: boolean
}

export interface MemoryCacheLayerOptions {
  id: string
  ttlMs: number
  maxEntries?: number
  maxMemoryBytes?: number
  expirationResolutionMs?: number
  eviction?: 'lru' | 'fifo'
}

export interface TieredCacheOptions {
  namespace: string
  layers: CacheLayer[]
  writeBehind?: WriteBehindQueueOptions
  onLayerError?: (
    layer: string,
    operation: 'get' | 'set' | 'delete' | 'clear' | 'shutdown',
    error: unknown,
  ) => void
}

export interface TieredCache {
  get<T = unknown>(key: string): Promise<CacheLookup<T> | undefined>
  set(key: string, value: unknown, options?: CacheWriteOptions): Promise<void>
  delete(key: string): Promise<void>
  clearNamespace(): Promise<void>
  stats(): ReadonlyArray<CacheLayerStats & { id: string }>
  shutdown(): Promise<void>
}

export interface CacheWriteOptions {
  ttlMs?: number | Readonly<Record<string, number>>
  staleMs?: number | Readonly<Record<string, number>>
}

function layerDuration(
  configured: CacheWriteOptions[keyof CacheWriteOptions],
  layer: CacheLayer,
  fallback: number
): number {
  if (typeof configured === 'number') return configured
  return configured?.[layer.id] ?? fallback
}

function logicalSize(value: unknown): number | undefined {
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? undefined : Buffer.byteLength(encoded)
  } catch {
    return undefined
  }
}

export function createMemoryCacheLayer(options: MemoryCacheLayerOptions): CacheLayer {
  if (options.ttlMs <= 0) throw new Error('Memory cache ttlMs must be greater than zero')
  if (options.maxEntries !== undefined && options.maxEntries <= 0) {
    throw new Error('Memory cache maxEntries must be greater than zero')
  }
  if (options.maxMemoryBytes !== undefined && options.maxMemoryBytes <= 0) {
    throw new Error('Memory cache maxMemoryBytes must be greater than zero')
  }
  if (options.expirationResolutionMs !== undefined && options.expirationResolutionMs <= 0) {
    throw new Error('Memory cache expirationResolutionMs must be greater than zero')
  }
  const entries = new Map<string, CacheRecord>()
  const maxEntries = options.maxEntries ?? DEFAULT_L1_MAX_ENTRIES
  const maxMemoryBytes = options.maxMemoryBytes ?? DEFAULT_L1_MAX_MEMORY_BYTES
  let currentMemoryBytes = 0
  let hits = 0
  let misses = 0
  const wheel = new ExpirationWheel(
    options.expirationResolutionMs ?? 1_000,
    (key, scheduledVersion) => {
      if (entries.get(key)?.version === scheduledVersion) remove(key)
    }
  )

  function remove(key: string): void {
    const record = entries.get(key)
    if (record) currentMemoryBytes -= record.sizeBytes ?? 0
    entries.delete(key)
    wheel.cancel(key)
  }

  function evictUntilFits(incomingBytes: number): boolean {
    if (incomingBytes > maxMemoryBytes) return false
    while (
      currentMemoryBytes + incomingBytes > maxMemoryBytes ||
      entries.size >= maxEntries
    ) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      remove(oldest)
    }
    return currentMemoryBytes + incomingBytes <= maxMemoryBytes
  }

  return {
    id: options.id,
    ttlMs: options.ttlMs,
    get(key) {
      const record = entries.get(key)
      if (!record) {
        misses++
        return undefined
      }
      if (Date.now() >= (record.staleUntil ?? record.expiresAt)) {
        remove(key)
        misses++
        return undefined
      }
      if (options.eviction !== 'fifo') {
        entries.delete(key)
        entries.set(key, record)
      }
      hits++
      return record
    },
    set(key, record, ttlMs, staleMs = 0) {
      const sizeBytes = record.sizeBytes ?? logicalSize(record.value)
      if (sizeBytes === undefined) return
      remove(key)
      if (!evictUntilFits(sizeBytes)) return
      const expiresAt = Date.now() + ttlMs
      const stored = {
        ...record,
        sizeBytes,
        expiresAt,
        staleUntil: staleMs > 0 ? expiresAt + staleMs : undefined,
      }
      entries.set(key, stored)
      currentMemoryBytes += sizeBytes
      wheel.schedule(key, stored.staleUntil ?? stored.expiresAt, stored.version)
    },
    delete(key) {
      remove(key)
    },
    clearNamespace(namespace) {
      for (const key of entries.keys()) {
        if (key.startsWith(`${namespace}:`)) remove(key)
      }
    },
    stats() {
      return { totalItems: entries.size, memoryUsageBytes: currentMemoryBytes, hits, misses }
    },
    shutdown() {
      wheel.shutdown()
    },
  }
}

export function createTieredCache(options: TieredCacheOptions): TieredCache {
  if (options.layers.length === 0) throw new Error('Tiered cache requires at least one layer')
  const prefix = `${options.namespace}:`
  const layers = [...options.layers]
  const writeQueues = layers.slice(1).map((layer) =>
    new WriteBehindQueue({
      ...options.writeBehind,
      ...layer.writeBehind,
    })
  )
  let version = 0

  return {
    async get<T>(key: string) {
      const namespacedKey = prefix + key
      for (let index = 0; index < layers.length; index++) {
        const layer = layers[index]!
        let record: CacheRecord | undefined
        try {
          record = await layer.get(namespacedKey)
        } catch (error) {
          options.onLayerError?.(layer.id, 'get', error)
          continue
        }
        if (!record) continue
        const now = Date.now()
        const stale = now >= record.expiresAt && now < (record.staleUntil ?? record.expiresAt)
        if (index > 0 && !stale) {
          await Promise.allSettled(
            layers
              .slice(0, index)
              .map((upper) => upper.set(namespacedKey, record, upper.ttlMs ?? 60_000))
          )
        }
        return { value: record.value as T, layer: layer.id, stale }
      }
      return undefined
    },
    async set(key, value, writeOptions = {}) {
      const now = Date.now()
      const sizeBytes = logicalSize(value)
      if (sizeBytes === undefined) return
      const record: CacheRecord = {
        value,
        sizeBytes,
        createdAt: now,
        expiresAt: now,
        version: ++version,
      }
      const namespacedKey = prefix + key
      const first = layers[0]
      if (first) {
        try {
          await first.set(
            namespacedKey,
            record,
            layerDuration(writeOptions.ttlMs, first, first.ttlMs ?? 60_000),
            layerDuration(writeOptions.staleMs, first, 0)
          )
        } catch (error) {
          options.onLayerError?.(first.id, 'set', error)
        }
      }
      for (let index = 1; index < layers.length; index++) {
        const layer = layers[index]!
        writeQueues[index - 1]!.enqueue(namespacedKey, async () => {
          try {
            await layer.set(
              namespacedKey,
              record,
              layerDuration(writeOptions.ttlMs, layer, layer.ttlMs ?? 60_000),
              layerDuration(writeOptions.staleMs, layer, 0)
            )
          } catch (error) {
            options.onLayerError?.(layer.id, 'set', error)
          }
        })
      }
    },
    async delete(key) {
      await Promise.all(
        layers.map(async (layer) => {
          try {
            await layer.delete(prefix + key)
          } catch (error) {
            options.onLayerError?.(layer.id, 'delete', error)
          }
        })
      )
    },
    async clearNamespace() {
      await Promise.all(
        layers.map(async (layer) => {
          try {
            await layer.clearNamespace(options.namespace)
          } catch (error) {
            options.onLayerError?.(layer.id, 'clear', error)
          }
        })
      )
    },
    stats() {
      return layers.map((layer) => ({ id: layer.id, totalItems: 0, ...layer.stats?.() }))
    },
    async shutdown() {
      await Promise.all(writeQueues.map((queue) => queue.flush()))
      await Promise.all(
        layers.map(async (layer) => {
          try {
            await layer.shutdown?.()
          } catch (error) {
            options.onLayerError?.(layer.id, 'shutdown', error)
          }
        })
      )
    },
  }
}

export { createFileSystemCacheLayer } from './fs-layer.js'
export type { FileSystemCacheLayerOptions } from './fs-layer.js'
export {
  DEFAULT_L1_MAX_ENTRIES,
  DEFAULT_L1_MAX_MEMORY_BYTES,
  DEFAULT_L2_MAX_FILES,
  DEFAULT_L2_MAX_SIZE_BYTES,
} from './defaults.js'
