import { describe, it, expect, afterEach } from 'vitest'
import { createMcpServer } from '../../../src/protocols/mcp/standalone.js'
import { mcpText, mcpJson, mcpError } from '../../../src/protocols/mcp/response-helpers.js'
import { z } from 'zod'

describe('createMcpServer (standalone)', () => {
  it('should create a server with fluent API', () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })

    server
      .tool({ name: 'a', description: 'A', handler: async () => mcpText('a') })
      .tool({ name: 'b', description: 'B', handler: async () => mcpText('b') })
      .resource({ uri: 'r://x', name: 'X', handler: async () => ({ contents: [{ uri: 'r://x', mimeType: 'text/plain', text: 'x' }] }) })
      .prompt({ name: 'p', description: 'P', handler: async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] }) })

    const protocol = server.getProtocolHandler()
    expect(protocol.listTools()).toHaveLength(2)
    expect(protocol.listResources()).toHaveLength(1)
    expect(protocol.listPrompts()).toHaveLength(1)
  })

  it('should register tools with Zod schemas', () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })

    server.tool({
      name: 'greet',
      description: 'Greet',
      input: z.object({ name: z.string() }),
      handler: async ({ name }) => mcpText(`Hello, ${name}!`),
    })

    const tools = server.getProtocolHandler().listTools()
    expect(tools[0].name).toBe('greet')
    expect(tools[0].inputSchema.properties).toHaveProperty('name')
  })

  it('should register tools with raw JSON Schema', () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })

    server.tool({
      name: 'echo',
      description: 'Echo',
      input: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      handler: async ({ msg }) => mcpText(String(msg)),
    })

    const tools = server.getProtocolHandler().listTools()
    expect(tools[0].inputSchema.required).toEqual(['msg'])
  })

  it('should register interceptors via use()', async () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })
    const log: string[] = []

    server.use(async (req, next) => {
      log.push(`before:${req.name}`)
      const r = await next()
      log.push(`after:${req.name}`)
      return r
    })

    server.tool({ name: 'x', description: 'X', handler: async () => mcpText('ok') })

    const protocol = server.getProtocolHandler()
    await protocol.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: {} } })

    expect(log).toEqual(['before:x', 'after:x'])
  })

  it('should register resource templates', () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })

    server.resourceTemplate({
      uriTemplate: 'db://{table}/{id}',
      name: 'DB Record',
      handler: async (uri, params) => ({
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(params) }],
      }),
    })

    const protocol = server.getProtocolHandler()
    expect(protocol.listResources()).toHaveLength(0) // templates != static resources
  })

  it('should handle tool call through protocol handler', async () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })

    server.tool({
      name: 'add',
      description: 'Add',
      input: z.object({ a: z.number(), b: z.number() }),
      handler: async ({ a, b }) => mcpJson({ result: a + b }),
    })

    const protocol = server.getProtocolHandler()
    const response = await protocol.handleRequest({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 5, b: 3 } },
    })

    const result = response!.result as { content: Array<{ text: string }> }
    expect(JSON.parse(result.content[0].text)).toEqual({ result: 8 })
  })

  it('should return error for unknown tool', async () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })

    const protocol = server.getProtocolHandler()
    const response = await protocol.handleRequest({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    })

    expect(response!.error).toBeDefined()
  })

  it('should support getProtocolHandler() for advanced use', () => {
    const server = createMcpServer({ name: 'test', version: '1.0.0' })
    const protocol = server.getProtocolHandler()

    protocol.registerTool({
      name: 'direct',
      description: 'Directly registered',
      handler: async () => mcpText('direct'),
    })

    expect(protocol.listTools()).toHaveLength(1)
  })

  it('should include server options in initialize', async () => {
    const server = createMcpServer({
      name: 'my-app',
      version: '2.0.0',
      title: 'My App',
      description: 'Cool app',
      websiteUrl: 'https://example.com',
      instructions: 'Use tool X first',
    })

    const protocol = server.getProtocolHandler()
    const response = await protocol.handleRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    })

    const result = response!.result as Record<string, unknown>
    const info = result.serverInfo as Record<string, unknown>
    expect(info.name).toBe('my-app')
    expect(info.title).toBe('My App')
    expect(info.websiteUrl).toBe('https://example.com')
    expect(result.instructions).toBe('Use tool X first')
  })
})
