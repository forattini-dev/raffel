/**
 * Bootstrap Layer
 *
 * Concrete wiring: creates the server, normalizes config, and
 * initializes protocol adapters. This is the composition root.
 */

// Server creation — re-exported from server/builder.js. The former
// create-server.ts pass-through (19 lines, zero behaviour) was deleted
// as slice 6 of the architecture-deepening initiative (PRD #6).
export { createServer } from '../server/builder.js'

// Config normalization
export { buildProtocolConfig, resolveSinglePortConfig } from './config-normalization.js'

// Protocol wiring
export { createProtocolWiring, createServerLifecycle } from './protocol-wiring.js'
export type { ServerLifecycleContext } from './protocol-wiring.js'
