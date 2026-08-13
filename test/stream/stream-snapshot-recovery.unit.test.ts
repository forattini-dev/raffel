import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { writeSseStream } from '../../src/adapters/sse-runtime.js'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter, RaffelError } from '../../src/core/router.js'
import { generateStreams } from '../../src/docs/generators/streams-generator.js'
import { generateOpenAPI } from '../../src/docs/openapi/generator.js'
import {
  createSourceBackedStreamHandler,
  ResumeCursorExpiredError,
} from '../../src/stream/resumable.js'
import { createContext } from '../../src/types/context.js'
import type {
  Envelope,
  ResumableStreamConfig,
  ResumableStreamProvider,
} from '../../src/types/index.js'

const config = {
  provider: 'orderChanges',
  delivery: 'at-least-once',
  cursor: { header: 'Last-Event-ID', query: 'cursor' },
  expiredCursor: { event: 'snapshot' },
} satisfies ResumableStreamConfig

function expiredProvider(): ResumableStreamProvider<
  { orderId: string },
  { status: string },
  { orderId: string; status: string }
> {
  return {
    replay: {
      replay: vi.fn(async () => ({
        outcome: 'cursor-expired' as const,
        snapshot: {
          cursor: 'opaque:fresh',
          data: { orderId: 'order-1', status: 'paid' },
        },
      })),
    },
    source: {
      subscribe: vi.fn(() => (async function* () {})()),
    },
  }
}

async function resumableSse(provider: ResumableStreamProvider) {
  const registry = createRegistry()
  registry.stream('orders/watch', createSourceBackedStreamHandler(config), {
    resumable: config,
  })
  const router = createRouter(registry)
  const context = createContext('snapshot-request', {
    input: { metadata: { 'last-event-id': 'opaque:expired' } },
    services: { orderChanges: provider },
  })
  const stream = await router.handle({
    id: 'snapshot-request',
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

  return writes.join('')
}

describe('Stream Snapshot recovery', () => {
  it('emits the application snapshot and continuation cursor as a named SSE event', async () => {
    const provider = expiredProvider()

    const output = await resumableSse(provider)

    expect(output).toContain(
      'event: snapshot\nid: opaque:fresh\ndata: {"orderId":"order-1","status":"paid"}\n\n',
    )
    expect(output).not.toContain('event: error')
    expect(provider.source.subscribe).not.toHaveBeenCalled()
  })

  it('keeps cursor expiration distinguishable from a transient replay failure', async () => {
    const expired = expiredProvider()
    const expiredContext = createContext('expired', {
      input: { metadata: { 'last-event-id': 'opaque:expired' } },
      services: { orderChanges: expired },
    })
    const expiredIterator = createSourceBackedStreamHandler(config)(
      { orderId: 'order-1' },
      expiredContext,
    )[Symbol.asyncIterator]()

    await expect(expiredIterator.next()).rejects.toMatchObject({
      name: 'ResumeCursorExpiredError',
      snapshot: {
        cursor: 'opaque:fresh',
        data: { orderId: 'order-1', status: 'paid' },
      },
    })

    const transient = expiredProvider()
    transient.replay.replay = vi.fn(async () => {
      throw new Error('replay store unavailable')
    })
    const transientContext = createContext('transient', {
      input: { metadata: { 'last-event-id': 'opaque:expired' } },
      services: { orderChanges: transient },
    })
    const transientIterator = createSourceBackedStreamHandler(config)(
      { orderId: 'order-1' },
      transientContext,
    )[Symbol.asyncIterator]()

    await expect(transientIterator.next()).rejects.not.toBeInstanceOf(
      ResumeCursorExpiredError,
    )
    await expect(resumableSse(transient)).resolves.toContain('event: error')
  })

  it('keeps authorization failures outside the snapshot recovery path', async () => {
    const registry = createRegistry()
    registry.stream('orders/protected', createSourceBackedStreamHandler(config), {
      resumable: config,
      interceptors: [async () => {
        throw new RaffelError('UNAUTHENTICATED', 'authentication required')
      }],
    })
    const context = createContext('unauthorized', {
      services: { orderChanges: expiredProvider() },
    })

    const result = await createRouter(registry).handle({
      id: 'unauthorized',
      procedure: 'orders/protected',
      type: 'stream:start',
      payload: { orderId: 'order-1' },
      metadata: {},
      context,
    })

    expect(result).toMatchObject({
      type: 'error',
      payload: { code: 'UNAUTHENTICATED', status: 401 },
    })
  })

  it('rejects an application snapshot cursor that is unsafe for SSE framing', async () => {
    const provider = expiredProvider()
    provider.replay.replay = vi.fn(async () => ({
      outcome: 'cursor-expired' as const,
      snapshot: {
        cursor: 'opaque\nid: injected',
        data: { orderId: 'order-1', status: 'paid' },
      },
    }))

    const output = await resumableSse(provider)

    expect(output).toContain('event: error')
    expect(output).not.toContain('\nid: injected\n')
  })

  it('projects the named expired-cursor outcome in USD and OpenAPI', () => {
    const registry = createRegistry()
    registry.stream('orders/watch', createSourceBackedStreamHandler(config), {
      resumable: config,
    })

    const usd = generateStreams({ registry }).streams.endpoints?.['orders/watch']
    const openapi = generateOpenAPI(registry, undefined, {
      info: { title: 'Orders', version: '1.0.0' },
    })

    expect(usd?.['x-usd-resumable']?.expiredCursor).toEqual({ event: 'snapshot' })
    expect(openapi.paths['/streams/orders/watch']?.get?.['x-raffel-resumable-stream'])
      .toMatchObject({ expiredCursor: { event: 'snapshot' } })
  })

  it('documents application ownership and the named snapshot recovery event', async () => {
    const guide = await readFile(
      new URL('../../docs/core/streams.md', import.meta.url),
      'utf8',
    )

    expect(guide).toContain("source.addEventListener('snapshot'")
    expect(guide).toContain('snapshot cursor is supplied by the application')
    expect(guide).toContain('Raffel does not create an in-memory replay or snapshot fallback')
  })
})
