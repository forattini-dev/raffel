/**
 * Server Builder Types
 *
 * Type definitions for the unified server API.
 *
 * This file is a barrel that re-exports types from three axis-based modules:
 * - `./types/config-types.ts` — config-time options (ServerOptions, providers,
 *   plugins, error handling, per-protocol options)
 * - `./types/handler-types.ts` — handler signatures, protocol namespaces,
 *   fluent builders, router modules, declarative definition maps
 * - `./types/lifecycle-types.ts` — server runtime (RaffelServer, addresses,
 *   protocol adapters), USD documentation types, internal types
 *
 * All original imports of `src/server/types.ts` continue to work unchanged.
 */

export type * from './types/config-types.js'
export type * from './types/handler-types.js'
export type * from './types/lifecycle-types.js'
