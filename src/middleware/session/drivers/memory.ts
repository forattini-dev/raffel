/**
 * In-Memory Session Driver
 *
 * Stores sessions in a JavaScript Map with TTL support.
 * Suitable for development and single-instance deployments.
 *
 * NOT suitable for production multi-instance deployments
 * (sessions are not shared across instances).
 */

import type { SessionStore, SessionData } from '../types.js'

interface MemoryEntry {
  data: SessionData
  expiresAt: number | null // null = no expiry
}

export interface MemorySessionDriverOptions {
  /**
   * How often to run the garbage collection sweep in milliseconds.
   * Default: 60_000 (1 minute).
   * Pass `false` to disable automatic GC.
   */
  gcIntervalMs?: number | false
}

/**
 * Create an in-memory session store.
 *
 * @example
 * ```typescript
 * import { createMemorySessionDriver } from 'raffel/session'
 *
 * const store = createMemorySessionDriver()
 * const server = createServer({
 *   session: { driver: store, ttl: 3600 }
 * })
 * ```
 */
export function createMemorySessionDriver(
  options: MemorySessionDriverOptions = {}
): SessionStore & { size: number; dispose(): void } {
  const { gcIntervalMs = 60_000 } = options
  const store = new Map<string, MemoryEntry>()
  let gcTimer: ReturnType<typeof setInterval> | null = null

  function isExpired(entry: MemoryEntry): boolean {
    return entry.expiresAt !== null && entry.expiresAt < Date.now()
  }

  function gc(): void {
    for (const [id, entry] of store) {
      if (isExpired(entry)) {
        store.delete(id)
      }
    }
  }

  if (gcIntervalMs !== false && gcIntervalMs > 0) {
    gcTimer = setInterval(gc, gcIntervalMs)
    // Allow process to exit even if timer is active
    if (gcTimer.unref) gcTimer.unref()
  }

  const driver: SessionStore & { size: number; dispose(): void } = {
    async get(id: string): Promise<SessionData | null> {
      const entry = store.get(id)
      if (!entry) return null
      if (isExpired(entry)) {
        store.delete(id)
        return null
      }
      return entry.data
    },

    async set(id: string, data: SessionData, ttl?: number): Promise<void> {
      const expiresAt = ttl != null ? Date.now() + ttl * 1000 : null
      store.set(id, { data, expiresAt })
    },

    async delete(id: string): Promise<void> {
      store.delete(id)
    },

    async touch(id: string, ttl?: number): Promise<void> {
      const entry = store.get(id)
      if (!entry || isExpired(entry)) return
      if (ttl != null) {
        entry.expiresAt = Date.now() + ttl * 1000
      }
    },

    get size(): number {
      return store.size
    },

    dispose(): void {
      if (gcTimer) {
        clearInterval(gcTimer)
        gcTimer = null
      }
      store.clear()
    },
  }

  return driver
}
