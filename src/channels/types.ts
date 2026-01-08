/**
 * Channel Types
 *
 * Type definitions for Pusher-like WebSocket channels.
 *
 * Channel naming convention:
 * - `chat-room` → Public channel (anyone can subscribe)
 * - `private-xyz` → Private channel (requires authorization)
 * - `presence-xyz` → Presence channel (auth + member tracking)
 */

import type { Context } from '../types/index.js'

/**
 * Channel type based on name prefix
 */
export type ChannelType = 'public' | 'private' | 'presence'

/**
 * Configuration options for channels
 */
export interface ChannelOptions {
  /**
   * Authorize subscription to private/presence channels.
   * Called before allowing subscription to channels starting with
   * `private-` or `presence-`.
   *
   * @param socketId - Unique identifier of the WebSocket connection
   * @param channel - Channel name being subscribed to
   * @param ctx - Request context (may contain auth info)
   * @returns true to allow, false to deny
   *
   * @example
   * ```typescript
   * authorize: async (socketId, channel, ctx) => {
   *   if (!ctx.auth?.authenticated) return false
   *   // private-user-123 → only user 123 can subscribe
   *   const userId = channel.replace('private-user-', '')
   *   return ctx.auth.userId === userId
   * }
   * ```
   */
  authorize?: (
    socketId: string,
    channel: string,
    ctx: Context
  ) => boolean | Promise<boolean>

  /**
   * Get presence data for a member when joining a presence channel.
   * This data is broadcast to other members and returned in the member list.
   *
   * @param socketId - Unique identifier of the WebSocket connection
   * @param channel - Channel name being subscribed to
   * @param ctx - Request context
   * @returns Data to associate with this member
   *
   * @example
   * ```typescript
   * presenceData: (socketId, channel, ctx) => ({
   *   userId: ctx.auth.userId,
   *   name: ctx.auth.displayName,
   *   avatar: ctx.auth.avatarUrl,
   * })
   * ```
   */
  presenceData?: (
    socketId: string,
    channel: string,
    ctx: Context
  ) => Record<string, unknown>

  /**
   * Called when a client publishes a message to a channel.
   * Return false to reject the publish.
   *
   * @param socketId - Publishing socket
   * @param channel - Target channel
   * @param event - Event name
   * @param data - Event data
   * @param ctx - Request context
   * @returns true to allow, false to reject
   */
  onPublish?: (
    socketId: string,
    channel: string,
    event: string,
    data: unknown,
    ctx: Context
  ) => boolean | Promise<boolean>
}

/**
 * A member in a presence channel
 */
export interface ChannelMember {
  /** Socket/connection ID */
  id: string
  /** User ID from auth context (if available) */
  userId?: string
  /** Custom presence data from presenceData callback */
  info: Record<string, unknown>
  /** Timestamp when member joined */
  joinedAt: number
}

/**
 * Internal state for a channel
 */
export interface ChannelState {
  /** Channel name */
  name: string
  /** Channel type (derived from name prefix) */
  type: ChannelType
  /** Set of subscribed socket IDs */
  subscribers: Set<string>
  /** Member tracking (only for presence channels) */
  members?: Map<string, ChannelMember>
  /** When channel was created */
  createdAt: number
}

/**
 * Result of a subscribe operation
 */
export interface SubscribeResult {
  /** Whether subscription succeeded */
  success: boolean
  /** Error details if failed */
  error?: {
    code: string
    status: number
    message: string
  }
  /** Current members (only for presence channels) */
  members?: ChannelMember[]
}

/**
 * Channel manager interface for managing subscriptions and broadcasting
 */
export interface ChannelManager {
  // ─────────────────────────────────────────────────────────────
  // Subscription Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscribe a socket to a channel
   */
  subscribe(
    socketId: string,
    channel: string,
    ctx: Context
  ): Promise<SubscribeResult>

  /**
   * Unsubscribe a socket from a channel
   */
  unsubscribe(socketId: string, channel: string): void

  /**
   * Unsubscribe a socket from all channels (called on disconnect)
   */
  unsubscribeAll(socketId: string): void

  /**
   * Check if a socket is subscribed to a channel
   */
  isSubscribed(socketId: string, channel: string): boolean

  /**
   * Get all channels a socket is subscribed to
   */
  getSubscriptions(socketId: string): string[]

  // ─────────────────────────────────────────────────────────────
  // Broadcasting
  // ─────────────────────────────────────────────────────────────

  /**
   * Broadcast an event to all subscribers of a channel
   *
   * @param channel - Target channel
   * @param event - Event name
   * @param data - Event data
   * @param except - Optional socket ID to exclude (e.g., the sender)
   */
  broadcast(
    channel: string,
    event: string,
    data: unknown,
    except?: string
  ): void

  /**
   * Send an event to a specific socket on a channel
   */
  sendToSocket(
    socketId: string,
    channel: string,
    event: string,
    data: unknown
  ): void

  // ─────────────────────────────────────────────────────────────
  // Presence
  // ─────────────────────────────────────────────────────────────

  /**
   * Get all members in a presence channel
   */
  getMembers(channel: string): ChannelMember[]

  /**
   * Get a specific member in a presence channel
   */
  getMember(channel: string, socketId: string): ChannelMember | undefined

  /**
   * Get member count for a channel
   */
  getMemberCount(channel: string): number

  // ─────────────────────────────────────────────────────────────
  // Admin
  // ─────────────────────────────────────────────────────────────

  /**
   * Kick a socket from a channel
   */
  kick(channel: string, socketId: string): void

  /**
   * Get all active channel names
   */
  getChannels(): string[]

  /**
   * Get all subscriber socket IDs for a channel
   */
  getSubscribers(channel: string): string[]

  /**
   * Check if a channel exists (has any subscribers)
   */
  hasChannel(channel: string): boolean

  /**
   * Get subscriber count for a channel
   */
  getSubscriberCount(channel: string): number
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Protocol Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client → Server: Subscribe to a channel
 */
export interface SubscribeMessage {
  id: string
  type: 'subscribe'
  channel: string
}

/**
 * Server → Client: Subscription successful
 */
export interface SubscribedMessage {
  id: string
  type: 'subscribed'
  channel: string
  /** Members list (only for presence channels) */
  members?: ChannelMember[]
}

/**
 * Client → Server: Unsubscribe from a channel
 */
export interface UnsubscribeMessage {
  id: string
  type: 'unsubscribe'
  channel: string
}

/**
 * Server → Client: Unsubscription confirmed
 */
export interface UnsubscribedMessage {
  id: string
  type: 'unsubscribed'
  channel: string
}

/**
 * Client → Server: Publish event to channel
 */
export interface PublishMessage {
  id: string
  type: 'publish'
  channel: string
  event: string
  data: unknown
}

/**
 * Server → Client: Event broadcast
 */
export interface ChannelEventMessage {
  type: 'event'
  channel: string
  event: string
  data: unknown
}

/**
 * Server → Client: Channel error
 */
export interface ChannelErrorMessage {
  id: string
  type: 'error'
  code: string
  status: number
  message: string
}

/**
 * All channel-related message types
 */
export type ChannelMessage =
  | SubscribeMessage
  | SubscribedMessage
  | UnsubscribeMessage
  | UnsubscribedMessage
  | PublishMessage
  | ChannelEventMessage
  | ChannelErrorMessage

/**
 * Check if a message is a channel-related message
 */
export function isChannelMessage(
  message: unknown
): message is SubscribeMessage | UnsubscribeMessage | PublishMessage {
  if (!message || typeof message !== 'object') return false
  const msg = message as Record<string, unknown>
  return (
    msg.type === 'subscribe' ||
    msg.type === 'unsubscribe' ||
    msg.type === 'publish'
  )
}

/**
 * Get channel type from name
 */
export function getChannelType(name: string): ChannelType {
  if (name.startsWith('presence-')) return 'presence'
  if (name.startsWith('private-')) return 'private'
  return 'public'
}

/**
 * Check if channel requires authorization
 */
export function requiresAuth(channel: string): boolean {
  const type = getChannelType(channel)
  return type === 'private' || type === 'presence'
}
