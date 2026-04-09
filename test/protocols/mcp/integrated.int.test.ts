import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../../src/server/builder.js'
import type { RaffelServer } from '../../../src/server/types.js'

let server: RaffelServer | null = null

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

function getBase(s: RaffelServer): string {
  const port = s.addresses!.http.port
  return `http://127.0.0.1:${port}`
}

async function mcpCall(base: string, method: string, params?: Record<string, unknown>, id = 1): Promise<unknown> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  return res.json()
}

describe('MCP Integrated Mode', () => {
  it('should start a server with mcp: true', async () => {
    server = createServer({ port: 24900, mcp: true })

    server.procedure('users.list')
      .description('List all users')
      .handler(async () => [{ id: '1', name: 'Alice' }])

    await server.start()
    expect(server.addresses?.protocols?.mcp).toBeDefined()
    expect(server.addresses!.protocols!.mcp.path).toBe('/mcp')
  })

  it('should expose procedures as MCP tools via /mcp', async () => {
    server = createServer({ port: 24900, mcp: true })

    server.procedure('math.add')
      .description('Add two numbers')
      .handler(async (input) => {
        const { a, b } = input as { a: number; b: number }
        return { result: a + b }
      })

    server.procedure('math.multiply')
      .description('Multiply two numbers')
      .handler(async (input) => {
        const { a, b } = input as { a: number; b: number }
        return { result: a * b }
      })

    await server.start()
    const base = getBase(server)

    // Initialize
    const initData = await mcpCall(base, 'initialize') as { result: { serverInfo: { name: string } } }
    expect(initData.result.serverInfo.name).toBe('raffel')

    // List tools
    const listData = await mcpCall(base, 'tools/list', {}, 2) as { result: { tools: Array<{ name: string }> } }
    const toolNames = listData.result.tools.map((t) => t.name)
    expect(toolNames).toContain('math_add')
    expect(toolNames).toContain('math_multiply')

    // Call tool
    const callData = await mcpCall(base, 'tools/call', { name: 'math_add', arguments: { a: 10, b: 20 } }, 3) as {
      result: { content: Array<{ text: string }> }
    }
    const parsed = JSON.parse(callData.result.content[0].text)
    expect(parsed.result).toBe(30)
  })

  it('should support mcp option with custom path', async () => {
    server = createServer({ port: 24900, mcp: { path: '/api/mcp' } })

    server.procedure('ping')
      .description('Ping')
      .handler(async () => 'pong')

    await server.start()
    const port = server.addresses!.http.port

    const res = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    const data = await res.json() as { result: Record<string, unknown> }
    expect(data.result).toEqual({})
  })

  it('should support mcp filter option', async () => {
    server = createServer({
      port: 24900,
      mcp: {
        filter: (meta) => meta.tags?.includes('public') ?? false,
      },
    })

    server.procedure('public.list')
      .tags('public')
      .description('Public list')
      .handler(async () => [])

    server.procedure('internal.admin')
      .tags('internal')
      .description('Internal admin')
      .handler(async () => ({}))

    await server.start()
    const base = getBase(server)

    const data = await mcpCall(base, 'tools/list') as { result: { tools: Array<{ name: string }> } }
    expect(data.result.tools).toHaveLength(1)
    expect(data.result.tools[0].name).toBe('public_list')
  })

  it('should support extra manually-defined tools', async () => {
    const { mcpText } = await import('../../../src/protocols/mcp/response-helpers.js')

    server = createServer({
      port: 24900,
      mcp: {
        tools: [{
          name: 'custom_tool',
          description: 'A custom tool not from registry',
          handler: async () => mcpText('custom result'),
        }],
      },
    })

    await server.start()
    const base = getBase(server)

    const data = await mcpCall(base, 'tools/call', { name: 'custom_tool', arguments: {} }) as {
      result: { content: Array<{ text: string }> }
    }
    expect(data.result.content[0].text).toBe('custom result')
  })

  it('should reject unauthenticated requests when auth is configured', async () => {
    const { createBearerAuth } = await import('../../../src/protocols/mcp/auth.js')
    const { mcpText } = await import('../../../src/protocols/mcp/response-helpers.js')

    server = createServer({
      port: 24900,
      mcp: {
        auth: createBearerAuth({
          verify: (token) => {
            if (token === 'valid-token') {
              return { token, clientId: 'test-client', scopes: ['read'] }
            }
            return null
          },
        }),
        tools: [{
          name: 'secret_tool',
          description: 'Secret tool',
          handler: async (_args, ctx) => mcpText(`Hello ${ctx.auth?.clientId ?? 'anonymous'}`),
        }],
      },
    })

    await server.start()
    const port = server.addresses!.http.port
    const base = `http://127.0.0.1:${port}`

    // No token → 401
    const noAuthRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(noAuthRes.status).toBe(401)

    // Invalid token → 401
    const badAuthRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer bad-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(badAuthRes.status).toBe(401)

    // Valid token → 200 + tool has ctx.auth
    const goodRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid-token' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'secret_tool', arguments: {} },
      }),
    })
    expect(goodRes.status).toBe(200)
    const data = await goodRes.json() as { result: { content: Array<{ text: string }> } }
    expect(data.result.content[0].text).toBe('Hello test-client')
  })

  it('should support API key auth', async () => {
    const { createApiKeyAuth } = await import('../../../src/protocols/mcp/auth.js')
    const { mcpText } = await import('../../../src/protocols/mcp/response-helpers.js')

    server = createServer({
      port: 24900,
      mcp: {
        auth: createApiKeyAuth({
          keys: {
            'sk-test-123': { clientId: 'client-1', scopes: ['read', 'write'] },
          },
        }),
        tools: [{
          name: 'check_auth',
          description: 'Check auth',
          handler: async (_args, ctx) => mcpText(JSON.stringify({
            clientId: ctx.auth?.clientId,
            scopes: ctx.auth?.scopes,
          })),
        }],
      },
    })

    await server.start()
    const port = server.addresses!.http.port
    const base = `http://127.0.0.1:${port}`

    // No key → 401
    const noKeyRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(noKeyRes.status).toBe(401)

    // Valid key → 200
    const goodRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'sk-test-123' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'check_auth', arguments: {} },
      }),
    })
    expect(goodRes.status).toBe(200)
    const data = await goodRes.json() as { result: { content: Array<{ text: string }> } }
    const authData = JSON.parse(data.result.content[0].text)
    expect(authData.clientId).toBe('client-1')
    expect(authData.scopes).toEqual(['read', 'write'])
  })
})
