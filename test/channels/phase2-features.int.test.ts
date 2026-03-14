/**
 * Phase 2 Features Integration Tests
 *
 * Tests for:
 *   - Message History (catchup on reconnect)
 *   - Connection State Recovery
 *   - Channel Transformers
 *   - Extended Lifecycle Hooks (onPublish, onChannelCreated, onChannelDestroyed)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createChannelManager,
  type SendToSocketFn,
} from '../../src/channels/channel-manager.js'
import {
  createMemoryHistoryStore,
  type ChannelHistoryPort,
} from '../../src/channels/history.js'
import {
  createMemoryRecoveryStore,
  generateRecoveryToken,
} from '../../src/channels/recovery.js'
import { createContext } from '../../src/types/context.js'
import { isRecoverMessage } from '../../src/channels/types.js'

function createMockSend(): {
  send: SendToSocketFn
  messages: Map<string, unknown[]>
} {
  const messages = new Map<string, unknown[]>()
  return {
    send: (socketId, message) => {
      const list = messages.get(socketId) ?? []
      list.push(message)
      messages.set(socketId, list)
    },
    messages,
  }
}

function makeCtx(requestId = 'req-1', userId = 'user-1') {
  return createContext(requestId, {
    auth: { authenticated: true, principal: userId },
  })
}

// ─── Message History ──────────────────────────────────────────────────────────

describe('Message History', () => {
  it('should create a memory history store', () => {
    const store = createMemoryHistoryStore({ maxSize: 10 })
    expect(store).toBeDefined()
    store.dispose()
  })

  it('should store and retrieve entries', () => {
    const store = createMemoryHistoryStore({ maxSize: 100 })
    const epoch = 'ep-1'

    store.append({
      id: '1', channel: 'chat', event: 'msg', data: { text: 'A' },
      seq: 1, epoch, timestamp: Date.now(),
    })
    store.append({
      id: '2', channel: 'chat', event: 'msg', data: { text: 'B' },
      seq: 2, epoch, timestamp: Date.now(),
    })
    store.append({
      id: '3', channel: 'chat', event: 'msg', data: { text: 'C' },
      seq: 3, epoch, timestamp: Date.now(),
    })

    const after1 = store.getAfterSeq('chat', 1, epoch)
    expect(after1).toHaveLength(2)
    expect(after1[0]!.seq).toBe(2)
    expect(after1[1]!.seq).toBe(3)

    const after0 = store.getAfterSeq('chat', 0, epoch)
    expect(after0).toHaveLength(3)

    const after3 = store.getAfterSeq('chat', 3, epoch)
    expect(after3).toHaveLength(0)

    store.dispose()
  })

  it('should respect epoch when retrieving', () => {
    const store = createMemoryHistoryStore({ maxSize: 100 })

    store.append({
      id: '1', channel: 'chat', event: 'msg', data: { text: 'A' },
      seq: 1, epoch: 'old-epoch', timestamp: Date.now(),
    })
    store.append({
      id: '2', channel: 'chat', event: 'msg', data: { text: 'B' },
      seq: 2, epoch: 'new-epoch', timestamp: Date.now(),
    })

    // Requesting old epoch should NOT return new epoch entries
    const results = store.getAfterSeq('chat', 0, 'old-epoch')
    expect(results).toHaveLength(1)
    expect(results[0]!.data).toEqual({ text: 'A' })

    store.dispose()
  })

  it('should respect maxSize circular buffer', () => {
    const store = createMemoryHistoryStore({ maxSize: 3 })
    const epoch = 'ep-1'

    for (let i = 1; i <= 5; i++) {
      store.append({
        id: String(i), channel: 'chat', event: 'msg', data: { n: i },
        seq: i, epoch, timestamp: Date.now(),
      })
    }

    const all = store.getAfterSeq('chat', 0, epoch)
    // Only last 3 should remain
    expect(all).toHaveLength(3)
    expect(all[0]!.seq).toBe(3)
    expect(all[1]!.seq).toBe(4)
    expect(all[2]!.seq).toBe(5)

    store.dispose()
  })

  it('should respect limit parameter', () => {
    const store = createMemoryHistoryStore({ maxSize: 100 })
    const epoch = 'ep-1'

    for (let i = 1; i <= 10; i++) {
      store.append({
        id: String(i), channel: 'chat', event: 'msg', data: { n: i },
        seq: i, epoch, timestamp: Date.now(),
      })
    }

    const limited = store.getAfterSeq('chat', 0, epoch, 3)
    expect(limited).toHaveLength(3)
    expect(limited[0]!.seq).toBe(1)
    expect(limited[2]!.seq).toBe(3)

    store.dispose()
  })

  it('should trim entries', () => {
    const store = createMemoryHistoryStore({ maxSize: 100 })
    const epoch = 'ep-1'

    for (let i = 1; i <= 10; i++) {
      store.append({
        id: String(i), channel: 'chat', event: 'msg', data: { n: i },
        seq: i, epoch, timestamp: Date.now(),
      })
    }

    store.trim('chat', 5)
    const all = store.getAfterSeq('chat', 0, epoch)
    expect(all).toHaveLength(5)
    expect(all[0]!.seq).toBe(6)

    store.dispose()
  })

  it('should expire entries by TTL', () => {
    const store = createMemoryHistoryStore({ maxSize: 100, ttl: 50 })
    const epoch = 'ep-1'

    // Entry with old timestamp
    store.append({
      id: '1', channel: 'chat', event: 'msg', data: { text: 'old' },
      seq: 1, epoch, timestamp: Date.now() - 100,
    })
    // Entry with fresh timestamp
    store.append({
      id: '2', channel: 'chat', event: 'msg', data: { text: 'new' },
      seq: 2, epoch, timestamp: Date.now(),
    })

    const results = store.getAfterSeq('chat', 0, epoch)
    // Old entry should be filtered by TTL
    expect(results).toHaveLength(1)
    expect(results[0]!.data).toEqual({ text: 'new' })

    store.dispose()
  })
})

// ─── History Integration with ChannelManager ─────────────────────────────────

describe('History Integration', () => {
  it('should store broadcast messages in history and replay via replayHistory', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { history: { enabled: true, maxSize: 50 } },
      send
    )

    await manager.subscribe('s1', 'chat', makeCtx())

    manager.broadcast('chat', 'msg', { text: 'first' })
    manager.broadcast('chat', 'msg', { text: 'second' })
    manager.broadcast('chat', 'msg', { text: 'third' })

    // Get epoch from one of s1's messages
    const s1Msgs = messages.get('s1')!
    const firstMsg = s1Msgs[0] as Record<string, unknown>
    const epoch = firstMsg.epoch as string

    // Subscribe s2 normally
    await manager.subscribe('s2', 'chat', makeCtx())

    // Then replay history after subscribe
    manager.replayHistory('s2', 'chat', 1, epoch)

    const s2Msgs = messages.get('s2')!
    // Should have received the 2 missed messages (seq 2 and 3)
    expect(s2Msgs).toHaveLength(2)
    expect((s2Msgs[0] as Record<string, unknown>).seq).toBe(2)
    expect((s2Msgs[1] as Record<string, unknown>).seq).toBe(3)
  })

  it('should not replay history when history is disabled', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager({}, send)

    await manager.subscribe('s1', 'chat', makeCtx())
    manager.broadcast('chat', 'msg', { text: 'hello' })

    // Subscribe and try replay — should be a no-op (no history store)
    await manager.subscribe('s2', 'chat', makeCtx())
    manager.replayHistory('s2', 'chat', 0, 'any')
    const s2Msgs = messages.get('s2')
    expect(s2Msgs).toBeUndefined()
  })
})

// ─── Connection Recovery Store ───────────────────────────────────────────────

describe('Connection Recovery Store', () => {
  it('should save and retrieve sessions', () => {
    const store = createMemoryRecoveryStore({ ttl: 10_000 })

    const session = {
      recoveryToken: 'rec_abc123',
      socketId: 'old-socket',
      userId: 'user-1',
      channels: [{ name: 'chat', lastSeq: 5 }],
      groups: ['team-a'],
      metadata: { role: 'admin' },
      expiresAt: Date.now() + 10_000,
    }

    store.save(session)
    const retrieved = store.get('rec_abc123')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.socketId).toBe('old-socket')
    expect(retrieved!.channels).toHaveLength(1)
    expect(retrieved!.groups).toContain('team-a')

    store.dispose()
  })

  it('should return null for expired sessions', () => {
    const store = createMemoryRecoveryStore()

    store.save({
      recoveryToken: 'rec_expired',
      socketId: 'old',
      channels: [],
      groups: [],
      metadata: {},
      expiresAt: Date.now() - 1000, // Already expired
    })

    expect(store.get('rec_expired')).toBeNull()
    store.dispose()
  })

  it('should delete sessions', () => {
    const store = createMemoryRecoveryStore()

    store.save({
      recoveryToken: 'rec_del',
      socketId: 'old',
      channels: [],
      groups: [],
      metadata: {},
      expiresAt: Date.now() + 10_000,
    })

    store.delete('rec_del')
    expect(store.get('rec_del')).toBeNull()
    store.dispose()
  })

  it('should generate unique recovery tokens', () => {
    const t1 = generateRecoveryToken()
    const t2 = generateRecoveryToken()
    expect(t1).toMatch(/^rec_/)
    expect(t2).toMatch(/^rec_/)
    expect(t1).not.toBe(t2)
  })
})

// ─── Recovery Integration with ChannelManager ────────────────────────────────

describe('ChannelManager Recovery', () => {
  it('should recover client subscriptions', async () => {
    const { send, messages } = createMockSend()
    const manager = createChannelManager(
      { history: { enabled: true, maxSize: 50 } },
      send
    )

    // Original client subscribes and receives messages
    await manager.subscribe('old-socket', 'chat-a', makeCtx())
    await manager.subscribe('old-socket', 'chat-b', makeCtx())
    manager.broadcast('chat-a', 'msg', { n: 1 })
    manager.broadcast('chat-a', 'msg', { n: 2 })
    manager.broadcast('chat-b', 'msg', { n: 1 })

    // Get epoch
    const oldMsgs = messages.get('old-socket')!
    const epoch = (oldMsgs[0] as Record<string, unknown>).epoch as string

    // Simulate disconnect
    manager.removeClient('old-socket')

    // Register new client and recover
    manager.registerClient('new-socket', { userId: 'user-1' })
    manager.recoverClient('old-socket', 'new-socket', [
      { name: 'chat-a', lastSeq: 1 },
      { name: 'chat-b', lastSeq: 0 },
    ])

    // new-socket should be subscribed to both channels
    expect(manager.isSubscribed('new-socket', 'chat-a')).toBe(true)
    expect(manager.isSubscribed('new-socket', 'chat-b')).toBe(true)

    // Should have received missed messages
    const newMsgs = messages.get('new-socket')!
    // chat-a: seq 2 missed (seq > 1), chat-b: seq 1 missed (seq > 0)
    expect(newMsgs.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── isRecoverMessage Helper ──────────────────────────────────────────────────

describe('isRecoverMessage', () => {
  it('should identify recover messages', () => {
    expect(isRecoverMessage({ type: 'recover', recoveryToken: 'abc' })).toBe(true)
    expect(isRecoverMessage({ type: 'recover' })).toBe(false)
    expect(isRecoverMessage({ type: 'subscribe', channel: 'chat' })).toBe(false)
    expect(isRecoverMessage(null)).toBe(false)
    expect(isRecoverMessage(42)).toBe(false)
  })
})

// ─── Extended Lifecycle Hooks ─────────────────────────────────────────────────

describe('Extended Lifecycle Hooks', () => {
  it('should call onChannelCreated when first subscriber joins', async () => {
    const onChannelCreated = vi.fn()
    const { send } = createMockSend()
    const manager = createChannelManager(
      { hooks: { onChannelCreated } },
      send
    )

    await manager.subscribe('s1', 'chat', makeCtx())

    // Wait for async hook
    await new Promise((r) => setTimeout(r, 10))

    expect(onChannelCreated).toHaveBeenCalledWith('chat', 'public')
  })

  it('should call onChannelDestroyed when last subscriber leaves', async () => {
    const onChannelDestroyed = vi.fn()
    const { send } = createMockSend()
    const manager = createChannelManager(
      { hooks: { onChannelDestroyed } },
      send
    )

    await manager.subscribe('s1', 'chat', makeCtx())
    manager.unsubscribe('s1', 'chat')

    await new Promise((r) => setTimeout(r, 10))

    expect(onChannelDestroyed).toHaveBeenCalledWith('chat', 'public')
  })

  it('should not call onChannelDestroyed if channel still has subscribers', async () => {
    const onChannelDestroyed = vi.fn()
    const { send } = createMockSend()
    const manager = createChannelManager(
      { hooks: { onChannelDestroyed } },
      send
    )

    await manager.subscribe('s1', 'chat', makeCtx())
    await manager.subscribe('s2', 'chat', makeCtx())
    manager.unsubscribe('s1', 'chat')

    await new Promise((r) => setTimeout(r, 10))

    expect(onChannelDestroyed).not.toHaveBeenCalled()
  })

  it('should call onChannelCreated for presence channels', async () => {
    const onChannelCreated = vi.fn()
    const { send } = createMockSend()
    const manager = createChannelManager(
      {
        authorize: () => true,
        hooks: { onChannelCreated },
      },
      send
    )

    await manager.subscribe('s1', 'presence-lobby', makeCtx())

    await new Promise((r) => setTimeout(r, 10))

    expect(onChannelCreated).toHaveBeenCalledWith('presence-lobby', 'presence')
  })
})

// ─── Channel Transformers ─────────────────────────────────────────────────────

describe('Channel Transformers', () => {
  // Note: Transform is applied in the WebSocket adapter's handleChannelMessage,
  // not in the channel manager directly. We test the transform option config here,
  // and the actual transform behavior in phase3 WebSocket-level tests.

  it('should accept transform option in ChannelOptions', async () => {
    const { send } = createMockSend()
    const transform = vi.fn((channel, event, data) => data)
    const manager = createChannelManager(
      { transform },
      send
    )

    // The transform is stored in options, available for the WS adapter
    expect(manager).toBeDefined()
  })
})
