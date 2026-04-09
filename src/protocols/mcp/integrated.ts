/**
 * MCP Integrated Adapter
 *
 * ProtocolAdapterFactory that wires MCP into an existing Raffel server.
 * Procedures become MCP tools automatically via the registry bridge.
 * Streamable HTTP transport is mounted as middleware on the existing HTTP server.
 */

import type { ProtocolAdapterContext, ProtocolAdapter, ProtocolAdapterFactory } from '../../server/types.js'
import type { McpAdapterOptions } from './types.js'
import { createProtocolHandler } from './protocol.js'
import { bridgeRegistry } from './registry-bridge.js'
import { createStreamableHttpTransport } from './transport/streamable-http.js'

/**
 * Create an MCP protocol adapter factory for use with Raffel's
 * protocolExtensions system.
 *
 * Usage in createServer():
 * ```typescript
 * const server = createServer({
 *   port: 3000,
 *   mcp: true,  // or { path: '/mcp', name: 'my-api', ... }
 * })
 * ```
 */
export function createMcpAdapterFactory(): ProtocolAdapterFactory<McpAdapterOptions> {
  return async (context: ProtocolAdapterContext, options: McpAdapterOptions = {}): Promise<ProtocolAdapter> => {
    const { registry, schemaRegistry, router, host, port } = context
    const mcpPath = options.path ?? '/mcp'

    // Create transport first so we can capture its send() for notifications
    const { transport, middleware } = createStreamableHttpTransport({
      path: mcpPath,
      auth: options.auth,
    })

    // Create protocol handler with notification support wired to the transport
    const protocol = createProtocolHandler({
      name: options.name ?? 'raffel',
      version: options.version ?? '1.0.0',
      instructions: options.instructions,
      sendNotification: async (method, params) => {
        await transport.send({ jsonrpc: '2.0', method, params })
      },
    })

    // Bridge: auto-discover procedures → MCP tools
    bridgeRegistry(protocol, registry, schemaRegistry, {
      router,
      filter: options.filter,
      toolName: options.toolName,
    })

    // Register extra manually-defined tools/resources/prompts
    for (const tool of options.tools ?? []) protocol.registerTool(tool)
    for (const resource of options.resources ?? []) protocol.registerResource(resource)
    for (const rt of options.resourceTemplates ?? []) protocol.registerResourceTemplate(rt)
    for (const prompt of options.prompts ?? []) protocol.registerPrompt(prompt)

    // Start transport with the protocol handler
    await transport.start((request, extra) => protocol.handleRequest(request, extra))

    return {
      async start(): Promise<void> {
        // Transport already started above
      },

      async stop(): Promise<void> {
        await transport.stop()
      },

      address: {
        host,
        port,
        path: mcpPath,
      },

      /**
       * HTTP middleware — lifecycle wiring picks this up and adds
       * it to the HTTP adapter's middleware list.
       */
      get middleware() {
        return middleware
      },
    } as ProtocolAdapter & { middleware: typeof middleware }
  }
}
