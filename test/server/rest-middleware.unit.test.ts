import { describe, expect, it } from 'vitest'
import { createRestMiddleware } from '../../src/server/rest-middleware.js'

/**
 * Regression: a literal path (`/org/nodes/salesforce-ids`) must win over a
 * parametrized sibling (`/org/nodes/:id`) even when the dynamic route was
 * discovered first (`[id]` sorts before `salesforce-ids` on disk).
 */
function makeResources() {
  return [
    {
      name: 'nodes',
      filePath: '/virtual/nodes.rest.ts',
      routes: [
        { method: 'GET', path: '/org/nodes/:id', operation: 'get' },
        { method: 'GET', path: '/org/nodes/salesforce-ids', operation: 'salesforceIds' },
        { method: 'GET', path: '/org/nodes/:id/rollup', operation: 'rollup' },
        { method: 'GET', path: '/org/nodes/ids', operation: 'ids' },
      ],
    },
  ] as any
}

function makeResponse() {
  const state = { status: 0, body: '' }
  const res = {
    headersSent: false,
    setHeader() {},
    getHeader() { return undefined },
    writeHead(status: number) {
      state.status = status
      res.headersSent = true
    },
    end(chunk?: Uint8Array | string) {
      if (chunk) state.body = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    },
    on() {},
    once() {},
  }
  return { res: res as any, state }
}

async function dispatch(pathname: string, restResources = makeResources()) {
  const calls: Array<{ procedure: string; params: Record<string, string> }> = []
  const router = {
    handle: async (envelope: any) => {
      calls.push({ procedure: envelope.procedure, params: envelope.context?.params ?? {} })
      return { ok: true }
    },
  } as any
  const middleware = createRestMiddleware({
    restResources,
    router,
    basePath: '/admin/v1',
    maxBodySize: 1024,
  })
  const { res, state } = makeResponse()
  const handled = await middleware(
    {
      method: 'GET',
      url: pathname,
      headers: { host: 'localhost', accept: 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
      on() {},
      once() {},
      off() {},
      removeListener() {},
    } as any,
    res
  )
  return { handled, calls, state }
}

describe('createRestMiddleware route precedence', () => {
  it('routes a literal path to its own operation even if a :param sibling was registered first', async () => {
    const { handled, calls } = await dispatch('/admin/v1/org/nodes/salesforce-ids')
    expect(handled).toBe(true)
    expect(calls).toEqual([{ procedure: 'nodes.salesforceIds', params: {} }])

    const ids = await dispatch('/admin/v1/org/nodes/ids')
    expect(ids.calls[0]?.procedure).toBe('nodes.ids')
  })

  it('still routes a real id to the dynamic operation with the decoded param', async () => {
    const { calls } = await dispatch('/admin/v1/org/nodes/01J%20X')
    expect(calls).toEqual([{ procedure: 'nodes.get', params: { id: '01J X' } }])
  })

  it('keeps registration order among dynamic routes of different shape', async () => {
    const { calls } = await dispatch('/admin/v1/org/nodes/abc/rollup')
    expect(calls[0]).toEqual({ procedure: 'nodes.rollup', params: { id: 'abc' } })
  })

  it('does not handle a path that matches no route', async () => {
    const { handled, calls } = await dispatch('/admin/v1/org/other')
    expect(handled).toBe(false)
    expect(calls).toEqual([])
  })
})
