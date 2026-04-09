import { describe, expect, it, vi } from 'vitest'

import { createContext } from '../../src/types/index.js'
import { buildChannelOptions } from '../../src/server/channel-utils.js'
import type { LoadedChannel } from '../../src/server/fs-routes/index.js'

describe('buildChannelOptions', () => {
  it('returns undefined when there are no channels, base options, or runtime handlers', () => {
    const options = buildChannelOptions(new Map())

    expect(options).toBeUndefined()
  })

  it('uses live subscribe and unsubscribe handlers from runtime getters', async () => {
    const ctx = createContext('test-request')
    const baseSubscribe = vi.fn()
    const baseUnsubscribe = vi.fn()
    const firstSubscribe = vi.fn()
    const firstUnsubscribe = vi.fn()
    const secondSubscribe = vi.fn()
    const secondUnsubscribe = vi.fn()

    let subscribeHandler = firstSubscribe
    let unsubscribeHandler = firstUnsubscribe

    const options = buildChannelOptions(
      new Map(),
      {
        hooks: {
          onSubscribe: baseSubscribe,
          onUnsubscribe: baseUnsubscribe,
        },
      },
      {
        getSubscribeHandler: () => subscribeHandler,
        getUnsubscribeHandler: () => unsubscribeHandler,
      }
    )

    subscribeHandler = secondSubscribe
    unsubscribeHandler = secondUnsubscribe

    await options?.hooks?.onSubscribe?.('socket-1', 'chat-room', ctx)
    await options?.hooks?.onUnsubscribe?.('socket-1', 'chat-room', ctx)

    expect(firstSubscribe).not.toHaveBeenCalled()
    expect(firstUnsubscribe).not.toHaveBeenCalled()
    expect(secondSubscribe).toHaveBeenCalledWith('chat-room', ctx)
    expect(secondUnsubscribe).toHaveBeenCalledWith('chat-room', ctx)
    expect(baseSubscribe).toHaveBeenCalledWith('socket-1', 'chat-room', ctx)
    expect(baseUnsubscribe).toHaveBeenCalledWith('socket-1', 'chat-room', ctx)
  })

  it('maps loaded channel join and leave hooks into channel lifecycle hooks', async () => {
    const ctx = createContext('test-request')
    const onJoin = vi.fn()
    const onLeave = vi.fn()
    const baseMemberAdded = vi.fn()
    const baseMemberRemoved = vi.fn()
    const channelRegistry = new Map<string, LoadedChannel>([
      ['presence-lobby', {
        name: 'presence-lobby',
        filePath: '<test>',
        type: 'presence',
        config: {
          auth: 'required',
          onJoin,
          onLeave,
        },
      }],
    ])
    const member = {
      id: 'socket-1',
      userId: 'user-1',
      info: { role: 'admin' },
      joinedAt: Date.now(),
    }

    const options = buildChannelOptions(
      channelRegistry,
      {
        hooks: {
          onMemberAdded: baseMemberAdded,
          onMemberRemoved: baseMemberRemoved,
        },
      }
    )

    await options?.hooks?.onMemberAdded?.('presence-lobby', member, ctx)
    await options?.hooks?.onMemberRemoved?.('presence-lobby', member, ctx)

    expect(onJoin).toHaveBeenCalledWith(member, ctx)
    expect(onLeave).toHaveBeenCalledWith(member, ctx)
    expect(baseMemberAdded).toHaveBeenCalledWith('presence-lobby', member, ctx)
    expect(baseMemberRemoved).toHaveBeenCalledWith('presence-lobby', member, ctx)
  })
})
