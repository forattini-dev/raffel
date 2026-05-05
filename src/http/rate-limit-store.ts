import type {
  RateLimitDriver,
  RateLimitDriverConfig,
  RateLimitDriverType,
  MemoryRateLimitDriverOptions,
  FilesystemRateLimitDriverOptions,
} from '../rate-limit/types.js'
import { createDriver, createDriverFromConfig } from '../rate-limit/factory.js'
import type { RateLimitEntry, RateLimitStore } from './rate-limit.js'

export interface InternalRateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number; timestamps?: number[] }>
  get(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetAt: number } | undefined>
  reset(key: string): Promise<void>
  clear(): Promise<void>
  cleanup(windowMs: number): Promise<number> | number
  stop(): Promise<void>
  getKeyCount(): number
}

interface RateLimitStoreOptions {
  store?: RateLimitStore
  driver?: RateLimitDriverConfig | RateLimitDriverType | RateLimitDriver
  maxUniqueKeys?: number
  cleanupInterval?: number
}

function toRateLimitPromise<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value)
}

function resolveRateLimitDriver(
  options: Pick<RateLimitStoreOptions, 'driver' | 'maxUniqueKeys' | 'cleanupInterval'>
): RateLimitDriver {
  const { driver, maxUniqueKeys, cleanupInterval } = options

  const memoryDefaults: MemoryRateLimitDriverOptions = {}
  const filesystemDefaults: FilesystemRateLimitDriverOptions = {}
  if (maxUniqueKeys !== undefined) {
    memoryDefaults.maxKeys = maxUniqueKeys
  }
  if (cleanupInterval !== undefined) {
    memoryDefaults.cleanupInterval = cleanupInterval
    filesystemDefaults.cleanupInterval = cleanupInterval
  }

  if (!driver) {
    return createDriver('memory', memoryDefaults)
  }

  if (typeof driver === 'string') {
    if (driver === 'memory') {
      return createDriver('memory', memoryDefaults)
    }
    if (driver === 'filesystem') {
      return createDriver('filesystem', filesystemDefaults)
    }
    if (driver === 'redis') {
      throw new Error(
        "Rate limit driver 'redis' requires configuration object. Use { driver: 'redis', options: { client, ... } }."
      )
    }
    if (driver === 's3db') {
      throw new Error(
        "Rate limit driver 's3db' requires configuration object. Use { driver: 's3db', options: { resource, ... } }."
      )
    }
    throw new Error(`Unknown rate limit driver '${driver}'`)
  }

  if ('increment' in driver && typeof driver.increment === 'function') {
    return driver
  }

  const config = driver as RateLimitDriverConfig
  if (config.driver === 'memory') {
    return createDriver('memory', {
      ...memoryDefaults,
      ...config.options,
    })
  }

  if (config.driver === 'filesystem') {
    return createDriver('filesystem', {
      ...filesystemDefaults,
      ...config.options,
    })
  }

  if (config.driver === 'redis') {
    return createDriverFromConfig(config)
  }

  if (config.driver === 's3db') {
    return createDriverFromConfig(config)
  }

  throw new Error(`Unknown rate limit driver '${(config as { driver: string }).driver}'`)
}

export function createInMemoryRateLimitStore(
  maxUniqueKeys: number,
  slidingWindow: boolean,
  cleanupInterval: number
): InternalRateLimitStore {
  const store = new InMemoryRateLimitStore(maxUniqueKeys, slidingWindow)

  const cleanupTimer = setInterval(() => {
    store.cleanup(cleanupInterval)
  }, cleanupInterval)
  cleanupTimer.unref()

  return {
    increment: (key, windowMs) => toRateLimitPromise(store.increment(key, windowMs)),
    get: (key, windowMs) => toRateLimitPromise(store.get(key, windowMs)),
    reset: (key) => toRateLimitPromise(store.reset(key)),
    clear: () => toRateLimitPromise(store.clear()),
    cleanup: (windowMs) => toRateLimitPromise(store.cleanup(windowMs)),
    stop: async () => {
      clearInterval(cleanupTimer)
    },
    getKeyCount: () => store.size,
  }
}

export function createRateLimitStoreAdapter(
  options: RateLimitStoreOptions
): InternalRateLimitStore {
  if (options.store) {
    const customStore = options.store

    return {
      increment: (key, windowMs) => toRateLimitPromise(customStore.increment(key, windowMs)),
      get: (key, _windowMs) => toRateLimitPromise(customStore.get(key, _windowMs)),
      reset: (key) => toRateLimitPromise(customStore.reset(key)),
      clear: () => toRateLimitPromise(customStore.clear()),
      cleanup: () => Promise.resolve(0),
      stop: async () => Promise.resolve(),
      getKeyCount: () => {
        const maybeNumber = (customStore as { size?: number }).size
        return maybeNumber ?? 0
      },
    }
  }

  const driver = resolveRateLimitDriver(options)

  return {
    increment: (key, windowMs) => toRateLimitPromise(driver.increment(key, windowMs)),
    get: (key, _windowMs) => {
      return toRateLimitPromise(
        driver.get(key)
          .then((record) => {
            if (!record) return undefined
            return { count: record.count, resetAt: record.resetAt }
          })
      )
    },
    reset: (key) => toRateLimitPromise(driver.reset ? driver.reset(key) : Promise.resolve()),
    clear: () => toRateLimitPromise(driver.clear ? driver.clear() : Promise.resolve()),
    cleanup: () => Promise.resolve(0),
    stop: () => toRateLimitPromise(driver.shutdown ? driver.shutdown() : Promise.resolve()),
    getKeyCount: () => 0,
  }
}

class InMemoryRateLimitStore {
  private entries = new Map<string, RateLimitEntry>()
  private maxKeys: number
  private slidingWindow: boolean

  constructor(maxKeys: number, slidingWindow: boolean) {
    this.maxKeys = maxKeys
    this.slidingWindow = slidingWindow
  }

  increment(key: string, windowMs: number): { count: number; resetAt: number; timestamps: number[] } {
    const now = Date.now()
    let entry = this.entries.get(key)

    if (!entry) {
      if (this.entries.size >= this.maxKeys) {
        this.evictOldest()
      }

      entry = {
        timestamps: [now],
        count: 1,
        windowStart: now,
      }
      this.entries.set(key, entry)

      return {
        count: 1,
        resetAt: now + windowMs,
        timestamps: entry.timestamps,
      }
    }

    if (this.slidingWindow) {
      const windowStart = now - windowMs
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart)
      entry.timestamps.push(now)
      entry.count = entry.timestamps.length
      entry.windowStart = entry.timestamps[0] || now

      return {
        count: entry.count,
        resetAt: entry.windowStart + windowMs,
        timestamps: entry.timestamps,
      }
    }

    if (now - entry.windowStart >= windowMs) {
      entry.timestamps = [now]
      entry.count = 1
      entry.windowStart = now
    } else {
      entry.timestamps.push(now)
      entry.count++
    }

    return {
      count: entry.count,
      resetAt: entry.windowStart + windowMs,
      timestamps: entry.timestamps,
    }
  }

  get(key: string, windowMs: number): { count: number; resetAt: number } | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    const now = Date.now()

    if (this.slidingWindow) {
      const windowStart = now - windowMs
      const validTimestamps = entry.timestamps.filter((t) => t > windowStart)
      if (validTimestamps.length === 0) {
        this.entries.delete(key)
        return undefined
      }
      return {
        count: validTimestamps.length,
        resetAt: validTimestamps[0] + windowMs,
      }
    }

    if (now - entry.windowStart >= windowMs) {
      this.entries.delete(key)
      return undefined
    }
    return {
      count: entry.count,
      resetAt: entry.windowStart + windowMs,
    }
  }

  reset(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  cleanup(windowMs: number): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.entries) {
      if (this.slidingWindow) {
        const windowStart = now - windowMs
        entry.timestamps = entry.timestamps.filter((t) => t > windowStart)
        if (entry.timestamps.length === 0) {
          this.entries.delete(key)
          cleaned++
        }
      } else if (now - entry.windowStart >= windowMs) {
        this.entries.delete(key)
        cleaned++
      }
    }

    return cleaned
  }

  get size(): number {
    return this.entries.size
  }

  shutdown(): void {
    this.entries.clear()
  }

  private evictOldest(): void {
    const firstKey = this.entries.keys().next().value
    if (firstKey) {
      this.entries.delete(firstKey)
    }
  }
}
