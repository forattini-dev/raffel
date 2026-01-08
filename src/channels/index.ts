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

export {
  // Types
  type ChannelType,
  type ChannelOptions,
  type ChannelMember,
  type ChannelState,
  type ChannelManager,
  type SubscribeResult,

  // Messages
  type SubscribeMessage,
  type SubscribedMessage,
  type UnsubscribeMessage,
  type UnsubscribedMessage,
  type PublishMessage,
  type ChannelEventMessage,
  type ChannelErrorMessage,
  type ChannelMessage,

  // Helpers
  isChannelMessage,
  getChannelType,
  requiresAuth,
} from './types.js'
