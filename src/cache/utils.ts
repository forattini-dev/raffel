/**
 * Shared cache utilities
 */

/**
 * Compute hit rate from hits and misses counters.
 * Returns 0 when there are no requests.
 */
export function computeHitRate(hits: number, misses: number): number {
  const total = hits + misses
  return total > 0 ? hits / total : 0
}
