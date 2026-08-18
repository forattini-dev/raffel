import { describe, expect, it, vi } from 'vitest'
import { executeDocsTryItProxy, executeDocsTryItStreamProxy } from '../../src/docs/try-it-proxy.js'

describe('documentation try-it proxy', () => {
  it('rejects targets that are not declared documentation servers', async () => {
    const fetchImpl = vi.fn()

    const response = await executeDocsTryItProxy({
      url: 'http://169.254.169.254/latest/meta-data',
      method: 'GET',
      headers: {},
    }, {
      servers: [{ url: 'https://api.example.com' }],
      fetchImpl,
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      title: 'Request target is not allowed',
      status: 403,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not widen a declared API base path to the entire origin', async () => {
    const fetchImpl = vi.fn()

    const response = await executeDocsTryItProxy({
      url: 'https://api.example.com/admin',
      method: 'GET',
      headers: {},
    }, {
      servers: [{ url: 'https://api.example.com/v1' }],
      fetchImpl,
    })

    expect(response.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('forwards one bounded request without following redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"pay_1"}', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_1' },
    }))

    const response = await executeDocsTryItProxy({
      url: 'https://api.example.com/payments',
      method: 'POST',
      headers: {
        Host: 'metadata.internal',
        Connection: 'keep-alive',
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: { amount: 1200 },
    }, {
      servers: [{ url: 'https://api.example.com' }],
      fetchImpl: fetchImpl as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/payments', expect.objectContaining({
      method: 'POST',
      redirect: 'manual',
      body: '{"amount":1200}',
    }))
    const forwarded = fetchImpl.mock.calls[0][1] as RequestInit
    expect(new Headers(forwarded.headers).get('host')).toBeNull()
    expect(new Headers(forwarded.headers).get('connection')).toBeNull()
    expect(new Headers(forwarded.headers).get('authorization')).toBe('Bearer token')
    expect(await response.json()).toEqual({
      status: 201,
      statusText: 'Created',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_1',
      },
      body: '{"id":"pay_1"}',
    })
  })
})

describe('documentation try-it stream proxy', () => {
  it('rejects stream targets that are not declared documentation servers', async () => {
    const fetchImpl = vi.fn()

    const response = await executeDocsTryItStreamProxy({
      url: 'http://169.254.169.254/stream',
    }, {
      servers: [{ url: 'https://api.example.com' }],
      fetchImpl,
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ title: 'Request target is not allowed', status: 403 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('pipes an allowed event-stream through without buffering', async () => {
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\n'))
        controller.enqueue(new TextEncoder().encode('data: two\n\n'))
        controller.close()
      },
    })
    const fetchImpl = vi.fn(async () => new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))

    const response = await executeDocsTryItStreamProxy({
      url: 'https://api.example.com/streams/prices',
      authorization: 'Bearer stream-token',
    }, {
      servers: [{ url: 'https://api.example.com' }],
      fetchImpl: fetchImpl as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const forwarded = fetchImpl.mock.calls[0][1] as RequestInit
    expect(forwarded.method).toBe('GET')
    expect(new Headers(forwarded.headers).get('accept')).toBe('text/event-stream')
    expect(new Headers(forwarded.headers).get('authorization')).toBe('Bearer stream-token')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)
    expect(await response.text()).toBe('data: one\n\ndata: two\n\n')
  })

  it('surfaces an upstream that does not return a stream body', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503, statusText: 'Unavailable' }))

    const response = await executeDocsTryItStreamProxy({
      url: 'https://api.example.com/streams/prices',
    }, {
      servers: [{ url: 'https://api.example.com' }],
      fetchImpl: fetchImpl as typeof fetch,
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ title: 'Upstream stream unavailable' })
  })
})
