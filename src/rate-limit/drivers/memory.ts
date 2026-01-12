import type { RateLimitDriver, RateLimitRecord, MemoryRateLimitDriverOptions } from '../types.js'

export class MemoryRateLimitDriver implements RateLimitDriver {
  readonly name = 'memory'

  private readonly maxKeys: number
  private readonly cleanupInterval: number
  private readonly store = new Map<string, RateLimitRecord>()
  private cleanupHandle: ReturnType<typeof setInterval> | null = null

  constructor(options: MemoryRateLimitDriverOptions = {}) {
    this.maxKeys = options.maxKeys ?? 10000
    this.cleanupInterval = options.cleanupInterval ?? 60000

    if (this.cleanupInterval > 0) {
      this.cleanupHandle = setInterval(() => this.cleanupExpired(), this.cleanupInterval)
      this.cleanupHandle.unref?.()
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const now = Date.now()
    let record = this.store.get(key)

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs }
      this.store.set(key, record)
    }

    record.count += 1

    if (this.store.size > this.maxKeys) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey) {
        this.store.delete(oldestKey)
      }
    }

    return { ...record }
  }

  async decrement(key: string): Promise<void> {
    const record = this.store.get(key)
    if (!record) return
    record.count = Math.max(0, record.count - 1)
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key)
  }

  async shutdown(): Promise<void> {
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle)
      this.cleanupHandle = null
    }
  }

  private cleanupExpired(): void {
    const now = Date.now()
    for (const [key, record] of this.store) {
      if (now > record.resetAt) {
        this.store.delete(key)
      }
    }
  }
}
