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
  get(key: string): Promise<RateLimitRecord | null>
  decrement?(key: string): Promise<void>
  reset?(key: string): Promise<void>
  clear?(): Promise<void>
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
  get(key: string): Promise<string | number | null>
  incr(key: string): Promise<number>
  decr?(key: string): Promise<number>
  pexpire?(key: string, ttlMs: number): Promise<number>
  pttl?(key: string): Promise<number>
  del?(key: string): Promise<number>
}

export interface S3dbRateLimitResource {
  /** Read a record by key */
  get(key: string): Promise<Record<string, unknown> | null | undefined>

  /** Write/rewrite a record by key */
  upsert(key: string, data: Record<string, unknown>): Promise<unknown>

  /** Delete a key */
  delete(key: string): Promise<unknown>

  /** Optional namespace-based key listing for cleanup */
  listKeys?(namespace: string): Promise<string[]>
  keys?(namespace: string): Promise<string[]>

  /** Optional connection shutdown */
  close?(): Promise<void>
}

export interface S3dbRateLimitDriverOptions {
  /** s3db-like resource instance */
  resource: S3dbRateLimitResource

  /** Namespace used to isolate rate-limit keys */
  namespace?: string

  /** Field for counter value */
  countField?: string

  /** Field for window reset timestamp (ms since epoch) */
  resetAtField?: string
}

export type RateLimitDriverType = 'memory' | 'filesystem' | 'redis' | 's3db'

export type RateLimitDriverConfig =
  | { driver: 'memory'; options?: MemoryRateLimitDriverOptions }
  | { driver: 'filesystem'; options?: FilesystemRateLimitDriverOptions }
  | { driver: 'redis'; options: RedisRateLimitDriverOptions }
  | { driver: 's3db'; options: S3dbRateLimitDriverOptions }
