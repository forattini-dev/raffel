/**
 * Raffel WebSocket Client SDK — Browser entry point
 *
 * Uses the native browser WebSocket API. No `ws` dependency needed.
 *
 * @example
 * ```typescript
 * import { createRaffelClient } from 'raffel/client/browser'
 *
 * const client = createRaffelClient({ url: 'wss://api.example.com/ws', token: 'xxx' })
 *
 * // RPC
 * const user = await client.call('users.get', { id: '123' })
 *
 * // Channels
 * const channel = client.subscribe('orders')
 * channel.on('created', (data) => console.log(data))
 *
 * // Streams
 * for await (const chunk of client.stream('logs.tail')) {
 *   console.log(chunk)
 * }
 * ```
 */

export { createRaffelClient } from './create.js'
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
