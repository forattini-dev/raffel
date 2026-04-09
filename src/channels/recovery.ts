/**
 * Connection State Recovery
 *
 * Saves session state on disconnect and restores on reconnect,
 * allowing clients to recover subscriptions and replay missed messages.
 */

import { sid } from '../utils/id/index.js'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Saved session state for recovery
 */
export interface RecoverableSession {
  /** Opaque recovery token given to the client */
  recoveryToken: string
  /** Original socket ID */
  socketId: string
  /** User ID (if authenticated) */
  userId?: string
  /** Channels the client was subscribed to, with last seen seq */
  channels: { name: string; lastSeq: number }[]
  /** Groups the client belonged to */
  groups: string[]
  /** Custom metadata */
  metadata: Record<string, unknown>
  /** When this session expires */
  expiresAt: number
}

/**
 * Port interface for pluggable recovery storage
 */
export interface ConnectionRecoveryPort {
  /** Save a recoverable session */
  save(session: RecoverableSession): void
  /** Get a session by recovery token */
  get(recoveryToken: string): RecoverableSession | null
  /** Delete a session (consumed or expired) */
  delete(recoveryToken: string): void
}

// ─── In-Memory Implementation ───────────────────────────────────────────────

export interface MemoryRecoveryStoreOptions {
  /** TTL in ms for recovery sessions (default: 120000 = 2 minutes) */
  ttl?: number
  /** GC interval in ms (default: 30000) */
  gcInterval?: number
}

/**
 * Create an in-memory recovery store with TTL and periodic GC
 */
export function createMemoryRecoveryStore(
  options: MemoryRecoveryStoreOptions = {}
): ConnectionRecoveryPort & { dispose(): void; size: number } {
  const {
    gcInterval = 30_000,
  } = options

  const sessions = new Map<string, RecoverableSession>()

  // Periodic GC for expired sessions
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (session.expiresAt < now) {
        sessions.delete(token)
      }
    }
  }, gcInterval)

  if (timer.unref) timer.unref()

  return {
    save(session: RecoverableSession): void {
      sessions.set(session.recoveryToken, session)
    },

    get(recoveryToken: string): RecoverableSession | null {
      const session = sessions.get(recoveryToken)
      if (!session) return null

      // Check expiration
      if (session.expiresAt < Date.now()) {
        sessions.delete(recoveryToken)
        return null
      }

      return session
    },

    delete(recoveryToken: string): void {
      sessions.delete(recoveryToken)
    },

    dispose(): void {
      clearInterval(timer)
      sessions.clear()
    },

    get size(): number {
      return sessions.size
    },
  }
}

/**
 * Generate a recovery token
 */
export function generateRecoveryToken(): string {
  return `rec_${sid()}`
}
