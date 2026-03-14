/**
 * Enhanced Channels Integration Tests
 *
 * Tests for the new WebSocket channel features:
 *   - Client inventory (register, remove, getClients, sendToClient, broadcastAll)
 *   - Rooms (1:1 private channels)
 *   - Groups (N-client named collections)
 *   - Lifecycle hooks (onConnect, onDisconnect, onSubscribe, onUnsubscribe, onMemberAdded, onMemberRemoved)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createChannelManager, type SendToSocketFn } from '../../src/channels/channel-manager.js'
import { createContext } from '../../src/types/context.js'
import type { ChannelOptions, ChannelMember } from '../../src/channels/types.js'

/** Collect messages sent to sockets */
function createMockSend(): {
  send: SendToSocketFn
  messages: Map<string, unknown[]>
  allMessages: Array<{ socketId: string; message: unknown }>
} {
  const messages = new Map<string, unknown[]>()
  const allMessages: Array<{ socketId: string; message: unknown }> = []

  return {
    send: (socketId, message) => {
      const list = messages.get(socketId) ?? []
      list.push(message)
      messages.set(socketId, list)
      allMessages.push({ socketId, message })
    },
    messages,
    allMessages,
  }
}

function makeCtx(requestId = 'req-1') {
  return createContext(requestId, {
    auth: { authenticated: true, principal: 'user-1' },
  })
}

// ─── Client Inventory ─────────────────────────────────────────────────────

describe('Client Inventory', () => {
  it('should register and retrieve clients', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('socket-1', { userId: 'alice' })
    manager.registerClient('socket-2', { userId: 'bob', data: { role: 'admin' } })

    const client1 = manager.getClient('socket-1')
    expect(client1).toBeTruthy()
    expect(client1!.id).toBe('socket-1')
    expect(client1!.userId).toBe('alice')

    const client2 = manager.getClient('socket-2')
    expect(client2!.data.role).toBe('admin')
  })

  it('should list all clients', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')
    manager.registerClient('s3')

    const clients = manager.getClients()
    expect(clients).toHaveLength(3)
    expect(manager.getClientCount()).toBe(3)
  })

  it('should remove client and clean up channels', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({
      authorize: () => true,
    }, send)

    manager.registerClient('s1')

    await manager.subscribe('s1', 'chat', makeCtx())
    expect(manager.isSubscribed('s1', 'chat')).toBe(true)

    manager.removeClient('s1')
    expect(manager.getClient('s1')).toBeUndefined()
    expect(manager.isSubscribed('s1', 'chat')).toBe(false)
  })

  it('should track client channels', async () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'chat-a', makeCtx())
    await manager.subscribe('s1', 'chat-b', makeCtx())

    const client = manager.getClient('s1')
    expect(client!.channels).toContain('chat-a')
    expect(client!.channels).toContain('chat-b')
  })

  it('should send to client directly (no channel)', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.sendToClient('s1', 'notification', { text: 'Hello!' })

    const received = messages.get('s1')!
    expect(received).toHaveLength(1)
    expect((received[0] as Record<string, unknown>).event).toBe('notification')
    expect((received[0] as Record<string, unknown>).data).toEqual({ text: 'Hello!' })
  })

  it('should broadcast to all clients', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')
    manager.registerClient('s3')

    manager.broadcastAll('announcement', { msg: 'Server restart in 5 minutes' })

    expect(messages.get('s1')).toHaveLength(1)
    expect(messages.get('s2')).toHaveLength(1)
    expect(messages.get('s3')).toHaveLength(1)
  })

  it('should broadcast to all except one', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')
    manager.registerClient('s3')

    manager.broadcastAll('typing', { user: 's1' }, 's1')

    expect(messages.get('s1')).toBeUndefined()
    expect(messages.get('s2')).toHaveLength(1)
    expect(messages.get('s3')).toHaveLength(1)
  })

  it('should not double-register', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1', { userId: 'alice' })
    manager.registerClient('s1', { userId: 'bob' }) // Should be ignored

    expect(manager.getClient('s1')!.userId).toBe('alice')
    expect(manager.getClientCount()).toBe(1)
  })
})

// ─── Rooms ────────────────────────────────────────────────────────────────

describe('Rooms (1:1)', () => {
  it('should create a room between two clients', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')

    const room = manager.createRoom('alice', 'bob')
    expect(room.participants).toContain('alice')
    expect(room.participants).toContain('bob')
    expect(room.name).toContain('room:')

    // Both should receive room:created event
    const aliceMsg = messages.get('alice')!
    const bobMsg = messages.get('bob')!
    expect(aliceMsg.some((m: unknown) => (m as Record<string, unknown>).event === 'room:created')).toBe(true)
    expect(bobMsg.some((m: unknown) => (m as Record<string, unknown>).event === 'room:created')).toBe(true)
  })

  it('should send messages to room', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')

    const room = manager.createRoom('alice', 'bob')

    // Clear creation messages
    messages.clear()

    manager.sendToRoom(room.name, 'message', { text: 'Hey!' })

    expect(messages.get('alice')).toHaveLength(1)
    expect(messages.get('bob')).toHaveLength(1)
  })

  it('should send to room excluding sender', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')

    const room = manager.createRoom('alice', 'bob')
    messages.clear()

    manager.sendToRoom(room.name, 'message', { text: 'Hey!' }, 'alice')

    expect(messages.get('alice')).toBeUndefined()
    expect(messages.get('bob')).toHaveLength(1)
  })

  it('should return same room for same pair', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')

    const room1 = manager.createRoom('alice', 'bob')
    const room2 = manager.createRoom('bob', 'alice') // Reversed order

    expect(room1.name).toBe(room2.name)
  })

  it('should list client rooms', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')
    manager.registerClient('charlie')

    manager.createRoom('alice', 'bob')
    manager.createRoom('alice', 'charlie')

    const aliceRooms = manager.getClientRooms('alice')
    expect(aliceRooms).toHaveLength(2)

    const bobRooms = manager.getClientRooms('bob')
    expect(bobRooms).toHaveLength(1)
  })

  it('should close room and notify participants', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')

    const room = manager.createRoom('alice', 'bob')
    messages.clear()

    manager.closeRoom(room.name)

    expect(manager.getRoom(room.name)).toBeUndefined()
    expect(manager.getClientRooms('alice')).toHaveLength(0)

    // Both should receive room:closed
    const aliceMsg = messages.get('alice')!
    expect(aliceMsg.some((m: unknown) => (m as Record<string, unknown>).event === 'room:closed')).toBe(true)
  })

  it('should clean up rooms when client disconnects', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('alice')
    manager.registerClient('bob')

    const room = manager.createRoom('alice', 'bob')

    manager.removeClient('alice')

    expect(manager.getRoom(room.name)).toBeUndefined()
  })
})

// ─── Groups ───────────────────────────────────────────────────────────────

describe('Groups (N-client)', () => {
  it('should create a group and add members', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')
    manager.registerClient('s3')

    const group = manager.createGroup('team-alpha', { project: 'tetis' })
    expect(group.name).toBe('team-alpha')
    expect(group.data.project).toBe('tetis')

    manager.joinGroup('team-alpha', 's1')
    manager.joinGroup('team-alpha', 's2')
    manager.joinGroup('team-alpha', 's3')

    const g = manager.getGroup('team-alpha')!
    expect(g.members.size).toBe(3)
  })

  it('should send events to group members', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')
    manager.registerClient('s3')

    manager.joinGroup('devs', 's1')
    manager.joinGroup('devs', 's2')
    // s3 NOT in group

    messages.clear()

    manager.sendToGroup('devs', 'deploy', { env: 'production' })

    expect(messages.get('s1')).toHaveLength(1)
    expect(messages.get('s2')).toHaveLength(1)
    expect(messages.get('s3')).toBeUndefined()
  })

  it('should send to group excluding sender', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')

    manager.joinGroup('devs', 's1')
    manager.joinGroup('devs', 's2')
    messages.clear()

    manager.sendToGroup('devs', 'typing', { user: 's1' }, 's1')

    expect(messages.get('s1')).toBeUndefined()
    expect(messages.get('s2')).toHaveLength(1)
  })

  it('should notify on join/leave', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')

    manager.joinGroup('team', 's1')
    messages.clear()

    manager.joinGroup('team', 's2')

    // s1 should get member_added notification
    const s1msgs = messages.get('s1')!
    expect(s1msgs.some((m: unknown) => (m as Record<string, unknown>).event === 'group:member_added')).toBe(true)

    messages.clear()

    manager.leaveGroup('team', 's2')

    const s1msgs2 = messages.get('s1')!
    expect(s1msgs2.some((m: unknown) => (m as Record<string, unknown>).event === 'group:member_removed')).toBe(true)
  })

  it('should auto-create group on joinGroup', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.joinGroup('new-group', 's1')

    expect(manager.getGroup('new-group')).toBeTruthy()
    expect(manager.getGroup('new-group')!.members.size).toBe(1)
  })

  it('should auto-delete empty group', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.joinGroup('temp', 's1')

    manager.leaveGroup('temp', 's1')
    expect(manager.getGroup('temp')).toBeUndefined()
  })

  it('should list client groups', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')

    manager.joinGroup('team-a', 's1')
    manager.joinGroup('team-b', 's1')

    const groups = manager.getClientGroups('s1')
    expect(groups).toHaveLength(2)
  })

  it('should list all groups', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.createGroup('g1')
    manager.createGroup('g2')
    manager.createGroup('g3')

    expect(manager.getGroups()).toHaveLength(3)
  })

  it('should delete group and notify members', () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')

    manager.joinGroup('doomed', 's1')
    manager.joinGroup('doomed', 's2')
    messages.clear()

    manager.deleteGroup('doomed')

    expect(manager.getGroup('doomed')).toBeUndefined()
    expect(messages.get('s1')![0]).toMatchObject({
      event: 'group:deleted',
    })
  })

  it('should clean up groups when client disconnects', () => {
    const { send } = createMockSend()
    const manager = createChannelManager({}, send)

    manager.registerClient('s1')
    manager.registerClient('s2')

    manager.joinGroup('team', 's1')
    manager.joinGroup('team', 's2')

    manager.removeClient('s1')

    const group = manager.getGroup('team')!
    expect(group.members.has('s1')).toBe(false)
    expect(group.members.size).toBe(1)
  })
})

// ─── Lifecycle Hooks ──────────────────────────────────────────────────────

describe('Lifecycle Hooks', () => {
  it('should call onSubscribe hook', async () => {
    const subscribed: string[] = []
    const { send } = createMockSend()

    const manager = createChannelManager({
      hooks: {
        onSubscribe: (socketId, channel) => {
          subscribed.push(`${socketId}:${channel}`)
        },
      },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'chat', makeCtx())

    // Hooks fire asynchronously
    await new Promise((r) => setTimeout(r, 10))
    expect(subscribed).toContain('s1:chat')
  })

  it('should call onUnsubscribe hook', async () => {
    const unsubscribed: string[] = []
    const { send } = createMockSend()

    const manager = createChannelManager({
      hooks: {
        onUnsubscribe: (socketId, channel) => {
          unsubscribed.push(`${socketId}:${channel}`)
        },
      },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'chat', makeCtx())
    manager.unsubscribe('s1', 'chat')

    await new Promise((r) => setTimeout(r, 10))
    expect(unsubscribed).toContain('s1:chat')
  })

  it('should call onMemberAdded hook for presence channels', async () => {
    const added: Array<{ channel: string; member: ChannelMember }> = []
    const { send } = createMockSend()

    const manager = createChannelManager({
      authorize: () => true,
      hooks: {
        onMemberAdded: (channel, member) => {
          added.push({ channel, member })
        },
      },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'presence-lobby', makeCtx())

    await new Promise((r) => setTimeout(r, 10))
    expect(added).toHaveLength(1)
    expect(added[0]!.channel).toBe('presence-lobby')
    expect(added[0]!.member.id).toBe('s1')
  })

  it('should call onMemberRemoved hook for presence channels', async () => {
    const removed: Array<{ channel: string; member: ChannelMember }> = []
    const { send } = createMockSend()

    const manager = createChannelManager({
      authorize: () => true,
      hooks: {
        onMemberRemoved: (channel, member) => {
          removed.push({ channel, member })
        },
      },
    }, send)

    manager.registerClient('s1')
    await manager.subscribe('s1', 'presence-lobby', makeCtx())
    manager.unsubscribe('s1', 'presence-lobby')

    await new Promise((r) => setTimeout(r, 10))
    expect(removed).toHaveLength(1)
    expect(removed[0]!.channel).toBe('presence-lobby')
    expect(removed[0]!.member.id).toBe('s1')
  })
})
