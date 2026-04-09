import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStreamableHttpTransport } from '../../../src/protocols/mcp/transport/streamable-http.js'
import { createStdioTransport } from '../../../src/protocols/mcp/transport/stdio.js'
import type { IncomingMessage, ServerResponse } from 'http'
import { Readable, Writable } from 'stream'

// ─── Streamable HTTP Transport ──────────────────────────────────

function createMockReq(method: string, url: string, headers: Record<string, string> = {}, body = ''): IncomingMessage {
  const readable = new Readable({ read() {} })
  if (body) {
    readable.push(body)
    readable.push(null)
  } else {
    readable.push(null)
  }
  return Object.assign(readable, {
    method,
    url,
    headers: { ...headers },
  }) as unknown as IncomingMessage
}

function createMockRes(): ServerResponse & { _status: number; _headers: Record<string, string>; _body: string; _ended: boolean } {
  const chunks: string[] = []
  const headers: Record<string, string> = {}
  const res = {
    _status: 200,
    _headers: headers,
    _body: '',
    _ended: false,
    writeHead(status: number, h?: Record<string, string>) {
      res._status = status
      if (h) Object.assign(headers, h)
      return res
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
      return res
    },
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    end(data?: string) {
      if (data) chunks.push(data)
      res._body = chunks.join('')
      res._ended = true
    },
  }
  return res as any
}

describe('Streamable HTTP Transport', () => {
  it('should create transport and middleware', () => {
    const { transport, middleware } = createStreamableHttpTransport()
    expect(transport).toBeDefined()
    expect(typeof transport.start).toBe('function')
    expect(typeof transport.stop).toBe('function')
    expect(typeof transport.send).toBe('function')
    expect(typeof middleware).toBe('function')
  })

  it('should not handle requests to wrong path', async () => {
    const { middleware } = createStreamableHttpTransport({ path: '/mcp' })
    const req = createMockReq('POST', '/other')
    const res = createMockRes()
    const handled = await middleware(req, res)
    expect(handled).toBe(false)
  })

  it('should handle OPTIONS with CORS headers', async () => {
    const { transport, middleware } = createStreamableHttpTransport()
    await transport.start(async () => null)

    const req = createMockReq('OPTIONS', '/mcp')
    const res = createMockRes()
    const handled = await middleware(req, res)

    expect(handled).toBe(true)
    expect(res._status).toBe(204)
  })

  it('should handle POST with JSON-RPC request', async () => {
    const { transport, middleware } = createStreamableHttpTransport()
    await transport.start(async (request) => ({
      jsonrpc: '2.0' as const,
      id: request.id ?? null,
      result: { ok: true },
    }))

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const req = createMockReq('POST', '/mcp', { 'content-type': 'application/json' }, body)
    const res = createMockRes()
    const handled = await middleware(req, res)

    expect(handled).toBe(true)
    expect(res._status).toBe(200)
    const parsed = JSON.parse(res._body)
    expect(parsed.result).toEqual({ ok: true })
  })

  it('should return parse error for invalid JSON', async () => {
    const { transport, middleware } = createStreamableHttpTransport()
    await transport.start(async () => null)

    const req = createMockReq('POST', '/mcp', {}, 'not json')
    const res = createMockRes()
    await middleware(req, res)

    expect(res._status).toBe(200)
    const parsed = JSON.parse(res._body)
    expect(parsed.error.code).toBe(-32700) // ParseError
  })

  it('should return 405 for unsupported methods', async () => {
    const { transport, middleware } = createStreamableHttpTransport()
    await transport.start(async () => null)

    const req = createMockReq('PUT', '/mcp')
    const res = createMockRes()
    await middleware(req, res)

    expect(res._status).toBe(405)
  })

  it('should include Mcp-Session-Id in response', async () => {
    const { transport, middleware } = createStreamableHttpTransport({ stateful: true })
    await transport.start(async (request) => ({
      jsonrpc: '2.0' as const,
      id: request.id ?? null,
      result: {},
    }))

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const req = createMockReq('POST', '/mcp', {}, body)
    const res = createMockRes()
    await middleware(req, res)

    expect(res._headers['Mcp-Session-Id'] || res._headers['mcp-session-id']).toBeDefined()
  })

  it('should reject unauthenticated requests when auth is configured', async () => {
    const { transport, middleware } = createStreamableHttpTransport({
      auth: {
        verify: (req) => {
          const auth = req.headers.authorization
          if (auth === 'Bearer valid') return { token: 'valid', clientId: 'user', scopes: [] }
          return null
        },
      },
    })
    await transport.start(async (request) => ({
      jsonrpc: '2.0' as const,
      id: request.id ?? null,
      result: {},
    }))

    // No auth → 401
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const noAuth = createMockReq('POST', '/mcp', {}, body)
    const noAuthRes = createMockRes()
    await middleware(noAuth, noAuthRes)
    expect(noAuthRes._status).toBe(401)

    // Valid auth → 200
    const withAuth = createMockReq('POST', '/mcp', { authorization: 'Bearer valid' }, body)
    const withAuthRes = createMockRes()
    await middleware(withAuth, withAuthRes)
    expect(withAuthRes._status).toBe(200)
  })

  it('should handle DELETE for session teardown', async () => {
    const { transport, middleware } = createStreamableHttpTransport({ stateful: true })
    await transport.start(async (request) => ({
      jsonrpc: '2.0' as const,
      id: request.id ?? null,
      result: {},
    }))

    // First create a session via POST
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const postReq = createMockReq('POST', '/mcp', {}, body)
    const postRes = createMockRes()
    await middleware(postReq, postRes)
    const sessionId = postRes._headers['Mcp-Session-Id'] || postRes._headers['mcp-session-id']

    // DELETE with session ID
    const delReq = createMockReq('DELETE', '/mcp', { 'mcp-session-id': sessionId })
    const delRes = createMockRes()
    await middleware(delReq, delRes)
    expect(delRes._status).toBe(204)
  })

  it('should return 404 for DELETE with unknown session', async () => {
    const { transport, middleware } = createStreamableHttpTransport({ stateful: true })
    await transport.start(async () => null)

    const req = createMockReq('DELETE', '/mcp', { 'mcp-session-id': 'nonexistent' })
    const res = createMockRes()
    await middleware(req, res)
    expect(res._status).toBe(404)
  })

  it('should stop cleanly', async () => {
    const { transport } = createStreamableHttpTransport()
    await transport.start(async () => null)
    await transport.stop()
    // No error = success
  })

  it('should work in stateless mode', async () => {
    const { transport, middleware } = createStreamableHttpTransport({ stateful: false })
    await transport.start(async (request) => ({
      jsonrpc: '2.0' as const,
      id: request.id ?? null,
      result: { stateless: true },
    }))

    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const req = createMockReq('POST', '/mcp', {}, body)
    const res = createMockRes()
    await middleware(req, res)

    expect(res._status).toBe(200)
    // No session header in stateless mode
    expect(res._headers['Mcp-Session-Id']).toBeUndefined()
  })

  it('should return 202 for notifications (no response body)', async () => {
    const { transport, middleware } = createStreamableHttpTransport()
    await transport.start(async () => null) // null = notification handled

    const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const req = createMockReq('POST', '/mcp', {}, body)
    const res = createMockRes()
    await middleware(req, res)

    expect(res._status).toBe(202)
  })
})

// ─── Stdio Transport ────────────────────────────────────────────

describe('Stdio Transport', () => {
  it('should create transport', () => {
    // Use a stream that never ends (no process.exit trigger)
    const input = new Readable({ read() {} })
    const output = new Writable({ write(_, __, cb) { cb() } })

    const transport = createStdioTransport({ input, output })
    expect(transport).toBeDefined()
    expect(typeof transport.start).toBe('function')
    expect(typeof transport.stop).toBe('function')
    expect(typeof transport.send).toBe('function')
  })
})
