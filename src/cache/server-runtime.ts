import type { Context, Envelope, Interceptor } from '../types/index.js'
import { matchProcedurePattern } from '../utils/pattern-match.js'
import { createFileSystemCacheLayer } from './fs-layer.js'
import {
  compileProcedureCacheKey,
  procedureCacheKeyFor,
  type ProcedureCacheKeyOptions,
} from './key.js'
import {
  createMemoryCacheLayer,
  createTieredCache,
  type CacheLayer,
  type CacheCircuitBreakerOptions,
  type CacheFillTicket,
  type CacheInvalidationResult,
  type CacheLayerCapabilities,
  type TieredCacheAccess,
  type CacheWriteOptions,
  type TieredCache,
  type TieredCacheOptions,
} from './tiered.js'
import type { WriteBehindQueueOptions } from './write-behind-queue.js'

export type CacheTagResolver =
  | readonly string[]
  | ((input: unknown, ctx: Context, result: unknown) => readonly string[])

export interface RouteCacheConfig
  extends Omit<CacheWriteOptions, 'tags'>, ProcedureCacheKeyOptions {
  enabled?: boolean
  profile?: string
  tags?: CacheTagResolver
}

export interface CacheProfileConfig extends Omit<CacheWriteOptions, 'tags'> {
  layers: string[]
  /** Coherence guarantee promised by this profile's selected topology. */
  coherence?: 'ttl' | 'shared-invalidation' | 'backplane'
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
  profiles?: Readonly<Record<string, CacheProfileConfig>>
  rules?: CacheRule[]
  writeBehind?: WriteBehindQueueOptions
  onLayerError?: TieredCacheOptions['onLayerError']
}

export interface ServerCacheController {
  invalidate(key: string): Promise<void>
  invalidateTag(tag: string): Promise<CacheInvalidationResult>
  invalidatePrefix(prefix: string): Promise<CacheInvalidationResult>
  clear(): Promise<void>
  keyForProcedure(
    procedure: string,
    input: unknown,
    ctx: Context,
    options?: ProcedureCacheKeyOptions,
  ): string | undefined
  /** @deprecated Prefer dependency tags or logical-prefix invalidation. */
  invalidateProcedure(
    procedure: string,
    input: unknown,
    ctx: Context,
    options?: ProcedureCacheKeyOptions,
  ): Promise<boolean>
  stats(): ReturnType<TieredCache['stats']>
}

interface BoundProviderLayer {
  layer: CacheLayer
  bind(services: Readonly<Record<string, unknown>>): void
}

interface BoundProviderFillToken {
  fenced: boolean
  token?: unknown
}

interface PendingProcedureFill {
  cache: TieredCacheAccess
  execution: Promise<unknown>
  ticket: CacheFillTicket
}

function providerLayer(config: ProviderLayerConfig, id: string): BoundProviderLayer {
  let delegate: CacheLayer | undefined
  let capabilities: CacheLayerCapabilities = { distributedFillFencing: false }
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
        const hasCompleteFencing = Boolean(
          delegate.capabilities?.distributedFillFencing &&
          delegate.beginFill &&
          delegate.isFillCurrent &&
          delegate.commitFill &&
          delegate.bumpGeneration
        )
        capabilities = {
          ...delegate.capabilities,
          distributedFillFencing: hasCompleteFencing,
          tagInvalidation: delegate.invalidateTag
            ? delegate.capabilities?.tagInvalidation ?? false
            : false,
          prefixInvalidation: delegate.invalidatePrefix
            ? delegate.capabilities?.prefixInvalidation ?? false
            : false,
        }
      }
    },
    layer: {
      id,
      get capabilities() { return capabilities },
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
      async beginFill(key, namespace): Promise<BoundProviderFillToken> {
        const candidate = requireDelegate()
        if (!candidate.beginFill || !candidate.commitFill) return { fenced: false }
        return { fenced: true, token: await candidate.beginFill(key, namespace) }
      },
      async isFillCurrent(token, namespace) {
        const captured = token as BoundProviderFillToken
        if (!captured.fenced) return true
        const candidate = requireDelegate()
        return candidate.isFillCurrent
          ? candidate.isFillCurrent(captured.token, namespace)
          : true
      },
      async commitFill(key, record, ttlMs, staleMs, token, namespace) {
        const captured = token as BoundProviderFillToken
        const candidate = requireDelegate()
        if (!captured.fenced || !candidate.commitFill) {
          await candidate.set(key, record, ttlMs, staleMs)
          return true
        }
        return candidate.commitFill(
          key,
          record,
          ttlMs,
          staleMs,
          captured.token,
          namespace,
        )
      },
      async bumpGeneration(namespace) {
        await requireDelegate().bumpGeneration?.(namespace)
      },
      invalidateTag: (tag, namespace) => {
        const candidate = requireDelegate().invalidateTag
        if (!candidate) {
          throw new Error(`Cache provider "${config.provider}" does not support tag invalidation`)
        }
        return candidate.call(requireDelegate(), tag, namespace)
      },
      invalidatePrefix: (prefix, namespace) => {
        const candidate = requireDelegate().invalidatePrefix
        if (!candidate) {
          throw new Error(`Cache provider "${config.provider}" does not support prefix invalidation`)
        }
        return candidate.call(requireDelegate(), prefix, namespace)
      },
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

function routeWriteOptions(
  config: RouteCacheConfig,
  envelope: Envelope,
  ctx: Context,
  result: unknown,
): CacheWriteOptions {
  const tags = typeof config.tags === 'function'
    ? config.tags(envelope.payload, ctx, result)
    : config.tags
  return {
    ttlMs: config.ttlMs,
    staleMs: config.staleMs,
    tags,
  }
}

function createProcedureInterceptor(
  runtime: ServerCacheRuntime,
  procedure: string,
  config: RouteCacheConfig,
  cache: TieredCacheAccess,
  planId: string,
): Interceptor {
  const keyFor = compileProcedureCacheKey(procedure, config)
  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    runtime.bind(ctx.services)
    const key = keyFor(envelope.payload, ctx)
    if (!key) return next()
    const hit = await cache.get(key)
    if (hit && !hit.stale) return hit.value
    const writeOptions = (result: unknown): CacheWriteOptions | undefined => {
      try {
        return routeWriteOptions(config, envelope, ctx, result)
      } catch (error) {
        ctx.logger.warn(
          { error, procedure: envelope.procedure },
          'Cache tag resolver failed; the result was not cached',
        )
        return undefined
      }
    }
    if (hit?.stale) {
      runtime.revalidate(key, next, writeOptions, cache, planId)
      return hit.value
    }
    return runtime.executeOnce(key, next, writeOptions, cache, planId)
  }
}

export class ServerCacheRuntime {
  private current: TieredCache | undefined
  private readonly profileCaches = new Map<string, TieredCacheAccess>()
  private readonly layersById = new Map<string, CacheLayer>()
  private binders: BoundProviderLayer[] = []
  private providersValidated = false
  private readonly pending = new Map<string, PendingProcedureFill>()
  readonly controller: ServerCacheController

  constructor(private readonly config: ServerCacheConfig) {
    this.controller = {
      invalidate: (key) => this.cache.delete(key),
      invalidateTag: (tag) => this.cache.invalidateTag(tag),
      invalidatePrefix: (prefix) => this.cache.invalidatePrefix(prefix),
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
    const resolved: RouteCacheConfig = {}
    for (const rule of this.config.rules ?? []) {
      if (matchProcedurePattern(rule.match, procedure)) Object.assign(resolved, rule)
    }
    if (explicit === false) resolved.enabled = false
    else if (explicit) Object.assign(resolved, explicit)
    if (resolved.enabled === undefined) resolved.enabled = Boolean(resolved.profile)
    if (!resolved.enabled) return undefined
    const profileName = resolved.profile
    if (!profileName) {
      return createProcedureInterceptor(this, procedure, resolved, this.cache, 'default')
    }
    const profile = this.config.profiles?.[profileName]
    if (!profile) throw new Error(`Cache profile "${profileName}" does not exist`)
    let cache = this.profileCaches.get(profileName)
    if (!cache) {
      cache = this.cache.selectLayers(profile.layers)
      this.profileCaches.set(profileName, cache)
    }
    const { layers: _layers, ...profileDefaults } = profile
    const effective = { ...profileDefaults, ...resolved }
    return createProcedureInterceptor(this, procedure, effective, cache, profileName)
  }

  bind(services: Readonly<Record<string, unknown>>): void {
    if (this.providersValidated) return
    for (const binder of this.binders) binder.bind(services)
    for (const [profileName, profile] of Object.entries(this.config.profiles ?? {})) {
      if (profile.coherence !== 'shared-invalidation') continue
      for (const id of profile.layers) {
        const layer = this.layersById.get(id)!
        if (!layer.capabilities?.distributedFillFencing) {
          throw new Error(
            `Cache profile "${profileName}" requires distributed fill fencing on layer "${id}"`,
          )
        }
        if (!layer.capabilities.tagInvalidation || !layer.capabilities.prefixInvalidation) {
          throw new Error(
            `Cache profile "${profileName}" requires tag and prefix invalidation on layer "${id}"`,
          )
        }
      }
    }
    this.providersValidated = true
  }

  executeOnce(
    key: string,
    next: () => Promise<unknown>,
    writeOptions: CacheWriteOptions | ((value: unknown) => CacheWriteOptions | undefined),
    cache: TieredCacheAccess = this.cache,
    planId = 'default',
  ): Promise<unknown> {
    const pendingKey = `${planId}\0${key}`
    const existing = this.pending.get(pendingKey)
    if (existing) {
      return existing.cache.isFillCurrent(existing.ticket).then((current) => {
        if (current) return existing.execution.then(cloneResponse)
        if (this.pending.get(pendingKey) === existing) this.pending.delete(pendingKey)
        return this.executeOnce(key, next, writeOptions, cache, planId)
      })
    }
    const ticket = cache.beginFill(key)
    const execution = Promise.resolve()
      .then(() => ticket.ready)
      .then(next)
      .then(async (value) => {
        if (isSuccessful(value)) {
          const resolved = typeof writeOptions === 'function'
            ? writeOptions(value)
            : writeOptions
          if (resolved) await cache.commitFill(ticket, value, resolved)
        }
        return value
      })
      .finally(() => {
        cache.cancelFill(ticket)
        if (this.pending.get(pendingKey)?.execution === execution) {
          this.pending.delete(pendingKey)
        }
      })
    this.pending.set(pendingKey, { cache, execution, ticket })
    return execution.then(cloneResponse)
  }

  revalidate(
    key: string,
    next: () => Promise<unknown>,
    writeOptions: CacheWriteOptions | ((value: unknown) => CacheWriteOptions | undefined),
    cache: TieredCacheAccess = this.cache,
    planId = 'default',
  ): void {
    void this.executeOnce(key, next, writeOptions, cache, planId).catch(() => undefined)
  }

  start(): void {
    if (this.current) return
    this.binders = []
    this.providersValidated = false
    this.profileCaches.clear()
    this.layersById.clear()
    const layers: CacheLayer[] = []
    const layerConfigsById = new Map<string, ServerCacheLayerConfig>()
    const ids = new Set<string>()
    for (const [index, layer] of this.config.layers.entries()) {
      if (layer.enabled === false) continue
      const id = layer.id?.trim() || `l${index + 1}`
      if (ids.has(id)) throw new Error(`Cache layer id "${id}" is duplicated`)
      ids.add(id)
      layerConfigsById.set(id, layer)
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
      this.layersById.set(id, layers.at(-1)!)
    }
    if (layers.length === 0) throw new Error('At least one cache layer must be enabled')
    const cache = createTieredCache({
      namespace: this.config.namespace ?? 'raffel',
      layers,
      writeBehind: this.config.writeBehind,
      onLayerError: this.config.onLayerError,
    })
    for (const [profileName, profile] of Object.entries(this.config.profiles ?? {})) {
      try {
        const selected = cache.selectLayers(profile.layers)
        if (profile.coherence === 'backplane') {
          throw new Error(
            `Cache profile "${profileName}" requires an invalidation backplane, which is not configured`,
          )
        }
        if (profile.coherence === 'shared-invalidation') {
          const configuredLayers = profile.layers.map((id) => layerConfigsById.get(id))
          if (configuredLayers.some((layer) => layer?.driver !== 'provider')) {
            throw new Error(
              `Cache profile "${profileName}" with shared-invalidation coherence can only use provider layers`,
            )
          }
          if (configuredLayers.length !== 1) {
            throw new Error(
              `Cache profile "${profileName}" with shared-invalidation coherence requires exactly one provider layer`,
            )
          }
        }
        this.profileCaches.set(profileName, selected)
      } catch (error) {
        void cache.shutdown()
        throw error
      }
    }
    this.current = cache
  }

  async stop(): Promise<void> {
    const cache = this.current
    this.current = undefined
    this.profileCaches.clear()
    this.layersById.clear()
    this.providersValidated = false
    if (cache) await cache.shutdown()
  }
}

export function createServerCacheRuntime(
  config: ServerCacheConfig | false | undefined
): ServerCacheRuntime | undefined {
  if (!config || !config.enabled) return undefined
  return new ServerCacheRuntime(config)
}
