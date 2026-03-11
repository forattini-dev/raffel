/**
 * Channel Manager
 *
 * Core state management for WebSocket channels.
 * Handles subscriptions, broadcasting, and presence tracking.
 */

import type { Context } from '../types/index.js'
import { getPrincipalId } from '../types/index.js'
import type { ChannelPresencePort } from '../ports/outbound/channel-presence.js'
import type {
  ChannelOptions,
  ChannelManager,
  ChannelState,
  ChannelMember,
  SubscribeResult,
} from './types.js'
import { getChannelType } from './types.js'

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

    const message = {
      type: 'event',
      channel: channelName,
      event,
      data,
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

        return {
          success: true,
          members: presence.getMembers(channelName),
        }
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
        }
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
  }

  return manager
}
