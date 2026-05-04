/**
 * Cache Store Contract Test Suite
 *
 * Reusable conformance tests for any `CacheStore` implementation. Mirrors
 * the rate-limit-driver and session-store driver test patterns.
 *
 * Slice 5 of architecture-deepening initiative (PRD #6 / issue #15).
 *
 * @example
 * ```ts
 * import { describe } from 'vitest'
 * import { runCacheStoreContract } from 'raffel/testing'
 * import { createMyCacheStore } from './my-store.js'
 *
 * describe('MyCacheStore', () => {
 *   runCacheStoreContract(() => createMyCacheStore())
 * })
 * ```
 */

import { describe, it, expect } from 'vitest'
import type { CacheStore } from '../middleware/types.js'

export interface CacheStoreFactory {
  (): CacheStore | Promise<CacheStore>
}

/**
 * Run the cache store contract test suite.
 * Pass a factory that returns a fresh store instance per test.
 */
export function runCacheStoreContract(factory: CacheStoreFactory): void {
  describe('CacheStore contract', () => {
    it('returns undefined for missing keys', async () => {
      const store = await factory()
      const result = await store.get('does-not-exist')
      expect(result).toBeUndefined()
    })

    it('round-trips set → get', async () => {
      const store = await factory()
      await store.set('k1', { hello: 'world' }, 60_000)
      const result = await store.get('k1')
      expect(result).toBeDefined()
      expect(result!.value).toEqual({ hello: 'world' })
      expect(result!.expiresAt).toBeGreaterThan(Date.now())
    })

    it('overwrites existing keys', async () => {
      const store = await factory()
      await store.set('k', 'first', 60_000)
      await store.set('k', 'second', 60_000)
      const result = await store.get('k')
      expect(result!.value).toBe('second')
    })

    it('respects TTL — expired entries return undefined', async () => {
      const store = await factory()
      await store.set('short-lived', 'value', 1)
      // Wait for expiry — small but non-zero so any monotonic clock catches it.
      await new Promise((r) => setTimeout(r, 25))
      const result = await store.get('short-lived')
      expect(result).toBeUndefined()
    })

    it('delete removes a single key', async () => {
      const store = await factory()
      await store.set('a', 1, 60_000)
      await store.set('b', 2, 60_000)
      await store.delete('a')
      expect(await store.get('a')).toBeUndefined()
      expect(await store.get('b')).toBeDefined()
    })

    it('delete on missing key does not throw', async () => {
      const store = await factory()
      await expect(store.delete('never-was')).resolves.toBeUndefined()
    })

    it('clear removes all keys', async () => {
      const store = await factory()
      await store.set('a', 1, 60_000)
      await store.set('b', 2, 60_000)
      await store.clear()
      expect(await store.get('a')).toBeUndefined()
      expect(await store.get('b')).toBeUndefined()
    })

    it('handles concurrent sets to the same key', async () => {
      const store = await factory()
      await Promise.all([
        store.set('race', 'a', 60_000),
        store.set('race', 'b', 60_000),
        store.set('race', 'c', 60_000),
      ])
      const result = await store.get('race')
      expect(result).toBeDefined()
      expect(['a', 'b', 'c']).toContain(result!.value)
    })

    it('preserves arbitrary serialisable values', async () => {
      const store = await factory()
      const payload = { n: 1, s: 'two', b: true, arr: [1, 2, 3], nested: { k: 'v' } }
      await store.set('complex', payload, 60_000)
      const result = await store.get('complex')
      expect(result!.value).toEqual(payload)
    })
  })
}
