/**
 * API Event Emitter
 *
 * Extended EventEmitter with wildcard pattern support and convenience methods
 * for common API events (requests, auth, errors, etc.)
 *
 * @example
 * import { ApiEventEmitter } from 'raffel/http'
 *
 * const events = new ApiEventEmitter()
 *
 * // Listen to specific events
 * events.on('request:start', (data) => console.log('Request started:', data))
 *
 * // Listen to wildcard patterns
 * events.on('request:*', (data) => console.log('Any request event:', data))
 * events.on('*:error', (data) => console.log('Any error event:', data))
 *
 * // Emit events
 * events.emitRequest('start', { method: 'GET', path: '/api/users' })
 * events.emitAuth('success', { userId: '123' })
 */

import { EventEmitter } from 'events'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event listener function
 */
export type EventListener<T = unknown> = (data: T) => void | Promise<void>

/**
 * Request event data
 */
export interface RequestEventData {
  requestId?: string
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
  ip?: string
  userAgent?: string
  timestamp?: number
  duration?: number
  statusCode?: number
  error?: Error
  [key: string]: unknown
}

/**
 * Auth event data
 */
export interface AuthEventData {
  userId?: string | number
  username?: string
  email?: string
  role?: string
  method?: string // 'basic', 'bearer', 'session', etc.
  success?: boolean
  error?: string
  ip?: string
  timestamp?: number
  [key: string]: unknown
}

/**
 * Error event data
 */
export interface ErrorEventData {
  error: Error
  code?: string
  statusCode?: number
  requestId?: string
  path?: string
  method?: string
  stack?: string
  timestamp?: number
  [key: string]: unknown
}

/**
 * Rate limit event data
 */
export interface RateLimitEventData {
  ip: string
  path?: string
  limit: number
  current: number
  resetAt: number
  blocked: boolean
  [key: string]: unknown
}

/**
 * Event emitter options
 */
export interface ApiEventEmitterOptions {
  /**
   * Maximum number of listeners per event
   * @default 100
   */
  maxListeners?: number

  /**
   * Enable wildcard pattern matching
   * @default true
   */
  wildcards?: boolean

  /**
   * Separator for event namespaces
   * @default ':'
   */
  separator?: string
}

/**
 * Event statistics
 */
export interface EventStats {
  totalEvents: number
  totalListeners: number
  eventCounts: Record<string, number>
  listenerCounts: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// API Event Emitter Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extended EventEmitter with wildcard support and API-specific helpers
 */
export class ApiEventEmitter extends EventEmitter {
  private wildcardListeners: Map<string, Set<EventListener>> = new Map()
  private eventCounts: Map<string, number> = new Map()
  private readonly separator: string
  private readonly wildcardsEnabled: boolean

  constructor(options: ApiEventEmitterOptions = {}) {
    super()
    const { maxListeners = 100, wildcards = true, separator = ':' } = options
    this.setMaxListeners(maxListeners)
    this.wildcardsEnabled = wildcards
    this.separator = separator
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Wildcard Support
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register an event listener with wildcard support
   *
   * @param event - Event name (supports wildcards like 'request:*' or '*:error')
   * @param listener - Event listener function
   * @returns this
   *
   * @example
   * events.on('request:*', (data) => console.log('Any request event'))
   * events.on('*:error', (data) => console.log('Any error event'))
   * events.on('**', (data) => console.log('All events'))
   */
  override on(event: string | symbol, listener: EventListener): this {
    if (typeof event === 'string' && this.wildcardsEnabled && event.includes('*')) {
      const pattern = event
      if (!this.wildcardListeners.has(pattern)) {
        this.wildcardListeners.set(pattern, new Set())
      }
      this.wildcardListeners.get(pattern)!.add(listener)
      return this
    }
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  /**
   * Remove an event listener
   */
  override off(event: string | symbol, listener: EventListener): this {
    if (typeof event === 'string' && this.wildcardsEnabled && event.includes('*')) {
      const pattern = event
      const listeners = this.wildcardListeners.get(pattern)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          this.wildcardListeners.delete(pattern)
        }
      }
      return this
    }
    return super.off(event, listener as (...args: unknown[]) => void)
  }

  /**
   * Register a one-time event listener
   */
  override once(event: string | symbol, listener: EventListener): this {
    if (typeof event === 'string' && this.wildcardsEnabled && event.includes('*')) {
      const onceWrapper: EventListener = (data) => {
        this.off(event, onceWrapper)
        listener(data)
      }
      return this.on(event, onceWrapper)
    }
    return super.once(event, listener as (...args: unknown[]) => void)
  }

  /**
   * Emit an event with wildcard matching
   */
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    const eventName = String(event)

    // Track event count
    const count = this.eventCounts.get(eventName) || 0
    this.eventCounts.set(eventName, count + 1)

    // Emit to exact listeners
    const hasListeners = super.emit(event, ...args)

    // Emit to wildcard listeners
    if (this.wildcardsEnabled) {
      for (const [pattern, listeners] of this.wildcardListeners) {
        if (this.matchPattern(eventName, pattern)) {
          for (const listener of listeners) {
            try {
              listener(args[0])
            } catch (err) {
              // Emit error event if listener throws
              if (event !== 'error') {
                this.emit('error', err)
              }
            }
          }
        }
      }
    }

    return hasListeners || this.wildcardListeners.size > 0
  }

  /**
   * Check if a pattern matches an event name
   */
  private matchPattern(eventName: string, pattern: string): boolean {
    // ** matches everything
    if (pattern === '**') return true

    const eventParts = eventName.split(this.separator)
    const patternParts = pattern.split(this.separator)

    if (eventParts.length !== patternParts.length) return false

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] !== '*' && patternParts[i] !== eventParts[i]) {
        return false
      }
    }

    return true
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Convenience Emit Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Emit a request event
   *
   * @param type - Event type (start, end, error)
   * @param data - Request event data
   *
   * @example
   * events.emitRequest('start', { method: 'GET', path: '/api/users' })
   * events.emitRequest('end', { method: 'GET', path: '/api/users', duration: 50 })
   * events.emitRequest('error', { method: 'GET', path: '/api/users', error })
   */
  emitRequest(type: 'start' | 'end' | 'error', data: RequestEventData): boolean {
    return this.emit(`request:${type}`, {
      ...data,
      timestamp: data.timestamp || Date.now(),
    })
  }

  /**
   * Emit an auth event
   *
   * @param type - Event type (attempt, success, failure, logout)
   * @param data - Auth event data
   *
   * @example
   * events.emitAuth('success', { userId: '123', method: 'bearer' })
   * events.emitAuth('failure', { username: 'admin', error: 'Invalid password' })
   */
  emitAuth(
    type: 'attempt' | 'success' | 'failure' | 'logout' | 'refresh',
    data: AuthEventData
  ): boolean {
    return this.emit(`auth:${type}`, {
      ...data,
      timestamp: data.timestamp || Date.now(),
    })
  }

  /**
   * Emit an error event
   *
   * @param type - Error type (validation, internal, notFound, etc.)
   * @param data - Error event data
   *
   * @example
   * events.emitError('validation', { error, statusCode: 422 })
   * events.emitError('internal', { error, requestId: '...' })
   */
  emitError(
    type: 'validation' | 'internal' | 'notFound' | 'unauthorized' | 'forbidden' | 'timeout',
    data: ErrorEventData
  ): boolean {
    return this.emit(`error:${type}`, {
      ...data,
      stack: data.error.stack,
      timestamp: data.timestamp || Date.now(),
    })
  }

  /**
   * Emit a rate limit event
   *
   * @param type - Event type (warning, blocked)
   * @param data - Rate limit event data
   */
  emitRateLimit(type: 'warning' | 'blocked', data: RateLimitEventData): boolean {
    return this.emit(`rateLimit:${type}`, data)
  }

  /**
   * Emit a lifecycle event
   *
   * @param type - Event type (start, ready, shutdown, error)
   * @param data - Optional data
   */
  emitLifecycle(
    type: 'start' | 'ready' | 'shutdown' | 'error',
    data?: Record<string, unknown>
  ): boolean {
    return this.emit(`lifecycle:${type}`, {
      ...data,
      timestamp: Date.now(),
    })
  }

  /**
   * Emit a custom event with namespace
   *
   * @param namespace - Event namespace
   * @param type - Event type
   * @param data - Event data
   */
  emitCustom(namespace: string, type: string, data: unknown): boolean {
    return this.emit(`${namespace}:${type}`, data)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Convenience On Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Listen to request events
   */
  onRequest(
    type: 'start' | 'end' | 'error' | '*',
    listener: EventListener<RequestEventData>
  ): this {
    return this.on(`request:${type}`, listener as EventListener)
  }

  /**
   * Listen to auth events
   */
  onAuth(
    type: 'attempt' | 'success' | 'failure' | 'logout' | 'refresh' | '*',
    listener: EventListener<AuthEventData>
  ): this {
    return this.on(`auth:${type}`, listener as EventListener)
  }

  /**
   * Listen to error events
   */
  onError(
    type: 'validation' | 'internal' | 'notFound' | 'unauthorized' | 'forbidden' | 'timeout' | '*',
    listener: EventListener<ErrorEventData>
  ): this {
    return this.on(`error:${type}`, listener as EventListener)
  }

  /**
   * Listen to rate limit events
   */
  onRateLimit(
    type: 'warning' | 'blocked' | '*',
    listener: EventListener<RateLimitEventData>
  ): this {
    return this.on(`rateLimit:${type}`, listener as EventListener)
  }

  /**
   * Listen to lifecycle events
   */
  onLifecycle(
    type: 'start' | 'ready' | 'shutdown' | 'error' | '*',
    listener: EventListener<Record<string, unknown>>
  ): this {
    return this.on(`lifecycle:${type}`, listener as EventListener)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Statistics
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get event statistics
   */
  getStats(): EventStats {
    const listenerCounts: Record<string, number> = {}

    // Count regular listeners
    for (const eventName of this.eventNames()) {
      listenerCounts[String(eventName)] = this.listenerCount(eventName)
    }

    // Count wildcard listeners
    for (const [pattern, listeners] of this.wildcardListeners) {
      listenerCounts[pattern] = listeners.size
    }

    return {
      totalEvents: Array.from(this.eventCounts.values()).reduce((a, b) => a + b, 0),
      totalListeners: Object.values(listenerCounts).reduce((a, b) => a + b, 0),
      eventCounts: Object.fromEntries(this.eventCounts),
      listenerCounts,
    }
  }

  /**
   * Reset event counters
   */
  resetStats(): void {
    this.eventCounts.clear()
  }

  /**
   * Remove all listeners including wildcard listeners
   */
  override removeAllListeners(event?: string | symbol): this {
    if (event === undefined) {
      this.wildcardListeners.clear()
    } else if (typeof event === 'string' && event.includes('*')) {
      this.wildcardListeners.delete(event)
    }
    return super.removeAllListeners(event)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new API event emitter instance
 *
 * @param options - Event emitter options
 * @returns New ApiEventEmitter instance
 */
export function createEventEmitter(options?: ApiEventEmitterOptions): ApiEventEmitter {
  return new ApiEventEmitter(options)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default ApiEventEmitter
