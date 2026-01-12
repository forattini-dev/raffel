/**
 * Rate Limit Driver Types
 *
 * Driver abstraction for pluggable rate limiting backends.
 */

export interface RateLimitRecord {
  count: number
  resetAt: number
}

export interface RateLimitDriver {
  readonly name: string
  increment(key: string, windowMs: number): Promise<RateLimitRecord>
  decrement?(key: string): Promise<void>
  reset?(key: string): Promise<void>
  shutdown?(): Promise<void>
}

export interface MemoryRateLimitDriverOptions {
  /** Maximum number of keys to keep (default: 10000) */
  maxKeys?: number
  /** Cleanup interval in ms (default: 60000) */
  cleanupInterval?: number
}

export interface FilesystemRateLimitDriverOptions {
  /** Directory for storing rate limit state (default: '.rate-limit') */
  directory?: string
  /** Cleanup interval in ms (default: 300000) */
  cleanupInterval?: number
}

export interface RedisRateLimitDriverOptions {
  client: RedisLikeClient
  prefix?: string
}

export interface RedisLikeClient {
  incr(key: string): Promise<number>
  decr?(key: string): Promise<number>
  pexpire?(key: string, ttlMs: number): Promise<number>
  pttl?(key: string): Promise<number>
  del?(key: string): Promise<number>
}

export type RateLimitDriverType = 'memory' | 'filesystem' | 'redis'

export type RateLimitDriverConfig =
  | { driver: 'memory'; options?: MemoryRateLimitDriverOptions }
  | { driver: 'filesystem'; options?: FilesystemRateLimitDriverOptions }
  | { driver: 'redis'; options: RedisRateLimitDriverOptions }
