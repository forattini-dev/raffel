/**
 * Channel Manager
 *
 * Core state management for WebSocket channels.
 * Handles subscriptions, broadcasting, and presence tracking.
 */

import type { Context } from '../types/index.js'
import { getPrincipalId } from '../types/index.js'
import { sid } from '../utils/id/index.js'
import type { ChannelPresencePort } from '../ports/outbound/channel-presence.js'
import type {
  ChannelOptions,
  ChannelManager,
  ChannelState,
  ChannelMember,
  SubscribeResult,
  ClientInfo,
  RoomInfo,
  GroupInfo,
  ChannelRateLimits,
} from './types.js'
import { getChannelType } from './types.js'

// ─── Rate Limiter (sliding window per socket) ────────────────────────────────

interface RateBucket {
  count: number
  windowStart: number
}

function createRateLimiter(limits: ChannelRateLimits) {
  const buckets = new Map<string, RateBucket>()

  function checkLimit(key: string, maxPerSecond: number): boolean {
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || now - bucket.windowStart >= 1000) {
      buckets.set(key, { count: 1, windowStart: now })
      return true
    }

    if (bucket.count >= maxPerSecond) {
      return false
    }

    bucket.count++
    return true
  }

  function removeSocket(socketId: string): void {
    for (const key of buckets.keys()) {
      if (key.startsWith(socketId + ':')) {
        buckets.delete(key)
      }
    }
  }

  return { checkLimit, removeSocket }
}

/**
 * Function to send a message to a socket
 */
export type SendToSocketFn = (socketId: string, message: unknown) => void

function createInMemoryChannelPresencePort(): ChannelPresencePort {
  const membersByChannel = new Map<string, Map<string, ChannelMember>>()

  function getOrCreateMembers(channel: string): Map<string, ChannelMember> {
    let members = membersByChannel.get(channel)
    if (!members) {
      members = new Map()
      membersByChannel.set(channel, members)
    }
    return members
  }

  return {
    getMembers(channel: string): ChannelMember[] {
      const members = membersByChannel.get(channel)
      return members ? Array.from(members.values()) : []
    },
    getMember(channel: string, socketId: string): ChannelMember | undefined {
      return membersByChannel.get(channel)?.get(socketId)
    },
    getMemberCount(channel: string): number {
      return membersByChannel.get(channel)?.size ?? 0
    },
    addMember(channel: string, member: ChannelMember): void {
      getOrCreateMembers(channel).set(member.id, member)
    },
    removeMember(channel: string, socketId: string): void {
      const members = membersByChannel.get(channel)
      if (!members) return
      members.delete(socketId)
      if (members.size === 0) {
        membersByChannel.delete(channel)
      }
    },
    hasMember(channel: string, socketId: string): boolean {
      return membersByChannel.get(channel)?.has(socketId) ?? false
    },
  }
}

/**
 * Create a channel manager instance
 *
 * @param options - Channel configuration
 * @param sendToSocket - Function to send messages to sockets
 * @returns ChannelManager instance
 *
 * @example
 * ```typescript
 * const manager = createChannelManager(
 *   {
 *     authorize: async (socketId, channel, ctx) => {
 *       return ctx.auth?.authenticated ?? false
 *     },
 *     presenceData: (socketId, channel, ctx) => ({
 *       userId: ctx.auth?.principal,
 *       name: ctx.auth?.claims?.name,
 *     }),
 *   },
 *   (socketId, message) => {
 *     const client = clients.get(socketId)
 *     if (client) client.send(JSON.stringify(message))
 *   }
 * )
 * ```
 */
export function createChannelManager(
  options: ChannelOptions,
  sendToSocket: SendToSocketFn,
  presence: ChannelPresencePort = createInMemoryChannelPresencePort()
): ChannelManager {
  /** Channel state storage */
  const channels = new Map<string, ChannelState>()

  /** Reverse index: socket → channels */
  const socketChannels = new Map<string, Set<string>>()

  /** Connected clients inventory */
  const clientInventory = new Map<string, ClientInfo>()

  /** Rooms (1:1 private channels) */
  const rooms = new Map<string, RoomInfo>()

  /** Reverse index: socket → rooms */
  const socketRooms = new Map<string, Set<string>>()

  /** Groups (N-client collections) */
  const groups = new Map<string, GroupInfo>()

  /** Reverse index: socket → groups */
  const socketGroups = new Map<string, Set<string>>()

  /** Server epoch (unique per createChannelManager call / server restart) */
  const serverEpoch = sid()

  /** Rate limiter instance */
  const rateLimiter = options.rateLimits ? createRateLimiter(options.rateLimits) : null
  const rateLimits = options.rateLimits

  /**
   * Get or create a channel
   */
  function getOrCreateChannel(name: string): ChannelState {
    let channel = channels.get(name)
    if (!channel) {
      const type = getChannelType(name)
      channel = {
        name,
        type,
        subscribers: new Set(),
        createdAt: Date.now(),
        sequence: 0,
        epoch: serverEpoch,
      }
      channels.set(name, channel)
    }
    return channel
  }

  /**
   * Track socket → channel relationship
   */
  function trackSubscription(socketId: string, channel: string): void {
    let subs = socketChannels.get(socketId)
    if (!subs) {
      subs = new Set()
      socketChannels.set(socketId, subs)
    }
    subs.add(channel)
  }

  /**
   * Untrack socket → channel relationship
   */
  function untrackSubscription(socketId: string, channel: string): void {
    const subs = socketChannels.get(socketId)
    if (subs) {
      subs.delete(channel)
      if (subs.size === 0) {
        socketChannels.delete(socketId)
      }
    }
  }

  /**
   * Broadcast a message to channel subscribers
   */
  function broadcastMessage(
    channelName: string,
    event: string,
    data: unknown,
    except?: string
  ): void {
    const channel = channels.get(channelName)
    if (!channel) return

    // Increment sequence number
    channel.sequence++

    const message = {
      type: 'event',
      channel: channelName,
      event,
      data,
      seq: channel.sequence,
      epoch: channel.epoch,
    }

    for (const socketId of channel.subscribers) {
      if (socketId !== except) {
        sendToSocket(socketId, message)
      }
    }
  }

  /**
   * Clean up channel if empty
   */
  function cleanupIfEmpty(channelName: string): void {
    const channel = channels.get(channelName)
    if (channel && channel.subscribers.size === 0) {
      channels.delete(channelName)
    }
  }

  const manager: ChannelManager = {
    // ─────────────────────────────────────────────────────────────
    // Subscription Management
    // ─────────────────────────────────────────────────────────────

    async subscribe(
      socketId: string,
      channelName: string,
      ctx: Context
    ): Promise<SubscribeResult> {
      // Rate limit: max subscribes per second
      if (rateLimiter && rateLimits?.maxSubscribesPerSecond) {
        if (!rateLimiter.checkLimit(`${socketId}:sub`, rateLimits.maxSubscribesPerSecond)) {
          rateLimits.onRateLimited?.(socketId, 'subscribe', rateLimits.maxSubscribesPerSecond)
          return {
            success: false,
            error: {
              code: 'RATE_LIMITED',
              status: 429,
              message: 'Too many subscribe operations',
            },
          }
        }
      }

      // Rate limit: max channels per client
      if (rateLimits?.maxChannelsPerClient) {
        const currentCount = socketChannels.get(socketId)?.size ?? 0
        if (currentCount >= rateLimits.maxChannelsPerClient) {
          rateLimits.onRateLimited?.(socketId, 'max_channels', rateLimits.maxChannelsPerClient)
          return {
            success: false,
            error: {
              code: 'RATE_LIMITED',
              status: 429,
              message: `Max channels per client (${rateLimits.maxChannelsPerClient}) exceeded`,
            },
          }
        }
      }

      const type = getChannelType(channelName)

      // Authorization check (all channels when authorize is provided)
      if (options.authorize) {
        const allowed = await options.authorize(socketId, channelName, ctx)
        if (!allowed) {
          return {
            success: false,
            error: {
              code: 'PERMISSION_DENIED',
              status: 403,
              message: `Not authorized to subscribe to ${channelName}`,
            },
          }
        }
      } else if (type !== 'public') {
        // No authorize function → deny by default for private/presence
        return {
          success: false,
          error: {
            code: 'PERMISSION_DENIED',
            status: 403,
            message: `Authorization required for ${type} channels`,
          },
        }
      }

      const channel = getOrCreateChannel(channelName)

      // Already subscribed?
      if (channel.subscribers.has(socketId)) {
        // For presence, return current members
        if (type === 'presence') {
          return {
            success: true,
            members: presence.getMembers(channelName),
          }
        }
        return { success: true }
      }

      // Add subscriber
      channel.subscribers.add(socketId)
      trackSubscription(socketId, channelName)

      // Presence: track member and notify others
      if (type === 'presence') {
        const info = options.presenceData?.(socketId, channelName, ctx) ?? {}
        const member: ChannelMember = {
          id: socketId,
          userId: getPrincipalId(ctx.auth?.principal),
          info,
          joinedAt: Date.now(),
        }
        presence.addMember(channelName, member)

        // Notify existing members (not the new one)
        broadcastMessage(
          channelName,
          'member_added',
          {
            id: member.id,
            userId: member.userId,
            info: member.info,
          },
          socketId
        )

        // Lifecycle hook: member added
        if (options.hooks?.onMemberAdded) {
          Promise.resolve(options.hooks.onMemberAdded(channelName, member)).catch(() => {})
        }

        return {
          success: true,
          members: presence.getMembers(channelName),
        }
      }

      // Lifecycle hook: subscribe
      if (options.hooks?.onSubscribe) {
        Promise.resolve(options.hooks.onSubscribe(socketId, channelName)).catch(() => {})
      }

      return { success: true }
    },

    unsubscribe(socketId: string, channelName: string): void {
      const channel = channels.get(channelName)
      if (!channel) return

      if (!channel.subscribers.has(socketId)) return

      channel.subscribers.delete(socketId)
      untrackSubscription(socketId, channelName)

      // Presence: remove member and notify others
      if (channel.type === 'presence') {
        const member = presence.getMember(channelName, socketId)
        if (member) {
          presence.removeMember(channelName, socketId)
          broadcastMessage(channelName, 'member_removed', {
            id: socketId,
            userId: member.userId,
          })

          // Lifecycle hook: member removed
          if (options.hooks?.onMemberRemoved) {
            Promise.resolve(options.hooks.onMemberRemoved(channelName, member)).catch(() => {})
          }
        }
      }

      // Lifecycle hook: unsubscribe
      if (options.hooks?.onUnsubscribe) {
        Promise.resolve(options.hooks.onUnsubscribe(socketId, channelName)).catch(() => {})
      }

      cleanupIfEmpty(channelName)
    },

    unsubscribeAll(socketId: string): void {
      const subs = socketChannels.get(socketId)
      if (!subs) return

      // Copy because we're modifying during iteration
      const channelNames = Array.from(subs)
      for (const channelName of channelNames) {
        manager.unsubscribe(socketId, channelName)
      }

      socketChannels.delete(socketId)
    },

    isSubscribed(socketId: string, channelName: string): boolean {
      const channel = channels.get(channelName)
      return channel?.subscribers.has(socketId) ?? false
    },

    getSubscriptions(socketId: string): string[] {
      const subs = socketChannels.get(socketId)
      return subs ? Array.from(subs) : []
    },

    // ─────────────────────────────────────────────────────────────
    // Broadcasting
    // ─────────────────────────────────────────────────────────────

    broadcast(
      channelName: string,
      event: string,
      data: unknown,
      except?: string
    ): void {
      broadcastMessage(channelName, event, data, except)
    },

    sendToSocket(
      socketId: string,
      channelName: string,
      event: string,
      data: unknown
    ): void {
      const channel = channels.get(channelName)
      if (!channel || !channel.subscribers.has(socketId)) return

      sendToSocket(socketId, {
        type: 'event',
        channel: channelName,
        event,
        data,
      })
    },

    // ─────────────────────────────────────────────────────────────
    // Presence
    // ─────────────────────────────────────────────────────────────

    getMembers(channelName: string): ChannelMember[] {
      return presence.getMembers(channelName)
    },

    getMember(channelName: string, socketId: string): ChannelMember | undefined {
      return presence.getMember(channelName, socketId)
    },

    getMemberCount(channelName: string): number {
      return presence.getMemberCount(channelName)
    },

    // ─────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────

    kick(channelName: string, socketId: string): void {
      manager.unsubscribe(socketId, channelName)
    },

    getChannels(): string[] {
      return Array.from(channels.keys())
    },

    getSubscribers(channelName: string): string[] {
      const channel = channels.get(channelName)
      return channel ? Array.from(channel.subscribers) : []
    },

    hasChannel(channelName: string): boolean {
      return channels.has(channelName)
    },

    getSubscriberCount(channelName: string): number {
      const channel = channels.get(channelName)
      return channel?.subscribers.size ?? 0
    },

    // ─────────────────────────────────────────────────────────────
    // Client Inventory
    // ─────────────────────────────────────────────────────────────

    registerClient(socketId: string, info?: Partial<Pick<ClientInfo, 'userId' | 'data'>>): void {
      if (clientInventory.has(socketId)) return
      clientInventory.set(socketId, {
        id: socketId,
        userId: info?.userId,
        data: info?.data ?? {},
        channels: [],
        connectedAt: Date.now(),
      })
    },

    removeClient(socketId: string): void {
      // Clean up rate limiter state
      rateLimiter?.removeSocket(socketId)

      // Clean up rooms
      const clientRoomSet = socketRooms.get(socketId)
      if (clientRoomSet) {
        for (const roomName of Array.from(clientRoomSet)) {
          manager.closeRoom(roomName)
        }
        socketRooms.delete(socketId)
      }

      // Clean up groups
      const clientGroupSet = socketGroups.get(socketId)
      if (clientGroupSet) {
        for (const groupName of Array.from(clientGroupSet)) {
          manager.leaveGroup(groupName, socketId)
        }
        socketGroups.delete(socketId)
      }

      // Unsubscribe from all channels
      manager.unsubscribeAll(socketId)

      clientInventory.delete(socketId)
    },

    getClient(socketId: string): ClientInfo | undefined {
      const info = clientInventory.get(socketId)
      if (!info) return undefined
      return {
        ...info,
        channels: manager.getSubscriptions(socketId),
      }
    },

    getClients(): ClientInfo[] {
      return Array.from(clientInventory.values()).map((info) => ({
        ...info,
        channels: manager.getSubscriptions(info.id),
      }))
    },

    getClientCount(): number {
      return clientInventory.size
    },

    sendToClient(socketId: string, event: string, data: unknown): void {
      sendToSocket(socketId, {
        type: 'event',
        event,
        data,
      })
    },

    broadcastAll(event: string, data: unknown, except?: string): void {
      const message = { type: 'event', event, data }
      for (const socketId of clientInventory.keys()) {
        if (socketId !== except) {
          sendToSocket(socketId, message)
        }
      }
    },

    // ─────────────────────────────────────────────────────────────
    // Rooms (1:1)
    // ─────────────────────────────────────────────────────────────

    createRoom(socketA: string, socketB: string): RoomInfo {
      // Deterministic room name (sorted IDs)
      const sorted = [socketA, socketB].sort()
      const roomName = `room:${sorted[0]}:${sorted[1]}`

      // Return existing room if already created
      const existing = rooms.get(roomName)
      if (existing) return existing

      const room: RoomInfo = {
        name: roomName,
        participants: [sorted[0]!, sorted[1]!],
        createdAt: Date.now(),
      }
      rooms.set(roomName, room)

      // Track reverse index
      for (const id of sorted) {
        let set = socketRooms.get(id!)
        if (!set) { set = new Set(); socketRooms.set(id!, set) }
        set.add(roomName)
      }

      // Notify both participants
      for (const id of sorted) {
        sendToSocket(id!, {
          type: 'event',
          event: 'room:created',
          data: { room: roomName, participants: room.participants },
        })
      }

      return room
    },

    sendToRoom(roomName: string, event: string, data: unknown, except?: string): void {
      const room = rooms.get(roomName)
      if (!room) return

      const message = { type: 'event', channel: roomName, event, data }
      for (const id of room.participants) {
        if (id !== except) {
          sendToSocket(id, message)
        }
      }
    },

    getRoom(roomName: string): RoomInfo | undefined {
      return rooms.get(roomName)
    },

    getClientRooms(socketId: string): RoomInfo[] {
      const set = socketRooms.get(socketId)
      if (!set) return []
      return Array.from(set)
        .map((name) => rooms.get(name))
        .filter((r): r is RoomInfo => !!r)
    },

    closeRoom(roomName: string): void {
      const room = rooms.get(roomName)
      if (!room) return

      // Notify participants
      for (const id of room.participants) {
        sendToSocket(id, {
          type: 'event',
          event: 'room:closed',
          data: { room: roomName },
        })

        // Clean reverse index
        socketRooms.get(id)?.delete(roomName)
      }

      rooms.delete(roomName)
    },

    // ─────────────────────────────────────────────────────────────
    // Groups
    // ─────────────────────────────────────────────────────────────

    createGroup(name: string, data?: Record<string, unknown>): GroupInfo {
      const existing = groups.get(name)
      if (existing) return existing

      const group: GroupInfo = {
        name,
        members: new Set(),
        data: data ?? {},
        createdAt: Date.now(),
      }
      groups.set(name, group)
      return group
    },

    joinGroup(groupName: string, socketId: string): void {
      let group = groups.get(groupName)
      if (!group) {
        group = manager.createGroup(groupName)
      }

      if (group.members.has(socketId)) return

      group.members.add(socketId)

      // Track reverse index
      let set = socketGroups.get(socketId)
      if (!set) { set = new Set(); socketGroups.set(socketId, set) }
      set.add(groupName)

      // Notify existing members
      const message = {
        type: 'event',
        channel: `group:${groupName}`,
        event: 'group:member_added',
        data: { group: groupName, socketId },
      }
      for (const memberId of group.members) {
        if (memberId !== socketId) {
          sendToSocket(memberId, message)
        }
      }
    },

    leaveGroup(groupName: string, socketId: string): void {
      const group = groups.get(groupName)
      if (!group) return

      if (!group.members.has(socketId)) return

      group.members.delete(socketId)
      socketGroups.get(socketId)?.delete(groupName)

      // Notify remaining members
      const message = {
        type: 'event',
        channel: `group:${groupName}`,
        event: 'group:member_removed',
        data: { group: groupName, socketId },
      }
      for (const memberId of group.members) {
        sendToSocket(memberId, message)
      }

      // Auto-delete empty groups
      if (group.members.size === 0) {
        groups.delete(groupName)
      }
    },

    sendToGroup(groupName: string, event: string, data: unknown, except?: string): void {
      const group = groups.get(groupName)
      if (!group) return

      const message = { type: 'event', channel: `group:${groupName}`, event, data }
      for (const memberId of group.members) {
        if (memberId !== except) {
          sendToSocket(memberId, message)
        }
      }
    },

    getGroup(groupName: string): GroupInfo | undefined {
      return groups.get(groupName)
    },

    getGroups(): GroupInfo[] {
      return Array.from(groups.values())
    },

    getClientGroups(socketId: string): GroupInfo[] {
      const set = socketGroups.get(socketId)
      if (!set) return []
      return Array.from(set)
        .map((name) => groups.get(name))
        .filter((g): g is GroupInfo => !!g)
    },

    deleteGroup(groupName: string): void {
      const group = groups.get(groupName)
      if (!group) return

      // Notify all members
      const message = {
        type: 'event',
        channel: `group:${groupName}`,
        event: 'group:deleted',
        data: { group: groupName },
      }
      for (const memberId of group.members) {
        sendToSocket(memberId, message)
        socketGroups.get(memberId)?.delete(groupName)
      }

      groups.delete(groupName)
    },
  }

  return manager
}
