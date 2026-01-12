/**
 * Session Tracking Middleware
 *
 * Manages user sessions with configurable storage backends.
 * Tracks session metadata including IP, user-agent, and activity timestamps.
 *
 * @example
 * import { createSessionTracker, sessionMiddleware } from 'raffel/http/session'
 *
 * // Create session tracker with in-memory storage
 * const sessions = createSessionTracker({
 *   maxAge: 3600000,        // 1 hour
 *   refreshOnAccess: true,  // Reset TTL on activity
 * })
 *
 * // Use as middleware
 * app.use('*', sessionMiddleware(sessions))
 *
 * // Access session in handlers
 * app.get('/profile', (c) => {
 *   const session = c.get('session')
 *   if (!session) return c.json({ error: 'No session' }, 401)
 *   return c.json({ userId: session.userId })
 * })
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import { getCookie, setCookie, deleteCookie, type CookieOptions, type CookieContext } from './cookie.js'

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adapter to convert HttpContextInterface to CookieContext
 */
function toCookieContext<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>
): CookieContext {
  return {
    req: {
      header: (name: string) => c.req.header(name) as string | undefined,
      raw: {
        headers: {
          cookie: c.req.header('cookie') as string | undefined,
        },
      },
    },
    header: (name: string, value: string) => c.header(name, value),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session data stored for each session
 */
export interface Session {
  /** Unique session identifier */
  id: string

  /** User ID (if authenticated) */
  userId?: string | number

  /** When the session was created */
  createdAt: number

  /** Last activity timestamp */
  lastAccessedAt: number

  /** Session expiry timestamp */
  expiresAt: number

  /** Client IP address */
  ip?: string

  /** Client user agent */
  userAgent?: string

  /** Custom session data */
  data: Record<string, unknown>
}

/**
 * Session manager configuration options
 */
export interface SessionManagerOptions {
  /**
   * Session max age in milliseconds
   * @default 3600000 (1 hour)
   */
  maxAge?: number

  /**
   * Refresh session TTL on each access
   * @default true
   */
  refreshOnAccess?: boolean

  /**
   * Session ID generator function
   * @default crypto.randomUUID
   */
  generateId?: () => string

  /**
   * Custom storage backend
   * @default InMemorySessionStore
   */
  store?: SessionStore

  /**
   * Callback when session is created
   */
  onCreate?: (session: Session) => void | Promise<void>

  /**
   * Callback when session is accessed
   */
  onAccess?: (session: Session) => void | Promise<void>

  /**
   * Callback when session is destroyed
   */
  onDestroy?: (sessionId: string) => void | Promise<void>

  /**
   * Cleanup interval for expired sessions (ms)
   * @default 60000 (1 minute)
   */
  cleanupInterval?: number
}

/**
 * Session storage interface for custom backends
 */
export interface SessionStore {
  /**
   * Get a session by ID
   */
  get(id: string): Promise<Session | undefined>

  /**
   * Save or update a session
   */
  set(id: string, session: Session): Promise<void>

  /**
   * Delete a session
   */
  delete(id: string): Promise<void>

  /**
   * Clear all sessions
   */
  clear(): Promise<void>

  /**
   * Get all sessions (for admin/debugging)
   */
  getAll(): Promise<Session[]>

  /**
   * Get sessions for a specific user
   */
  getByUserId(userId: string | number): Promise<Session[]>

  /**
   * Delete all sessions for a user
   */
  deleteByUserId(userId: string | number): Promise<void>

  /**
   * Cleanup expired sessions
   */
  cleanup(): Promise<number>
}

/**
 * Session tracker interface (server-wide session management)
 */
export interface SessionTracker {
  /**
   * Create a new session
   */
  create(options?: { userId?: string | number; ip?: string; userAgent?: string; data?: Record<string, unknown> }): Promise<Session>

  /**
   * Get a session by ID
   */
  get(id: string): Promise<Session | undefined>

  /**
   * Update session data
   */
  update(id: string, data: Partial<Pick<Session, 'userId' | 'data'>>): Promise<Session | undefined>

  /**
   * Touch session (update lastAccessedAt and extend expiry)
   */
  touch(id: string): Promise<Session | undefined>

  /**
   * Destroy a session
   */
  destroy(id: string): Promise<void>

  /**
   * Destroy all sessions for a user
   */
  destroyByUserId(userId: string | number): Promise<void>

  /**
   * Get all active sessions
   */
  getAll(): Promise<Session[]>

  /**
   * Get sessions for a user
   */
  getByUserId(userId: string | number): Promise<Session[]>

  /**
   * Get session statistics
   */
  getStats(): Promise<SessionStats>

  /**
   * Clear all sessions
   */
  clear(): Promise<void>

  /**
   * Cleanup expired sessions
   */
  cleanup(): Promise<number>

  /**
   * Stop cleanup timer (for graceful shutdown)
   */
  stop(): void
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalSessions: number
  activeSessions: number
  expiredSessions: number
  uniqueUsers: number
}

/**
 * Session middleware options
 */
export interface SessionMiddlewareOptions {
  /**
   * Cookie name for session ID
   * @default 'session_id'
   */
  cookieName?: string

  /**
   * Cookie options
   */
  cookie?: Omit<CookieOptions, 'maxAge' | 'expires'>

  /**
   * Function to extract IP from context
   */
  getIp?: (c: HttpContextInterface) => string

  /**
   * Create session automatically if none exists
   * @default false
   */
  autoCreate?: boolean

  /**
   * Key to store session in context
   * @default 'session'
   */
  contextKey?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default in-memory session store
 */
class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>()

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id)
  }

  async set(id: string, session: Session): Promise<void> {
    this.sessions.set(id, session)
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id)
  }

  async clear(): Promise<void> {
    this.sessions.clear()
  }

  async getAll(): Promise<Session[]> {
    return Array.from(this.sessions.values())
  }

  async getByUserId(userId: string | number): Promise<Session[]> {
    return Array.from(this.sessions.values()).filter((s) => s.userId === userId)
  }

  async deleteByUserId(userId: string | number): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(id)
      }
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now()
    let count = 0
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id)
        count++
      }
    }
    return count
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a session manager
 *
 * @param options - Session manager configuration
 * @returns Session manager instance
 *
 * @example
 * const sessions = createSessionTracker({
 *   maxAge: 3600000,        // 1 hour
 *   refreshOnAccess: true,  // Reset TTL on activity
 *   onDestroy: (id) => console.log(`Session ${id} destroyed`),
 * })
 */
export function createSessionTracker(options: SessionManagerOptions = {}): SessionTracker {
  const {
    maxAge = 3600000, // 1 hour
    refreshOnAccess = true,
    generateId = () => crypto.randomUUID(),
    store = new InMemorySessionStore(),
    onCreate,
    onAccess,
    onDestroy,
    cleanupInterval = 60000, // 1 minute
  } = options

  // Start cleanup timer
  let cleanupTimer: ReturnType<typeof setInterval> | undefined
  if (cleanupInterval > 0) {
    cleanupTimer = setInterval(async () => {
      await store.cleanup()
    }, cleanupInterval)
    // Don't block process exit
    if (cleanupTimer.unref) {
      cleanupTimer.unref()
    }
  }

  return {
    async create(opts = {}): Promise<Session> {
      const now = Date.now()
      const session: Session = {
        id: generateId(),
        userId: opts.userId,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: now + maxAge,
        ip: opts.ip,
        userAgent: opts.userAgent,
        data: opts.data || {},
      }

      await store.set(session.id, session)

      if (onCreate) {
        await onCreate(session)
      }

      return session
    },

    async get(id: string): Promise<Session | undefined> {
      const session = await store.get(id)

      if (!session) {
        return undefined
      }

      // Check if expired
      if (session.expiresAt <= Date.now()) {
        await store.delete(id)
        if (onDestroy) {
          await onDestroy(id)
        }
        return undefined
      }

      // Update access time if configured
      if (refreshOnAccess) {
        const now = Date.now()
        session.lastAccessedAt = now
        session.expiresAt = now + maxAge
        await store.set(id, session)
      }

      if (onAccess) {
        await onAccess(session)
      }

      return session
    },

    async update(id: string, data: Partial<Pick<Session, 'userId' | 'data'>>): Promise<Session | undefined> {
      const session = await store.get(id)

      if (!session || session.expiresAt <= Date.now()) {
        return undefined
      }

      if (data.userId !== undefined) {
        session.userId = data.userId
      }

      if (data.data !== undefined) {
        session.data = { ...session.data, ...data.data }
      }

      session.lastAccessedAt = Date.now()

      await store.set(id, session)
      return session
    },

    async touch(id: string): Promise<Session | undefined> {
      const session = await store.get(id)

      if (!session || session.expiresAt <= Date.now()) {
        return undefined
      }

      const now = Date.now()
      session.lastAccessedAt = now
      session.expiresAt = now + maxAge

      await store.set(id, session)
      return session
    },

    async destroy(id: string): Promise<void> {
      await store.delete(id)
      if (onDestroy) {
        await onDestroy(id)
      }
    },

    async destroyByUserId(userId: string | number): Promise<void> {
      const sessions = await store.getByUserId(userId)
      for (const session of sessions) {
        await store.delete(session.id)
        if (onDestroy) {
          await onDestroy(session.id)
        }
      }
    },

    async getAll(): Promise<Session[]> {
      const all = await store.getAll()
      const now = Date.now()
      return all.filter((s) => s.expiresAt > now)
    },

    async getByUserId(userId: string | number): Promise<Session[]> {
      const sessions = await store.getByUserId(userId)
      const now = Date.now()
      return sessions.filter((s) => s.expiresAt > now)
    },

    async getStats(): Promise<SessionStats> {
      const all = await store.getAll()
      const now = Date.now()
      const active = all.filter((s) => s.expiresAt > now)
      const expired = all.length - active.length
      const uniqueUsers = new Set(active.filter((s) => s.userId).map((s) => s.userId)).size

      return {
        totalSessions: all.length,
        activeSessions: active.length,
        expiredSessions: expired,
        uniqueUsers,
      }
    },

    async clear(): Promise<void> {
      await store.clear()
    },

    async cleanup(): Promise<number> {
      return store.cleanup()
    },

    stop(): void {
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = undefined
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default IP extraction function
 */
function defaultGetIp(c: HttpContextInterface): string {
  const forwardedFor = c.req.header('x-forwarded-for') as string | undefined
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim()
    if (firstIp) return firstIp
  }

  const realIp = c.req.header('x-real-ip') as string | undefined
  if (realIp) return realIp

  return 'unknown'
}

/**
 * Create session middleware
 *
 * Attaches session to context and manages session cookie.
 *
 * @param sessions - Session manager instance
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * const sessions = createSessionTracker()
 * app.use('*', sessionMiddleware(sessions, { autoCreate: true }))
 *
 * app.get('/profile', (c) => {
 *   const session = c.get('session')
 *   return c.json({ session })
 * })
 */
export function sessionMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  sessions: SessionTracker,
  options: SessionMiddlewareOptions = {}
): HttpMiddleware<E> {
  const {
    cookieName = 'session_id',
    cookie = {},
    getIp = defaultGetIp as (c: HttpContextInterface<E>) => string,
    autoCreate = false,
    contextKey = 'session',
  } = options

  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    ...cookie,
  }

  return async (c, next) => {
    const cookieCtx = toCookieContext(c)

    // Try to get existing session from cookie
    const sessionId = getCookie(cookieCtx, cookieName)
    let session: Session | undefined

    if (sessionId) {
      session = await sessions.get(sessionId)
    }

    // Auto-create session if configured
    if (!session && autoCreate) {
      session = await sessions.create({
        ip: getIp(c),
        userAgent: c.req.header('user-agent') as string | undefined,
      })

      // Set session cookie
      setCookie(cookieCtx, cookieName, session.id, cookieOptions)
    }

    // Store session in context
    if (session) {
      ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, session)
    }

    await next()

    // Check if session was set during request (e.g., after login)
    const newSession = c.get(contextKey) as Session | undefined
    if (newSession && (!session || newSession.id !== session.id)) {
      setCookie(cookieCtx, cookieName, newSession.id, cookieOptions)
    }
  }
}

/**
 * Helper to create a session and set it in context (use after login)
 */
export async function createSession<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  sessions: SessionTracker,
  options: {
    userId?: string | number
    data?: Record<string, unknown>
    contextKey?: string
  } = {}
): Promise<Session> {
  const { userId, data, contextKey = 'session' } = options

  const session = await sessions.create({
    userId,
    ip: defaultGetIp(c as HttpContextInterface),
    userAgent: c.req.header('user-agent') as string | undefined,
    data,
  })

  ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, session)
  return session
}

/**
 * Helper to destroy session (use for logout)
 */
export async function destroySession<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  sessions: SessionTracker,
  options: {
    cookieName?: string
    contextKey?: string
  } = {}
): Promise<void> {
  const { cookieName = 'session_id', contextKey = 'session' } = options

  const session = c.get(contextKey) as Session | undefined
  if (session) {
    await sessions.destroy(session.id)
    ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, undefined as unknown)
  }

  deleteCookie(toCookieContext(c), cookieName)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createSessionTracker,
  sessionMiddleware,
  createSession,
  destroySession,
}
