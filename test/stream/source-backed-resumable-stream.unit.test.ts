import { describe, expect, it, vi } from 'vitest'

import { writeSseStream } from '../../src/adapters/sse-runtime.js'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { generateStreams } from '../../src/docs/generators/streams-generator.js'
import { generateOpenAPI } from '../../src/docs/openapi/generator.js'
import { createServer } from '../../src/server/index.js'
import {
  createInMemoryDiscoverySource,
  loadDiscovery,
} from '../../src/server/fs-routes/index.js'
import { createSourceBackedStreamHandler } from '../../src/stream/resumable.js'
import { createContext } from '../../src/types/context.js'
import type {
  DurableStreamSource,
  Envelope,
  ReplayProvider,
  ResumableStreamConfig,
  StreamRecord,
} from '../../src/types/index.js'

const config = {
  provider: 'orderChanges',
  delivery: 'at-least-once',
  cursor: { header: 'Last-Event-ID', query: 'cursor' },
  expiredCursor: { event: 'snapshot' },
} satisfies ResumableStreamConfig

function records(...values: Array<StreamRecord<{ status: string }>>) {
  return (async function* () {
    yield* values
  })()
}

describe('Source-Backed Resumable Stream', () => {
  it('uses the Durable Stream Source for initial consumption', async () => {
    const source: DurableStreamSource<{ orderId: string }, { status: string }> = {
      subscribe: vi.fn((_input, { after }) => records({
        cursor: after ?? 'opaque:first',
        data: { status: 'pending' },
      })),
    }
    const replay: ReplayProvider<{ orderId: string }, { status: string }, never> = {
      replay: vi.fn(),
    }
    const handler = createSourceBackedStreamHandler(config)
    const context = createContext('request-1', {
      services: { orderChanges: { source, replay } },
    })

    const received = []
    for await (const record of handler({ orderId: 'order-1' }, context)) {
      received.push(record)
      break
    }

    expect(received).toEqual([
      { cursor: 'opaque:first', data: { status: 'pending' } },
    ])
    expect(source.subscribe).toHaveBeenCalledWith(
      { orderId: 'order-1' },
      { after: undefined, signal: context.signal },
    )
    expect(replay.replay).not.toHaveBeenCalled()
  })

  it('replays after an opaque Resume Cursor, then continues from the application source', async () => {
    const source: DurableStreamSource<{ orderId: string }, { status: string }> = {
      subscribe: vi.fn((_input, { after }) => records(
        // At-least-once permits the source to repeat the replay boundary.
        { cursor: after!, data: { status: 'paid' } },
        { cursor: 'opaque:live', data: { status: 'shipped' } },
      )),
    }
    const replay: ReplayProvider<{ orderId: string }, { status: string }, never> = {
      replay: vi.fn(async (_input, { after }) => ({
        outcome: 'records' as const,
        records: records(
          { cursor: `${after}:next`, data: { status: 'paid' } },
        ),
        through: `${after}:next`,
      })),
    }
    const handler = createSourceBackedStreamHandler(config)
    const context = createContext('request-2', {
      input: { metadata: { 'last-event-id': 'opaque:@previous' } },
      services: { orderChanges: { source, replay } },
    })

    const received = []
    for await (const record of handler({ orderId: 'order-1' }, context)) {
      received.push(record)
      if (received.length === 3) break
    }

    expect(replay.replay).toHaveBeenCalledWith(
      { orderId: 'order-1' },
      { after: 'opaque:@previous', signal: context.signal },
    )
    expect(source.subscribe).toHaveBeenCalledWith(
      { orderId: 'order-1' },
      { after: 'opaque:@previous:next', signal: context.signal },
    )
    expect(received).toEqual([
      { cursor: 'opaque:@previous:next', data: { status: 'paid' } },
      { cursor: 'opaque:@previous:next', data: { status: 'paid' } },
      { cursor: 'opaque:live', data: { status: 'shipped' } },
    ])
  })

  it('accepts the configured query fallback without interpreting its value', async () => {
    const source = {
      subscribe: vi.fn((_input: unknown, { after }: { after?: string }) => records({
        cursor: `${after}:next`,
        data: { status: 'paid' },
      })),
    }
    const replay = {
      replay: vi.fn(async (_input: unknown, { after }: { after: string }) => ({
        outcome: 'records' as const,
        records: records({ cursor: `${after}:next`, data: { status: 'paid' } }),
        through: `${after}:next`,
      })),
    }
    const context = createContext('request-3', {
      services: { orderChanges: { source, replay } },
    })
    const handler = createSourceBackedStreamHandler(config)
    const iterator = handler(
      { orderId: 'order-1', cursor: 'opaque:/?=@ cursor' },
      context,
    )[Symbol.asyncIterator]()

    expect((await iterator.next()).value).toEqual({
      cursor: 'opaque:/?=@ cursor:next',
      data: { status: 'paid' },
    })
    await iterator.return?.()
    expect(replay.replay).toHaveBeenCalledWith(
      { orderId: 'order-1', cursor: 'opaque:/?=@ cursor' },
      { after: 'opaque:/?=@ cursor', signal: context.signal },
    )
  })

  it('frames Stream Record cursors as SSE ids while keeping business data as the payload', async () => {
    const registry = createRegistry()
    registry.stream('orders/watch', createSourceBackedStreamHandler(config), {
      resumable: config,
    })
    const router = createRouter(registry)
    const context = createContext('request-4', {
      services: {
        orderChanges: {
          source: {
            subscribe: () => records({
              cursor: 'opaque:id/1',
              data: { status: 'pending' },
            }),
          },
          replay: { replay: vi.fn() },
        },
      },
    })
    const stream = await router.handle({
      id: 'request-4',
      procedure: 'orders/watch',
      type: 'stream:start',
      payload: { orderId: 'order-1' },
      metadata: {},
      context,
    }) as AsyncIterable<Envelope>
    const writes: string[] = []

    await writeSseStream({
      stream,
      signal: context.signal,
      write: chunk => writes.push(chunk),
      end: () => {},
      isClosed: () => false,
    })

    expect(writes.join('')).toContain(
      'event: data\nid: opaque:id/1\ndata: {"status":"pending"}\n\n',
    )
    expect(writes.join('')).not.toContain('"cursor"')
  })

  it('leaves cursor-shaped business payloads unchanged on ordinary Live Streams', async () => {
    const registry = createRegistry()
    registry.stream('orders/live', async function* () {
      yield { cursor: 'business-field', data: { status: 'pending' } }
    })
    const router = createRouter(registry)
    const context = createContext('request-live')
    const stream = await router.handle({
      id: 'request-live',
      procedure: 'orders/live',
      type: 'stream:start',
      payload: {},
      metadata: {},
      context,
    }) as AsyncIterable<Envelope>
    const envelopes: Envelope[] = []

    for await (const envelope of stream) envelopes.push(envelope)

    expect(envelopes[1]?.payload).toEqual({
      cursor: 'business-field',
      data: { status: 'pending' },
    })
    expect(envelopes[1]?.metadata).toEqual({})
  })

  it('rejects cursors that cannot be framed safely as an SSE id', async () => {
    const handler = createSourceBackedStreamHandler(config)
    const context = createContext('request-unsafe-cursor', {
      services: {
        orderChanges: {
          source: {
            subscribe: () => records({
              cursor: 'opaque\nid: injected',
              data: { status: 'pending' },
            }),
          },
          replay: { replay: vi.fn() },
        },
      },
    })
    const iterator = handler(
      { orderId: 'order-1' },
      context,
    )[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toThrow(
      'Stream Record cursor must be safe for SSE framing',
    )
  })

  it('rejects malformed resumable contracts at registration time', () => {
    const registry = createRegistry()
    const handler = async function* () {
      yield { cursor: 'opaque:1', data: { status: 'pending' } }
    }

    expect(() => registry.stream('orders/invalid-provider', handler, {
      resumable: { ...config, provider: '' },
    })).toThrow('Resumable Stream provider must not be empty')

    expect(() => registry.stream('orders/invalid-direction', handler, {
      direction: 'bidirectional',
      resumable: config,
    })).toThrow('Source-Backed Resumable Streams must use server direction')
  })

  it('preserves the same opt-in contract through fs-discovery and the fluent builder', async () => {
    const discovery = await loadDiscovery({
      baseDir: '/app',
      discovery: { streams: true },
      extensions: ['.js'],
      source: createInMemoryDiscoverySource({
        '/app/src/streams/orders/watch.js': {
          module: {
            input: { kind: 'input-schema' },
            output: { kind: 'business-schema' },
            snapshot: { kind: 'snapshot-schema' },
            resumable: config,
          },
        },
      }),
    })
    const discovered = createServer({ port: 0 })
      .provide('orderChanges', () => ({ source: {}, replay: {} }))
    discovered.addDiscovery(discovery)
    expect(discovered.registry.getStream('orders/watch')?.meta.resumable)
      .toEqual(config)

    const imperative = createServer({ port: 0 })
      .provide('orderChanges', () => ({ source: {}, replay: {} }))
    imperative.stream('orders/watch')
      .resumable(config)
    expect(imperative.registry.getStream('orders/watch')?.meta.resumable)
      .toEqual(config)
  })

  it('projects resumability without changing ordinary Live Stream contracts', () => {
    const registry = createRegistry()
    registry.stream('orders/live', async function* () {
      yield { status: 'pending' }
    })
    registry.stream('orders/resumable', createSourceBackedStreamHandler(config), {
      resumable: config,
    })

    const streams = generateStreams({ registry }).streams.endpoints
    expect(streams?.['orders/live']).not.toHaveProperty('x-usd-resumable')
    expect(streams?.['orders/resumable']?.['x-usd-resumable']).toMatchObject(config)

    const openapi = generateOpenAPI(registry, undefined, {
      info: { title: 'Orders API', version: '1.0.0' },
    })
    expect(openapi.paths['/streams/orders/live']?.get)
      .not.toHaveProperty('x-raffel-resumable-stream')
    expect(openapi.paths['/streams/orders/resumable']?.get?.['x-raffel-resumable-stream'])
      .toMatchObject(config)
  })
})
