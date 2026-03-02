/**
 * S3DB-like Rate Limit Driver
 *
 * Stores rate limit counters in a key/value S3DB-like resource.
 * Useful for serverless/object storage scenarios where Redis/memory
 * is not a good fit.
 *
 * Works with any resource adapter that exposes:
 * - get(id)
 * - upsert(id, data)
 * - delete(id)
 */

import type { RateLimitDriver, RateLimitRecord, S3dbRateLimitDriverOptions } from '../types.js'

interface S3dbRecordShape {
  [key: string]: unknown
}

export class S3dbRateLimitDriver implements RateLimitDriver {
  readonly name = 's3db'

  private readonly resource: S3dbRateLimitDriverOptions['resource']
  private readonly namespace: string
  private readonly countField: string
  private readonly resetAtField: string

  constructor(options: S3dbRateLimitDriverOptions) {
    const {
      resource,
      namespace = 'raffel:rate-limit',
      countField = 'count',
      resetAtField = 'resetAt',
    } = options

    this.resource = resource
    this.namespace = namespace
    this.countField = countField
    this.resetAtField = resetAtField
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    const fullKey = this.makeKey(key)
    const now = Date.now()

    const existingRaw = await this.resource.get(fullKey)
    const existing = this.parseRateLimitRecord(existingRaw)

    let record: RateLimitRecord
    if (!existing || existing.resetAt <= now) {
      record = {
        count: 1,
        resetAt: now + windowMs,
      }
    } else {
      record = {
        count: existing.count + 1,
        resetAt: existing.resetAt,
      }
    }

    await this.writeRecord(fullKey, record)
    return { ...record }
  }

  async get(key: string): Promise<RateLimitRecord | null> {
    const fullKey = this.makeKey(key)
    const now = Date.now()
    const existingRaw = await this.resource.get(fullKey)
    const existing = this.parseRateLimitRecord(existingRaw)

    if (!existing || existing.resetAt <= now) {
      if (existingRaw) {
        await this.resource.delete(fullKey).catch(() => {
          // ignore cleanup failures
        })
      }
      return null
    }

    return existing
  }

  async decrement(key: string): Promise<void> {
    const fullKey = this.makeKey(key)
    const existingRaw = await this.resource.get(fullKey)
    const existing = this.parseRateLimitRecord(existingRaw)

    if (!existing) return

    const nextCount = Math.max(0, existing.count - 1)
    await this.writeRecord(fullKey, {
      count: nextCount,
      resetAt: existing.resetAt,
    })
  }

  async reset(key: string): Promise<void> {
    const fullKey = this.makeKey(key)
    await this.resource.delete(fullKey)
  }

  async clear(): Promise<void> {
    const listKeys = this.resource.listKeys ?? this.resource.keys
    if (!listKeys) return

    const keys = await listKeys(this.namespace)
    if (!keys.length) return

    for (const key of keys) {
      await this.resource.delete(key)
    }
  }

  async shutdown(): Promise<void> {
    if (this.resource.close) {
      await this.resource.close()
    }
  }

  private makeKey(key: string): string {
    return `${this.namespace}:${key}`
  }

  private parseRateLimitRecord(raw: S3dbRecordShape | null | undefined): RateLimitRecord | null {
    if (!raw) return null

    const countRaw = raw[this.countField]
    const resetAtRaw = raw[this.resetAtField]

    if (typeof countRaw !== 'number' || typeof resetAtRaw !== 'number') {
      return null
    }

    if (!Number.isFinite(countRaw) || !Number.isFinite(resetAtRaw) || countRaw < 0 || resetAtRaw < 0) {
      return null
    }

    return {
      count: Math.trunc(countRaw),
      resetAt: Math.trunc(resetAtRaw),
    }
  }

  private async writeRecord(key: string, record: RateLimitRecord): Promise<void> {
    await this.resource.upsert(key, {
      [this.countField]: record.count,
      [this.resetAtField]: record.resetAt,
    })
  }
}
