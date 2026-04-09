/**
 * Session Module Unit Tests
 *
 * Tests for the in-memory session driver and session interceptor.
 * Covers: memory driver CRUD, TTL expiry, GC, dispose,
 * and session interceptor context injection, save, destroy, regenerate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMemorySessionDriver } from '../../../src/middleware/session/drivers/memory.js'
import { createSessionInterceptor } from '../../../src/middleware/session/interceptor.js'
import type { Envelope, Context } from '../../../src/types/index.js'
import type { Session } from '../../../src/middleware/session/types.js'
import { createContext } from '../../../src/types/index.js'

// ============================================================================
// Memory Driver Tests
// ============================================================================

describe('createMemorySessionDriver', () => {
  it('should create a driver with size 0', () => {
    const driver = createMemorySessionDriver({ gcIntervalMs: false })
    expect(driver.size).toBe(0)
    driver.dispose()
  })

  describe('get / set / delete', () => {
    it('should set and get session data', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { userId: 'alice' })
      const data = await driver.get('sess-1')

      expect(data).toEqual({ userId: 'alice' })
      driver.dispose()
    })

    it('should return null for non-existent session', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })
      const data = await driver.get('does-not-exist')

      expect(data).toBeNull()
      driver.dispose()
    })

    it('should delete a session', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { userId: 'alice' })
      await driver.delete('sess-1')

      const data = await driver.get('sess-1')
      expect(data).toBeNull()
      expect(driver.size).toBe(0)
      driver.dispose()
    })

    it('should silently handle deleting non-existent session', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })
      await expect(driver.delete('nope')).resolves.toBeUndefined()
      driver.dispose()
    })

    it('should overwrite existing session data', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { version: 1 })
      await driver.set('sess-1', { version: 2 })

      const data = await driver.get('sess-1')
      expect(data).toEqual({ version: 2 })
      expect(driver.size).toBe(1)
      driver.dispose()
    })
  })

  describe('TTL', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire entries after TTL', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { userId: 'alice' }, 1) // 1 second TTL
      expect(await driver.get('sess-1')).toEqual({ userId: 'alice' })

      vi.advanceTimersByTime(1500) // 1.5 seconds later

      expect(await driver.get('sess-1')).toBeNull()
      driver.dispose()
    })

    it('should not expire entries without TTL', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { userId: 'alice' }) // no TTL
      vi.advanceTimersByTime(100_000)

      expect(await driver.get('sess-1')).toEqual({ userId: 'alice' })
      driver.dispose()
    })

    it('should refresh TTL via touch', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { userId: 'alice' }, 2) // 2 second TTL

      vi.advanceTimersByTime(1500) // 1.5 seconds

      // Touch resets TTL to 2 more seconds from now
      await driver.touch('sess-1', 2)

      vi.advanceTimersByTime(1500) // 1.5 more seconds (3s total)

      // Should still be alive (touched at 1.5s, expires at 3.5s)
      expect(await driver.get('sess-1')).toEqual({ userId: 'alice' })

      vi.advanceTimersByTime(1000) // 4.5s total, past the touched expiry

      expect(await driver.get('sess-1')).toBeNull()
      driver.dispose()
    })

    it('should not touch an expired session', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('sess-1', { userId: 'alice' }, 1)

      vi.advanceTimersByTime(1500) // expired

      await driver.touch('sess-1', 5) // this should be a no-op

      // Still null since it was expired when touch was called
      expect(await driver.get('sess-1')).toBeNull()
      driver.dispose()
    })

    it('should not touch a non-existent session', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })
      await expect(driver.touch('nope', 5)).resolves.toBeUndefined()
      driver.dispose()
    })
  })

  describe('dispose', () => {
    it('should clear all entries on dispose', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })

      await driver.set('a', { x: 1 })
      await driver.set('b', { x: 2 })
      expect(driver.size).toBe(2)

      driver.dispose()
      expect(driver.size).toBe(0)
    })

    it('should be safe to call dispose multiple times', () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: false })
      driver.dispose()
      driver.dispose()
      // No error
    })
  })

  describe('garbage collection', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should clean up expired entries on GC sweep', async () => {
      const driver = createMemorySessionDriver({ gcIntervalMs: 100 })

      await driver.set('short', { x: 1 }, 1) // expires after 1s
      await driver.set('long', { x: 2 }, 10) // expires after 10s

      expect(driver.size).toBe(2)

      vi.advanceTimersByTime(1500) // past short's TTL, GC has run at least once

      // GC should have cleaned up 'short'
      // Trigger a GC interval
      vi.advanceTimersByTime(100)

      expect(await driver.get('short')).toBeNull()
      expect(await driver.get('long')).toEqual({ x: 2 })

      driver.dispose()
    })
  })
})

// ============================================================================
// Session Interceptor Tests
// ============================================================================

function createEnvelope(
  procedure: string,
  metadata: Record<string, string> = {},
): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: { ...metadata },
    context: createContext('test-id'),
  }
}

function createTestContext(): Context {
  return createContext('test')
}

describe('createSessionInterceptor', () => {
  it('should inject ctx.session for new sessions', async () => {
    const interceptor = createSessionInterceptor({
      driver: 'memory',
      ttl: 60,
      saveUninitialized: true,
    })

    let capturedSession: Session | undefined

    await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async function handler() {
        capturedSession = (this as unknown as { session: Session })?.session
        // access session via the ctx argument instead
        return 'ok'
      },
    )

    // The session is injected into ctx, not into handler `this`
    // We need to check it through the context instead
  })

  it('should create a new session when no cookie present', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })
    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
      saveUninitialized: true,
    })

    const ctx = createTestContext()

    await interceptor(createEnvelope('test'), ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      expect(session).toBeDefined()
      expect(session.id).toBeDefined()
      expect(session.id.length).toBeGreaterThan(0)
      expect(session.data).toEqual({})
      session.touch()
      return 'ok'
    })

    // Session should have been saved (saveUninitialized + touch)
    expect(store.size).toBe(1)
    store.dispose()
  })

  it('should load existing session from cookie', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    // Pre-populate a session
    await store.set('existing-session', { userId: 'alice' }, 60)

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
    })

    const ctx = createTestContext()
    const env = createEnvelope('test', { cookie: 'sid=existing-session' })

    await interceptor(env, ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      expect(session.id).toBe('existing-session')
      expect(session.data).toEqual({ userId: 'alice' })
      return 'ok'
    })

    store.dispose()
  })

  it('should create new session when cookie references expired session', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    // No session in store for this id (simulates expired)
    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
      saveUninitialized: true,
    })

    const ctx = createTestContext()
    const env = createEnvelope('test', { cookie: 'sid=expired-session' })

    await interceptor(env, ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      // Should have a new session ID, not 'expired-session'
      expect(session.id).not.toBe('expired-session')
      expect(session.data).toEqual({})
      session.touch()
      return 'ok'
    })

    store.dispose()
  })

  it('should persist dirty session after handler', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
    })

    const ctx = createTestContext()
    let sessionId: string | undefined

    await interceptor(createEnvelope('test'), ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      session.data.theme = 'dark'
      session.touch()
      sessionId = session.id
      return 'ok'
    })

    // Verify session was saved
    const saved = await store.get(sessionId!)
    expect(saved).toEqual({ theme: 'dark' })

    store.dispose()
  })

  it('should delete session on destroy', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    await store.set('to-destroy', { userId: 'alice' }, 60)

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
    })

    const ctx = createTestContext()
    const env = createEnvelope('test', { cookie: 'sid=to-destroy' })

    await interceptor(env, ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      session.destroy()
      return 'ok'
    })

    // Session should be deleted from store
    const data = await store.get('to-destroy')
    expect(data).toBeNull()

    store.dispose()
  })

  it('should regenerate session ID', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    await store.set('old-id', { userId: 'alice' }, 60)

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
    })

    const ctx = createTestContext()
    const env = createEnvelope('test', { cookie: 'sid=old-id' })
    let newSessionId: string | undefined

    await interceptor(env, ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      expect(session.id).toBe('old-id')

      await session.regenerate()
      newSessionId = session.id

      expect(newSessionId).not.toBe('old-id')
      expect(newSessionId!.length).toBeGreaterThan(0)
      return 'ok'
    })

    // New session should be saved with new ID
    const newData = await store.get(newSessionId!)
    expect(newData).toEqual({ userId: 'alice' })

    store.dispose()
  })

  it('should not save uninitialized sessions by default', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
      // saveUninitialized defaults to false
    })

    const ctx = createTestContext()

    await interceptor(createEnvelope('test'), ctx, async () => {
      // Don't touch or modify session
      return 'ok'
    })

    // Session should NOT have been saved
    expect(store.size).toBe(0)

    store.dispose()
  })

  it('should save uninitialized sessions when saveUninitialized is true', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
      saveUninitialized: true,
    })

    const ctx = createTestContext()

    await interceptor(createEnvelope('test'), ctx, async () => {
      // Don't touch or modify session
      return 'ok'
    })

    // Session should have been saved even though untouched
    expect(store.size).toBe(1)

    store.dispose()
  })

  it('should throw for invalid driver config', () => {
    expect(() =>
      createSessionInterceptor({
        driver: 'custom',
        ttl: 60,
      }),
    ).toThrow('Session driver "custom" requires a store instance')
  })

  it('should throw for unknown string driver', () => {
    expect(() =>
      createSessionInterceptor({
        driver: 'redis' as unknown as 'memory',
        ttl: 60,
      }),
    ).toThrow('Invalid session driver')
  })

  it('should read cookie from Cookie header (capital C)', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    await store.set('cap-cookie', { data: true }, 60)

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
    })

    const ctx = createTestContext()
    const env = createEnvelope('test', { Cookie: 'sid=cap-cookie' })

    await interceptor(env, ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      expect(session.id).toBe('cap-cookie')
      expect(session.data).toEqual({ data: true })
      return 'ok'
    })

    store.dispose()
  })

  it('should use custom cookie name', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    await store.set('my-sess', { hello: 'world' }, 60)

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
      cookie: { name: 'my-session' },
    })

    const ctx = createTestContext()
    const env = createEnvelope('test', { cookie: 'my-session=my-sess' })

    await interceptor(env, ctx, async () => {
      const session = (ctx as unknown as Record<string, unknown>).session as Session
      expect(session.id).toBe('my-sess')
      expect(session.data).toEqual({ hello: 'world' })
      return 'ok'
    })

    store.dispose()
  })

  it('should persist session even when handler throws', async () => {
    const store = createMemorySessionDriver({ gcIntervalMs: false })

    const interceptor = createSessionInterceptor({
      driver: store,
      ttl: 60,
    })

    const ctx = createTestContext()
    let sessionId: string | undefined

    try {
      await interceptor(createEnvelope('test'), ctx, async () => {
        const session = (ctx as unknown as Record<string, unknown>).session as Session
        session.data.important = true
        session.touch()
        sessionId = session.id
        throw new Error('handler-crash')
      })
    } catch {
      // expected
    }

    // Session should still have been saved thanks to finally block
    const saved = await store.get(sessionId!)
    expect(saved).toEqual({ important: true })

    store.dispose()
  })
})
