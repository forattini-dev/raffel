/**
 * Failban (IP Banning) Middleware
 *
 * Tracks violations per IP address and automatically bans IPs
 * that exceed the maximum violation threshold.
 *
 * @example
 * import { createFailban, failbanMiddleware } from 'raffel/http'
 *
 * // Create failban manager
 * const failban = createFailban({
 *   maxViolations: 5,
 *   banDuration: 3600000, // 1 hour
 *   violationDecay: 60000  // Reset after 1 minute of no violations
 * })
 *
 * // Use as middleware
 * app.use('*', failbanMiddleware(failban))
 *
 * // Record violations manually
 * failban.recordViolation(clientIp, 'invalid_credentials')
 * failban.recordViolation(clientIp, 'rate_limit_exceeded')
 *
 * // Check if IP is banned
 * if (failban.isBanned(clientIp)) {
 *   // Handle banned IP
 * }
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Violation record for an IP
 */
export interface ViolationRecord {
  ip: string
  violations: number
  lastViolation: number
  firstViolation: number
  reasons: string[]
  banned: boolean
  bannedAt?: number
  bannedUntil?: number
}

/**
 * Failban configuration options
 */
export interface FailbanOptions {
  /**
   * Maximum violations before ban
   * @default 5
   */
  maxViolations?: number

  /**
   * Ban duration in milliseconds
   * @default 3600000 (1 hour)
   */
  banDuration?: number

  /**
   * Time in ms after which violations decay (reset)
   * @default 300000 (5 minutes)
   */
  violationDecay?: number

  /**
   * IPs that are never banned
   */
  whitelist?: string[]

  /**
   * IPs that are always banned
   */
  blacklist?: string[]

  /**
   * Function to extract IP from context
   * @default Uses x-forwarded-for or socket address
   */
  getIp?: (c: HttpContextInterface) => string

  /**
   * Callback when IP is banned
   */
  onBan?: (ip: string, record: ViolationRecord) => void | Promise<void>

  /**
   * Callback when IP is unbanned
   */
  onUnban?: (ip: string) => void | Promise<void>

  /**
   * Callback when violation is recorded
   */
  onViolation?: (ip: string, reason: string, record: ViolationRecord) => void | Promise<void>

  /**
   * Custom store for persistence (default: in-memory)
   */
  store?: FailbanStore
}

/**
 * Custom store interface for persistence
 */
export interface FailbanStore {
  get(ip: string): Promise<ViolationRecord | undefined>
  set(ip: string, record: ViolationRecord): Promise<void>
  delete(ip: string): Promise<void>
  clear(): Promise<void>
  getAll(): Promise<ViolationRecord[]>
}

/**
 * Failban manager interface
 */
export interface FailbanManager {
  /**
   * Record a violation for an IP
   */
  recordViolation(ip: string, reason?: string): Promise<ViolationRecord>

  /**
   * Check if an IP is banned
   */
  isBanned(ip: string): Promise<boolean>

  /**
   * Get violation record for an IP
   */
  getRecord(ip: string): Promise<ViolationRecord | undefined>

  /**
   * Manually ban an IP
   */
  ban(ip: string, duration?: number, reason?: string): Promise<void>

  /**
   * Manually unban an IP
   */
  unban(ip: string): Promise<void>

  /**
   * Clear all records
   */
  clear(): Promise<void>

  /**
   * Get all violation records
   */
  getAllRecords(): Promise<ViolationRecord[]>

  /**
   * Get banned IPs
   */
  getBannedIps(): Promise<string[]>

  /**
   * Reset violations for an IP (without unbanning)
   */
  resetViolations(ip: string): Promise<void>

  /**
   * Check if IP is whitelisted
   */
  isWhitelisted(ip: string): boolean

  /**
   * Check if IP is blacklisted
   */
  isBlacklisted(ip: string): boolean

  /**
   * Add IP to whitelist
   */
  addToWhitelist(ip: string): void

  /**
   * Remove IP from whitelist
   */
  removeFromWhitelist(ip: string): void

  /**
   * Add IP to blacklist
   */
  addToBlacklist(ip: string): void

  /**
   * Remove IP from blacklist
   */
  removeFromBlacklist(ip: string): void

  /**
   * Get stats
   */
  getStats(): Promise<FailbanStats>
}

/**
 * Failban statistics
 */
export interface FailbanStats {
  totalRecords: number
  bannedCount: number
  whitelistCount: number
  blacklistCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default in-memory store
 */
class InMemoryStore implements FailbanStore {
  private records = new Map<string, ViolationRecord>()

  async get(ip: string): Promise<ViolationRecord | undefined> {
    return this.records.get(ip)
  }

  async set(ip: string, record: ViolationRecord): Promise<void> {
    this.records.set(ip, record)
  }

  async delete(ip: string): Promise<void> {
    this.records.delete(ip)
  }

  async clear(): Promise<void> {
    this.records.clear()
  }

  async getAll(): Promise<ViolationRecord[]> {
    return Array.from(this.records.values())
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Failban Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a failban manager
 *
 * @param options - Failban configuration
 * @returns Failban manager instance
 *
 * @example
 * const failban = createFailban({
 *   maxViolations: 5,
 *   banDuration: 3600000, // 1 hour
 * })
 *
 * // Record violation on auth failure
 * app.post('/login', async (c) => {
 *   const ip = getClientIp(c)
 *   const success = await authenticate(...)
 *   if (!success) {
 *     await failban.recordViolation(ip, 'invalid_credentials')
 *   }
 * })
 */
export function createFailban(options: FailbanOptions = {}): FailbanManager {
  const {
    maxViolations = 5,
    banDuration = 3600000, // 1 hour
    violationDecay = 300000, // 5 minutes
    whitelist: initialWhitelist = [],
    blacklist: initialBlacklist = [],
    onBan,
    onUnban,
    onViolation,
    store = new InMemoryStore(),
  } = options

  const whitelist = new Set(initialWhitelist)
  const blacklist = new Set(initialBlacklist)

  return {
    async recordViolation(ip: string, reason = 'unknown'): Promise<ViolationRecord> {
      // Check whitelist
      if (whitelist.has(ip)) {
        return {
          ip,
          violations: 0,
          lastViolation: 0,
          firstViolation: 0,
          reasons: [],
          banned: false,
        }
      }

      const now = Date.now()
      let record = await store.get(ip)

      // Create new record or check decay
      if (!record) {
        record = {
          ip,
          violations: 0,
          lastViolation: now,
          firstViolation: now,
          reasons: [],
          banned: false,
        }
      } else if (now - record.lastViolation > violationDecay && !record.banned) {
        // Violations have decayed
        record.violations = 0
        record.reasons = []
        record.firstViolation = now
      }

      // Check if ban has expired
      if (record.banned && record.bannedUntil && now >= record.bannedUntil) {
        record.banned = false
        record.bannedAt = undefined
        record.bannedUntil = undefined
        if (onUnban) {
          await onUnban(ip)
        }
      }

      // Record violation
      record.violations++
      record.lastViolation = now
      if (!record.reasons.includes(reason)) {
        record.reasons.push(reason)
      }

      // Callback
      if (onViolation) {
        await onViolation(ip, reason, record)
      }

      // Check if should be banned
      if (record.violations >= maxViolations && !record.banned) {
        record.banned = true
        record.bannedAt = now
        record.bannedUntil = now + banDuration

        if (onBan) {
          await onBan(ip, record)
        }
      }

      await store.set(ip, record)
      return record
    },

    async isBanned(ip: string): Promise<boolean> {
      // Blacklisted IPs are always banned
      if (blacklist.has(ip)) {
        return true
      }

      // Whitelisted IPs are never banned
      if (whitelist.has(ip)) {
        return false
      }

      const record = await store.get(ip)
      if (!record) {
        return false
      }

      // Check if ban has expired
      if (record.banned && record.bannedUntil) {
        const now = Date.now()
        if (now >= record.bannedUntil) {
          record.banned = false
          record.bannedAt = undefined
          record.bannedUntil = undefined
          await store.set(ip, record)
          if (onUnban) {
            await onUnban(ip)
          }
          return false
        }
      }

      return record.banned
    },

    async getRecord(ip: string): Promise<ViolationRecord | undefined> {
      return store.get(ip)
    },

    async ban(ip: string, duration = banDuration, reason = 'manual'): Promise<void> {
      if (whitelist.has(ip)) {
        return
      }

      const now = Date.now()
      let record = await store.get(ip)

      if (!record) {
        record = {
          ip,
          violations: maxViolations,
          lastViolation: now,
          firstViolation: now,
          reasons: [reason],
          banned: true,
          bannedAt: now,
          bannedUntil: now + duration,
        }
      } else {
        record.banned = true
        record.bannedAt = now
        record.bannedUntil = now + duration
        if (!record.reasons.includes(reason)) {
          record.reasons.push(reason)
        }
      }

      await store.set(ip, record)

      if (onBan) {
        await onBan(ip, record)
      }
    },

    async unban(ip: string): Promise<void> {
      const record = await store.get(ip)
      if (record) {
        record.banned = false
        record.bannedAt = undefined
        record.bannedUntil = undefined
        await store.set(ip, record)

        if (onUnban) {
          await onUnban(ip)
        }
      }
    },

    async clear(): Promise<void> {
      await store.clear()
    },

    async getAllRecords(): Promise<ViolationRecord[]> {
      return store.getAll()
    },

    async getBannedIps(): Promise<string[]> {
      const records = await store.getAll()
      const now = Date.now()
      return records
        .filter((r) => r.banned && (!r.bannedUntil || r.bannedUntil > now))
        .map((r) => r.ip)
        .concat(Array.from(blacklist))
    },

    async resetViolations(ip: string): Promise<void> {
      const record = await store.get(ip)
      if (record) {
        record.violations = 0
        record.reasons = []
        await store.set(ip, record)
      }
    },

    isWhitelisted(ip: string): boolean {
      return whitelist.has(ip)
    },

    isBlacklisted(ip: string): boolean {
      return blacklist.has(ip)
    },

    addToWhitelist(ip: string): void {
      whitelist.add(ip)
      blacklist.delete(ip) // Remove from blacklist if present
    },

    removeFromWhitelist(ip: string): void {
      whitelist.delete(ip)
    },

    addToBlacklist(ip: string): void {
      blacklist.add(ip)
      whitelist.delete(ip) // Remove from whitelist if present
    },

    removeFromBlacklist(ip: string): void {
      blacklist.delete(ip)
    },

    async getStats(): Promise<FailbanStats> {
      const records = await store.getAll()
      const now = Date.now()
      return {
        totalRecords: records.length,
        bannedCount: records.filter(
          (r) => r.banned && (!r.bannedUntil || r.bannedUntil > now)
        ).length + blacklist.size,
        whitelistCount: whitelist.size,
        blacklistCount: blacklist.size,
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create failban middleware
 *
 * Blocks banned IPs with 403 Forbidden response.
 *
 * @param failban - Failban manager instance
 * @param options - Additional middleware options
 * @returns Middleware function
 *
 * @example
 * const failban = createFailban({ maxViolations: 5 })
 * app.use('*', failbanMiddleware(failban))
 */
export function failbanMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  failban: FailbanManager,
  options: {
    getIp?: (c: HttpContextInterface<E>) => string
    message?: string
  } = {}
): HttpMiddleware<E> {
  const { getIp = defaultGetIp as (c: HttpContextInterface<E>) => string, message = 'Access denied' } = options

  return async (c, next) => {
    const ip = getIp(c)

    if (await failban.isBanned(ip)) {
      c.res = new Response(
        JSON.stringify({
          success: false,
          error: {
            message,
            code: 'IP_BANNED',
          },
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      return
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default IP extraction function
 */
function defaultGetIp(c: HttpContextInterface): string {
  // Check X-Forwarded-For header
  const forwardedFor = c.req.header('x-forwarded-for') as string | undefined
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    const firstIp = forwardedFor.split(',')[0].trim()
    if (firstIp) {
      return firstIp
    }
  }

  // Check X-Real-IP header
  const realIp = c.req.header('x-real-ip') as string | undefined
  if (realIp) {
    return realIp
  }

  // Fallback to unknown (in real implementation, would get from socket)
  return 'unknown'
}

/**
 * Get client IP helper
 */
export function getClientIp(c: HttpContextInterface): string {
  return defaultGetIp(c)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createFailban,
  failbanMiddleware,
  getClientIp,
}
