/**
 * Cache Driver Factory
 *
 * Creates cache drivers with lazy loading.
 * Drivers are only imported when actually used.
 */

import type {
  CacheDriver,
  CacheDriverType,
  CacheDriverConfig,
  MemoryDriverOptions,
  FileDriverOptions,
  RedisDriverOptions,
} from './types.js'

// Lazy-loaded driver constructors
let MemoryDriverClass: typeof import('./drivers/memory.js').MemoryDriver | null = null
let FileDriverClass: typeof import('./drivers/file.js').FileDriver | null = null
let RedisDriverClass: typeof import('./drivers/redis.js').RedisDriver | null = null

/**
 * Lazily load the Memory driver
 */
async function loadMemoryDriver(): Promise<typeof import('./drivers/memory.js').MemoryDriver> {
  if (!MemoryDriverClass) {
    const module = await import('./drivers/memory.js')
    MemoryDriverClass = module.MemoryDriver
  }
  return MemoryDriverClass
}

/**
 * Lazily load the File driver
 */
async function loadFileDriver(): Promise<typeof import('./drivers/file.js').FileDriver> {
  if (!FileDriverClass) {
    const module = await import('./drivers/file.js')
    FileDriverClass = module.FileDriver
  }
  return FileDriverClass
}

/**
 * Lazily load the Redis driver
 */
async function loadRedisDriver(): Promise<typeof import('./drivers/redis.js').RedisDriver> {
  if (!RedisDriverClass) {
    const module = await import('./drivers/redis.js')
    RedisDriverClass = module.RedisDriver
  }
  return RedisDriverClass
}

/**
 * Create a cache driver by type
 *
 * Drivers are lazily loaded to avoid bundling unused dependencies.
 *
 * @example Memory driver (default)
 * ```typescript
 * const driver = await createDriver('memory', {
 *   maxSize: 5000,
 *   evictionPolicy: 'lru',
 * })
 * ```
 *
 * @example File driver
 * ```typescript
 * const driver = await createDriver('file', {
 *   directory: '.cache',
 *   maxFiles: 10000,
 * })
 * ```
 *
 * @example Redis driver
 * ```typescript
 * const driver = await createDriver('redis', {
 *   client: redisClient,
 *   prefix: 'myapp:cache:',
 * })
 * ```
 *
 */
export async function createDriver(
  type: 'memory',
  options?: MemoryDriverOptions
): Promise<CacheDriver>
export async function createDriver(
  type: 'file',
  options?: FileDriverOptions
): Promise<CacheDriver>
export async function createDriver(
  type: 'redis',
  options: RedisDriverOptions
): Promise<CacheDriver>
export async function createDriver(
  type: CacheDriverType,
  options?: MemoryDriverOptions | FileDriverOptions | RedisDriverOptions
): Promise<CacheDriver> {
  switch (type) {
    case 'memory': {
      const Driver = await loadMemoryDriver()
      return new Driver(options as MemoryDriverOptions)
    }
    case 'file': {
      const Driver = await loadFileDriver()
      return new Driver(options as FileDriverOptions)
    }
    case 'redis': {
      const Driver = await loadRedisDriver()
      return new Driver(options as RedisDriverOptions)
    }
    default:
      throw new Error(`Unknown cache driver type: ${type}`)
  }
}

/**
 * Create a cache driver from a configuration object
 *
 * @example
 * ```typescript
 * const driver = await createDriverFromConfig({
 *   driver: 'memory',
 *   options: { maxSize: 5000 },
 * })
 * ```
 */
export async function createDriverFromConfig(config: CacheDriverConfig): Promise<CacheDriver> {
  switch (config.driver) {
    case 'memory':
      return createDriver('memory', config.options)
    case 'file':
      return createDriver('file', config.options)
    case 'redis':
      return createDriver('redis', config.options)
    default:
      throw new Error(`Unknown cache driver: ${(config as { driver: string }).driver}`)
  }
}

/**
 * Synchronous driver creation (for cases where async is not possible)
 *
 * Note: This eagerly loads all driver code. Use createDriver() when possible
 * for better tree-shaking and lazy loading.
 */
export function createDriverSync(
  type: 'memory',
  options?: MemoryDriverOptions
): CacheDriver
export function createDriverSync(
  type: 'file',
  options?: FileDriverOptions
): CacheDriver
export function createDriverSync(
  type: 'redis',
  options?: RedisDriverOptions
): CacheDriver
export function createDriverSync(
  type: 'memory' | 'file' | 'redis',
  options?: MemoryDriverOptions | FileDriverOptions | RedisDriverOptions
): CacheDriver {
  // For sync creation, we need to use require-style imports
  // This is a fallback for when async/await is not available
  switch (type) {
    case 'memory': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MemoryDriver } = require('./drivers/memory.js')
      return new MemoryDriver(options as MemoryDriverOptions)
    }
    case 'file': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { FileDriver } = require('./drivers/file.js')
      return new FileDriver(options as FileDriverOptions)
    }
    case 'redis':
      throw new Error(`${type} driver requires async initialization. Use createDriver() instead.`)
    default:
      throw new Error(`Unknown cache driver type: ${type}`)
  }
}

/**
 * Available driver types
 */
export const DRIVER_TYPES: CacheDriverType[] = ['memory', 'file', 'redis']

/**
 * Check if a driver type is valid
 */
export function isValidDriverType(type: string): type is CacheDriverType {
  return DRIVER_TYPES.includes(type as CacheDriverType)
}
