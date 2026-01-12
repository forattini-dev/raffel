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
import { MemoryRateLimitDriver } from './drivers/memory.js'
import { FilesystemRateLimitDriver } from './drivers/filesystem.js'
import { RedisRateLimitDriver } from './drivers/redis.js'

export function createDriver(type: 'memory', options?: MemoryRateLimitDriverOptions): RateLimitDriver
export function createDriver(type: 'filesystem', options?: FilesystemRateLimitDriverOptions): RateLimitDriver
export function createDriver(type: 'redis', options: RedisRateLimitDriverOptions): RateLimitDriver
export function createDriver(
  type: RateLimitDriverType,
  options?: MemoryRateLimitDriverOptions | FilesystemRateLimitDriverOptions | RedisRateLimitDriverOptions
): RateLimitDriver {
  switch (type) {
    case 'memory':
      return new MemoryRateLimitDriver(options as MemoryRateLimitDriverOptions)
    case 'filesystem':
      return new FilesystemRateLimitDriver(options as FilesystemRateLimitDriverOptions)
    case 'redis':
      return new RedisRateLimitDriver(options as RedisRateLimitDriverOptions)
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
