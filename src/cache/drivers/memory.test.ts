/**
 * Memory Cache Driver Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryDriver, createMemoryDriver } from './memory.js'

describe('MemoryDriver', () => {
  let driver: MemoryDriver

  beforeEach(() => {
    driver = new MemoryDriver({
      maxSize: 100,
      enableStats: true,
    })
  })

  afterEach(async () => {
    await driver.shutdown()
  })

  describe('basic operations', () => {
    it('should set and get a value', async () => {
      await driver.set('key1', { name: 'Alice' }, 60000)

      const result = await driver.get('key1')
      expect(result).toBeDefined()
      expect(result?.entry.value).toEqual({ name: 'Alice' })
    })

    it('should return undefined for non-existent key', async () => {
      const result = await driver.get('non-existent')
      expect(result).toBeUndefined()
    })

    it('should delete a value', async () => {
      await driver.set('key1', 'value1', 60000)
      await driver.delete('key1')

      const result = await driver.get('key1')
      expect(result).toBeUndefined()
    })

    it('should clear all values', async () => {
      await driver.set('key1', 'value1', 60000)
      await driver.set('key2', 'value2', 60000)
      await driver.clear()

      expect(await driver.get('key1')).toBeUndefined()
      expect(await driver.get('key2')).toBeUndefined()
    })

    it('should clear values by prefix', async () => {
      await driver.set('user:1', 'Alice', 60000)
      await driver.set('user:2', 'Bob', 60000)
      await driver.set('product:1', 'Widget', 60000)

      await driver.clear('user:')

      expect(await driver.get('user:1')).toBeUndefined()
      expect(await driver.get('user:2')).toBeUndefined()
      expect(await driver.get('product:1')).toBeDefined()
    })

    it('should check if key exists', async () => {
      await driver.set('key1', 'value1', 60000)

      expect(await driver.has('key1')).toBe(true)
      expect(await driver.has('key2')).toBe(false)
    })

    it('should list all keys', async () => {
      await driver.set('key1', 'value1', 60000)
      await driver.set('key2', 'value2', 60000)

      const keys = await driver.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
    })
  })

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers()

      await driver.set('key1', 'value1', 100) // 100ms TTL

      // Should exist immediately
      expect(await driver.get('key1')).toBeDefined()

      // Advance time past TTL
      vi.advanceTimersByTime(150)

      // Should be expired
      expect(await driver.get('key1')).toBeUndefined()

      vi.useRealTimers()
    })

    it('should update expiresAt and createdAt in entry', async () => {
      const before = Date.now()
      await driver.set('key1', 'value1', 60000)

      const result = await driver.get('key1')
      expect(result?.entry.createdAt).toBeGreaterThanOrEqual(before)
      expect(result?.entry.expiresAt).toBeGreaterThan(result?.entry.createdAt ?? 0)
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used items when maxSize is reached', async () => {
      const smallDriver = new MemoryDriver({
        maxSize: 3,
        evictionPolicy: 'lru',
      })

      await smallDriver.set('key1', 'value1', 60000)
      await smallDriver.set('key2', 'value2', 60000)
      await smallDriver.set('key3', 'value3', 60000)

      // Access key1 to make it recently used
      await smallDriver.get('key1')

      // Add a new item - should evict key2 (least recently used)
      await smallDriver.set('key4', 'value4', 60000)

      expect(await smallDriver.get('key1')).toBeDefined()
      expect(await smallDriver.get('key2')).toBeUndefined() // Evicted
      expect(await smallDriver.get('key3')).toBeDefined()
      expect(await smallDriver.get('key4')).toBeDefined()

      await smallDriver.shutdown()
    })
  })

  describe('FIFO eviction', () => {
    it('should evict oldest items when maxSize is reached', async () => {
      const fifoDriver = new MemoryDriver({
        maxSize: 3,
        evictionPolicy: 'fifo',
      })

      await fifoDriver.set('key1', 'value1', 60000)
      await fifoDriver.set('key2', 'value2', 60000)
      await fifoDriver.set('key3', 'value3', 60000)

      // Access key1 (shouldn't matter for FIFO)
      await fifoDriver.get('key1')

      // Add a new item - should evict key1 (oldest)
      await fifoDriver.set('key4', 'value4', 60000)

      expect(await fifoDriver.get('key1')).toBeUndefined() // Evicted (oldest)
      expect(await fifoDriver.get('key2')).toBeDefined()
      expect(await fifoDriver.get('key3')).toBeDefined()
      expect(await fifoDriver.get('key4')).toBeDefined()

      await fifoDriver.shutdown()
    })
  })

  describe('memory limits', () => {
    it('should enforce memory limits', async () => {
      const memLimitedDriver = new MemoryDriver({
        maxMemoryBytes: 1000, // 1KB limit
        maxSize: 10000,
      })

      // Add items until memory limit is hit
      for (let i = 0; i < 50; i++) {
        await memLimitedDriver.set(`key${i}`, `value-${i}-${'x'.repeat(50)}`, 60000)
      }

      // Should have evicted some items due to memory pressure
      const stats = memLimitedDriver.getMemoryStats()
      expect(stats.currentMemoryBytes).toBeLessThanOrEqual(1000)

      await memLimitedDriver.shutdown()
    })
  })

  describe('compression', () => {
    it('should compress large values when enabled', async () => {
      const compressDriver = new MemoryDriver({
        compression: {
          enabled: true,
          threshold: 100, // Compress values > 100 bytes
        },
        enableStats: true,
      })

      // Small value - should not be compressed
      await compressDriver.set('small', 'hi', 60000)

      // Large value - should be compressed
      const largeValue = 'x'.repeat(500)
      await compressDriver.set('large', largeValue, 60000)

      // Verify we can still read the value correctly
      const result = await compressDriver.get('large')
      expect(result?.entry.value).toBe(largeValue)

      // Check compression stats
      const compressionStats = compressDriver.getCompressionStats()
      expect(compressionStats.enabled).toBe(true)
      expect(compressionStats.compressedItems).toBeGreaterThan(0)

      await compressDriver.shutdown()
    })
  })

  describe('statistics', () => {
    it('should track hits and misses', async () => {
      await driver.set('key1', 'value1', 60000)

      // Generate some hits
      await driver.get('key1')
      await driver.get('key1')

      // Generate some misses
      await driver.get('missing1')
      await driver.get('missing2')

      const stats = driver.stats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(2)
      expect(stats.hitRate).toBe(0.5)
    })

    it('should track sets and deletes', async () => {
      await driver.set('key1', 'value1', 60000)
      await driver.set('key2', 'value2', 60000)
      await driver.delete('key1')

      const stats = driver.stats()
      expect(stats.sets).toBe(2)
      expect(stats.deletes).toBe(1)
    })
  })

  describe('callbacks', () => {
    it('should call onEvict when items are evicted', async () => {
      const onEvict = vi.fn()
      const callbackDriver = new MemoryDriver({
        maxSize: 2,
        onEvict,
      })

      await callbackDriver.set('key1', 'value1', 60000)
      await callbackDriver.set('key2', 'value2', 60000)
      await callbackDriver.set('key3', 'value3', 60000) // Triggers eviction

      expect(onEvict).toHaveBeenCalled()
      expect(onEvict.mock.calls[0][0].reason).toBe('size')

      await callbackDriver.shutdown()
    })
  })

  describe('createMemoryDriver factory', () => {
    it('should create a driver with the factory function', async () => {
      const factoryDriver = createMemoryDriver({ maxSize: 50 })
      expect(factoryDriver.name).toBe('memory')

      await factoryDriver.set('key1', 'value1', 60000)
      const result = await factoryDriver.get('key1')
      expect(result?.entry.value).toBe('value1')

      await factoryDriver.shutdown?.()
    })
  })

  describe('configuration validation', () => {
    it('should throw when using both maxMemoryBytes and maxMemoryPercent', () => {
      expect(() => {
        new MemoryDriver({
          maxMemoryBytes: 1000,
          maxMemoryPercent: 0.5,
        })
      }).toThrow('Cannot use both maxMemoryBytes and maxMemoryPercent')
    })

    it('should throw for invalid maxMemoryPercent', () => {
      expect(() => {
        new MemoryDriver({
          maxMemoryPercent: 1.5,
        })
      }).toThrow('maxMemoryPercent must be between 0 and 1')

      expect(() => {
        new MemoryDriver({
          maxMemoryPercent: -0.1,
        })
      }).toThrow('maxMemoryPercent must be between 0 and 1')
    })
  })

  describe('tags', () => {
    it('should store and retrieve tags', async () => {
      await driver.set('key1', 'value1', 60000, ['user', 'active'])

      const result = await driver.get('key1')
      expect(result?.entry.tags).toEqual(['user', 'active'])
    })
  })
})
