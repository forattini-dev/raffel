import type { HttpMiddleware } from '../../adapters/http.js'
import { createUSDHandlers } from '../../docs/index.js'
import { createDocsRouteMiddleware } from '../rest-middleware.js'
import type {
  ServerRuntimeHttpMiddlewareStep,
  ServerRuntimePlan,
} from '../runtime-plan.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'
import type { IncomingMessage } from 'node:http'
import { getAuthMiddlewareDocumentation } from '../../middleware/auth.js'

type DocsHttpMiddlewareStep = Extract<
  ServerRuntimeHttpMiddlewareStep,
  { kind: 'docs' }
>

async function readDocsProxyPayload(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 1_048_576) return null
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null }
}

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
    globalInterceptors,
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
    const registeredInterceptors = registry.listProcedures().flatMap(meta => registry.getProcedure(meta.name)?.interceptors ?? [])
    const documentedAuth = (interceptors: typeof globalInterceptors) => [...new Set(
      interceptors.map(getAuthMiddlewareDocumentation)
        .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    )]
    const globalAuth = documentedAuth(globalInterceptors)
    const inferredAuth = [...new Set([...globalAuth, ...documentedAuth(registeredInterceptors)])]
    const inferredSecuritySchemes = Object.assign({}, ...inferredAuth.map(value => value.securitySchemes))
    const inferredSecurity = globalAuth.flatMap(value => value.security)
    const authSecurity = Object.keys(inferredSecuritySchemes).map(name => ({ [name]: [] }))
    const authPublicProcedures = globalAuth.flatMap(value => value.publicProcedures)
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
        securitySchemes: Object.keys(inferredSecuritySchemes).length > 0 || docsConfig.securitySchemes
          ? { ...inferredSecuritySchemes, ...docsConfig.securitySchemes }
          : undefined,
        defaultSecurity: docsConfig.defaultSecurity ?? (inferredSecurity.length > 0 ? inferredSecurity : undefined),
        authSecurity: authSecurity.length > 0 ? authSecurity : undefined,
        authPublicProcedures,
        authentication: docsConfig.authentication,
        webhooks: docsConfig.webhooks,
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
      {
        method: 'GET',
        path: `${docsBasePath}/usd.:extension`,
        handler: (_pathname, params) => state.usdDocsHandlers.value!.serveUSDFormat(params.extension ?? ''),
      },
      {
        method: 'GET',
        path: `${docsBasePath}/openapi.:extension`,
        handler: (_pathname, params) => state.usdDocsHandlers.value!.serveOpenAPIFormat(params.extension ?? ''),
      },
      { method: 'GET', path: `${docsBasePath}/state.json`, handler: state.usdDocsHandlers.value.serveDocsState },
      {
        method: 'POST',
        path: `${docsBasePath}/-/request`,
        handler: async (_pathname, _params, req) => state.usdDocsHandlers.value!.serveTryItProxy(await readDocsProxyPayload(req)),
      },
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
      { method: 'GET', path: `${docsBasePath}/favicon.ico`, handler: state.usdDocsHandlers.value.serveFavicon },
      { method: 'GET', path: `${docsBasePath}/-/assets`, prefix: true, handler: state.usdDocsHandlers.value.serveDocsAsset },
    ]))
    logger.info({ basePath: docsBasePath }, 'USD Documentation middleware registered')
  }

  return {
    executeHttpDocsStep,
  }
}
