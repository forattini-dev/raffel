import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeSseStream } from '../../src/adapters/sse-runtime.js'
import { createRegistry } from '../../src/core/registry.js'
import { generateStreams } from '../../src/docs/generators/streams-generator.js'
import { generateOpenAPI } from '../../src/docs/openapi/generator.js'
import { createServer } from '../../src/server/index.js'
import {
  createInMemoryDiscoverySource,
  loadDiscovery,
} from '../../src/server/fs-routes/index.js'
import type { Envelope } from '../../src/types/index.js'

function dataEnvelope(payload: unknown): Envelope {
  return {
    id: 'request-1',
    procedure: 'orders/watch',
    type: 'stream:data',
    payload,
    metadata: {},
    context: {} as Envelope['context'],
  }
}

describe('Live Stream operational controls', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves existing SSE output when controls are disabled', async () => {
    const writes: string[] = []
    let ended = false

    await writeSseStream({
      stream: (async function* () {
        yield dataEnvelope({ status: 'pending' })
      })(),
      signal: new AbortController().signal,
      write: (chunk) => writes.push(chunk),
      end: () => { ended = true },
      isClosed: () => false,
    })

    expect(writes.join('')).toBe(
      'event: data\ndata: {"status":"pending"}\n\n'
    )
    expect(ended).toBe(true)
  })

  it('writes retry and heartbeat frames, then cleans up on max duration', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    let returned = false
    let ended = false
    const abortController = new AbortController()
    const stream: AsyncIterable<Envelope> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Envelope>>(() => {}),
          return: async () => {
            returned = true
            return { done: true, value: undefined }
          },
        }
      },
    }

    const consuming = writeSseStream({
      stream,
      signal: abortController.signal,
      abort: (reason) => abortController.abort(reason),
      controls: {
        heartbeatMs: 100,
        retryMs: 2_500,
        maxDurationMs: 250,
      },
      write: (chunk) => writes.push(chunk),
      end: () => { ended = true },
      isClosed: () => false,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(writes).toEqual(['retry: 2500\n\n', ': heartbeat\n\n'])

    await vi.advanceTimersByTimeAsync(150)
    await consuming

    expect(abortController.signal.reason).toBe('Live Stream maximum duration exceeded')
    expect(returned).toBe(true)
    expect(ended).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets the idle timeout only when a business record is emitted', async () => {
    vi.useFakeTimers()
    const abortController = new AbortController()
    let releaseFirst!: () => void
    let nextCount = 0
    const stream: AsyncIterable<Envelope> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            nextCount += 1
            if (nextCount === 1) {
              await new Promise<void>((resolve) => { releaseFirst = resolve })
              return { done: false, value: dataEnvelope({ status: 'pending' }) }
            }
            return new Promise<IteratorResult<Envelope>>(() => {})
          },
          return: async () => ({ done: true, value: undefined }),
        }
      },
    }

    const consuming = writeSseStream({
      stream,
      signal: abortController.signal,
      abort: (reason) => abortController.abort(reason),
      controls: { heartbeatMs: 50, idleTimeoutMs: 100 },
      write: () => {},
      end: () => {},
      isClosed: () => false,
    })

    await vi.advanceTimersByTimeAsync(75)
    releaseFirst()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(75)
    expect(abortController.signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(25)
    await consuming
    expect(abortController.signal.reason).toBe('Live Stream idle timeout exceeded')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('projects controls as Live Stream metadata without implying resumability', () => {
    const registry = createRegistry()
    registry.stream('orders/watch', async function* watch() {
      yield { status: 'pending' }
    }, {
      controls: {
        heartbeatMs: 15_000,
        retryMs: 2_000,
        maxDurationMs: 3_600_000,
        idleTimeoutMs: 60_000,
      },
    })

    const endpoint = generateStreams({ registry }).streams.endpoints?.['orders/watch']
    expect(endpoint?.['x-usd-live-stream']).toEqual({
      heartbeatMs: 15_000,
      retryMs: 2_000,
      maxDurationMs: 3_600_000,
      idleTimeoutMs: 60_000,
    })
    expect(endpoint).not.toHaveProperty('resumable')

    const openapi = generateOpenAPI(registry, undefined, {
      info: { title: 'Orders API', version: '1.0.0' },
    })
    expect(openapi.paths['/streams/orders/watch']?.get?.['x-raffel-live-stream']).toEqual(
      endpoint?.['x-usd-live-stream']
    )
  })

  it('preserves the same controls through fs-discovery and the fluent builder', async () => {
    const controls = { heartbeatMs: 10_000, retryMs: 1_500 }
    const discovery = await loadDiscovery({
      baseDir: '/app',
      discovery: { streams: true },
      extensions: ['.js'],
      source: createInMemoryDiscoverySource({
        '/app/src/streams/orders/watch.js': {
          module: {
            meta: { direction: 'server', controls },
            default: async function* watch() {
              yield { status: 'pending' }
            },
          },
        },
      }),
    })
    const discoveredServer = createServer({ port: 0 })
    discoveredServer.addDiscovery(discovery)
    expect(discoveredServer.registry.getStream('orders/watch')?.meta.streamControls)
      .toEqual(controls)

    const imperativeServer = createServer({ port: 0 })
    imperativeServer.stream('orders/watch')
      .controls(controls)
      .handler(async function* watch() {
        yield { status: 'pending' }
      })
    expect(imperativeServer.registry.getStream('orders/watch')?.meta.streamControls)
      .toEqual(controls)
  })

  it('rejects non-positive and non-finite control durations', () => {
    const registry = createRegistry()
    expect(() => registry.stream('invalid/heartbeat', async function* watch() {}, {
      controls: { heartbeatMs: 0 },
    })).toThrow(/heartbeatMs must be a positive finite number/)
    expect(() => registry.stream('invalid/retry', async function* watch() {}, {
      controls: { retryMs: Number.POSITIVE_INFINITY },
    })).toThrow(/retryMs must be a positive finite number/)
  })
})
