/**
 * Watch Stream Helpers
 *
 * Utilities for creating filtered real-time watch streams from resource adapters.
 */

import type { Context } from '../types/index.js'
import type { ResourceAdapter, ResourceChangeEvent, WatchFilter } from './types.js'

/**
 * Check if an event matches a watch filter
 */
function matchesFilter(event: ResourceChangeEvent, filter: WatchFilter): boolean {
  // Check operation filter
  if (filter.op && !filter.op.includes(event.op)) {
    return false
  }

  // Check field-level filters against event data
  if (event.data && typeof event.data === 'object') {
    const data = event.data as Record<string, unknown>
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'op') continue
      if (data[key] !== value) return false
    }
  }

  return true
}

/**
 * Create a filtered watch async generator from a resource adapter's subscribe
 *
 * @param adapter - Resource adapter with subscribe capability
 * @param filter - Optional filter to apply to events
 * @param ctx - Request context (for abort signal)
 */
export async function* createFilteredWatchStream<T>(
  adapter: ResourceAdapter<T>,
  filter: WatchFilter | undefined,
  ctx: Context
): AsyncGenerator<ResourceChangeEvent<T>> {
  if (!adapter.subscribe) {
    throw new Error('Resource adapter does not support subscriptions')
  }

  const queue: ResourceChangeEvent<T>[] = []
  let notify: (() => void) | null = null

  const unsub = adapter.subscribe((event) => {
    // Apply filter
    if (filter && !matchesFilter(event as ResourceChangeEvent, filter)) return
    queue.push(event)
    notify?.()
    notify = null
  })

  // Wake the pending promise on abort so the loop exits cleanly
  ctx.signal.addEventListener('abort', () => {
    notify?.()
    notify = null
  }, { once: true })

  try {
    while (!ctx.signal.aborted) {
      while (queue.length > 0) yield queue.shift()!
      if (!ctx.signal.aborted) {
        await new Promise<void>((r) => { notify = r })
      }
    }
  } finally {
    unsub()
  }
}
