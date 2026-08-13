import type { HttpMiddleware } from '../../adapters/http.js'
import type { StopTask } from '../telemetry-bootstrap.js'
import type {
  ServerRuntimeHttpMiddlewareStep,
  ServerRuntimePlan,
} from '../runtime-plan.js'
import { setProtocolAddress } from './execution-addresses.js'
import { startManagedRuntimeResource } from './execution-runtime-resource.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

type McpHttpMiddlewareStep = Extract<
  ServerRuntimeHttpMiddlewareStep,
  { kind: 'mcp' }
>

export function createExecutionHttpMcp(context: ServerLifecycleExecutionContext) {
  const { logger, state } = context
  const { registry, schemaRegistry, router } = context.core

  async function executeHttpMcpStep(
    runtimePlan: ServerRuntimePlan,
    step: McpHttpMiddlewareStep,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (task: StopTask) => void
  ) {
    const { options: opts, path: mcpPath } = step.feature
    const loopback = runtimePlan.effectiveHost === '127.0.0.1' || runtimePlan.effectiveHost === 'localhost' || runtimePlan.effectiveHost === '::1'
    if (!loopback && !opts.auth && !opts.dangerouslyAllowUnauthenticatedNetwork) {
      throw new Error(
        'Externally bound MCP requires auth; set dangerouslyAllowUnauthenticatedNetwork only after an explicit risk review'
      )
    }

    const { createProtocolHandler } = await import('../../protocols/mcp/protocol.js')
    const { bridgeRegistry } = await import('../../protocols/mcp/registry-bridge.js')
    const { createStreamableHttpTransport } = await import('../../protocols/mcp/transport/streamable-http.js')

    const { transport: mcpTransport, middleware: mcpMiddleware } = createStreamableHttpTransport({
      path: mcpPath,
      auth: opts.auth,
      cors: opts.cors,
      maxBodySize: opts.maxBodySize,
      maxSessions: opts.maxSessions,
      maxStreamsPerSession: opts.maxStreamsPerSession,
    })

    const protocol = createProtocolHandler({
      name: opts.name ?? 'raffel',
      version: opts.version ?? '1.0.0',
      instructions: opts.instructions,
      sendNotification: async (method, params) => {
        await mcpTransport.send({ jsonrpc: '2.0', method, params })
      },
    })

    bridgeRegistry(protocol, registry, schemaRegistry, {
      router,
      filter: opts.filter,
      toolName: opts.toolName,
    })

    for (const tool of opts.tools ?? []) protocol.registerTool(tool)
    for (const resource of opts.resources ?? []) protocol.registerResource(resource)
    for (const rt of opts.resourceTemplates ?? []) protocol.registerResourceTemplate(rt)
    for (const prompt of opts.prompts ?? []) protocol.registerPrompt(prompt)

    await startManagedRuntimeResource({
      resource: mcpTransport,
      name: 'mcp',
      registerStopTask,
      start: (resource) => resource.start((request, extra) => protocol.handleRequest(request, extra)),
      stop: (resource) => resource.stop(),
    })
    httpMiddleware.push(mcpMiddleware)

    setProtocolAddress(state.addresses, 'mcp', {
      host: runtimePlan.effectiveHost,
      port: runtimePlan.effectivePort,
      path: mcpPath,
    })

    logger.info({ path: mcpPath, tools: protocol.listTools().length }, 'MCP protocol adapter started')
  }

  return {
    executeHttpMcpStep,
  }
}
