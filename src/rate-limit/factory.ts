/**
 * Rate Limit Driver Factory
 *
 * Creates rate-limit drivers with a cache-like configuration.
 */

import type {
  RateLimitDriver,
  RateLimitDriverType,
  RateLimitDriverConfig,
  MemoryRateLimitDriverOptions,
  FilesystemRateLimitDriverOptions,
  RedisRateLimitDriverOptions,
} from './types.js'

let MemoryRateLimitDriverClass: typeof import('./drivers/memory.js').MemoryRateLimitDriver | null = null
let FilesystemRateLimitDriverClass:
  | typeof import('./drivers/filesystem.js').FilesystemRateLimitDriver
  | null = null
let RedisRateLimitDriverClass: typeof import('./drivers/redis.js').RedisRateLimitDriver | null = null

function loadMemoryRateLimitDriver(): typeof import('./drivers/memory.js').MemoryRateLimitDriver {
  if (!MemoryRateLimitDriverClass) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MemoryRateLimitDriver } = require('./drivers/memory.js')
    MemoryRateLimitDriverClass = MemoryRateLimitDriver
  }

  return MemoryRateLimitDriverClass
}

function loadFilesystemRateLimitDriver(): typeof import('./drivers/filesystem.js').FilesystemRateLimitDriver {
  if (!FilesystemRateLimitDriverClass) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FilesystemRateLimitDriver } = require('./drivers/filesystem.js')
    FilesystemRateLimitDriverClass = FilesystemRateLimitDriver
  }

  return FilesystemRateLimitDriverClass
}

function loadRedisRateLimitDriver(): typeof import('./drivers/redis.js').RedisRateLimitDriver {
  if (!RedisRateLimitDriverClass) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RedisRateLimitDriver } = require('./drivers/redis.js')
    RedisRateLimitDriverClass = RedisRateLimitDriver
  }

  return RedisRateLimitDriverClass
}

export function createDriver(type: 'memory', options?: MemoryRateLimitDriverOptions): RateLimitDriver
export function createDriver(type: 'filesystem', options?: FilesystemRateLimitDriverOptions): RateLimitDriver
export function createDriver(type: 'redis', options: RedisRateLimitDriverOptions): RateLimitDriver
export function createDriver(
  type: RateLimitDriverType,
  options?: MemoryRateLimitDriverOptions | FilesystemRateLimitDriverOptions | RedisRateLimitDriverOptions
): RateLimitDriver {
  switch (type) {
    case 'memory':
      return new (loadMemoryRateLimitDriver())(options as MemoryRateLimitDriverOptions)
    case 'filesystem':
      return new (loadFilesystemRateLimitDriver())(options as FilesystemRateLimitDriverOptions)
    case 'redis':
      return new (loadRedisRateLimitDriver())(options as RedisRateLimitDriverOptions)
    default:
      throw new Error(`Unknown rate limit driver type: ${type}`)
  }
}

export function createDriverFromConfig(config: RateLimitDriverConfig): RateLimitDriver {
  switch (config.driver) {
    case 'memory':
      return createDriver('memory', config.options)
    case 'filesystem':
      return createDriver('filesystem', config.options)
    case 'redis':
      return createDriver('redis', config.options)
    default:
      throw new Error(`Unknown rate limit driver: ${(config as { driver: string }).driver}`)
  }
}
