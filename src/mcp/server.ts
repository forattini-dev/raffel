/**
 * Raffel MCP Server
 *
 * Model Context Protocol server with stdio, HTTP, and SSE transports.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { createInterface } from 'readline'
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MCPServerOptions,
  MCPCapabilities,
  MCPInitializeResult,
  CategoryName,
} from './types.js'
import { JsonRpcErrorCode } from './types.js'
import { tools, getToolsByCategory, handlers } from './tools/index.js'
import { getStaticResources, getResourceTemplates, readResource } from './resources/index.js'
import { prompts, getPromptResult } from './prompts/index.js'
import { MCP_VERSION } from './version.js'

export class MCPServer {
  private options: MCPServerOptions
  private debug: boolean
  private enabledTools: string[]
  private _initialized: boolean = false

  constructor(options: MCPServerOptions = {}) {
    this.options = {
      name: options.name || 'raffel-mcp',
      version: options.version || MCP_VERSION,
      port: options.port || 3200,
      transport: options.transport || 'stdio',
      debug: options.debug || false,
      category: options.category || 'full',
      ...options,
    }

    this.debug = this.options.debug || false

    // Determine enabled tools based on category
    const categories = Array.isArray(this.options.category)
      ? this.options.category
      : [this.options.category || 'full']

    const enabledSet = new Set<string>()
    for (const cat of categories) {
      for (const tool of getToolsByCategory(cat as CategoryName)) {
        enabledSet.add(tool.name)
      }
    }
    this.enabledTools = Array.from(enabledSet)

    // Apply additional filters
    if (this.options.toolsFilter) {
      this.enabledTools = this.enabledTools.filter((name) => {
        return this.options.toolsFilter!.some((pattern) => {
          if (pattern.startsWith('!')) {
            return !this.matchPattern(name, pattern.slice(1))
          }
          return this.matchPattern(name, pattern)
        })
      })
    }
  }

  private matchPattern(name: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (pattern === name) return true
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return regex.test(name)
    }
    return false
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.error('[raffel-mcp]', ...args)
    }
  }

  async start(): Promise<void> {
    const transport = this.options.transport || 'stdio'

    switch (transport) {
      case 'stdio':
        await this.startStdio()
        break
      case 'http':
        await this.startHttp()
        break
      case 'sse':
        await this.startSSE()
        break
      default:
        throw new Error(`Unknown transport: ${transport}`)
    }
  }

  private async startStdio(): Promise<void> {
    this.log('Starting stdio transport')

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    })

    rl.on('line', async (line) => {
      try {
        const request = JSON.parse(line) as JsonRpcRequest
        const response = await this.handleRequest(request)
        if (response) {
          console.log(JSON.stringify(response))
        }
      } catch (error) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: JsonRpcErrorCode.ParseError,
            message: 'Parse error',
            data: (error as Error).message,
          },
        }
        console.log(JSON.stringify(errorResponse))
      }
    })

    rl.on('close', () => {
      process.exit(0)
    })
  }

  private async startHttp(): Promise<void> {
    const port = this.options.port || 3200

    const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', version: MCP_VERSION }))
        return
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const request = JSON.parse(body) as JsonRpcRequest
            const response = await this.handleRequest(request)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
          } catch (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: JsonRpcErrorCode.ParseError,
                  message: 'Parse error',
                  data: (error as Error).message,
                },
              })
            )
          }
        })
        return
      }

      res.writeHead(405)
      res.end('Method not allowed')
    })

    server.listen(port, () => {
      this.log(`HTTP server listening on port ${port}`)
      console.error(`Raffel MCP server running on http://localhost:${port}`)
    })
  }

  private async startSSE(): Promise<void> {
    const port = this.options.port || 3200
    const clients: ServerResponse[] = []

    const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // SSE endpoint
      if (req.method === 'GET' && req.url === '/sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })

        clients.push(res)
        res.write('data: {"type":"connected"}\n\n')

        req.on('close', () => {
          const index = clients.indexOf(res)
          if (index > -1) clients.splice(index, 1)
        })
        return
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', version: MCP_VERSION, clients: clients.length }))
        return
      }

      if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const request = JSON.parse(body) as JsonRpcRequest
            const response = await this.handleRequest(request)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
          } catch (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: JsonRpcErrorCode.ParseError,
                  message: 'Parse error',
                  data: (error as Error).message,
                },
              })
            )
          }
        })
        return
      }

      res.writeHead(405)
      res.end('Method not allowed')
    })

    server.listen(port, () => {
      this.log(`SSE server listening on port ${port}`)
      console.error(`Raffel MCP server running on http://localhost:${port}`)
      console.error(`SSE endpoint: http://localhost:${port}/sse`)
    })
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { id, method, params } = request

    // Notifications don't return responses
    if (id === undefined || id === null) {
      await this.handleNotification(method, params)
      return null
    }

    try {
      const result = await this.handleMethod(method, params || {})
      return {
        jsonrpc: '2.0',
        id,
        result,
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: this.formatError(error),
      }
    }
  }

  private async handleNotification(
    method: string,
    params: Record<string, unknown> | undefined
  ): Promise<void> {
    this.log('Notification:', method, params)

    switch (method) {
      case 'notifications/initialized':
        this._initialized = true
        break
      case 'notifications/cancelled':
        // Handle request cancellation
        break
    }
  }

  private async handleMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    this.log('Method:', method, params)

    switch (method) {
      case 'initialize':
        return this.handleInitialize(params)

      case 'tools/list':
        return this.handleToolsList()

      case 'tools/call':
        return this.handleToolCall(params)

      case 'resources/list':
        return this.handleResourcesList()

      case 'resources/templates/list':
        return this.handleResourceTemplatesList()

      case 'resources/read':
        return this.handleResourceRead(params)

      case 'prompts/list':
        return this.handlePromptsList()

      case 'prompts/get':
        return this.handlePromptGet(params)

      case 'completion/complete':
        return this.handleCompletion(params)

      case 'ping':
        return {}

      default:
        throw {
          code: JsonRpcErrorCode.MethodNotFound,
          message: `Method not found: ${method}`,
        }
    }
  }

  private handleInitialize(params: Record<string, unknown>): MCPInitializeResult {
    const capabilities: MCPCapabilities = {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
      logging: {},
    }

    return {
      protocolVersion: '2024-11-05',
      capabilities,
      serverInfo: {
        name: this.options.name || 'raffel-mcp',
        version: this.options.version || MCP_VERSION,
      },
      instructions: `Raffel MCP Server - Unified Multi-Protocol Server Runtime

Available tools for documentation, code generation, and debugging:
- raffel_getting_started: Quick start guide
- raffel_search: Search documentation
- raffel_api_patterns: CRITICAL - Learn correct code patterns
- raffel_create_*: Generate server, procedures, streams, events
- raffel_add_middleware: Add interceptors
- raffel_explain_error: Debug error codes

Use raffel_api_patterns before generating code to ensure correct structure.`,
    }
  }

  private handleToolsList(): { tools: typeof tools } {
    const enabledTools = tools.filter((t) => this.enabledTools.includes(t.name))
    return { tools: enabledTools }
  }

  private async handleToolCall(params: Record<string, unknown>): Promise<unknown> {
    const name = String(params.name || '')
    const args = (params.arguments as Record<string, unknown>) || {}

    if (!name) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: 'Tool name required' }
    }

    if (!this.enabledTools.includes(name)) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: `Tool not found: ${name}` }
    }

    const handler = handlers[name]
    if (!handler) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: `Tool handler not found: ${name}` }
    }

    return await handler(args)
  }

  private handleResourcesList(): { resources: ReturnType<typeof getStaticResources> } {
    return { resources: getStaticResources() }
  }

  private handleResourceTemplatesList(): {
    resourceTemplates: ReturnType<typeof getResourceTemplates>
  } {
    return { resourceTemplates: getResourceTemplates() }
  }

  private handleResourceRead(params: Record<string, unknown>): unknown {
    const uri = String(params.uri || '')
    if (!uri) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: 'Resource URI required' }
    }

    const result = readResource(uri)
    if (!result) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: `Resource not found: ${uri}` }
    }

    return result
  }

  private handlePromptsList(): { prompts: typeof prompts } {
    return { prompts }
  }

  private handlePromptGet(params: Record<string, unknown>): unknown {
    const name = String(params.name || '')
    const args = (params.arguments as Record<string, string>) || {}

    if (!name) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: 'Prompt name required' }
    }

    const result = getPromptResult(name, args)
    if (!result) {
      throw { code: JsonRpcErrorCode.InvalidParams, message: `Prompt not found: ${name}` }
    }

    return result
  }

  private handleCompletion(params: Record<string, unknown>): unknown {
    const ref = params.ref as { type: string; name: string } | undefined
    const argument = params.argument as { name: string; value: string } | undefined

    if (!ref || !argument) {
      return { completion: { values: [], hasMore: false } }
    }

    // Provide completions based on context
    const values: string[] = []

    if (ref.type === 'ref/argument') {
      // Tool argument completions
      if (argument.name === 'name' && ref.name === 'raffel_get_interceptor') {
        const allInterceptors = [
          'createAuthMiddleware',
          'createRateLimitInterceptor',
          'timeout',
          'retry',
          'circuitBreaker',
          'cache',
          'logging',
          'bulkhead',
          'fallback',
        ]
        values.push(...allInterceptors.filter((i) => i.includes(argument.value)))
      }

      if (argument.name === 'name' && ref.name === 'raffel_get_adapter') {
        const allAdapters = ['HTTP', 'WebSocket', 'gRPC', 'JSON-RPC', 'GraphQL', 'TCP', 'S3DB']
        values.push(...allAdapters.filter((a) => a.toLowerCase().includes(argument.value.toLowerCase())))
      }

      if (argument.name === 'code' && ref.name === 'raffel_explain_error') {
        const allErrors = [
          'INVALID_ARGUMENT',
          'UNAUTHENTICATED',
          'PERMISSION_DENIED',
          'NOT_FOUND',
          'ALREADY_EXISTS',
          'RESOURCE_EXHAUSTED',
          'DEADLINE_EXCEEDED',
          'CANCELLED',
          'INTERNAL',
          'UNAVAILABLE',
        ]
        values.push(...allErrors.filter((e) => e.includes(argument.value.toUpperCase())))
      }
    }

    return {
      completion: {
        values: values.slice(0, 10),
        total: values.length,
        hasMore: values.length > 10,
      },
    }
  }

  private formatError(error: unknown): JsonRpcError {
    if (typeof error === 'object' && error !== null) {
      const err = error as { code?: number; message?: string; data?: unknown }
      return {
        code: err.code || JsonRpcErrorCode.InternalError,
        message: err.message || 'Internal error',
        data: err.data,
      }
    }

    return {
      code: JsonRpcErrorCode.InternalError,
      message: String(error),
    }
  }
}

// === Server Factory ===

export function createMCPServer(options?: MCPServerOptions): MCPServer {
  return new MCPServer(options)
}

export async function runMCPServer(options?: MCPServerOptions): Promise<void> {
  const server = createMCPServer(options)
  await server.start()
}
