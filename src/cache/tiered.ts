import { ExpirationWheel } from './expiration-wheel.js'
import {
  WriteBehindQueue,
  type WriteBehindQueueOptions,
  type WriteBehindQueueStats,
} from './write-behind-queue.js'
import {
  DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
  DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
  DEFAULT_CACHE_READ_TIMEOUT_MS,
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

export function isCacheRecord(value: unknown): value is CacheRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<CacheRecord>
  return Number.isFinite(record.createdAt)
    && Number.isFinite(record.expiresAt)
    && Number.isFinite(record.version)
    && (record.staleUntil === undefined || Number.isFinite(record.staleUntil))
    && (record.sizeBytes === undefined || Number.isFinite(record.sizeBytes))
    && 'value' in record
}

export interface CacheLayer {
  readonly id: string
  /** Marks a layer whose operations are guaranteed not to return promises. */
  readonly synchronous?: boolean
  readonly ttlMs?: number
  readonly writeBehind?: WriteBehindQueueOptions
  readonly readTimeoutMs?: number
  readonly operationTimeoutMs?: number
  readonly circuitBreaker?: CacheCircuitBreakerOptions
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
  readFailures?: number
  circuitOpen?: boolean
  writeQueue?: WriteBehindQueueStats
  trackedKeys?: number
  fencedKeys?: number
}

export interface CacheCircuitBreakerOptions {
  failureThreshold?: number
  cooldownMs?: number
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
  /** Default async layer read deadline. Defaults to 250 ms. */
  readTimeoutMs?: number
  /** Default async layer mutation deadline. Defaults to 1 second. */
  operationTimeoutMs?: number
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

function isJsonSafe(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) {
    const keys = Object.keys(value)
    if (keys.length !== value.length) return false
    return keys.every((key, index) => key === String(index) && isJsonSafe(value[index], seen))
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const enumerableKeys = Object.keys(value)
  if (Reflect.ownKeys(value).length !== enumerableKeys.length) return false
  return enumerableKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return Boolean(descriptor && 'value' in descriptor && isJsonSafe(descriptor.value, seen))
  })
}

function logicalSize(value: unknown): number | undefined {
  try {
    if (!isJsonSafe(value)) return undefined
    const encoded = JSON.stringify(value)
    return encoded === undefined ? undefined : Buffer.byteLength(encoded)
  } catch {
    return undefined
  }
}

function isThenable<T>(value: MaybePromise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as PromiseLike<T>).then === 'function')
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
    synchronous: true,
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
  if (options.readTimeoutMs !== undefined && options.readTimeoutMs <= 0) {
    throw new Error('Tiered cache readTimeoutMs must be greater than zero')
  }
  if (options.operationTimeoutMs !== undefined && options.operationTimeoutMs <= 0) {
    throw new Error('Tiered cache operationTimeoutMs must be greater than zero')
  }
  for (const layer of options.layers) {
    if (layer.readTimeoutMs !== undefined && layer.readTimeoutMs <= 0) {
      throw new Error(`Cache layer "${layer.id}" readTimeoutMs must be greater than zero`)
    }
    if (layer.operationTimeoutMs !== undefined && layer.operationTimeoutMs <= 0) {
      throw new Error(`Cache layer "${layer.id}" operationTimeoutMs must be greater than zero`)
    }
  }
  const prefix = `${options.namespace}:`
  const layers = [...options.layers]
  const writeQueues = layers.slice(1).map((layer) =>
    new WriteBehindQueue({
      ...options.writeBehind,
      ...layer.writeBehind,
    })
  )
  let version = 0
  let namespaceEpoch = 0
  let clearInProgress: Promise<void> | undefined
  const keyEpochs = new Map<string, number>()
  const keyWriteVersions = new Map<string, number>()
  const keyActivity = new Map<string, number>()
  const deletions = new Map<string, Promise<void>>()
  const foregroundWrites = new Map<string, Promise<void>>()
  const readHealth = new Map<CacheLayer, { failures: number; openUntil: number }>()
  const layerFences = layers.map(() => ({
    namespace: 0,
    keys: new Map<string, number>(),
    failedNamespace: false,
    failedKeys: new Set<string>(),
  }))

  function keyHasFence(key: string): boolean {
    return layerFences.some((fence) => fence.keys.has(key) || fence.failedKeys.has(key))
  }

  function cleanupKeyState(key: string): void {
    if (
      keyActivity.has(key) || deletions.has(key) || foregroundWrites.has(key) ||
      keyHasFence(key)
    ) return
    keyEpochs.delete(key)
    keyWriteVersions.delete(key)
  }

  function retainKey(key: string): () => void {
    keyActivity.set(key, (keyActivity.get(key) ?? 0) + 1)
    let active = true
    return () => {
      if (!active) return
      active = false
      const count = (keyActivity.get(key) ?? 1) - 1
      if (count === 0) keyActivity.delete(key)
      else keyActivity.set(key, count)
      cleanupKeyState(key)
    }
  }

  function addLayerFence(index: number, key?: string): () => void {
    const fence = layerFences[index]!
    if (key === undefined) fence.namespace++
    else fence.keys.set(key, (fence.keys.get(key) ?? 0) + 1)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (key === undefined) {
        fence.namespace--
        return
      }
      const count = (fence.keys.get(key) ?? 1) - 1
      if (count === 0) fence.keys.delete(key)
      else fence.keys.set(key, count)
      cleanupKeyState(key)
    }
  }

  function isLayerFenced(index: number, key: string): boolean {
    const fence = layerFences[index]!
    return fence.namespace > 0 || fence.failedNamespace ||
      fence.keys.has(key) || fence.failedKeys.has(key)
  }

  function markLayerFailure(index: number, key?: string): void {
    const fence = layerFences[index]!
    if (key === undefined) fence.failedNamespace = true
    else {
      fence.failedKeys.add(key)
      cleanupKeyState(key)
    }
  }

  function clearLayerFailure(index: number, key?: string): void {
    const fence = layerFences[index]!
    if (key === undefined) fence.failedNamespace = false
    else {
      fence.failedKeys.delete(key)
      cleanupKeyState(key)
    }
  }

  async function withDeadline<T>(
    candidate: MaybePromise<T>,
    timeoutMs: number,
    message: string,
    onTimeout?: () => void,
    onLateSettlement?: (result: { ok: true; value: T } | { ok: false; error: unknown }) => MaybePromise<void>,
  ): Promise<T> {
    if (!isThenable(candidate)) return candidate
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    return new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        onTimeout?.()
        reject(new Error(message))
      }, timeoutMs)
      timer.unref()
      Promise.resolve(candidate).then(
        (value) => {
          if (!timedOut) {
            if (timer) clearTimeout(timer)
            resolve(value)
            return
          }
          void Promise.resolve(onLateSettlement?.({ ok: true, value })).catch(() => undefined)
        },
        (error: unknown) => {
          if (!timedOut) {
            if (timer) clearTimeout(timer)
            reject(error)
            return
          }
          void Promise.resolve(onLateSettlement?.({ ok: false, error })).catch(() => undefined)
        },
      )
    })
  }

  function trackForegroundWrite(key: string, task: () => Promise<void>): Promise<void> {
    const releaseKey = retainKey(key)
    const previous = foregroundWrites.get(key)
    const execution = Promise.resolve(previous).then(task)
    foregroundWrites.set(key, execution)
    return execution.finally(() => {
      if (foregroundWrites.get(key) === execution) foregroundWrites.delete(key)
      releaseKey()
    })
  }

  async function writeLayer(
    index: number,
    key: string,
    record: CacheRecord,
    ttlMs: number,
    staleMs: number,
    capturedNamespaceEpoch: number,
    capturedKeyEpoch: number,
    capturedWriteVersion: number | undefined,
  ): Promise<void> {
    if (isLayerFenced(index, key)) return
    const layer = layers[index]!
    let releaseFence: (() => void) | undefined
    const cleanupLateWrite = async (
      result: { ok: true; value: void } | { ok: false; error: unknown },
    ): Promise<void> => {
      if (!releaseFence) return
      const stillCurrent = result.ok &&
        namespaceEpoch === capturedNamespaceEpoch &&
        (keyEpochs.get(key) ?? 0) === capturedKeyEpoch &&
        keyWriteVersions.get(key) === capturedWriteVersion
      if (stillCurrent) {
        releaseFence()
        return
      }
      if (!result.ok) options.onLayerError?.(layer.id, 'set', result.error)
      try {
        await layer.delete(key)
        releaseFence()
        clearLayerFailure(index, key)
      } catch (error) {
        options.onLayerError?.(layer.id, 'delete', error)
        releaseFence()
        markLayerFailure(index, key)
      }
    }
    await withDeadline(
      layer.set(key, record, ttlMs, staleMs),
      layer.operationTimeoutMs ?? options.operationTimeoutMs ?? DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
      `Cache layer "${layer.id}" set timed out`,
      () => { releaseFence = addLayerFence(index, key) },
      cleanupLateWrite,
    )
  }

  async function deleteLayer(index: number, key: string): Promise<void> {
    const layer = layers[index]!
    let releaseFence: (() => void) | undefined
    try {
      await withDeadline(
        layer.delete(key),
        layer.operationTimeoutMs ?? options.operationTimeoutMs ?? DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
        `Cache layer "${layer.id}" delete timed out`,
        () => { releaseFence = addLayerFence(index, key) },
        (result) => {
          releaseFence?.()
          if (result.ok) clearLayerFailure(index, key)
          else {
            markLayerFailure(index, key)
            options.onLayerError?.(layer.id, 'delete', result.error)
          }
        },
      )
      clearLayerFailure(index, key)
    } catch (error) {
      if (!releaseFence) markLayerFailure(index, key)
      throw error
    }
  }

  async function clearLayer(index: number): Promise<void> {
    const layer = layers[index]!
    let releaseFence: (() => void) | undefined
    try {
      await withDeadline(
        layer.clearNamespace(options.namespace),
        layer.operationTimeoutMs ?? options.operationTimeoutMs ?? DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
        `Cache layer "${layer.id}" clear timed out`,
        () => { releaseFence = addLayerFence(index) },
        (result) => {
          releaseFence?.()
          if (result.ok) clearLayerFailure(index)
          else {
            markLayerFailure(index)
            options.onLayerError?.(layer.id, 'clear', result.error)
          }
        },
      )
      clearLayerFailure(index)
    } catch (error) {
      if (!releaseFence) markLayerFailure(index)
      throw error
    }
  }

  function guardedRead(layer: CacheLayer, key: string): MaybePromise<CacheRecord | undefined> {
    const health = readHealth.get(layer) ?? { failures: 0, openUntil: 0 }
    readHealth.set(layer, health)
    if (health.openUntil > Date.now()) {
      throw new Error(`Cache layer "${layer.id}" circuit is open`)
    }
    const markSuccess = (result: CacheRecord | undefined): CacheRecord | undefined => {
      health.failures = 0
      health.openUntil = 0
      return result
    }
    const markFailure = (error: unknown): never => {
      health.failures++
      const threshold = layer.circuitBreaker?.failureThreshold ??
        DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD
      if (health.failures >= threshold) {
        health.openUntil = Date.now() + (
          layer.circuitBreaker?.cooldownMs ?? DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS
        )
      }
      throw error
    }
    try {
      const candidate = layer.get(key)
      if (!isThenable(candidate)) return markSuccess(candidate)
      return withDeadline(
        candidate,
        layer.readTimeoutMs ?? options.readTimeoutMs ?? DEFAULT_CACHE_READ_TIMEOUT_MS,
        `Cache layer "${layer.id}" read timed out`,
      )
        .then(markSuccess, markFailure)
    } catch (error) {
      return markFailure(error)
    }
  }

  return {
    async get<T>(key: string) {
      const namespacedKey = prefix + key
      let releaseKey: (() => void) | undefined
      const ensureRetained = () => {
        releaseKey ??= retainKey(namespacedKey)
      }
      try {
        if (clearInProgress) await clearInProgress.catch(() => undefined)
        const deletion = deletions.get(namespacedKey)
        if (deletion) await deletion.catch(() => undefined)
        const capturedNamespaceEpoch = namespaceEpoch
        const capturedKeyEpoch = keyEpochs.get(namespacedKey) ?? 0
        const capturedWriteVersion = keyWriteVersions.get(namespacedKey)
        const readIsCurrent = () =>
          namespaceEpoch === capturedNamespaceEpoch &&
          (keyEpochs.get(namespacedKey) ?? 0) === capturedKeyEpoch &&
          keyWriteVersions.get(namespacedKey) === capturedWriteVersion
        let staleHit: CacheLookup<T> | undefined
        for (let index = 0; index < layers.length; index++) {
          const layer = layers[index]!
          if (isLayerFenced(index, namespacedKey)) continue
          let record: CacheRecord | undefined
          try {
            if (layer.synchronous) {
              record = layer.get(namespacedKey) as CacheRecord | undefined
            } else {
              ensureRetained()
              const candidate = guardedRead(layer, namespacedKey)
              record = isThenable(candidate) ? await candidate : candidate
            }
          } catch (error) {
            options.onLayerError?.(layer.id, 'get', error)
            continue
          }
          if (!readIsCurrent()) return undefined
          if (!record) continue
          const now = Date.now()
          if (now >= (record.staleUntil ?? record.expiresAt)) {
            ensureRetained()
            try {
              await deleteLayer(index, namespacedKey)
            } catch (error) {
              options.onLayerError?.(layer.id, 'delete', error)
            }
            continue
          }
          const stale = now >= record.expiresAt && now < (record.staleUntil ?? record.expiresAt)
          if (stale) {
            staleHit ??= { value: record.value as T, layer: layer.id, stale: true }
            continue
          }
          if (index > 0) {
            await Promise.all(layers.slice(0, index).map(async (upper, upperIndex) => {
              await trackForegroundWrite(namespacedKey, async () => {
                if (!readIsCurrent()) return
                try {
                  await writeLayer(
                    upperIndex,
                    namespacedKey,
                    record,
                    upper.ttlMs ?? 60_000,
                    0,
                    capturedNamespaceEpoch,
                    capturedKeyEpoch,
                    capturedWriteVersion,
                  )
                } catch (error) {
                  options.onLayerError?.(upper.id, 'set', error)
                }
              })
            }))
          }
          if (!readIsCurrent()) return undefined
          return { value: record.value as T, layer: layer.id, stale: false }
        }
        return readIsCurrent() ? staleHit : undefined
      } finally {
        releaseKey?.()
      }
    },
    async set(key, value, writeOptions = {}) {
      if (clearInProgress) await clearInProgress.catch(() => undefined)
      const namespacedKey = prefix + key
      const deletion = deletions.get(namespacedKey)
      if (deletion) await deletion.catch(() => undefined)
      const releaseKey = retainKey(namespacedKey)
      try {
      const capturedNamespaceEpoch = namespaceEpoch
      const capturedKeyEpoch = keyEpochs.get(namespacedKey) ?? 0
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
      keyWriteVersions.set(namespacedKey, record.version)
      const first = layers[0]
      if (first) {
        await trackForegroundWrite(namespacedKey, async () => {
          try {
            await writeLayer(
              0,
              namespacedKey,
              record,
              layerDuration(writeOptions.ttlMs, first, first.ttlMs ?? 60_000),
              layerDuration(writeOptions.staleMs, first, 0),
              capturedNamespaceEpoch,
              capturedKeyEpoch,
              record.version,
            )
          } catch (error) {
            options.onLayerError?.(first.id, 'set', error)
          }
        })
      }
      for (let index = 1; index < layers.length; index++) {
        const layer = layers[index]!
        const releaseQueuedKey = retainKey(namespacedKey)
        writeQueues[index - 1]!.enqueue(namespacedKey, async () => {
          if (
            namespaceEpoch !== capturedNamespaceEpoch ||
            (keyEpochs.get(namespacedKey) ?? 0) !== capturedKeyEpoch ||
            keyWriteVersions.get(namespacedKey) !== record.version
          ) return
          try {
            await writeLayer(
              index,
              namespacedKey,
              record,
              layerDuration(writeOptions.ttlMs, layer, layer.ttlMs ?? 60_000),
              layerDuration(writeOptions.staleMs, layer, 0),
              capturedNamespaceEpoch,
              capturedKeyEpoch,
              record.version,
            )
          } catch (error) {
            options.onLayerError?.(layer.id, 'set', error)
          }
        }, releaseQueuedKey)
      }
      } finally {
        releaseKey()
      }
    },
    async delete(key) {
      if (clearInProgress) await clearInProgress.catch(() => undefined)
      const namespacedKey = prefix + key
      const existing = deletions.get(namespacedKey)
      if (existing) return existing
      const releaseKey = retainKey(namespacedKey)
      keyEpochs.set(namespacedKey, (keyEpochs.get(namespacedKey) ?? 0) + 1)
      keyWriteVersions.delete(namespacedKey)
      const operation = (async () => {
        const errors: unknown[] = []
        await foregroundWrites.get(namespacedKey)
        try {
          await deleteLayer(0, namespacedKey)
        } catch (error) {
          options.onLayerError?.(layers[0]!.id, 'delete', error)
          errors.push(error)
        }
        await Promise.all(layers.slice(1).map((layer, index) =>
          writeQueues[index]!.enqueueBarrier(namespacedKey, async () => {
            try {
              await deleteLayer(index + 1, namespacedKey)
            } catch (error) {
              options.onLayerError?.(layer.id, 'delete', error)
              errors.push(error)
            }
          })
        ))
        if (errors.length > 0) {
          throw new AggregateError(errors, `Cache key invalidation failed for ${errors.length} layer(s)`)
        }
      })()
      deletions.set(namespacedKey, operation)
      try {
        await operation
      } finally {
        if (deletions.get(namespacedKey) === operation) {
          deletions.delete(namespacedKey)
        }
        releaseKey()
      }
    },
    async clearNamespace() {
      if (clearInProgress) return clearInProgress
      namespaceEpoch++
      keyEpochs.clear()
      keyWriteVersions.clear()
      const operation = (async () => {
        const errors: unknown[] = []
        for (const result of await Promise.allSettled(deletions.values())) {
          if (result.status === 'rejected') errors.push(result.reason)
        }
        await Promise.all(foregroundWrites.values())
        try {
          await clearLayer(0)
        } catch (error) {
          options.onLayerError?.(layers[0]!.id, 'clear', error)
          errors.push(error)
        }
        await Promise.all(layers.slice(1).map(async (layer, index) => {
          await writeQueues[index]!.drain()
          try {
            await clearLayer(index + 1)
          } catch (error) {
            options.onLayerError?.(layer.id, 'clear', error)
            errors.push(error)
          }
        }))
        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            `Cache namespace invalidation failed for ${errors.length} operation(s)`,
          )
        }
      })()
      clearInProgress = operation
      try {
        await operation
      } finally {
        if (clearInProgress === operation) clearInProgress = undefined
      }
    },
    stats() {
      return layers.map((layer, index) => {
        const health = readHealth.get(layer)
        return {
          id: layer.id,
          totalItems: 0,
          ...layer.stats?.(),
          ...(health ? {
            readFailures: health.failures,
            circuitOpen: health.openUntil > Date.now(),
          } : {}),
          ...(index === 0 ? {
            trackedKeys: new Set([
              ...keyActivity.keys(),
              ...keyEpochs.keys(),
              ...keyWriteVersions.keys(),
            ]).size,
          } : {}),
          fencedKeys: layerFences[index]!.keys.size + layerFences[index]!.failedKeys.size,
          ...(index > 0 ? { writeQueue: writeQueues[index - 1]!.stats() } : {}),
        }
      })
    },
    async shutdown() {
      await Promise.all(writeQueues.map((queue) => queue.flush()))
      await Promise.all(
        layers.map(async (layer) => {
          try {
            const candidate = layer.shutdown?.()
            if (candidate !== undefined) {
              await withDeadline(
                candidate,
                layer.operationTimeoutMs ?? options.operationTimeoutMs ??
                  DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
                `Cache layer "${layer.id}" shutdown timed out`,
              )
            }
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
  DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
  DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
  DEFAULT_CACHE_READ_TIMEOUT_MS,
  DEFAULT_L1_MAX_ENTRIES,
  DEFAULT_L1_MAX_MEMORY_BYTES,
  DEFAULT_L2_MAX_FILES,
  DEFAULT_L2_MAX_SIZE_BYTES,
} from './defaults.js'
