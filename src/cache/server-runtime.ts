import type { Context, Envelope, Interceptor } from '../types/index.js'
import { matchProcedurePattern } from '../utils/pattern-match.js'
import { createFileSystemCacheLayer } from './fs-layer.js'
import { procedureCacheKey, procedureCacheKeyFor, type CacheIdentityScope } from './key.js'
import {
  createMemoryCacheLayer,
  createTieredCache,
  type CacheLayer,
  type CacheCircuitBreakerOptions,
  type CacheWriteOptions,
  type TieredCache,
  type TieredCacheOptions,
} from './tiered.js'
import type { WriteBehindQueueOptions } from './write-behind-queue.js'

export interface RouteCacheConfig extends CacheWriteOptions {
  enabled?: boolean
  scope?: CacheIdentityScope
  version?: string
}

export interface CacheRule extends RouteCacheConfig {
  match: string
}

interface CacheLayerConfigBase {
  id?: string
  enabled?: boolean
  ttlMs?: number
  writeBehind?: WriteBehindQueueOptions
  /** Maximum time spent on one layer read before failing open. */
  timeoutMs?: number
  /** Maximum time spent on one layer mutation before failing open. */
  operationTimeoutMs?: number
  /** Read circuit breaker; set false to disable it. */
  circuitBreaker?: CacheCircuitBreakerOptions | false
}

export interface MemoryLayerConfig extends CacheLayerConfigBase {
  driver: 'memory'
  maxMemoryBytes?: number
  maxEntries?: number
  eviction?: 'lru' | 'fifo'
}

export interface FileSystemLayerConfig extends CacheLayerConfigBase {
  driver: 'fs'
  directory?: string
  maxSizeBytes?: number
  maxFiles?: number
}

export interface ProviderLayerConfig extends CacheLayerConfigBase {
  driver: 'provider'
  provider: string
}

export type ServerCacheLayerConfig =
  | MemoryLayerConfig
  | FileSystemLayerConfig
  | ProviderLayerConfig

export interface ServerCacheConfig {
  enabled: boolean
  namespace?: string
  layers: ServerCacheLayerConfig[]
  rules?: CacheRule[]
  writeBehind?: WriteBehindQueueOptions
  onLayerError?: TieredCacheOptions['onLayerError']
}

export interface ServerCacheController {
  invalidate(key: string): Promise<void>
  clear(): Promise<void>
  keyForProcedure(
    procedure: string,
    input: unknown,
    ctx: Context,
    options?: Pick<RouteCacheConfig, 'scope' | 'version'>,
  ): string | undefined
  invalidateProcedure(
    procedure: string,
    input: unknown,
    ctx: Context,
    options?: Pick<RouteCacheConfig, 'scope' | 'version'>,
  ): Promise<boolean>
  stats(): ReturnType<TieredCache['stats']>
}

interface BoundProviderLayer {
  layer: CacheLayer
  bind(services: Readonly<Record<string, unknown>>): void
}

function providerLayer(config: ProviderLayerConfig, id: string): BoundProviderLayer {
  let delegate: CacheLayer | undefined
  const requireDelegate = (): CacheLayer => {
    if (!delegate) throw new Error(`Cache provider "${config.provider}" is not available`)
    return delegate
  }
  return {
    bind(services) {
      const candidate = services[config.provider]
      if (
        candidate &&
        typeof candidate === 'object' &&
        'get' in candidate &&
        'set' in candidate &&
        'delete' in candidate &&
        'clearNamespace' in candidate
      ) {
        delegate = candidate as CacheLayer
      }
    },
    layer: {
      id,
      ttlMs: config.ttlMs ?? 60 * 60_000,
      writeBehind: config.writeBehind,
      readTimeoutMs: config.timeoutMs ?? 100,
      operationTimeoutMs: config.operationTimeoutMs,
      circuitBreaker: config.circuitBreaker === false
        ? { failureThreshold: Number.MAX_SAFE_INTEGER }
        : config.circuitBreaker,
      get: (key) => requireDelegate().get(key),
      set: (key, record, ttlMs, staleMs) =>
        requireDelegate().set(key, record, ttlMs, staleMs),
      delete: (key) => requireDelegate().delete(key),
      clearNamespace: (namespace) => requireDelegate().clearNamespace(namespace),
      stats: () => delegate?.stats?.() ?? { totalItems: 0 },
      shutdown: () => delegate?.shutdown?.(),
    },
  }
}

function isSuccessful(value: unknown): boolean {
  return !(
    value &&
    typeof value === 'object' &&
    'type' in value &&
    (value as { type?: string }).type === 'error'
  )
}

function cloneResponse(value: unknown): unknown {
  return value instanceof Response ? value.clone() : value
}

function createProcedureInterceptor(
  runtime: ServerCacheRuntime,
  config: RouteCacheConfig
): Interceptor {
  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    runtime.bind(ctx.services)
    const key = procedureCacheKey(envelope, ctx, config)
    if (!key) return next()
    const hit = await runtime.cache.get(key)
    if (hit && !hit.stale) return hit.value
    if (hit?.stale) {
      runtime.revalidate(key, next, config)
      return hit.value
    }
    return runtime.executeOnce(key, next, config)
  }
}

export class ServerCacheRuntime {
  private current: TieredCache | undefined
  private binders: BoundProviderLayer[] = []
  private readonly pending = new Map<string, Promise<unknown>>()
  readonly controller: ServerCacheController

  constructor(private readonly config: ServerCacheConfig) {
    this.controller = {
      invalidate: (key) => this.cache.delete(key),
      clear: () => this.cache.clearNamespace(),
      keyForProcedure: (procedure, input, ctx, options) =>
        procedureCacheKeyFor(procedure, input, ctx, options),
      invalidateProcedure: async (procedure, input, ctx, options) => {
        const key = procedureCacheKeyFor(procedure, input, ctx, options)
        if (!key) return false
        await this.cache.delete(key)
        return true
      },
      stats: () => this.cache.stats(),
    }
    this.start()
  }

  get cache(): TieredCache {
    if (!this.current) this.start()
    return this.current!
  }

  interceptorFor(procedure: string, explicit?: RouteCacheConfig | false): Interceptor | undefined {
    const resolved: RouteCacheConfig = { enabled: false }
    for (const rule of this.config.rules ?? []) {
      if (matchProcedurePattern(rule.match, procedure)) Object.assign(resolved, rule)
    }
    if (explicit === false) resolved.enabled = false
    else if (explicit) Object.assign(resolved, explicit)
    return resolved.enabled ? createProcedureInterceptor(this, resolved) : undefined
  }

  bind(services: Readonly<Record<string, unknown>>): void {
    for (const binder of this.binders) binder.bind(services)
  }

  executeOnce(key: string, next: () => Promise<unknown>, config: RouteCacheConfig): Promise<unknown> {
    const existing = this.pending.get(key)
    if (existing) return existing.then(cloneResponse)
    const execution = next()
      .then(async (value) => {
        if (isSuccessful(value)) await this.cache.set(key, value, config)
        return value
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, execution)
    return execution.then(cloneResponse)
  }

  revalidate(key: string, next: () => Promise<unknown>, config: RouteCacheConfig): void {
    if (this.pending.has(key)) return
    void this.executeOnce(key, next, config).catch(() => undefined)
  }

  start(): void {
    if (this.current) return
    this.binders = []
    const layers: CacheLayer[] = []
    const ids = new Set<string>()
    for (const [index, layer] of this.config.layers.entries()) {
      if (layer.enabled === false) continue
      const id = layer.id?.trim() || `l${index + 1}`
      if (ids.has(id)) throw new Error(`Cache layer id "${id}" is duplicated`)
      ids.add(id)
      if (layer.ttlMs !== undefined && layer.ttlMs <= 0) {
        throw new Error(`Cache layer "${id}" ttlMs must be greater than zero`)
      }
      if (layer.timeoutMs !== undefined && layer.timeoutMs <= 0) {
        throw new Error(`Cache layer "${id}" timeoutMs must be greater than zero`)
      }
      if (layer.operationTimeoutMs !== undefined && layer.operationTimeoutMs <= 0) {
        throw new Error(`Cache layer "${id}" operationTimeoutMs must be greater than zero`)
      }
      if (
        layer.circuitBreaker &&
        (layer.circuitBreaker.failureThreshold ?? 3) <= 0
      ) {
        throw new Error(`Cache layer "${id}" circuit failureThreshold must be greater than zero`)
      }
      if (layer.circuitBreaker && (layer.circuitBreaker.cooldownMs ?? 10_000) <= 0) {
        throw new Error(`Cache layer "${id}" circuit cooldownMs must be greater than zero`)
      }
      if (layer.driver === 'memory') {
        layers.push({
          ...createMemoryCacheLayer({
            id,
            ttlMs: layer.ttlMs ?? 60_000,
            maxEntries: layer.maxEntries,
            maxMemoryBytes: layer.maxMemoryBytes,
            eviction: layer.eviction,
          }),
          writeBehind: layer.writeBehind,
          readTimeoutMs: layer.timeoutMs,
          operationTimeoutMs: layer.operationTimeoutMs,
          circuitBreaker: layer.circuitBreaker === false
            ? { failureThreshold: Number.MAX_SAFE_INTEGER }
            : layer.circuitBreaker,
        })
      } else if (layer.driver === 'fs') {
        layers.push({
          ...createFileSystemCacheLayer({
            id,
            ttlMs: layer.ttlMs ?? 10 * 60_000,
            directory: layer.directory ?? '.raffel/cache',
            maxFiles: layer.maxFiles,
            maxSizeBytes: layer.maxSizeBytes,
            readTimeoutMs: layer.timeoutMs,
            operationTimeoutMs: layer.operationTimeoutMs,
            circuitBreaker: layer.circuitBreaker === false
              ? { failureThreshold: Number.MAX_SAFE_INTEGER }
              : layer.circuitBreaker,
          }),
          writeBehind: layer.writeBehind,
        })
      } else {
        const bound = providerLayer(layer, id)
        this.binders.push(bound)
        layers.push(bound.layer)
      }
    }
    if (layers.length === 0) throw new Error('At least one cache layer must be enabled')
    this.current = createTieredCache({
      namespace: this.config.namespace ?? 'raffel',
      layers,
      writeBehind: this.config.writeBehind,
      onLayerError: this.config.onLayerError,
    })
  }

  async stop(): Promise<void> {
    const cache = this.current
    this.current = undefined
    if (cache) await cache.shutdown()
  }
}

export function createServerCacheRuntime(
  config: ServerCacheConfig | false | undefined
): ServerCacheRuntime | undefined {
  if (!config || !config.enabled) return undefined
  return new ServerCacheRuntime(config)
}
