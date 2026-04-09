import type { HttpMiddleware } from '../../adapters/http.js'
import { createUSDHandlers } from '../../docs/index.js'
import { createDocsRouteMiddleware } from '../rest-middleware.js'
import type {
  ServerRuntimeHttpMiddlewareStep,
  ServerRuntimePlan,
} from '../runtime-plan.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

type DocsHttpMiddlewareStep = Extract<
  ServerRuntimeHttpMiddlewareStep,
  { kind: 'docs' }
>

export function createExecutionHttpDocs(context: ServerLifecycleExecutionContext) {
  const { logger, state } = context
  const { registry, schemaRegistry } = context.core
  const {
    channelRegistry,
    restResourceRegistry,
    tcpHandlers,
    udpHandlers,
  } = context.http

  function executeHttpDocsStep(
    runtimePlan: ServerRuntimePlan,
    step: DocsHttpMiddlewareStep,
    httpMiddleware: HttpMiddleware[]
  ) {
    const { basePath: docsBasePath, config: docsConfig } = step.feature
    state.usdDocsHandlers.value = createUSDHandlers(
      {
        registry,
        schemaRegistry,
        channels: channelRegistry,
        restResources: restResourceRegistry,
        tcpHandlers,
        udpHandlers,
        protocolConfig: runtimePlan.protocols,
      },
      {
        basePath: docsBasePath,
        info: docsConfig.info,
        servers: docsConfig.servers,
        protocols: docsConfig.protocols,
        contentTypes: docsConfig.contentTypes,
        securitySchemes: docsConfig.securitySchemes,
        defaultSecurity: docsConfig.defaultSecurity,
        tags: docsConfig.tags,
        tagGroups: docsConfig.tagGroups,
        externalDocs: docsConfig.externalDocs,
        ui: docsConfig.ui,
        documentation: docsConfig.documentation,
        includeErrorSchemas: docsConfig.includeErrorSchemas,
        includeStreamEventSchemas: docsConfig.includeStreamEventSchemas,
        jsonrpc: docsConfig.jsonrpc,
        grpc: docsConfig.grpc,
      }
    )

    httpMiddleware.push(createDocsRouteMiddleware([
      { method: 'GET', path: docsBasePath, handler: state.usdDocsHandlers.value.serveUI },
      { method: 'GET', path: `${docsBasePath}/usd.json`, handler: state.usdDocsHandlers.value.serveUSD },
      { method: 'GET', path: `${docsBasePath}/usd.yaml`, handler: state.usdDocsHandlers.value.serveUSDYaml },
      { method: 'GET', path: `${docsBasePath}/openapi.json`, handler: state.usdDocsHandlers.value.serveOpenAPI },
    ]))
    logger.info({ basePath: docsBasePath }, 'USD Documentation middleware registered')
  }

  return {
    executeHttpDocsStep,
  }
}
