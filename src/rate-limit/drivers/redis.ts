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

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }
}
