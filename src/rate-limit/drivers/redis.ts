import type { RateLimitDriver, RateLimitRecord, RedisRateLimitDriverOptions } from '../types.js'

export class RedisRateLimitDriver implements RateLimitDriver {
  readonly name = 'redis'

  private readonly client: RedisRateLimitDriverOptions['client']
  private readonly prefix: string

  constructor(options: RedisRateLimitDriverOptions) {
    if (!options.client) {
      throw new Error('[RedisRateLimitDriver] Redis client is required')
    }

    this.client = options.client
    this.prefix = options.prefix ?? 'raffel:rate-limit:'
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const fullKey = this.getFullKey(key)
    const count = await this.client.incr(fullKey)

    if (count === 1) {
      if (this.client.pexpire) {
        await this.client.pexpire(fullKey, windowMs)
      }
    }

    let ttlMs = windowMs
    if (this.client.pttl) {
      const ttl = await this.client.pttl(fullKey)
      if (ttl > 0) {
        ttlMs = ttl
      }
    }

    const resetAt = Date.now() + ttlMs
    return { count, resetAt }
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    const fullKey = this.getFullKey(key)
    const raw = await this.client.get(fullKey)

    if (raw === null || raw === undefined) {
      return null
    }

    const count = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
    if (!Number.isFinite(count) || count < 0) {
      return null
    }

    let ttlMs = 0
    if (this.client.pttl) {
      ttlMs = await this.client.pttl(fullKey)
      if (ttlMs < 0) {
        ttlMs = 0
      }
    }

    if (ttlMs <= 0) {
      if (this.client.del) {
        await this.client.del(fullKey)
      }
      return null
    }

    return { count, resetAt: Date.now() + ttlMs }
  }

  async decrement(key: string): Promise<void> {
    if (!this.client.decr) return
    const fullKey = this.getFullKey(key)
    await this.client.decr(fullKey)
  }

  async reset(key: string): Promise<void> {
    if (!this.client.del) return
    const fullKey = this.getFullKey(key)
    await this.client.del(fullKey)
  }

  async clear(): Promise<void> {
    if (!this.client.keys) return
    const keys = await this.client.keys(`${this.prefix}*`)
    if (keys.length > 0) {
      await this.client.del(...keys)
    }
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }
}
