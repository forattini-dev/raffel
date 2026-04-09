/**
 * Session Store Types
 *
 * Interfaces for the dedicated Session Store abstraction.
 * The session store manages user sessions across requests,
 * providing a uniform API regardless of backing storage.
 */

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Session data bag — arbitrary key/value pairs persisted per session.
 */
export type SessionData = Record<string, unknown>

/**
 * Session store interface.
 * Implement this to provide a custom backing store.
 */
export interface SessionStore {
  /** Retrieve session data by session ID. Returns null if not found or expired. */
  get(id: string): Promise<SessionData | null>

  /** Persist session data. `ttl` is in seconds; store must honour it. */
  set(id: string, data: SessionData, ttl?: number): Promise<void>

  /** Delete a session. No-op if not found. */
  delete(id: string): Promise<void>

  /**
   * Touch a session — reset its expiry without changing data.
   * Used for sliding-window TTL.
   */
  touch(id: string, ttl?: number): Promise<void>
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Cookie options for the session cookie.
 */
export interface SessionCookieOptions {
  /** Cookie name (default: 'sid') */
  name?: string
  /** Max age in seconds (takes precedence over `ttl` for cookie expiry). Defaults to `ttl`. */
  maxAge?: number
  /** HttpOnly flag (default: true) */
  httpOnly?: boolean
  /** Secure flag — set cookies only over HTTPS (default: true in production) */
  secure?: boolean
  /** SameSite policy (default: 'lax') */
  sameSite?: 'strict' | 'lax' | 'none'
  /** Cookie path (default: '/') */
  path?: string
  /** Cookie domain */
  domain?: string
}

/**
 * Session store driver type (built-in drivers).
 *
 * - `'memory'`  — in-memory Map + TTL (dev, single-instance)
 * - `'custom'`  — explicit alias for passing any `SessionStore` instance
 */
export type SessionDriverType = 'memory' | 'custom'

/**
 * Session configuration passed to `createServer()`.
 */
export interface SessionConfig {
  /**
   * Built-in driver type, OR a custom store instance.
   *
   * @example
   * // Built-in memory driver (dev)
   * driver: 'memory'
   *
   * @example
   * // Custom store
   * driver: myCustomStore
   */
  driver: SessionDriverType | SessionStore

  /**
   * Session TTL in seconds (default: 3600 — 1 hour).
   * Applies to both store expiry and cookie maxAge (unless overridden in `cookie.maxAge`).
   * @deprecated Use ttlMs instead
   */
  ttl?: number

  /** Session TTL in milliseconds. Takes precedence over ttl. */
  ttlMs?: number

  /**
   * Whether to use a sliding-window TTL: each access resets the TTL.
   * (default: false — fixed TTL)
   */
  rolling?: boolean

  /**
   * Whether to save sessions that have never been modified.
   * (default: false — lazy save)
   */
  saveUninitialized?: boolean

  /**
   * Secret for signing session IDs (HMAC-SHA256).
   * If not set, session IDs are unsigned.
   */
  secret?: string

  /** Cookie configuration */
  cookie?: SessionCookieOptions

}

// ============================================================================
// Runtime Session Handle
// ============================================================================

/**
 * Live session handle injected into `ctx.session` by the session interceptor.
 */
export interface Session {
  /** Session ID */
  readonly id: string

  /** Session data (mutable) */
  data: SessionData

  /**
   * Mark session as modified so it will be persisted at response time.
   * Called automatically when `data` is mutated via `set()`.
   */
  touch(): void

  /** Whether the session has been modified this request */
  readonly isDirty: boolean

  /** Destroy the session (delete from store, clear cookie on response) */
  destroy(): void

  /** Whether the session has been destroyed */
  readonly isDestroyed: boolean

  /** Regenerate session ID (for security after privilege escalation) */
  regenerate(): Promise<void>
}
