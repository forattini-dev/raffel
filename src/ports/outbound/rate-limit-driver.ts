/**
 * Rate Limit Driver Port
 *
 * Canonical interface for rate limiting backends.
 * Re-exports from rate-limit/types.ts to establish the port
 * as the single source of truth.
 */

export type { RateLimitDriver, RateLimitRecord } from '../../rate-limit/types.js'
