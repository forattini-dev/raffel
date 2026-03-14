/**
 * Channels Module
 *
 * Pusher-like WebSocket channels for real-time communication.
 *
 * Channel Types:
 * - Public: `chat-room` - Anyone can subscribe
 * - Private: `private-xyz` - Requires authorization
 * - Presence: `presence-xyz` - Auth + member tracking
 *
 * @example
 * ```typescript
 * import { createChannelManager } from '@raffel/channels'
 *
 * const channels = createChannelManager(
 *   {
 *     authorize: async (socketId, channel, ctx) => {
 *       if (channel.startsWith('private-') || channel.startsWith('presence-')) {
 *         return ctx.auth?.authenticated ?? false
 *       }
 *       return true
 *     },
 *     presenceData: (socketId, channel, ctx) => ({
 *       userId: ctx.auth?.principal,
 *       name: ctx.auth?.claims?.name,
 *     }),
 *   },
 *   (socketId, message) => sendToClient(socketId, message)
 * )
 *
 * // Subscribe
 * const result = await channels.subscribe('socket-1', 'presence-lobby', ctx)
 * if (result.success) {
 *   console.log('Members:', result.members)
 * }
 *
 * // Broadcast
 * channels.broadcast('chat-room', 'message', { text: 'Hello!' })
 *
 * // Presence
 * const members = channels.getMembers('presence-lobby')
 * ```
 */

export { createChannelManager } from './channel-manager.js'
export type { SendToSocketFn } from './channel-manager.js'
export { createMemoryTicketStore, generateTicket } from './ticket-store.js'
export type { MemoryTicketStoreOptions } from './ticket-store.js'

// History
export { createMemoryHistoryStore } from './history.js'
export type {
  ChannelHistoryEntry,
  ChannelHistoryPort,
  MemoryHistoryStoreOptions,
} from './history.js'

// Recovery
export { createMemoryRecoveryStore, generateRecoveryToken } from './recovery.js'
export type {
  RecoverableSession,
  ConnectionRecoveryPort,
  MemoryRecoveryStoreOptions,
} from './recovery.js'

// REST API
export { createChannelRestApi } from './rest-api.js'
export type { ChannelRestApiOptions } from './rest-api.js'

export {
  // Types
  type ChannelType,
  type ChannelOptions,
  type ChannelMember,
  type ChannelState,
  type ChannelManager,
  type SubscribeResult,
  type ClientInfo,
  type RoomInfo,
  type GroupInfo,
  type ChannelLifecycleHooks,
  type ClientConnectEvent,
  type ClientDisconnectEvent,
  type ConnectionTicket,
  type TicketStore,
  type WebSocketAuthConfig,
  type ChannelRateLimits,
  type BackpressureConfig,
  type AuthRefreshMessage,
  type AuthRefreshedMessage,
  type RecoverMessage,

  // Messages
  type SubscribeMessage,
  type SubscribedMessage,
  type UnsubscribeMessage,
  type UnsubscribedMessage,
  type PublishMessage,
  type ChannelEventMessage,
  type ChannelErrorMessage,
  type ChannelMessage,

  // Batch Messages
  type BatchSubscribeMessage,
  type BatchSubscribedMessage,
  type BatchPublishMessage,

  // Typing Indicators
  type TypingMessage,

  // Helpers
  isChannelMessage,
  isRecoverMessage,
  getChannelType,
  requiresAuth,
} from './types.js'
