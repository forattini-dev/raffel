/**
 * Server Bootstrap
 *
 * Canonical bootstrap entrypoint for wiring a Raffel server.
 * This is the composition root of the hexagonal architecture — the only place
 * that reaches into the server builder (infrastructure) to wire everything up.
 *
 * Currently a thin passthrough. Future responsibilities:
 * - Environment-based default wiring (logger, session driver)
 * - Preset resolution (e.g. `preset: 'api'` → pre-configured options)
 * - Startup diagnostics / config validation before builder runs
 */

import { createServer as createServerBuilder } from '../server/builder.js'
import type { RaffelServer, ServerOptions } from '../server/types.js'

export function createServer(options: ServerOptions): RaffelServer {
  return createServerBuilder(options)
}
