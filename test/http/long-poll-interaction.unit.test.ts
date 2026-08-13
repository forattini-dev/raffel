import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRegistry } from '../../src/core/registry.js'
import { generateHttpPaths } from '../../src/docs/generators/http-generator.js'
import { generateOpenAPI } from '../../src/docs/openapi/generator.js'
import { generateUIRuntimeJS } from '../../src/docs/ui/html-builder.js'
import { createServer } from '../../src/server/index.js'
import {
  createInMemoryDiscoverySource,
  loadDiscovery,
} from '../../src/server/fs-routes/index.js'
import {
  LongPollAbortedError,
  runLongPoll,
} from '../../src/http/long-poll.js'

describe('Long Poll Interaction', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats the Poll Cursor as an opaque exclusive position', async () => {
    const changes = [
      { cursor: 'opaque:1', data: { status: 'created' } },
      { cursor: 'opaque:2', data: { status: 'paid' } },
    ]
    const wait = async ({ after }: { after: string | null }) => {
      const index = after === null ? 0 : changes.findIndex((change) => change.cursor === after) + 1
      return changes[index] ?? null
    }

    const first = await runLongPoll({
      cursor: null,
      waitMs: 1_000,
      retryMs: 250,
      signal: new AbortController().signal,
      wait,
    })
    const second = await runLongPoll({
      cursor: first.cursor,
      waitMs: 1_000,
      retryMs: 250,
      signal: new AbortController().signal,
      wait,
    })

    expect(first).toEqual({
      outcome: 'change',
      cursor: 'opaque:1',
      retryAfterMs: 250,
      data: { status: 'created' },
    })
    expect(second).toEqual({
      outcome: 'change',
      cursor: 'opaque:2',
      retryAfterMs: 250,
      data: { status: 'paid' },
    })
  })

  it('rejects a source that repeats the exclusive cursor', async () => {
    await expect(runLongPoll({
      cursor: 'opaque:current',
      waitMs: 1_000,
      retryMs: 250,
      signal: new AbortController().signal,
      wait: async () => ({ cursor: 'opaque:current', data: { duplicated: true } }),
    })).rejects.toThrow(/must return a cursor after the exclusive Poll Cursor/)
  })

  it('returns a bounded timeout outcome and cancels the application wait', async () => {
    vi.useFakeTimers()
    let applicationSignal!: AbortSignal
    const polling = runLongPoll({
      cursor: 'opaque:current',
      waitMs: 1_000,
      retryMs: 300,
      signal: new AbortController().signal,
      wait: async ({ signal }) => {
        applicationSignal = signal
        return new Promise(() => {})
      },
    })

    await vi.advanceTimersByTimeAsync(1_000)

    await expect(polling).resolves.toEqual({
      outcome: 'timeout',
      cursor: 'opaque:current',
      retryAfterMs: 300,
    })
    expect(applicationSignal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates request cancellation instead of reporting a timeout', async () => {
    const request = new AbortController()
    let applicationSignal!: AbortSignal
    const polling = runLongPoll({
      cursor: null,
      waitMs: 1_000,
      retryMs: 300,
      signal: request.signal,
      wait: async ({ signal }) => {
        applicationSignal = signal
        return new Promise(() => {})
      },
    })

    request.abort('client disconnected')

    await expect(polling).rejects.toBeInstanceOf(LongPollAbortedError)
    expect(applicationSignal.aborted).toBe(true)
  })

  it('projects the interaction as ordinary HTTP and exposes it in generated docs', () => {
    const registry = createRegistry()
    const contract = {
      cursor: {
        input: 'cursor',
        output: 'cursor',
        semantics: 'exclusive' as const,
      },
      waitMs: 25_000,
      retryMs: 1_000,
      timeoutOutcome: 'timeout' as const,
    }
    registry.procedure('orders/updates', async () => ({ outcome: 'timeout' }), {
      httpPath: '/orders/updates',
      httpMethod: 'GET',
      longPoll: contract,
    })

    expect(registry.getProcedure('orders/updates')?.meta).toMatchObject({
      kind: 'procedure',
      longPoll: contract,
    })
    const usd = generateHttpPaths({ registry })
    expect(usd.paths['/orders/updates']?.get?.['x-usd-long-poll']).toEqual(contract)

    const openapi = generateOpenAPI(registry, undefined, {
      info: { title: 'Orders API', version: '1.0.0' },
    })
    expect(openapi.paths['/orders/updates']?.get?.['x-raffel-long-poll']).toEqual(contract)
    expect(generateUIRuntimeJS()).toContain('Long Poll Interaction')
  })

  it('preserves one contract through fs-discovery and imperative registration', async () => {
    const contract = {
      cursor: { input: 'after', output: 'next', semantics: 'exclusive' as const },
      waitMs: 20_000,
      retryMs: 750,
      timeoutOutcome: 'timeout' as const,
    }
    const discovery = await loadDiscovery({
      baseDir: '/app',
      discovery: { http: true },
      extensions: ['.js'],
      source: createInMemoryDiscoverySource({
        '/app/src/http/orders/updates/get.js': {
          module: {
            meta: {
              httpPath: '/orders/updates',
              httpMethod: 'GET',
              longPoll: contract,
            },
            default: async () => ({ outcome: 'timeout' }),
          },
        },
      }),
    })
    const discovered = createServer({ port: 0 })
    discovered.addDiscovery(discovery)
    expect(discovered.registry.getProcedure('orders/updates/get')?.meta).toMatchObject({
      kind: 'procedure',
      longPoll: contract,
    })

    const imperative = createServer({ port: 0 })
    imperative.procedure('orders/updates')
      .http('/orders/updates', 'GET')
      .longPoll(contract)
      .handler(async () => ({ outcome: 'timeout' }))
    expect(imperative.registry.getProcedure('orders/updates')?.meta.longPoll)
      .toEqual(contract)
  })

  it('rejects unbounded contract durations', () => {
    const registry = createRegistry()
    expect(() => registry.procedure('orders/updates', async () => null, {
      longPoll: {
        cursor: { input: 'cursor', output: 'cursor', semantics: 'exclusive' },
        waitMs: 0,
        retryMs: 1_000,
        timeoutOutcome: 'timeout',
      },
    })).toThrow(/waitMs must be a positive finite number/)
  })
})
