/**
 * Raffel MCP Server
 *
 * Built-in AI assistant with tools, resources, and prompts for the Raffel framework.
 * Now powered by the Raffel MCP protocol engine (src/protocols/mcp/).
 */

import type { JsonRpcRequest, JsonRpcResponse, MCPServerOptions, CategoryName } from './types.js'
import { tools, getToolsByCategory, handlers } from './tools/index.js'
import { getStaticResources, getResourceTemplates, readResource, getGuideCatalog } from './resources/index.js'
import { prompts, getPromptResult } from './prompts/index.js'
import { MCP_VERSION } from './version.js'
import { interceptors, adapters, errors } from './docs/index.js'
import { createProtocolHandler, type McpProtocolHandler } from '../protocols/mcp/protocol.js'
import { createStdioTransport } from '../protocols/mcp/transport/stdio.js'
import { createStreamableHttpTransport } from '../protocols/mcp/transport/streamable-http.js'
import { createSseTransport } from '../protocols/mcp/transport/sse.js'
import type { McpTransport } from '../protocols/mcp/transport/types.js'

export class MCPServer {
  private protocol: McpProtocolHandler
  private options: MCPServerOptions
  private debug: boolean

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
      const toolDefs = getToolsByCategory(cat)
      if (toolDefs.length === 0) {
        this.log(`Unknown MCP category: ${cat}`)
        continue
      }
      for (const tool of toolDefs) {
        enabledSet.add(tool.name)
      }
    }

    let enabledTools = Array.from(enabledSet)

    // Apply additional filters
    if (this.options.toolsFilter) {
      enabledTools = enabledTools.filter((name) => {
        return this.options.toolsFilter!.some((pattern) => {
          if (pattern.startsWith('!')) {
            return !this.matchPattern(name, pattern.slice(1))
          }
          return this.matchPattern(name, pattern)
        })
      })
    }

    // Create protocol handler from the new engine
    this.protocol = createProtocolHandler({
      name: this.options.name || 'raffel-mcp',
      version: this.options.version || MCP_VERSION,
      instructions: `Raffel MCP Server - Unified Multi-Protocol Server Runtime

Available tools for documentation, code generation, and debugging:
- raffel_getting_started: Quick start guide
- raffel_search: Search documentation
- raffel_api_patterns: Learn canonical API patterns
- raffel_create_*: Generate server, procedures, streams, events
- raffel_add_middleware: Add interceptors
- raffel_explain_error: Debug error codes

Use raffel_feature_catalog and raffel_api_patterns before generating implementation code to keep your output on track.`,
    })

    // Register only enabled tools
    for (const name of enabledTools) {
      const toolDef = tools.find((t) => t.name === name)
      const handler = handlers[name]
      if (!toolDef || !handler) continue

      this.protocol.registerTool({
        name: toolDef.name,
        description: toolDef.description,
        input: toolDef.inputSchema as import('../protocols/mcp/types.js').JsonSchema,
        handler: async (args) => handler(args as Record<string, unknown>),
      })
    }

    // Register resources
    for (const resource of getStaticResources()) {
      this.protocol.registerResource({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        handler: async (uri) => {
          const result = readResource(uri)
          if (!result) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Resource not found' }] }
          }
          return result
        },
      })
    }

    // Register resource templates
    for (const template of getResourceTemplates()) {
      this.protocol.registerResourceTemplate({
        uriTemplate: template.uriTemplate,
        name: template.name,
        description: template.description,
        mimeType: template.mimeType,
        handler: async (uri) => {
          const result = readResource(uri)
          if (!result) {
            return { contents: [{ uri, mimeType: 'text/plain', text: 'Resource not found' }] }
          }
          return result
        },
        completions: this.buildTemplateCompletions(template.uriTemplate),
      })
    }

    // Register prompts
    for (const prompt of prompts) {
      this.protocol.registerPrompt({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
        handler: async (args) => {
          const result = getPromptResult(prompt.name, args)
          if (!result) {
            return {
              messages: [{ role: 'user', content: { type: 'text', text: `Prompt not found: ${prompt.name}` } }],
            }
          }
          return result
        },
      })
    }
  }

  private buildTemplateCompletions(uriTemplate: string): Record<string, (prefix: string) => string[]> | undefined {
    // Provide completions for known template parameters
    if (uriTemplate.includes('{name}')) {
      if (uriTemplate.includes('interceptor')) {
        return {
          name: (prefix) => interceptors
            .map((i) => i.name)
            .filter((n) => n.toLowerCase().includes(prefix.toLowerCase())),
        }
      }
      if (uriTemplate.includes('adapter')) {
        return {
          name: (prefix) => adapters
            .map((a) => a.name)
            .filter((n) => n.toLowerCase().includes(prefix.toLowerCase())),
        }
      }
      if (uriTemplate.includes('pattern')) {
        return {
          name: () => ['rest-crud', 'event-driven', 'streaming', 'pub-sub'],
        }
      }
    }
    if (uriTemplate.includes('{code}')) {
      return {
        code: (prefix) => errors
          .map((e) => e.code)
          .filter((c) => c.includes(prefix.toUpperCase())),
      }
    }
    if (uriTemplate.includes('{topic}')) {
      return {
        topic: (prefix) => getGuideCatalog()
          .map((g) => g.topic)
          .filter((t) => t.includes(prefix.toLowerCase())),
      }
    }
    return undefined
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
    const transportType = this.options.transport || 'stdio'
    let transport: McpTransport

    switch (transportType) {
      case 'stdio':
        transport = createStdioTransport()
        break
      case 'http': {
        const { transport: httpTransport, middleware } = createStreamableHttpTransport({
          path: '/mcp',
        })
        transport = httpTransport

        // For HTTP, also create a standalone HTTP server
        const { createServer: createHttpServer } = await import('http')
        const port = this.options.port || 3200
        const httpServer = createHttpServer(async (req, res) => {
          const handled = await middleware(req, res)
          if (!handled) {
            if (req.method === 'GET' && req.url === '/health') {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ status: 'ok', version: MCP_VERSION }))
              return
            }
            res.writeHead(404)
            res.end('Not found')
          }
        })
        await new Promise<void>((resolve) => httpServer.listen(port, () => resolve()))
        this.log(`HTTP server listening on port ${port}`)
        console.error(`Raffel MCP server running on http://localhost:${port}`)
        break
      }
      case 'sse': {
        const port = this.options.port || 3200
        transport = createSseTransport({ port })
        this.log(`SSE server listening on port ${port}`)
        console.error(`Raffel MCP server running on http://localhost:${port}`)
        console.error(`SSE endpoint: http://localhost:${port}/sse`)
        break
      }
      default:
        throw new Error(`Unknown transport: ${transportType}`)
    }

    await transport.start((request) => this.protocol.handleRequest(request))
  }

  /**
   * Handle a raw JSON-RPC request (for testing and programmatic use).
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    return this.protocol.handleRequest(request)
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
