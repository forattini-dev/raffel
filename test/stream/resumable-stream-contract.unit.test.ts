import { describe, expect, it } from 'vitest'

import {
  createOrderChangesProvider,
  authorImperativeResumableStream,
  fsDiscoveredResumableStream,
  liveStream,
} from '../fixtures/resumable-stream-contract.prototype.js'

describe('Resumable Stream contract', () => {
  it('keeps Live Stream and Resumable Stream authoring visibly distinct', () => {
    expect(liveStream).toHaveProperty('default')
    expect(liveStream).not.toHaveProperty('resumable')
    expect(fsDiscoveredResumableStream).not.toHaveProperty('default')
    expect(fsDiscoveredResumableStream.resumable).toEqual({
      provider: 'orderChanges',
      delivery: 'at-least-once',
      cursor: {
        header: 'Last-Event-ID',
        query: 'cursor',
      },
      expiredCursor: {
        event: 'snapshot',
      },
    })
  })

  it('uses .provide() lifecycle and the same config in imperative .resumable()', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    let shutdown: (() => void | Promise<void>) | undefined
    const builder = {
      input(value: unknown) { calls.push({ method: 'input', value }); return this },
      output(value: unknown) { calls.push({ method: 'output', value }); return this },
      snapshot(value: unknown) { calls.push({ method: 'snapshot', value }); return this },
      resumable(value: unknown) { calls.push({ method: 'resumable', value }) },
    }
    const server = {
      provide(name: string, factory: () => ReturnType<typeof createOrderChangesProvider>, options: {
        onShutdown(instance: ReturnType<typeof createOrderChangesProvider>): void | Promise<void>
      }) {
        const provider = factory()
        calls.push({ method: 'provide', value: name })
        shutdown = () => options.onShutdown(provider)
        return this
      },
      stream(name: string) {
        calls.push({ method: 'stream', value: name })
        return builder
      },
    }

    authorImperativeResumableStream(server)

    expect(calls).toEqual([
      { method: 'provide', value: 'orderChanges' },
      { method: 'stream', value: 'orders/watch' },
      { method: 'input', value: fsDiscoveredResumableStream.input },
      { method: 'output', value: fsDiscoveredResumableStream.output },
      { method: 'snapshot', value: fsDiscoveredResumableStream.snapshot },
      { method: 'resumable', value: fsDiscoveredResumableStream.resumable },
    ])
    await shutdown?.()
  })

  it('keeps opaque records and snapshot recovery application-owned', async () => {
    const provider = createOrderChangesProvider()
    const signal = new AbortController().signal
    const replay = await provider.replay.replay(
      { orderId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6' },
      { after: 'opaque:previous', signal }
    )

    expect(replay.outcome).toBe('records')
    if (replay.outcome === 'records') {
      const records = []
      for await (const record of replay.records) records.push(record)
      expect(records).toEqual([
        { cursor: 'opaque:next', data: { status: 'paid' } },
      ])
      expect(replay.through).toBe('opaque:next')
    }

    const expired = await provider.replay.replay(
      { orderId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6' },
      { after: 'opaque:expired', signal }
    )
    expect(expired).toEqual({
      outcome: 'cursor-expired',
      snapshot: {
        cursor: 'opaque:current',
        data: { status: 'paid' },
      },
    })
  })
})
