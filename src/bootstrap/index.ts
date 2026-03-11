/**
 * Bootstrap Layer
 *
 * Concrete wiring: creates the server, normalizes config, and
 * initializes protocol adapters. This is the composition root.
 */

// Server creation
export { createServer } from './create-server.js'

// Config normalization
export { buildProtocolConfig, resolveSinglePortConfig } from './config-normalization.js'

// Protocol wiring
export { createProtocolWiring, createServerLifecycle } from './protocol-wiring.js'
export type { ServerLifecycleContext } from './protocol-wiring.js'
