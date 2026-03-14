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

// ─── Ticket-Based Authentication ─────────────────────────────────────────────

/**
 * A short-lived, single-use connection ticket.
 * Generated server-side via HTTP, consumed on WS connect.
 */
export interface ConnectionTicket {
  /** Unique ticket ID */
  id: string
  /** User/principal identifier */
  userId: string
  /** Allowed channel patterns (glob-like: 'private-user-123', 'presence-*') */
  permissions?: string[]
  /** Expiration timestamp (ms since epoch) */
  expiresAt: number
  /** Whether this ticket has been consumed */
  usedAt?: number
  /** Custom metadata carried into the connection context */
  metadata?: Record<string, unknown>
}

/**
 * Storage backend for connection tickets (port interface).
 * Default: in-memory. Can be backed by Redis for multi-instance.
 */
export interface TicketStore {
  /** Store a new ticket */
  create(ticket: ConnectionTicket): Promise<void>
  /** Consume a ticket (single-use). Returns null if not found, expired, or already used. */
  consume(ticketId: string): Promise<ConnectionTicket | null>
  /** Revoke a ticket before use */
  revoke(ticketId: string): Promise<void>
}

/**
 * WebSocket authentication configuration
 */
export interface WebSocketAuthConfig {
  /**
   * Auth mode:
   * - 'ticket': single-use token from HTTP endpoint (recommended for browsers)
   * - 'bearer': JWT/token in query param or first message
   * - 'custom': your own extraction logic
   */
  mode: 'ticket' | 'bearer' | 'custom'

  /** Ticket store (required for 'ticket' mode, default: in-memory) */
  ticketStore?: TicketStore

  /** Ticket TTL in ms (default: 30000 = 30s) */
  ticketTTL?: number

  /**
   * Extract auth token from the HTTP upgrade request.
   * Default: reads `?ticket=xxx` or `?token=xxx` from query string,
   * or `Authorization: Bearer xxx` header.
   */
  extractToken?: (req: import('http').IncomingMessage) => string | undefined

  /**
   * Validate a token and return auth context seed.
   * Called for 'bearer' and 'custom' modes.
   * Return null to reject the connection.
   */
  validateToken?: (token: string) => import('../types/index.js').ContextSeed | null | Promise<import('../types/index.js').ContextSeed | null>

  /**
   * Validate a refresh token sent mid-connection.
   * Return new context seed or null to reject.
   */
  refreshToken?: (token: string) => import('../types/index.js').ContextSeed | null | Promise<import('../types/index.js').ContextSeed | null>
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

/**
 * Per-connection rate limits for WebSocket operations
 */
export interface ChannelRateLimits {
  /** Max channels a single client can subscribe to (default: 100) */
  maxChannelsPerClient?: number
  /** Max subscribe operations per second per client (default: 10) */
  maxSubscribesPerSecond?: number
  /** Max publish operations per second per client (default: 10) */
  maxPublishesPerSecond?: number
  /** Max total messages per second per client (default: 50) */
  maxMessagesPerSecond?: number
  /** Called when a client is rate-limited */
  onRateLimited?: (socketId: string, operation: string, limit: number) => void
}

// ─── Backpressure ────────────────────────────────────────────────────────────

/**
 * Backpressure handling for slow consumers
 */
export interface BackpressureConfig {
  /** Max bytes buffered in the socket's write queue before action (default: 1MB) */
  maxBufferedAmount?: number
  /** What to do when buffer exceeds limit */
  strategy?: 'drop' | 'disconnect'
  /** Called when a slow consumer is detected */
  onSlowConsumer?: (socketId: string, bufferedAmount: number) => void
}

/**
 * Connected client info exposed via the manager
 */
export interface ClientInfo {
  /** Socket/connection ID */
  id: string
  /** User ID from auth context (if available) */
  userId?: string
  /** Custom data attached at connect time */
  data: Record<string, unknown>
  /** Channels this client is subscribed to */
  channels: string[]
  /** When the client connected */
  connectedAt: number
}

/**
 * Room: a private 1:1 channel between exactly two clients
 */
export interface RoomInfo {
  /** Auto-generated room name */
  name: string
  /** The two participant socket IDs */
  participants: [string, string]
  /** When the room was created */
  createdAt: number
}

/**
 * Group: a named collection of N clients for targeted messaging
 */
export interface GroupInfo {
  /** Group name */
  name: string
  /** Member socket IDs */
  members: Set<string>
  /** Custom metadata */
  data: Record<string, unknown>
  /** When the group was created */
  createdAt: number
}

/**
 * Lifecycle event data passed to hooks
 */
export interface ClientConnectEvent {
  socketId: string
  remoteAddress?: string
  headers: Record<string, string>
}

export interface ClientDisconnectEvent {
  socketId: string
  code: number
  reason: string
}

/**
 * Webhook-ready lifecycle hooks
 */
export interface ChannelLifecycleHooks {
  /** Called when a client connects (after auth/filter) */
  onConnect?: (event: ClientConnectEvent) => void | Promise<void>

  /** Called when a client disconnects */
  onDisconnect?: (event: ClientDisconnectEvent) => void | Promise<void>

  /** Called after a successful subscribe */
  onSubscribe?: (socketId: string, channel: string) => void | Promise<void>

  /** Called after unsubscribe */
  onUnsubscribe?: (socketId: string, channel: string) => void | Promise<void>

  /** Called when a member joins a presence channel */
  onMemberAdded?: (channel: string, member: ChannelMember) => void | Promise<void>

  /** Called when a member leaves a presence channel */
  onMemberRemoved?: (channel: string, member: ChannelMember) => void | Promise<void>

  /** Called after a successful publish to a channel */
  onPublish?: (socketId: string, channel: string, event: string, data: unknown) => void | Promise<void>

  /** Called when a new channel is created (first subscriber) */
  onChannelCreated?: (channel: string, type: ChannelType) => void | Promise<void>

  /** Called when a channel is destroyed (last subscriber left) */
  onChannelDestroyed?: (channel: string, type: ChannelType) => void | Promise<void>
}

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

  /** Lifecycle hooks for webhook integration */
  hooks?: ChannelLifecycleHooks

  /** Custom data to attach to clients on connect */
  clientData?: (
    socketId: string,
    ctx: Context
  ) => Record<string, unknown>

  /** Per-connection rate limits */
  rateLimits?: ChannelRateLimits

  /**
   * Message history configuration for catchup on reconnect.
   * When enabled, recent messages are stored and can be replayed
   * to clients that provide a `since` field in their subscribe message.
   */
  history?: {
    /** Enable message history (default: false) */
    enabled: boolean
    /** Max entries per channel (default: 100) */
    maxSize?: number
    /** TTL in ms for history entries (default: 300000 = 5 minutes) */
    ttl?: number
  }

  /**
   * Transform messages before broadcast.
   * Return null to drop the message.
   * Return modified data to transform.
   */
  transform?: (
    channel: string,
    event: string,
    data: unknown,
    ctx: { socketId: string; userId?: string }
  ) => unknown | null | Promise<unknown | null>

  /**
   * REST API configuration for server-side publishing.
   * When enabled, mounts HTTP endpoints for channel management.
   */
  restApi?: {
    /** Enable REST API (default: false) */
    enabled: boolean
    /** Base path for REST endpoints (default: '/channels') */
    path?: string
    /** API key for authentication (simple string check) */
    apiKey?: string
    /** Custom auth function (overrides apiKey) */
    auth?: (req: import('http').IncomingMessage) => boolean | Promise<boolean>
  }
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
  /** Monotonically increasing sequence number for message ordering */
  sequence: number
  /** Epoch identifier — changes on server restart (for detecting stale offsets) */
  epoch: string
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
   * Subscribe a socket to a channel.
   * Optionally pass `since` to replay missed messages from history.
   */
  subscribe(
    socketId: string,
    channel: string,
    ctx: Context,
    since?: { seq: number; epoch: string }
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

  // ─────────────────────────────────────────────────────────────
  // Client Inventory
  // ─────────────────────────────────────────────────────────────

  /**
   * Register a connected client (called by WS adapter on connect)
   */
  registerClient(socketId: string, info?: Partial<Pick<ClientInfo, 'userId' | 'data'>>): void

  /**
   * Remove a connected client (called by WS adapter on disconnect)
   */
  removeClient(socketId: string): void

  /**
   * Get info about a specific client
   */
  getClient(socketId: string): ClientInfo | undefined

  /**
   * Get all connected clients
   */
  getClients(): ClientInfo[]

  /**
   * Get total connected client count
   */
  getClientCount(): number

  /**
   * Send an event directly to a client (no channel needed)
   */
  sendToClient(socketId: string, event: string, data: unknown): void

  /**
   * Broadcast an event to ALL connected clients
   */
  broadcastAll(event: string, data: unknown, except?: string): void

  // ─────────────────────────────────────────────────────────────
  // Rooms (1:1 private channels)
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a private room between exactly two clients.
   * Both clients are auto-subscribed and can exchange messages.
   */
  createRoom(socketA: string, socketB: string): RoomInfo

  /**
   * Send an event to a room (both participants receive it)
   */
  sendToRoom(roomName: string, event: string, data: unknown, except?: string): void

  /**
   * Get room info
   */
  getRoom(roomName: string): RoomInfo | undefined

  /**
   * Get all rooms a client is in
   */
  getClientRooms(socketId: string): RoomInfo[]

  /**
   * Close a room (unsubscribe both participants)
   */
  closeRoom(roomName: string): void

  // ─────────────────────────────────────────────────────────────
  // Groups (N-client named collections)
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a named group
   */
  createGroup(name: string, data?: Record<string, unknown>): GroupInfo

  /**
   * Add a client to a group
   */
  joinGroup(groupName: string, socketId: string): void

  /**
   * Remove a client from a group
   */
  leaveGroup(groupName: string, socketId: string): void

  /**
   * Send an event to all members of a group
   */
  sendToGroup(groupName: string, event: string, data: unknown, except?: string): void

  /**
   * Get group info
   */
  getGroup(groupName: string): GroupInfo | undefined

  /**
   * Get all groups
   */
  getGroups(): GroupInfo[]

  /**
   * Get all groups a client belongs to
   */
  getClientGroups(socketId: string): GroupInfo[]

  /**
   * Delete a group
   */
  deleteGroup(groupName: string): void

  // ─────────────────────────────────────────────────────────────
  // Recovery
  // ─────────────────────────────────────────────────────────────

  /**
   * Recover a client's subscriptions from a previous session.
   * Re-subscribes the new socket to all channels and replays
   * missed messages from history (if available).
   */
  recoverClient(
    oldSocketId: string,
    newSocketId: string,
    channels: { name: string; lastSeq: number }[]
  ): void

  /**
   * Replay missed messages from history for a specific channel.
   * Called after subscribe+subscribed to send catchup messages.
   */
  replayHistory(
    socketId: string,
    channel: string,
    sinceSeq: number,
    epoch: string
  ): void

  /**
   * Get the current epoch for the server (used for history queries).
   */
  getEpoch(): string

  /**
   * Get the current sequence number for a channel.
   */
  getSequence(channel: string): number
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
  /** Resume from a specific sequence (for catchup on reconnect) */
  since?: { seq: number; epoch: string }
}

/**
 * Client → Server: Recover a previous session
 */
export interface RecoverMessage {
  type: 'recover'
  recoveryToken: string
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
  /** Sequence number (monotonically increasing per channel) */
  seq?: number
  /** Server epoch (changes on restart, used to detect stale offsets) */
  epoch?: string
}

/**
 * Client → Server: Refresh auth token mid-connection
 */
export interface AuthRefreshMessage {
  id: string
  type: 'auth:refresh'
  token: string
}

/**
 * Server → Client: Auth refresh result
 */
export interface AuthRefreshedMessage {
  id: string
  type: 'auth:refreshed'
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
  | AuthRefreshMessage
  | AuthRefreshedMessage
  | RecoverMessage

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
 * Check if a message is a recovery message
 */
export function isRecoverMessage(
  message: unknown
): message is RecoverMessage {
  if (!message || typeof message !== 'object') return false
  const msg = message as Record<string, unknown>
  return msg.type === 'recover' && typeof msg.recoveryToken === 'string'
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
