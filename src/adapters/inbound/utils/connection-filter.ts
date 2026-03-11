/**
 * Connection Filter
 *
 * Inbound access control for TCP, UDP, WebSocket adapters.
 * @see ../../utils/connection-filter.ts for the implementation.
 */
export { checkConnectionFilter, checkWebSocketConnectionFilter } from '../../utils/connection-filter.js'
export type { ConnectionFilter, WebSocketConnectionFilter } from '../../utils/connection-filter.js'
