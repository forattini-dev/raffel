/**
 * Channel Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChannelManager } from './channel-manager.js'
import type { ChannelOptions, ChannelMember } from './types.js'
import { createContext } from '../types/index.js'

describe('ChannelManager', () => {
  const mockSend = vi.fn()
  let sentMessages: Array<{ socketId: string; message: unknown }> = []

  beforeEach(() => {
    mockSend.mockReset()
    sentMessages = []
    mockSend.mockImplementation((socketId: string, message: unknown) => {
      sentMessages.push({ socketId, message })
    })
  })

  function createTestContext(auth?: { authenticated: boolean; principal?: string }) {
    const ctx = createContext('test-request')
    if (auth) {
      return { ...ctx, auth }
    }
    return ctx
  }

  describe('Public Channels', () => {
    it('should allow subscription to public channels', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      const result = await manager.subscribe('socket-1', 'chat-room', ctx)

      expect(result.success).toBe(true)
      expect(manager.isSubscribed('socket-1', 'chat-room')).toBe(true)
    })

    it('should track subscriptions per socket', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-1', 'announcements', ctx)

      const subs = manager.getSubscriptions('socket-1')
      expect(subs).toContain('chat-room')
      expect(subs).toContain('announcements')
    })

    it('should broadcast to all subscribers', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'chat-room', ctx)
      await manager.subscribe('socket-3', 'chat-room', ctx)

      manager.broadcast('chat-room', 'message', { text: 'Hello!' })

      expect(sentMessages).toHaveLength(3)
      expect(sentMessages[0]).toEqual({
        socketId: 'socket-1',
        message: {
          type: 'event',
          channel: 'chat-room',
          event: 'message',
          data: { text: 'Hello!' },
        },
      })
    })

    it('should exclude sender from broadcast', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'chat-room', ctx)

      manager.broadcast('chat-room', 'message', { text: 'Hello!' }, 'socket-1')

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].socketId).toBe('socket-2')
    })

    it('should unsubscribe from channel', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      expect(manager.isSubscribed('socket-1', 'chat-room')).toBe(true)

      manager.unsubscribe('socket-1', 'chat-room')
      expect(manager.isSubscribed('socket-1', 'chat-room')).toBe(false)
    })

    it('should unsubscribe from all channels on disconnect', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-1', 'announcements', ctx)

      manager.unsubscribeAll('socket-1')

      expect(manager.getSubscriptions('socket-1')).toHaveLength(0)
      expect(manager.isSubscribed('socket-1', 'chat-room')).toBe(false)
      expect(manager.isSubscribed('socket-1', 'announcements')).toBe(false)
    })

    it('should cleanup empty channels', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      expect(manager.hasChannel('chat-room')).toBe(true)

      manager.unsubscribe('socket-1', 'chat-room')
      expect(manager.hasChannel('chat-room')).toBe(false)
    })

    it('should send to specific socket', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'chat-room', ctx)

      manager.sendToSocket('socket-1', 'chat-room', 'private', { secret: true })

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].socketId).toBe('socket-1')
    })

    it('should not send to non-subscribed socket', async () => {
      const manager = createChannelManager({}, mockSend)

      manager.sendToSocket('socket-1', 'chat-room', 'message', { text: 'hi' })

      expect(sentMessages).toHaveLength(0)
    })
  })

  describe('Private Channels', () => {
    it('should deny subscription without authorize function', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      const result = await manager.subscribe('socket-1', 'private-user-123', ctx)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PERMISSION_DENIED')
      expect(result.error?.status).toBe(403)
    })

    it('should deny subscription when authorize returns false', async () => {
      const options: ChannelOptions = {
        authorize: vi.fn().mockResolvedValue(false),
      }
      const manager = createChannelManager(options, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-456' })

      const result = await manager.subscribe('socket-1', 'private-user-123', ctx)

      expect(result.success).toBe(false)
      expect(options.authorize).toHaveBeenCalledWith('socket-1', 'private-user-123', ctx)
    })

    it('should allow subscription when authorize returns true', async () => {
      const options: ChannelOptions = {
        authorize: vi.fn().mockResolvedValue(true),
      }
      const manager = createChannelManager(options, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-123' })

      const result = await manager.subscribe('socket-1', 'private-user-123', ctx)

      expect(result.success).toBe(true)
      expect(manager.isSubscribed('socket-1', 'private-user-123')).toBe(true)
    })

    it('should support async authorize function', async () => {
      const options: ChannelOptions = {
        authorize: async (socketId, channel, ctx) => {
          await new Promise((r) => setTimeout(r, 10))
          return ctx.auth?.authenticated === true
        },
      }
      const manager = createChannelManager(options, mockSend)
      const ctx = createTestContext({ authenticated: true })

      const result = await manager.subscribe('socket-1', 'private-channel', ctx)

      expect(result.success).toBe(true)
    })
  })

  describe('Presence Channels', () => {
    const presenceOptions: ChannelOptions = {
      authorize: () => true,
      presenceData: (socketId, channel, ctx) => ({
        name: `User ${socketId}`,
        avatar: `https://example.com/${socketId}.png`,
      }),
    }

    it('should deny subscription without authorize function', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      const result = await manager.subscribe('socket-1', 'presence-lobby', ctx)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PERMISSION_DENIED')
    })

    it('should track members on subscribe', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-1' })

      const result = await manager.subscribe('socket-1', 'presence-lobby', ctx)

      expect(result.success).toBe(true)
      expect(result.members).toHaveLength(1)
      expect(result.members![0]).toMatchObject({
        id: 'socket-1',
        userId: 'user-1',
        info: {
          name: 'User socket-1',
          avatar: 'https://example.com/socket-1.png',
        },
      })
    })

    it('should return all members on subscribe', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx1 = createTestContext({ authenticated: true, principal: 'user-1' })
      const ctx2 = createTestContext({ authenticated: true, principal: 'user-2' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx1)
      const result = await manager.subscribe('socket-2', 'presence-lobby', ctx2)

      expect(result.members).toHaveLength(2)
    })

    it('should broadcast member_added on new subscription', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx1 = createTestContext({ authenticated: true, principal: 'user-1' })
      const ctx2 = createTestContext({ authenticated: true, principal: 'user-2' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx1)
      sentMessages = [] // Clear

      await manager.subscribe('socket-2', 'presence-lobby', ctx2)

      // socket-1 should receive member_added for socket-2
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].socketId).toBe('socket-1')
      expect(sentMessages[0].message).toMatchObject({
        type: 'event',
        channel: 'presence-lobby',
        event: 'member_added',
        data: {
          id: 'socket-2',
          userId: 'user-2',
        },
      })
    })

    it('should broadcast member_removed on unsubscribe', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx1 = createTestContext({ authenticated: true, principal: 'user-1' })
      const ctx2 = createTestContext({ authenticated: true, principal: 'user-2' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx1)
      await manager.subscribe('socket-2', 'presence-lobby', ctx2)
      sentMessages = [] // Clear

      manager.unsubscribe('socket-2', 'presence-lobby')

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].socketId).toBe('socket-1')
      expect(sentMessages[0].message).toMatchObject({
        type: 'event',
        channel: 'presence-lobby',
        event: 'member_removed',
        data: {
          id: 'socket-2',
          userId: 'user-2',
        },
      })
    })

    it('should get members list', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx1 = createTestContext({ authenticated: true, principal: 'user-1' })
      const ctx2 = createTestContext({ authenticated: true, principal: 'user-2' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx1)
      await manager.subscribe('socket-2', 'presence-lobby', ctx2)

      const members = manager.getMembers('presence-lobby')
      expect(members).toHaveLength(2)
    })

    it('should get specific member', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-1' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx)

      const member = manager.getMember('presence-lobby', 'socket-1')
      expect(member).toBeDefined()
      expect(member?.userId).toBe('user-1')
    })

    it('should get member count', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx = createTestContext({ authenticated: true })

      await manager.subscribe('socket-1', 'presence-lobby', ctx)
      await manager.subscribe('socket-2', 'presence-lobby', ctx)

      expect(manager.getMemberCount('presence-lobby')).toBe(2)
    })

    it('should handle re-subscription gracefully', async () => {
      const manager = createChannelManager(presenceOptions, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-1' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx)
      sentMessages = []

      // Re-subscribe
      const result = await manager.subscribe('socket-1', 'presence-lobby', ctx)

      // Should succeed without adding duplicate
      expect(result.success).toBe(true)
      expect(result.members).toHaveLength(1)
      expect(sentMessages).toHaveLength(0) // No duplicate notifications
    })
  })

  describe('Admin Operations', () => {
    it('should kick user from channel', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'chat-room', ctx)

      manager.kick('chat-room', 'socket-1')

      expect(manager.isSubscribed('socket-1', 'chat-room')).toBe(false)
      expect(manager.isSubscribed('socket-2', 'chat-room')).toBe(true)
    })

    it('should get all channel names', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'announcements', ctx)

      const channels = manager.getChannels()
      expect(channels).toContain('chat-room')
      expect(channels).toContain('announcements')
    })

    it('should get subscribers for channel', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'chat-room', ctx)

      const subs = manager.getSubscribers('chat-room')
      expect(subs).toContain('socket-1')
      expect(subs).toContain('socket-2')
    })

    it('should get subscriber count', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)
      await manager.subscribe('socket-2', 'chat-room', ctx)
      await manager.subscribe('socket-3', 'chat-room', ctx)

      expect(manager.getSubscriberCount('chat-room')).toBe(3)
    })

    it('should return 0 for non-existent channel', () => {
      const manager = createChannelManager({}, mockSend)

      expect(manager.getSubscriberCount('non-existent')).toBe(0)
      expect(manager.getMemberCount('non-existent')).toBe(0)
      expect(manager.getMembers('non-existent')).toEqual([])
      expect(manager.getSubscribers('non-existent')).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    it('should handle unsubscribe from non-existent channel', () => {
      const manager = createChannelManager({}, mockSend)

      // Should not throw
      expect(() => manager.unsubscribe('socket-1', 'non-existent')).not.toThrow()
    })

    it('should handle unsubscribe from non-subscribed channel', async () => {
      const manager = createChannelManager({}, mockSend)
      const ctx = createTestContext()

      await manager.subscribe('socket-1', 'chat-room', ctx)

      // Should not throw
      expect(() => manager.unsubscribe('socket-2', 'chat-room')).not.toThrow()
    })

    it('should handle broadcast to non-existent channel', () => {
      const manager = createChannelManager({}, mockSend)

      // Should not throw
      expect(() =>
        manager.broadcast('non-existent', 'event', { data: 'test' })
      ).not.toThrow()
      expect(sentMessages).toHaveLength(0)
    })

    it('should handle kick from presence channel', async () => {
      const options: ChannelOptions = {
        authorize: () => true,
        presenceData: () => ({ name: 'Test' }),
      }
      const manager = createChannelManager(options, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-1' })

      await manager.subscribe('socket-1', 'presence-lobby', ctx)
      await manager.subscribe('socket-2', 'presence-lobby', ctx)
      sentMessages = []

      manager.kick('presence-lobby', 'socket-1')

      // Should notify remaining members
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0].socketId).toBe('socket-2')
      expect(sentMessages[0].message).toMatchObject({
        event: 'member_removed',
        data: { id: 'socket-1' },
      })
    })

    it('should handle presence data without presenceData callback', async () => {
      const options: ChannelOptions = {
        authorize: () => true,
        // No presenceData callback
      }
      const manager = createChannelManager(options, mockSend)
      const ctx = createTestContext({ authenticated: true, principal: 'user-1' })

      const result = await manager.subscribe('socket-1', 'presence-lobby', ctx)

      expect(result.success).toBe(true)
      expect(result.members![0].info).toEqual({}) // Empty info
    })
  })
})
