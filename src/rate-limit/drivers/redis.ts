import type { RateLimitDriver, RateLimitRecord, RedisRateLimitDriverOptions } from '../types.js'

const INCREMENT_FIXED_WINDOW = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`

export class RedisRateLimitDriver implements RateLimitDriver {
  readonly name = 'redis'

  private readonly client: RedisRateLimitDriverOptions['client']
  private readonly prefix: string
  private readonly clientStyle: RedisRateLimitDriverOptions['clientStyle']

  constructor(options: RedisRateLimitDriverOptions) {
    if (!options.client) {
      throw new Error('[RedisRateLimitDriver] Redis client is required')
    }

    this.client = options.client
    this.prefix = options.prefix ?? 'raffel:rate-limit:'
    this.clientStyle = options.clientStyle ?? 'ioredis'
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const fullKey = this.getFullKey(key)

    if (this.client.eval) {
      const raw = this.clientStyle === 'node-redis'
        ? await this.client.eval(INCREMENT_FIXED_WINDOW, {
          keys: [fullKey],
          arguments: [String(windowMs)],
        })
        : await this.client.eval(INCREMENT_FIXED_WINDOW, 1, fullKey, String(windowMs))
      const [rawCount, rawTtl] = Array.isArray(raw) ? raw : [0, windowMs]
      const count = Number(rawCount)
      const ttlMs = Number(rawTtl)
      return {
        count: Number.isFinite(count) ? count : 0,
        resetAt: Date.now() + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : windowMs),
      }
    }

    const count = await this.client.incr(fullKey)

    if (count === 1) {
      await this.client.pexpire?.(fullKey, windowMs)
    }

    let ttlMs = windowMs
    if (this.client.pttl) {
      const ttl = await this.client.pttl(fullKey)
      if (ttl < 0 && this.client.pexpire) {
        // Heal counters created by a previous partial INCR/PEXPIRE failure.
        await this.client.pexpire(fullKey, windowMs)
        ttlMs = windowMs
      } else if (ttl > 0) {
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
    const keys = await (this.client.keys?.(`${this.prefix}*`) ?? Promise.resolve([]))
    if (keys.length === 0) return
    if (!this.client.del) return
    await Promise.all(keys.map((key) => this.client.del!(key)))
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }
}
