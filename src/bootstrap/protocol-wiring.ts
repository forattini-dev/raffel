/**
 * Protocol Wiring
 *
 * Canonical bootstrap wrapper for adapter wiring and lifecycle composition.
 */

import {
  createServerLifecycle as createServerLifecycleInternal,
  type ServerLifecycleContext,
} from '../server/builder/lifecycle.js'

export type { ServerLifecycleContext } from '../server/builder/lifecycle.js'

export function createProtocolWiring(context: ServerLifecycleContext) {
  return createServerLifecycleInternal(context)
}

export const createServerLifecycle = createProtocolWiring
