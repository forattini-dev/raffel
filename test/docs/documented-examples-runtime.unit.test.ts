import { describe, expect, it, vi } from 'vitest'
import { createContext, type ContextLogger } from 'raffel'

import type { AppContext } from '../fixtures/docs-examples/src/application/context.js'
import liveOrders from '../fixtures/docs-examples/src/streams/orders/live.js'
import getOrderUpdate from '../fixtures/docs-examples/src/http/orders/updates/get.js'
import chat from '../fixtures/docs-examples/src/streams/assistant/chat.js'
import createOrder from '../fixtures/docs-examples/src/http/orders/create/post.js'

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const item of items) values.push(item)
  return values
}

const unavailable = async (): Promise<never> => {
  throw new Error('Unexpected service call')
}

function testLogger(warn = vi.fn()): ContextLogger {
  const noop = vi.fn()
  return {
    trace: noop,
    debug: noop,
    info: noop,
    warn,
    error: noop,
    fatal: noop,
    child: () => testLogger(warn),
  }
}

function exampleContext(
  services: Partial<AppContext['services']>,
  options: Omit<NonNullable<Parameters<typeof createContext>[1]>, 'services'> = {},
): AppContext {
  const defaults: AppContext['services'] = {
    orders: { subscribe: unavailable },
    orderChanges: { waitAfter: unavailable },
    modelGateway: {
      async *stream() {
        throw new Error('Unexpected service call')
      },
    },
    billing: { charge: unavailable, close: async () => {} },
  }

  return createContext('documented-example', {
    ...options,
    services: { ...defaults, ...services },
  }) as AppContext
}

describe('documented examples at runtime', () => {
  it('streams live records and closes the application subscription', async () => {
    const close = vi.fn(async () => {})
    const subscription = {
      async *[Symbol.asyncIterator]() {
        yield { orderId: 'order-42', status: 'paid' }
      },
      close,
    }
    const ctx = exampleContext({
      orders: { subscribe: vi.fn(async () => subscription) },
    })

    const stream = liveOrders({ region: 'br' }, ctx)

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { orderId: 'order-42', status: 'paid' },
    })
    await stream.return(undefined)
    expect(close).toHaveBeenCalledOnce()
  })

  it('returns the first change after the exclusive Poll Cursor', async () => {
    const waitAfter = vi.fn(async () => ({
      cursor: 'cursor-11',
      data: { orderId: 'order-42', status: 'paid' },
    }))
    const ctx = exampleContext({ orderChanges: { waitAfter } })

    await expect(getOrderUpdate({ cursor: 'cursor-10' }, ctx)).resolves.toEqual({
      outcome: 'change',
      cursor: 'cursor-11',
      retryAfterMs: 1_000,
      data: { orderId: 'order-42', status: 'paid' },
    })
    expect(waitAfter).toHaveBeenCalledWith('cursor-10', {
      signal: expect.any(AbortSignal),
    })
  })

  it('returns continuation metadata when the application wait times out', async () => {
    const ctx = exampleContext({
      orderChanges: { waitAfter: vi.fn(async () => null) },
    })

    await expect(getOrderUpdate({ cursor: 'cursor-10' }, ctx)).resolves.toEqual({
      outcome: 'timeout',
      cursor: 'cursor-10',
      retryAfterMs: 1_000,
    })
  })

  it('propagates request cancellation into the Long Poll Interaction', async () => {
    const controller = new AbortController()
    controller.abort('client disconnected')
    const ctx = exampleContext({
      orderChanges: { waitAfter: vi.fn(async () => null) },
    }, { signal: controller.signal })

    await expect(getOrderUpdate({ cursor: null }, ctx)).rejects.toMatchObject({
      name: 'LongPollAbortedError',
      reason: 'client disconnected',
    })
  })

  it('streams typed AI deltas and a terminal result', async () => {
    const modelGateway = {
      async *stream() {
        yield { type: 'delta' as const, text: 'Hello' }
        yield { type: 'delta' as const, text: ' world' }
        yield { type: 'final' as const, text: 'Hello world', finishReason: 'stop' as const }
      },
    }
    const ctx = exampleContext({ modelGateway })

    await expect(collect(chat({
      conversationId: '2dd5cc20-e739-4f4d-a5e7-535d8d5f63c2',
      prompt: 'Say hello',
    }, ctx))).resolves.toEqual([
      { type: 'delta', text: 'Hello', sequence: 0 },
      { type: 'delta', text: ' world', sequence: 1 },
      { type: 'final', text: 'Hello world', finishReason: 'stop' },
    ])
  })

  it('publishes a business cancellation when the model stream observes abort', async () => {
    const controller = new AbortController()
    controller.abort('client disconnected')
    const ctx = exampleContext({
      modelGateway: {
        async *stream() {
          yield { type: 'delta' as const, text: 'ignored' }
        },
      },
    }, { signal: controller.signal })

    await expect(collect(chat({
      conversationId: '2dd5cc20-e739-4f4d-a5e7-535d8d5f63c2',
      prompt: 'Say hello',
    }, ctx))).resolves.toEqual([
      { type: 'cancelled', reason: 'client' },
    ])
  })

  it('maps model failures to the documented safe error event', async () => {
    const warn = vi.fn()
    const ctx = exampleContext({
      modelGateway: {
        async *stream(): AsyncGenerator<never> {
          throw new Error('secret provider failure')
        },
      },
    }, { logger: testLogger(warn) })

    await expect(collect(chat({
      conversationId: '2dd5cc20-e739-4f4d-a5e7-535d8d5f63c2',
      prompt: 'Say hello',
    }, ctx))).resolves.toEqual([{
      type: 'error',
      code: 'MODEL_UNAVAILABLE',
      message: 'The model is temporarily unavailable',
      retryable: true,
    }])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('calls the injected billing port with cancellation and deadline context', async () => {
    const charge = vi.fn(async () => ({ paymentId: 'payment-7' }))
    const signal = new AbortController().signal
    const ctx = exampleContext({
      billing: { charge, close: async () => {} },
    }, { signal, deadline: 1_800_000_000_000 })

    await expect(createOrder({
      orderId: 'order-42',
      amount: 125,
      idempotencyKey: 'checkout-42',
    }, ctx)).resolves.toEqual({
      orderId: 'order-42',
      paymentId: 'payment-7',
    })
    expect(charge).toHaveBeenCalledWith({
      amount: 125,
      idempotencyKey: 'checkout-42',
      signal,
      deadline: 1_800_000_000_000,
    })
  })
})
