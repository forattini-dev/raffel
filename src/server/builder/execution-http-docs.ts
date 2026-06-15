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
  const {
    registry,
    schemaRegistry,
    getAuthzSnapshot,
    getApiDocumentationRevision,
    markApiDocumentationMounted,
    getDocsState,
    graphqlResources,
  } = context.core
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
    const authzSnapshot = getAuthzSnapshot?.() ?? undefined
    state.usdDocsHandlers.value = createUSDHandlers(
      {
        registry,
        schemaRegistry,
        channels: channelRegistry,
        restResources: restResourceRegistry,
        graphqlResources,
        tcpHandlers,
        udpHandlers,
        protocolConfig: runtimePlan.protocols,
        getApiDocumentationRevision,
        getDocsState,
        ...(authzSnapshot ? { authz: authzSnapshot } : {}),
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
        docsDir: docsConfig.docsDir,
        includeErrorSchemas: docsConfig.includeErrorSchemas,
        includeStreamEventSchemas: docsConfig.includeStreamEventSchemas,
        jsonrpc: docsConfig.jsonrpc,
        graphql: docsConfig.graphql,
        grpc: docsConfig.grpc,
      }
    )
    markApiDocumentationMounted?.()

    httpMiddleware.push(createDocsRouteMiddleware([
      { method: 'GET', path: docsBasePath, handler: state.usdDocsHandlers.value.serveUI },
      { method: 'GET', path: `${docsBasePath}/usd.json`, handler: state.usdDocsHandlers.value.serveUSD },
      { method: 'GET', path: `${docsBasePath}/usd.yaml`, handler: state.usdDocsHandlers.value.serveUSDYaml },
      { method: 'GET', path: `${docsBasePath}/openapi.json`, handler: state.usdDocsHandlers.value.serveOpenAPI },
      { method: 'GET', path: `${docsBasePath}/state.json`, handler: state.usdDocsHandlers.value.serveDocsState },
      { method: 'GET', path: `${docsBasePath}/-/raffel-docs.js`, handler: state.usdDocsHandlers.value.serveUIRuntime },
      { method: 'GET', path: `${docsBasePath}/-/marked.umd.js`, handler: state.usdDocsHandlers.value.serveUIMarkdownEngine },
      { method: 'GET', path: `${docsBasePath}/-/prism.js`, handler: state.usdDocsHandlers.value.serveUISyntaxHighlighter },
      { method: 'GET', path: `${docsBasePath}/-/marked-renderer.js`, handler: state.usdDocsHandlers.value.serveUIMarkdownRenderer },
      { method: 'GET', path: `${docsBasePath}/-/protocol-console.js`, handler: state.usdDocsHandlers.value.serveUIProtocolConsole },
      { method: 'GET', path: `${docsBasePath}/-/sidebar-tree.js`, handler: state.usdDocsHandlers.value.serveUISidebarTree },
      { method: 'GET', path: `${docsBasePath}/-/code-block-toolbar.js`, handler: state.usdDocsHandlers.value.serveUICodeBlockToolbar },
      { method: 'GET', path: `${docsBasePath}/-/page-nav.js`, handler: state.usdDocsHandlers.value.serveUIPageNav },
      { method: 'GET', path: `${docsBasePath}/-/search-modal.js`, handler: state.usdDocsHandlers.value.serveUISearchModal },
      { method: 'GET', path: `${docsBasePath}/-/raffel-docs.css`, handler: state.usdDocsHandlers.value.serveUIStyles },
      { method: 'GET', path: `${docsBasePath}/-/assets`, prefix: true, handler: state.usdDocsHandlers.value.serveDocsAsset },
    ]))
    logger.info({ basePath: docsBasePath }, 'USD Documentation middleware registered')
  }

  return {
    executeHttpDocsStep,
  }
}
