/**
 * HTTP Rate Limiter Tests
 *
 * Verifies driver-based rate-limit configuration and public behavior.
 */

import { describe, it, expect } from 'vitest'
import { HttpContext } from '../../src/http/context.js'
import { createRateLimiter } from '../../src/http/rate-limit.js'
import { createDriver } from '../../src/rate-limit/factory.js'
import fs from 'node:fs'
import type { S3dbRateLimitResource } from '../../src/rate-limit/types.js'

function createContext(path = 'https://app.test/api/test'): HttpContext {
  return new HttpContext(new Request(path), {})
}

describe('createRateLimiter (HTTP)', () => {
  it('should support built-in memory driver by config object', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 2,
      driver: {
        driver: 'memory',
        options: {
          maxKeys: 100,
          cleanupInterval: 0,
        },
      },
    })

    const first = await limiter.increment(createContext('https://app.test/api/login'))
    const second = await limiter.increment(createContext('https://app.test/api/login'))
    const third = await limiter.increment(createContext('https://app.test/api/login'))

    expect(first.limited).toBe(false)
    expect(second.limited).toBe(false)
    expect(third.limited).toBe(true)
    expect(third.remaining).toBe(0)
  })

  it('should support memory string driver', async () => {
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      driver: 'memory',
    })

    const first = await limiter.increment(createContext('https://app.test/api/test'))
    const second = await limiter.increment(createContext('https://app.test/api/test'))

    expect(first.limited).toBe(false)
    expect(second.limited).toBe(true)
    expect(second.current).toBe(2)
  })

  it('should support custom driver instances', async () => {
    const memoryDriver = createDriver('memory', { cleanupInterval: 0 })
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      driver: memoryDriver,
    })

    const first = await limiter.increment(createContext('https://app.test/api/driver-instance'))
    const second = await limiter.increment(createContext('https://app.test/api/driver-instance'))

    expect(first.limited).toBe(false)
    expect(second.limited).toBe(true)
  })

  it('should keep compatibility with custom store', async () => {
    const store: {
      data: Map<string, { count: number; resetAt: number; windowMs: number }>
      increment: (key: string, windowMs: number) => Promise<{ count: number; resetAt: number }>
      get: (key: string, windowMs?: number) => Promise<{ count: number; resetAt: number } | undefined>
      reset: (key: string) => Promise<void>
      clear: () => Promise<void>
    } = {
      data: new Map(),

      async increment(key, windowMs) {
        const now = Date.now()
        const previous = this.data.get(key)
        const record = !previous || now >= previous.resetAt ? { count: 1, resetAt: now + windowMs, windowMs } : {
          count: previous.count + 1,
          resetAt: previous.resetAt,
          windowMs: previous.windowMs,
        }
        this.data.set(key, record)
        return { count: record.count, resetAt: record.resetAt }
      },

      async get(key) {
        const now = Date.now()
        const record = this.data.get(key)
        if (!record || now >= record.resetAt) {
          this.data.delete(key)
          return undefined
        }
        return { count: record.count, resetAt: record.resetAt }
      },

      async reset(key) {
        this.data.delete(key)
      },

      async clear() {
        this.data.clear()
      },
    }

    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      store,
    })

    const first = await limiter.increment(createContext('https://app.test/api/custom'))
    const second = await limiter.increment(createContext('https://app.test/api/custom'))

    expect(first.limited).toBe(false)
    expect(second.limited).toBe(true)
  })

  it('should support filesystem driver config with options', async () => {
    const directory = `.rate-limit-http-test-${Date.now()}`

    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      driver: {
        driver: 'filesystem',
        options: {
          cleanupInterval: 0,
          directory,
        },
      },
    })

    const first = await limiter.increment(createContext('https://app.test/api/fs'))
    const second = await limiter.increment(createContext('https://app.test/api/fs'))

    expect(first.limited).toBe(false)
    expect(second.limited).toBe(true)

    await limiter.clear()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('should fail when redis driver is used without configuration', () => {
    expect(() => {
      createRateLimiter({
        driver: 'redis',
      })
    }).toThrow("Rate limit driver 'redis' requires configuration object. Use { driver: 'redis', options: { client, ... } }.")
  })

  it('should support s3db driver config', async () => {
    const store = new Map<string, { count: number; resetAt: number }>()

    const resource: S3dbRateLimitResource = {

      async get(key: string): Promise<Record<string, unknown> | null> {
        const record = store.get(key)
        if (!record) return null

        return {
          count: record.count,
          resetAt: record.resetAt,
        }
      },

      async upsert(key: string, data: Record<string, unknown>): Promise<void> {
        const countRaw = data.count
        const resetAtRaw = data.resetAt

        if (typeof countRaw !== 'number' || typeof resetAtRaw !== 'number') {
          return
        }

        store.set(key, { count: countRaw, resetAt: resetAtRaw })
      },

      async delete(key: string): Promise<void> {
        store.delete(key)
      },
    }

    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 1,
      driver: {
        driver: 's3db',
        options: {
          resource,
        },
      },
    })

    const first = await limiter.increment(createContext('https://app.test/api/s3db'))
    const second = await limiter.increment(createContext('https://app.test/api/s3db'))

    expect(first.limited).toBe(false)
    expect(second.limited).toBe(true)
  })
})
