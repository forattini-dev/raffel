/**
 * Cache Driver Port
 *
 * Canonical interface for cache backends.
 * Re-exports from cache/types.ts to establish the port
 * as the single source of truth.
 */

export type { CacheDriver, CacheEntry, CacheGetResult, CacheStats } from '../../cache/types.js'
