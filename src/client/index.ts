/**
 * Raffel WebSocket Client SDK — Node.js entry point
 *
 * This entry automatically uses the `ws` package as the WebSocket implementation.
 * For browser usage, import from 'raffel/client/browser' instead.
 *
 * @example
 * ```typescript
 * import { createRaffelClient } from 'raffel/client'
 *
 * const client = createRaffelClient({ url: 'ws://localhost:3000/ws' })
 * const order = await client.call('orders.get', { id: '123' })
 * ```
 */

import { WebSocket } from 'ws'
import { createRaffelClient as createUniversalClient } from './create.js'
import type { RaffelClientOptions, RaffelClient } from './types.js'

// Re-export types and utilities
export type {
  RaffelClientOptions,
  RaffelClient,
  ClientStream,
  CallOptions,
  ClientChannel,
  ClientChannelMember,
} from './types.js'
export { createReconnectController, getReconnectDelay } from './reconnect.js'
export type { ReconnectConfig, ReconnectState } from './reconnect.js'
export type { WebSocketLike, WebSocketConstructor } from './create.js'

/**
 * Create a Raffel WebSocket client (Node.js — uses `ws` package)
 *
 * @param options - Client configuration (url is required)
 * @returns RaffelClient instance
 */
export function createRaffelClient(options: RaffelClientOptions): RaffelClient
export function createRaffelClient(url: string): RaffelClient
export function createRaffelClient(urlOrOptions: string | RaffelClientOptions): RaffelClient {
  const opts: RaffelClientOptions = typeof urlOrOptions === 'string'
    ? { url: urlOrOptions }
    : urlOrOptions

  // Inject ws as default WebSocket implementation for Node.js
  if (!opts.WebSocket && (typeof globalThis === 'undefined' || !(globalThis as any).WebSocket)) {
    opts.WebSocket = WebSocket as any
  }

  return createUniversalClient(opts)
}
