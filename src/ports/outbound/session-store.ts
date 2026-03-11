/**
 * Session Store Port
 *
 * Canonical interface for session persistence.
 * Re-exports from middleware/session/types.ts to establish the port
 * as the single source of truth.
 */

export type { SessionStore, SessionData, Session } from '../../middleware/session/types.js'
