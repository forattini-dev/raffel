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
  tags?: readonly string[]
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
    && (record.tags === undefined || (
      Array.isArray(record.tags) && record.tags.every((tag) => typeof tag === 'string')
    ))
    && 'value' in record
}

export interface CacheLayerInvalidationResult {
  mode: 'physical' | 'logical'
  deleted?: number
  generation?: number
}

export interface CacheInvalidationResult {
  mode: 'physical' | 'logical' | 'mixed'
  deleted?: number
  layers: Readonly<Record<string, CacheLayerInvalidationResult>>
}

export interface CacheLayerCapabilities {
  distributedFillFencing?: boolean
  prefixInvalidation?: 'logical' | 'indexed' | 'scan' | false
  tagInvalidation?: 'logical' | 'indexed' | 'scan' | false
}

export interface CacheLayer {
  readonly id: string
  readonly capabilities?: CacheLayerCapabilities
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
  beginFill?(key: string, namespace: string): MaybePromise<unknown>
  isFillCurrent?(token: unknown, namespace: string): MaybePromise<boolean>
  commitFill?(
    key: string,
    record: CacheRecord,
    ttlMs: number,
    staleMs: number,
    token: unknown,
    namespace: string,
  ): MaybePromise<boolean>
  bumpGeneration?(namespace: string): MaybePromise<void>
  invalidateTag?(
    tag: string,
    namespace: string,
  ): MaybePromise<CacheLayerInvalidationResult>
  invalidatePrefix?(
    prefix: string,
    namespace: string,
  ): MaybePromise<CacheLayerInvalidationResult>
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

/** Opaque generation snapshot captured before computing a cache value. */
export interface CacheFillTicket {
  readonly key: string
  readonly ready: Promise<void>
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
    operation: 'get' | 'set' | 'delete' | 'clear' | 'beginFill' | 'commitFill' |
      'invalidateTag' | 'invalidatePrefix' | 'shutdown',
    error: unknown,
  ) => void
}

export interface TieredCacheAccess {
  get<T = unknown>(key: string): Promise<CacheLookup<T> | undefined>
  set(key: string, value: unknown, options?: CacheWriteOptions): Promise<void>
  beginFill(key: string): CacheFillTicket
  isFillCurrent(ticket: CacheFillTicket): Promise<boolean>
  commitFill(
    ticket: CacheFillTicket,
    value: unknown,
    options?: CacheWriteOptions,
  ): Promise<boolean>
  cancelFill(ticket: CacheFillTicket): void
}

export interface TieredCache extends TieredCacheAccess {
  /** Compile a hot-path view over an ordered subset of configured layers. */
  selectLayers(layerIds: readonly string[]): TieredCacheAccess
  delete(key: string): Promise<void>
  invalidateTag(tag: string): Promise<CacheInvalidationResult>
  invalidatePrefix(prefix: string): Promise<CacheInvalidationResult>
  clearNamespace(): Promise<void>
  stats(): ReadonlyArray<CacheLayerStats & { id: string }>
  shutdown(): Promise<void>
}

export interface CacheWriteOptions {
  ttlMs?: number | Readonly<Record<string, number>>
  staleMs?: number | Readonly<Record<string, number>>
  tags?: readonly string[]
}

/** Encode and frame a logical namespace for collision-free physical key prefixes. */
export function cacheNamespacePrefix(namespace: string): string {
  if (!namespace) throw new Error('Cache namespace cannot be empty')
  try {
    return `${encodeURIComponent(namespace)}:`
  } catch {
    throw new Error('Cache namespace must contain valid Unicode')
  }
}

function layerDuration(
  configured: CacheWriteOptions['ttlMs'] | CacheWriteOptions['staleMs'],
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

async function cacheValueSize(value: unknown): Promise<number | undefined> {
  if (!(value instanceof Response)) return logicalSize(value)
  // Response bodies are not JSON-serializable, so logicalSize() would reject
  // them. Prefer the declared content-length; fall back to buffering a clone.
  const contentLength = value.headers.get('content-length')
  if (contentLength !== null) {
    const declared = Number(contentLength)
    if (Number.isSafeInteger(declared) && declared >= 0) return declared
  }
  try {
    return (await value.clone().arrayBuffer()).byteLength
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
  const entrySizes = new Map<string, number>()
  const tagIndex = new Map<string, Set<string>>()
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
    if (record) {
      currentMemoryBytes -= entrySizes.get(key) ?? 0
      for (const tag of record.tags ?? []) {
        const keys = tagIndex.get(tag)
        keys?.delete(key)
        if (keys?.size === 0) tagIndex.delete(tag)
      }
    }
    entries.delete(key)
    entrySizes.delete(key)
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
    capabilities: {
      prefixInvalidation: 'scan',
      tagInvalidation: 'indexed',
    },
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
      const valueSizeBytes = record.sizeBytes ?? logicalSize(record.value)
      if (valueSizeBytes === undefined) return
      const tags = [...new Set(
        (record.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      )]
      const sizeBytes = valueSizeBytes + tags.reduce(
        (total, tag) => total + Buffer.byteLength(tag) + 16,
        0,
      )
      remove(key)
      if (!evictUntilFits(sizeBytes)) return
      const expiresAt = Date.now() + ttlMs
      const stored = {
        ...record,
        sizeBytes: valueSizeBytes,
        tags: tags.length > 0 ? tags : undefined,
        expiresAt,
        staleUntil: staleMs > 0 ? expiresAt + staleMs : undefined,
      }
      entries.set(key, stored)
      entrySizes.set(key, sizeBytes)
      for (const tag of stored.tags ?? []) {
        let keys = tagIndex.get(tag)
        if (!keys) {
          keys = new Set()
          tagIndex.set(tag, keys)
        }
        keys.add(key)
      }
      currentMemoryBytes += sizeBytes
      wheel.schedule(key, stored.staleUntil ?? stored.expiresAt, stored.version)
    },
    delete(key) {
      remove(key)
    },
    clearNamespace(namespace) {
      const prefix = cacheNamespacePrefix(namespace)
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) remove(key)
      }
    },
    invalidateTag(tag, namespace) {
      const prefix = cacheNamespacePrefix(namespace)
      const keys = [...(tagIndex.get(tag) ?? [])]
        .filter((key) => key.startsWith(prefix))
      for (const key of keys) remove(key)
      return { mode: 'physical', deleted: keys.length }
    },
    invalidatePrefix(logicalPrefix, namespace) {
      const prefix = cacheNamespacePrefix(namespace) + logicalPrefix
      const keys = [...entries.keys()].filter((key) => key.startsWith(prefix))
      for (const key of keys) remove(key)
      return { mode: 'physical', deleted: keys.length }
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
  const configuredLayerIds = new Set<string>()
  for (const layer of options.layers) {
    if (configuredLayerIds.has(layer.id)) {
      throw new Error(`Cache layer id "${layer.id}" is duplicated`)
    }
    configuredLayerIds.add(layer.id)
    if (layer.readTimeoutMs !== undefined && layer.readTimeoutMs <= 0) {
      throw new Error(`Cache layer "${layer.id}" readTimeoutMs must be greater than zero`)
    }
    if (layer.operationTimeoutMs !== undefined && layer.operationTimeoutMs <= 0) {
      throw new Error(`Cache layer "${layer.id}" operationTimeoutMs must be greater than zero`)
    }
    if (
      layer.capabilities?.distributedFillFencing &&
      !(layer.beginFill && layer.isFillCurrent && layer.commitFill && layer.bumpGeneration)
    ) {
      throw new Error(
        `Cache layer "${layer.id}" distributed fill fencing contract is incomplete`,
      )
    }
  }
  const prefix = cacheNamespacePrefix(options.namespace)
  const layers = [...options.layers]
  const writeQueues = layers.map((layer) =>
    new WriteBehindQueue({
      ...options.writeBehind,
      ...layer.writeBehind,
    })
  )
  const allLayerIndexes = layers.map((_layer, index) => index)
  const layerIndexes = new Map(layers.map((layer, index) => [layer.id, index]))
  const ticketOwner = {}
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

  function runOrderedWrite(
    index: number,
    key: string,
    task: () => Promise<void>,
  ): Promise<void> {
    return layers[index]!.synchronous
      ? trackForegroundWrite(key, task)
      : writeQueues[index]!.enqueueBarrier(key, task)
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

  async function commitLayerFill(
    index: number,
    key: string,
    record: CacheRecord,
    ttlMs: number,
    staleMs: number,
    token: unknown,
  ): Promise<boolean> {
    const layer = layers[index]!
    if (isLayerFenced(index, key)) return false
    return withDeadline(
      layer.commitFill!(key, record, ttlMs, staleMs, token, options.namespace),
      layer.operationTimeoutMs ?? options.operationTimeoutMs ?? DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
      `Cache layer "${layer.id}" fill commit timed out`,
    )
  }

  function usesDistributedFillFencing(layer: CacheLayer): boolean {
    return Boolean(
      layer.capabilities?.distributedFillFencing &&
      layer.beginFill &&
      layer.isFillCurrent &&
      layer.commitFill &&
      layer.bumpGeneration
    )
  }

  async function bumpLayerGenerations(
    operation: 'delete' | 'clear' | 'invalidateTag' | 'invalidatePrefix',
  ): Promise<void> {
    await Promise.all(layers.map(async (layer, index) => {
      if (!usesDistributedFillFencing(layer)) return
      try {
        await withDeadline(
          layer.bumpGeneration!(options.namespace),
          layer.operationTimeoutMs ?? options.operationTimeoutMs ??
            DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
          `Cache layer "${layer.id}" generation update timed out`,
        )
      } catch (error) {
        markLayerFailure(index)
        options.onLayerError?.(layer.id, operation, error)
        throw error
      }
    }))
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

  async function invalidateLayerTag(
    index: number,
    tag: string,
  ): Promise<CacheLayerInvalidationResult> {
    const layer = layers[index]!
    if (!layer.invalidateTag) {
      throw new Error(`Cache layer "${layer.id}" does not support tag invalidation`)
    }
    return withDeadline(
      layer.invalidateTag(tag, options.namespace),
      layer.operationTimeoutMs ?? options.operationTimeoutMs ??
        DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
      `Cache layer "${layer.id}" tag invalidation timed out`,
    )
  }

  async function invalidateLayerPrefix(
    index: number,
    logicalPrefix: string,
  ): Promise<CacheLayerInvalidationResult> {
    const layer = layers[index]!
    if (!layer.invalidatePrefix) {
      throw new Error(`Cache layer "${layer.id}" does not support prefix invalidation`)
    }
    return withDeadline(
      layer.invalidatePrefix(logicalPrefix, options.namespace),
      layer.operationTimeoutMs ?? options.operationTimeoutMs ??
        DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
      `Cache layer "${layer.id}" prefix invalidation timed out`,
    )
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

  async function getFrom<T>(
    key: string,
    selectedIndexes: readonly number[],
  ): Promise<CacheLookup<T> | undefined> {
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
        for (let position = 0; position < selectedIndexes.length; position++) {
          const index = selectedIndexes[position]!
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
          if (position > 0) {
            await Promise.all(selectedIndexes.slice(0, position).map(async (upperIndex) => {
              const upper = layers[upperIndex]!
              await runOrderedWrite(upperIndex, namespacedKey, async () => {
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
  }

  async function setTo(
    key: string,
    value: unknown,
    writeOptions: CacheWriteOptions,
    selectedIndexes: readonly number[],
    fillTicket?: InternalFillTicket,
  ): Promise<boolean> {
      if (clearInProgress) await clearInProgress.catch(() => undefined)
      const namespacedKey = prefix + key
      const deletion = deletions.get(namespacedKey)
      if (deletion) await deletion.catch(() => undefined)
      const releaseKey = retainKey(namespacedKey)
      try {
      const capturedNamespaceEpoch = namespaceEpoch
      const capturedKeyEpoch = keyEpochs.get(namespacedKey) ?? 0
      const now = Date.now()
      const sizeBytes = await cacheValueSize(value)
      if (sizeBytes === undefined) return false
      const tags = [...new Set(
        (writeOptions.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      )]
      const record: CacheRecord = {
        value,
        tags: tags.length > 0 ? tags : undefined,
        sizeBytes,
        createdAt: now,
        expiresAt: now,
        version: ++version,
      }
      let allAccepted = true
      keyWriteVersions.set(namespacedKey, record.version)
      const fencedIndexes = fillTicket
        ? selectedIndexes.filter((index) => usesDistributedFillFencing(layers[index]!))
        : []
      for (const index of fencedIndexes) {
        const layer = layers[index]!
        const releaseQueuedKey = retainKey(namespacedKey)
        const write = async () => {
          try {
            const ttlMs = layerDuration(writeOptions.ttlMs, layer, layer.ttlMs ?? 60_000)
            const staleMs = layerDuration(writeOptions.staleMs, layer, 0)
            if (!fillTicket!.layerTokens.has(index)) {
              allAccepted = false
              return
            }
            allAccepted = await commitLayerFill(
              index,
              namespacedKey,
              record,
              ttlMs,
              staleMs,
              fillTicket!.layerTokens.get(index),
            )
          } catch (error) {
            options.onLayerError?.(layer.id, 'commitFill', error)
            allAccepted = false
          }
        }
        try {
          await writeQueues[index]!.enqueueBarrier(namespacedKey, write)
        } finally {
          releaseQueuedKey()
        }
        if (!allAccepted) return false
      }
      if (
        namespaceEpoch !== capturedNamespaceEpoch ||
        (keyEpochs.get(namespacedKey) ?? 0) !== capturedKeyEpoch ||
        keyWriteVersions.get(namespacedKey) !== record.version
      ) return false

      for (const [position, index] of selectedIndexes.entries()) {
        const layer = layers[index]!
        if (fencedIndexes.includes(index)) continue
        const write = async () => {
          if (
            namespaceEpoch !== capturedNamespaceEpoch ||
            (keyEpochs.get(namespacedKey) ?? 0) !== capturedKeyEpoch ||
            keyWriteVersions.get(namespacedKey) !== record.version
          ) return
          try {
            const ttlMs = layerDuration(writeOptions.ttlMs, layer, layer.ttlMs ?? 60_000)
            const staleMs = layerDuration(writeOptions.staleMs, layer, 0)
            await writeLayer(
                index,
                namespacedKey,
                record,
                ttlMs,
                staleMs,
                capturedNamespaceEpoch,
                capturedKeyEpoch,
                record.version,
            )
          } catch (error) {
            options.onLayerError?.(layer.id, 'set', error)
          }
        }
        if (position === 0) {
          await runOrderedWrite(index, namespacedKey, write)
        } else {
          const releaseQueuedKey = retainKey(namespacedKey)
          writeQueues[index]!.enqueue(namespacedKey, write, releaseQueuedKey)
        }
      }
      return allAccepted
      } finally {
        releaseKey()
      }
  }

  interface InternalFillTicket extends CacheFillTicket {
    owner: object
    namespacedKey: string
    namespaceEpoch: number
    keyEpoch: number
    selectedIndexes: readonly number[]
    layerTokens: Map<number, unknown>
    captureFailed: boolean
    release: () => void
    finished: boolean
    ready: Promise<void>
  }

  function beginFillFor(
    key: string,
    selectedIndexes: readonly number[],
  ): CacheFillTicket {
    const namespacedKey = prefix + key
    const ticket = {
      owner: ticketOwner,
      key,
      namespacedKey,
      namespaceEpoch,
      keyEpoch: keyEpochs.get(namespacedKey) ?? 0,
      selectedIndexes,
      layerTokens: new Map<number, unknown>(),
      captureFailed: false as boolean,
      release: retainKey(namespacedKey),
      finished: false,
      ready: Promise.resolve(),
    } satisfies InternalFillTicket
    ticket.ready = Promise.all(selectedIndexes.map(async (index) => {
      const layer = layers[index]!
      if (!usesDistributedFillFencing(layer)) return
      try {
        const token = await withDeadline(
          layer.beginFill!(namespacedKey, options.namespace),
          layer.operationTimeoutMs ?? options.operationTimeoutMs ??
            DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
          `Cache layer "${layer.id}" fill capture timed out`,
        )
        ticket.layerTokens.set(index, token)
      } catch (error) {
        ticket.captureFailed = true
        options.onLayerError?.(layer.id, 'beginFill', error)
      }
    })).then(() => undefined)
    return ticket
  }

  function finishFill(ticket: CacheFillTicket): InternalFillTicket {
    const internal = ticket as InternalFillTicket
    if (internal.owner !== ticketOwner) {
      throw new Error('Cache fill ticket belongs to a different cache')
    }
    if (!internal.finished) {
      internal.finished = true
      internal.release()
    }
    return internal
  }

  function isLocallyCurrent(internal: InternalFillTicket): boolean {
    return !internal.finished && !internal.captureFailed &&
      namespaceEpoch === internal.namespaceEpoch &&
      (keyEpochs.get(internal.namespacedKey) ?? 0) === internal.keyEpoch
  }

  async function isFillCurrent(ticket: CacheFillTicket): Promise<boolean> {
    const internal = ticket as InternalFillTicket
    if (internal.owner !== ticketOwner) {
      throw new Error('Cache fill ticket belongs to a different cache')
    }
    await internal.ready
    if (!isLocallyCurrent(internal)) return false
    for (const [index, token] of internal.layerTokens) {
      const layer = layers[index]!
      if (!layer.isFillCurrent) continue
      try {
        const current = await withDeadline(
          layer.isFillCurrent(token, options.namespace),
          layer.readTimeoutMs ?? options.readTimeoutMs ?? DEFAULT_CACHE_READ_TIMEOUT_MS,
          `Cache layer "${layer.id}" fill validation timed out`,
        )
        if (!current) return false
      } catch (error) {
        options.onLayerError?.(layer.id, 'beginFill', error)
        return false
      }
    }
    return true
  }

  async function commitFill(
    ticket: CacheFillTicket,
    value: unknown,
    writeOptions: CacheWriteOptions,
  ): Promise<boolean> {
    const internal = ticket as InternalFillTicket
    try {
      if (internal.owner !== ticketOwner) {
        throw new Error('Cache fill ticket belongs to a different cache')
      }
      await internal.ready
      if (!isLocallyCurrent(internal)) return false
      return setTo(internal.key, value, writeOptions, internal.selectedIndexes, internal)
    } finally {
      finishFill(ticket)
    }
  }

  async function invalidateAcrossLayers(
    operation: 'invalidateTag' | 'invalidatePrefix',
    invalidate: (index: number) => Promise<CacheLayerInvalidationResult>,
  ): Promise<CacheInvalidationResult> {
    namespaceEpoch++
    await bumpLayerGenerations(operation)
    await Promise.all(foregroundWrites.values())
    await Promise.all(writeQueues.map((queue) => queue.drain()))
    const results = await Promise.all(layers.map(async (layer, index) => {
      try {
        return [layer.id, await invalidate(index)] as const
      } catch (error) {
        options.onLayerError?.(layer.id, operation, error)
        throw error
      }
    }))
    const modes = new Set(results.map(([, result]) => result.mode))
    return {
      mode: modes.size === 1 ? results[0]![1].mode : 'mixed',
      deleted: results.reduce((total, [, result]) => total + (result.deleted ?? 0), 0),
      layers: Object.fromEntries(results),
    }
  }

  return {
    get: <T = unknown>(key: string) => getFrom<T>(key, allLayerIndexes),
    set: async (key, value, writeOptions = {}) => {
      await setTo(key, value, writeOptions, allLayerIndexes)
    },
    beginFill: (key) => beginFillFor(key, allLayerIndexes),
    isFillCurrent,
    commitFill: (ticket, value, writeOptions = {}) => commitFill(ticket, value, writeOptions),
    cancelFill: (ticket) => { finishFill(ticket) },
    selectLayers(layerIds) {
      if (layerIds.length === 0) throw new Error('A cache layer selection cannot be empty')
      const selectedIndexes = layerIds.map((id) => {
        const index = layerIndexes.get(id)
        if (index === undefined) throw new Error(`Cache layer "${id}" does not exist`)
        return index
      })
      for (let index = 1; index < selectedIndexes.length; index++) {
        if (selectedIndexes[index]! <= selectedIndexes[index - 1]!) {
          throw new Error('Cache profile layers must preserve their configured order')
        }
      }
      return {
        get: <T = unknown>(key: string) => getFrom<T>(key, selectedIndexes),
        set: async (key, value, writeOptions = {}) => {
          await setTo(key, value, writeOptions, selectedIndexes)
        },
        beginFill: (key) => beginFillFor(key, selectedIndexes),
        isFillCurrent,
        commitFill: (ticket, value, writeOptions = {}) => commitFill(ticket, value, writeOptions),
        cancelFill: (ticket) => { finishFill(ticket) },
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
        try {
          await bumpLayerGenerations('delete')
        } catch (error) {
          errors.push(error)
        }
        await foregroundWrites.get(namespacedKey)
        await writeQueues[0]!.enqueueBarrier(namespacedKey, async () => {
          try {
            await deleteLayer(0, namespacedKey)
          } catch (error) {
            options.onLayerError?.(layers[0]!.id, 'delete', error)
            errors.push(error)
          }
        })
        await Promise.all(layers.slice(1).map((layer, index) =>
          writeQueues[index + 1]!.enqueueBarrier(namespacedKey, async () => {
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
    async invalidateTag(rawTag) {
      const tag = rawTag.trim()
      if (!tag) throw new Error('Cache tag cannot be empty')
      return invalidateAcrossLayers(
        'invalidateTag',
        (index) => invalidateLayerTag(index, tag),
      )
    },
    async invalidatePrefix(rawPrefix) {
      const logicalPrefix = rawPrefix.trim()
      if (!logicalPrefix) throw new Error('Cache prefix cannot be empty; use clearNamespace instead')
      return invalidateAcrossLayers(
        'invalidatePrefix',
        (index) => invalidateLayerPrefix(index, logicalPrefix),
      )
    },
    async clearNamespace() {
      if (clearInProgress) return clearInProgress
      namespaceEpoch++
      keyEpochs.clear()
      keyWriteVersions.clear()
      const operation = (async () => {
        const errors: unknown[] = []
        try {
          await bumpLayerGenerations('clear')
        } catch (error) {
          errors.push(error)
        }
        for (const result of await Promise.allSettled(deletions.values())) {
          if (result.status === 'rejected') errors.push(result.reason)
        }
        await Promise.all(foregroundWrites.values())
        await writeQueues[0]!.drain()
        try {
          await clearLayer(0)
        } catch (error) {
          options.onLayerError?.(layers[0]!.id, 'clear', error)
          errors.push(error)
        }
        await Promise.all(layers.slice(1).map(async (layer, index) => {
          await writeQueues[index + 1]!.drain()
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
          ...(index > 0 ? { writeQueue: writeQueues[index]!.stats() } : {}),
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
