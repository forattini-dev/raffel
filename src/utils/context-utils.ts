/**
 * Shared context utilities for protocol adapters.
 */

import type { Context } from '../types/index.js'
import { createContext } from '../types/context.js'

/**
 * Create a request context whose AbortSignal is merged with an upstream signal.
 * The abortController is aborted whenever the upstream signal fires (or
 * immediately if it is already aborted).
 */
export function createAbortableContext(
  requestId: string,
  overrides: Partial<Context> | undefined,
  abortController: AbortController
): Context {
  const { signal: upstreamSignal, ...rest } = overrides ?? {}

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortController.abort(upstreamSignal.reason)
    } else {
      upstreamSignal.addEventListener(
        'abort',
        () => {
          abortController.abort(upstreamSignal.reason)
        },
        { once: true }
      )
    }
  }

  return createContext(
    requestId,
    { ...(rest as Partial<Omit<Context, 'requestId' | 'extensions'>>), signal: abortController.signal }
  )
}
