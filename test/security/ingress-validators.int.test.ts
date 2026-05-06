/**
 * Trust-boundary ingress validators (#107).
 *
 * JSON-RPC method, MCP tool name, and MCP resource URI must reject
 * malicious bytes (CRLF, NUL, control chars, oversize) at ingress before
 * the registry, the policy engine, structured logs, or downstream
 * handlers observe them.
 */

import { describe, it, expect } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createJsonRpcAdapter } from '../../src/adapters/jsonrpc.js'
import { createRouter } from '../../src/core/router.js'
import { createRegistry } from '../../src/core/registry.js'
import { createProtocolHandler } from '../../src/protocols/mcp/protocol.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      if (!address || typeof address === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

describe('JSON-RPC method ingress validation (#107)', () => {
  it('rejects CRLF in method name with INVALID_REQUEST', async () => {
    const registry = createRegistry()
    registry.procedure('echo', async (input) => input)
    const router = createRouter(registry)
    const port = await getFreePort()
    const adapter = createJsonRpcAdapter(router, { port, host: '127.0.0.1', path: '/rpc' })
    await adapter.start()

    try {
      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo\r\nx-injected: pwn', params: {} }),
      })
      const body = await res.json() as { error?: { code: number; message: string } }
      expect(body.error?.message).toMatch(/invalid characters/i)
      // Procedure was never reached.
      expect(body).not.toHaveProperty('result')
    } finally {
      await adapter.stop()
    }
  })

  it('rejects NUL in method name', async () => {
    const registry = createRegistry()
    registry.procedure('echo', async (input) => input)
    const router = createRouter(registry)
    const port = await getFreePort()
    const adapter = createJsonRpcAdapter(router, { port, host: '127.0.0.1', path: '/rpc' })
    await adapter.start()

    try {
      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo\x00pwn', params: {} }),
      })
      const body = await res.json() as { error?: { message: string } }
      expect(body.error?.message).toMatch(/invalid characters/i)
    } finally {
      await adapter.stop()
    }
  })

  it('accepts a normal dot-separated method name', async () => {
    const registry = createRegistry()
    registry.procedure('users.list', async () => [])
    const router = createRouter(registry)
    const port = await getFreePort()
    const adapter = createJsonRpcAdapter(router, { port, host: '127.0.0.1', path: '/rpc' })
    await adapter.start()

    try {
      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'users.list', params: {} }),
      })
      const body = await res.json() as { result?: unknown; error?: unknown }
      expect(body.result).toEqual([])
      expect(body.error).toBeUndefined()
    } finally {
      await adapter.stop()
    }
  })
})

describe('MCP tool/resource ingress validation (#107)', () => {
  it('rejects CRLF in tool name with InvalidParams', async () => {
    const protocol = createProtocolHandler({ name: 'test', version: '1.0.0' })

    const res = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'good\r\nx-injected: pwn', arguments: {} },
    })
    expect(res).toMatchObject({
      error: { message: expect.stringMatching(/invalid characters/i) },
    })
  })

  it('rejects NUL in tool name', async () => {
    const protocol = createProtocolHandler({ name: 'test', version: '1.0.0' })

    const res = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'good\x00pwn', arguments: {} },
    })
    expect(res).toMatchObject({
      error: { message: expect.stringMatching(/invalid characters/i) },
    })
  })

  it('rejects CRLF in resource URI', async () => {
    const protocol = createProtocolHandler({ name: 'test', version: '1.0.0' })

    const res = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'file:///ok\r\nset-cookie: pwn' },
    })
    expect(res).toMatchObject({
      error: { message: expect.stringMatching(/invalid characters/i) },
    })
  })

  it('accepts a normal URI with `://`, path, and query', async () => {
    const protocol = createProtocolHandler({ name: 'test', version: '1.0.0' })

    const res = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'file:///etc/hostname?foo=bar' },
    })
    // URI passed validation; resource itself is unregistered → InvalidParams,
    // but the rejection reason is "Resource not found", not "invalid characters".
    expect(res).toMatchObject({ error: expect.any(Object) })
    expect((res as { error: { message: string } }).error.message).not.toMatch(/invalid characters/i)
  })
})
