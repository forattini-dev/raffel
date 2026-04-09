/**
 * Standalone MCP Server
 *
 * Declarative API for building MCP servers without the full Raffel runtime.
 *
 * @example
 * ```typescript
 * import { createMcpServer, mcpText, mcpJson } from 'raffel/protocols/mcp'
 * import { z } from 'zod'
 *
 * const server = createMcpServer({ name: 'my-tools', version: '1.0.0' })
 *   .tool({
 *     name: 'greet',
 *     description: 'Greet someone',
 *     input: z.object({ name: z.string() }),
 *     handler: async ({ name }) => mcpText(`Hello, ${name}!`),
 *   })
 *   .resource({
 *     uri: 'config://app',
 *     name: 'App Config',
 *     handler: async () => ({
 *       contents: [{ uri: 'config://app', mimeType: 'application/json', text: '{}' }],
 *     }),
 *   })
 *
 * await server.startStdio()
 * ```
 */

import type {
  McpServerOptions,
  McpToolRegistration,
  McpResourceRegistration,
  McpResourceTemplateRegistration,
  McpPromptRegistration,
  McpInterceptor,
} from './types.js'
import { createProtocolHandler, type McpProtocolHandler } from './protocol.js'
import type { McpTransport } from './transport/types.js'

export interface McpServer {
  /** Register a tool */
  tool<T>(registration: McpToolRegistration<T>): McpServer

  /** Register a static resource */
  resource(registration: McpResourceRegistration): McpServer

  /** Register a resource template (dynamic URIs) */
  resourceTemplate(registration: McpResourceTemplateRegistration): McpServer

  /** Register a prompt */
  prompt<T extends Record<string, string>>(registration: McpPromptRegistration<T>): McpServer

  /** Add an interceptor that runs before every handler */
  use(interceptor: McpInterceptor): McpServer

  /** Start with stdio transport (for Claude Code, Cursor, etc.) */
  startStdio(): Promise<void>

  /** Start with Streamable HTTP transport */
  startHttp(options: { port: number; host?: string; path?: string }): Promise<void>

  /** Start with SSE transport (legacy) */
  startSse(options: { port: number; host?: string }): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Get the underlying protocol handler (for embedding) */
  getProtocolHandler(): McpProtocolHandler
}

export function createMcpServer(options: McpServerOptions): McpServer {
  let transport: McpTransport | null = null

  const protocol = createProtocolHandler({
    ...options,
    sendNotification: async (method, params) => {
      if (transport) {
        await transport.send({ jsonrpc: '2.0', method, params })
      }
    },
  })

  const server: McpServer = {
    tool<T>(registration: McpToolRegistration<T>): McpServer {
      protocol.registerTool(registration)
      return server
    },

    resource(registration: McpResourceRegistration): McpServer {
      protocol.registerResource(registration)
      return server
    },

    resourceTemplate(registration: McpResourceTemplateRegistration): McpServer {
      protocol.registerResourceTemplate(registration)
      return server
    },

    prompt<T extends Record<string, string>>(registration: McpPromptRegistration<T>): McpServer {
      protocol.registerPrompt(registration)
      return server
    },

    use(interceptor: McpInterceptor): McpServer {
      protocol.use(interceptor)
      return server
    },

    async startStdio(): Promise<void> {
      const { createStdioTransport } = await import('./transport/stdio.js')
      transport = createStdioTransport()
      await transport.start((request) => protocol.handleRequest(request))
    },

    async startHttp(opts: { port: number; host?: string; path?: string }): Promise<void> {
      const { createServer: createHttpServer } = await import('http')
      const { createStreamableHttpTransport } = await import('./transport/streamable-http.js')

      const { transport: httpTransport, middleware } = createStreamableHttpTransport({
        path: opts.path ?? '/mcp',
        auth: options.auth,
      })

      transport = httpTransport
      await transport.start((request, extra) => protocol.handleRequest(request, extra))

      // Create a standalone HTTP server that delegates to the middleware
      const httpServer = createHttpServer(async (req, res) => {
        const handled = await middleware(req, res)
        if (!handled) {
          // Health endpoint
          if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              status: 'ok',
              name: options.name,
              version: options.version,
              tools: protocol.listTools().length,
            }))
            return
          }

          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      })

      await new Promise<void>((resolve) => {
        httpServer.listen(opts.port, opts.host ?? '0.0.0.0', resolve)
      })

      // Store reference for stop()
      const originalStop = transport.stop.bind(transport)
      transport.stop = async () => {
        await originalStop()
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()))
        })
      }

      console.error(`MCP server running on http://${opts.host ?? '0.0.0.0'}:${opts.port}${opts.path ?? '/mcp'}`)
    },

    async startSse(opts: { port: number; host?: string }): Promise<void> {
      const { createSseTransport } = await import('./transport/sse.js')
      transport = createSseTransport(opts)
      await transport.start((request) => protocol.handleRequest(request))
      console.error(`MCP SSE server running on http://${opts.host ?? '0.0.0.0'}:${opts.port}/sse`)
    },

    async stop(): Promise<void> {
      if (transport) {
        await transport.stop()
        transport = null
      }
    },

    getProtocolHandler(): McpProtocolHandler {
      return protocol
    },
  }

  return server
}
