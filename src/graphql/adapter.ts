/**
 * GraphQL Adapter
 *
 * HTTP server for GraphQL queries, mutations, and subscriptions.
 * Integrates with Raffel router via envelope-based dispatching.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import {
  graphql,
  execute,
  getOperationAST,
  parse,
  validate,
  subscribe,
  GraphQLError,
  Kind,
  type GraphQLSchema,
  type ExecutionResult,
  type DocumentNode,
  type FragmentDefinitionNode,
  type FieldNode,
  type SelectionSetNode,
} from 'graphql'
import type { Router } from '../core/router.js'
import type { Registry } from '../core/registry.js'
import type { SchemaRegistry } from '../validation/index.js'
import type { Context, Envelope } from '../types/index.js'
import { createContext } from '../types/context.js'
import type {
  GraphQLAdapter,
  GraphQLAdapterOptions,
  GraphQLOptions,
  GeneratedSchemaInfo,
  SubscriptionOptions,
} from './types.js'
import { generateGraphQLSchema } from './schema-generator.js'
import {
  GRAPHQL_AUTHENTICATION_BRIDGE_KEY,
  GRAPHQL_EXECUTION_BRIDGE_KEY,
  GRAPHQL_POLICY_BRIDGE_KEY,
  type GraphQLExecutionBridge,
} from './resource.js'
import type { AuthenticationRuntime } from '../middleware/auth.js'
import {
  createGraphQLAuthenticationBridge,
  enforceCustomSchemaSecurity,
  GraphQLAdapterError,
  validateCustomSchemaSecurity,
} from './security.js'
import { createLogger } from '../utils/logger.js'
import { sid } from '../utils/id/index.js'
import {
  extractMetadataFromHeaders,
  extractMetadataFromRecord,
  mergeMetadata,
} from '../utils/header-metadata.js'
import { isAsyncIterable } from '../utils/type-guards.js'
import {
  jsonCodec,
  resolveCodecs,
  selectCodecForAccept,
  selectCodecForContentType,
  type Codec,
} from '../utils/content-codecs.js'
import type { ClosableHttpServer } from '../types/server.js'
import {
  InMemoryPersistedOperationStore,
  hashGraphQLDocument,
  type PersistedOperationStore,
} from './persisted-operations.js'

const logger = createLogger('graphql-adapter')
const CONNECTION_INIT_KEY = Symbol.for('raffel.connection_init')

export interface GraphQLMiddleware {
  middleware: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
  schema: GraphQLSchema
  schemaInfo: GeneratedSchemaInfo | null
  createSubscriptionServer: (server: Server) => WebSocketServer | null
}

export interface GraphQLMiddlewareOptions {
  router: Router
  registry: Registry
  schemaRegistry: SchemaRegistry
  config: GraphQLAdapterOptions['config']
  graphqlResources?: GraphQLAdapterOptions['graphqlResources']
  policyBridge?: GraphQLAdapterOptions['policyBridge']
  providers?: GraphQLAdapterOptions['providers']
  authenticationRuntime?: GraphQLAdapterOptions['authenticationRuntime']
}

// === GraphiQL HTML ===

function getGraphiQLHTML(endpoint: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Raffel GraphQL</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
</head>
<body style="margin: 0; overflow: hidden;">
  <div id="graphiql" style="height: 100vh;"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: '${endpoint}' });
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher })
    );
  </script>
</body>
</html>
`
}

// === Request Parsing ===

interface GraphQLRequest {
  query?: string
  operationName?: string
  variables?: Record<string, unknown>
  extensions?: Record<string, unknown>
}

async function parseGraphQLRequest(
  req: IncomingMessage,
  maxBodySize: number,
  codec: Codec
): Promise<GraphQLRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBodySize) {
        req.destroy()
        reject(new GraphQLAdapterError('PAYLOAD_TOO_LARGE', 413, 'Request body too large'))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        if (codec.name === 'text') {
          resolve({ query: body })
          return
        }

        const parsed = JSON.parse(body)
        resolve({
          query: parsed.query,
          operationName: parsed.operationName,
          variables: parsed.variables,
          extensions: parsed.extensions,
        })
      } catch (err) {
        reject(new GraphQLAdapterError('PARSE_ERROR', 400, 'Invalid request body'))
      }
    })
    req.on('error', reject)
  })
}

function parseGraphQLGetRequest(url: URL): GraphQLRequest {
  const parseObject = (name: string): Record<string, unknown> | undefined => {
    const value = url.searchParams.get(name)
    if (!value) return undefined
    try {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      return parsed as Record<string, unknown>
    } catch {
      throw new GraphQLAdapterError('PARSE_ERROR', 400, `Invalid ${name}`)
    }
  }
  return {
    query: url.searchParams.get('query') ?? undefined,
    operationName: url.searchParams.get('operationName') ?? undefined,
    variables: parseObject('variables'),
    extensions: parseObject('extensions'),
  }
}

interface PersistedQueryExtension {
  version: number
  sha256Hash: string
}

function getPersistedQueryExtension(request: GraphQLRequest): PersistedQueryExtension | undefined {
  const value = request.extensions?.persistedQuery
  if (!value || typeof value !== 'object') return undefined
  const extension = value as Partial<PersistedQueryExtension>
  if (extension.version !== 1 || typeof extension.sha256Hash !== 'string') {
    throw new GraphQLAdapterError('PERSISTED_QUERY_INVALID', 400, 'Invalid persisted query extension')
  }
  return { version: 1, sha256Hash: extension.sha256Hash }
}

async function resolvePersistedOperation(
  request: GraphQLRequest,
  mode: 'disabled' | 'allow' | 'require',
  store: PersistedOperationStore,
  schema: GraphQLSchema,
  ttlMs: number
): Promise<GraphQLRequest> {
  const persisted = getPersistedQueryExtension(request)
  if (mode === 'disabled') {
    if (!request.query) throw new GraphQLAdapterError('INVALID_ARGUMENT', 400, 'GraphQL query is required')
    return request
  }
  if (!persisted) {
    if (mode === 'require') throw new GraphQLAdapterError('PERSISTED_QUERY_REQUIRED', 400, 'Persisted query is required')
    if (!request.query) throw new GraphQLAdapterError('INVALID_ARGUMENT', 400, 'GraphQL query is required')
    return request
  }
  if (!request.query) {
    const query = await store.get(persisted.sha256Hash)
    if (!query) throw new GraphQLAdapterError('PERSISTED_QUERY_NOT_FOUND', 200, 'PersistedQueryNotFound')
    return { ...request, query }
  }
  if (hashGraphQLDocument(request.query) !== persisted.sha256Hash) {
    throw new GraphQLAdapterError('PERSISTED_QUERY_HASH_MISMATCH', 400, 'Persisted query hash does not match query')
  }
  if (mode === 'require' && !await store.get(persisted.sha256Hash)) {
    throw new GraphQLAdapterError('PERSISTED_QUERY_NOT_FOUND', 200, 'PersistedQueryNotFound')
  }
  let document: DocumentNode
  try { document = parse(request.query) } catch { throw new GraphQLAdapterError('GRAPHQL_PARSE_FAILED', 400, 'Invalid GraphQL document') }
  if (validate(schema, document).length > 0) throw new GraphQLAdapterError('GRAPHQL_VALIDATION_FAILED', 422, 'Invalid GraphQL document')
  if (mode === 'allow') await store.set(persisted.sha256Hash, request.query, ttlMs)
  return request
}

function requestHasBody(req: IncomingMessage): boolean {
  const lengthHeader = req.headers['content-length']
  if (typeof lengthHeader === 'string') {
    const length = Number.parseInt(lengthHeader, 10)
    if (Number.isFinite(length)) {
      return length > 0
    }
  }

  const transferEncoding = req.headers['transfer-encoding']
  if (typeof transferEncoding === 'string' && transferEncoding.toLowerCase() !== 'identity') {
    return true
  }

  return false
}

function createGraphQLError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } })
}

function createErrorResult(code: string, message: string): ExecutionResult {
  return {
    errors: [createGraphQLError(code, message)],
  }
}

function formatExecutionResult(
  result: ExecutionResult,
  config: GraphQLOptions,
  requestId: string
): ExecutionResult {
  if (!result.errors?.length) return result
  const mask = config.errorMasking ?? process.env.NODE_ENV === 'production'
  return {
    ...result,
    errors: result.errors.map((error) => {
      if (config.formatError) return config.formatError(error) as GraphQLError
      const safeCode = typeof error.extensions?.code === 'string' ? error.extensions.code : undefined
      if (mask && error.originalError && !safeCode) {
        return new GraphQLError('Internal server error', {
          path: error.path,
          extensions: { code: 'INTERNAL', requestId },
        })
      }
      return new GraphQLError(error.message, {
        path: error.path,
        extensions: { ...error.extensions, requestId },
      })
    }),
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new GraphQLAdapterError('DEADLINE_EXCEEDED', 408, 'Request deadline exceeded'))
    }, timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

// === Router Integration ===

/**
 * Execute a procedure via the Router using envelope-based dispatching
 */
async function executeProcedure(
  router: Router,
  procedure: string,
  input: unknown,
  ctx: Context,
  metadata: Record<string, string>
): Promise<unknown> {
  const executionCtx: Context = {
    ...ctx,
    input: {
      ...ctx.input,
      body: input,
      metadata,
    },
    extensions: new Map(ctx.extensions),
  }
  const envelope: Envelope = {
    id: sid(),
    procedure,
    type: 'request',
    payload: input,
    metadata,
    context: executionCtx,
  }

  const result = await router.handle(envelope)

  if ('type' in result && result.type === 'error') {
    const errorPayload = result.payload as { code: string; message: string }
    throw createGraphQLError(errorPayload.code, errorPayload.message)
  }

  if ('type' in result && result.type === 'response') {
    return result.payload
  }

  return result
}

/**
 * Emit an event via the Router
 */
async function emitEvent(
  router: Router,
  event: string,
  input: unknown,
  ctx: Context,
  metadata: Record<string, string>
): Promise<boolean> {
  const executionCtx: Context = {
    ...ctx,
    input: {
      ...ctx.input,
      body: input,
      metadata,
    },
    extensions: new Map(ctx.extensions),
  }
  const envelope: Envelope = {
    id: sid(),
    procedure: event,
    type: 'event',
    payload: input,
    metadata,
    context: executionCtx,
  }

  const result = await router.handle(envelope)

  if ('type' in result && result.type === 'error') {
    const errorPayload = result.payload as { code: string; message: string }
    throw createGraphQLError(errorPayload.code, errorPayload.message)
  }
  return true
}

/**
 * Execute a stream via the Router
 */
async function* executeStream(
  router: Router,
  stream: string,
  input: unknown,
  ctx: Context,
  metadata: Record<string, string>
): AsyncIterable<unknown> {
  const executionCtx: Context = {
    ...ctx,
    input: {
      ...ctx.input,
      body: input,
      metadata,
    },
    stream: {
      kind: 'stream',
      mode: 'graphql-subscription',
      id: ctx.requestId,
    },
    extensions: new Map(ctx.extensions),
  }
  const envelope: Envelope = {
    id: sid(),
    procedure: stream,
    type: 'stream:start',
    payload: input,
    metadata,
    context: executionCtx,
  }

  const result = await router.handle(envelope)

  // If result is async iterable (stream)
  if (isAsyncIterable(result)) {
    for await (const item of result as AsyncIterable<Envelope>) {
      if (item.type === 'stream:data') {
        yield item.payload
      } else if (item.type === 'stream:error') {
        const errorPayload = item.payload as { code?: string; message: string }
        throw createGraphQLError(errorPayload.code ?? 'STREAM_ERROR', errorPayload.message)
      }
      // Skip stream:start and stream:end markers
    }
  }
}

// === Root Value Factory ===

function createRootValue(
  router: Router,
  registry: Registry,
  schemaInfo: GeneratedSchemaInfo,
  ctx: Context,
  metadata: Record<string, string>
) {
  const root: Record<string, unknown> = {}

  // Map queries
  for (const [graphqlField, queryName] of Object.entries(schemaInfo.fields.queries)) {
    if (queryName === '_health') {
      root[graphqlField] = () => true
      continue
    }
    root[graphqlField] = (args: Record<string, unknown>) =>
      executeProcedure(router, queryName, args, ctx, metadata)
  }

  // Map mutations
  for (const [graphqlField, mutationName] of Object.entries(schemaInfo.fields.mutations)) {
    // Check if it's a procedure or event
    const procedure = registry.getProcedure(mutationName)
    if (procedure) {
      root[graphqlField] = (args: Record<string, unknown>) =>
        executeProcedure(router, mutationName, args, ctx, metadata)
    } else {
      // It's an event
      root[graphqlField] = (args: Record<string, unknown>) =>
        emitEvent(router, mutationName, args, ctx, metadata)
    }
  }

  // Map subscriptions (return async iterators)
  for (const [graphqlField, subscriptionName] of Object.entries(schemaInfo.fields.subscriptions)) {
    root[graphqlField] = (args: Record<string, unknown>) =>
      executeStream(router, subscriptionName, args, ctx, metadata)
  }

  return root
}

function attachGraphQLRuntimeContext(
  ctx: Context,
  router: Router,
  metadata: Record<string, string>,
  providers: Readonly<Record<string, unknown>> | undefined,
  policyBridge: GraphQLAdapterOptions['policyBridge'] | undefined,
  authenticationRuntime: AuthenticationRuntime | undefined,
  securityMode: 'router' | 'inherit',
): void {
  if (providers) {
    ctx.services = Object.freeze({ ...ctx.services, ...providers })
  }
  if (policyBridge) ctx.extensions.set(GRAPHQL_POLICY_BRIDGE_KEY, policyBridge)
  const authenticationBridge = createGraphQLAuthenticationBridge(
    authenticationRuntime,
    securityMode,
    metadata,
  )
  ctx.extensions.set(GRAPHQL_AUTHENTICATION_BRIDGE_KEY, authenticationBridge)
  const bridge: GraphQLExecutionBridge = {
    executeProcedure: (name, input, operationCtx) => executeProcedure(router, name, input, operationCtx, metadata),
    executeStream: (name, input, operationCtx) => executeStream(router, name, input, operationCtx, metadata),
  }
  ctx.extensions.set(GRAPHQL_EXECUTION_BRIDGE_KEY, bridge)
}

interface GraphQLHandlers {
  schema: GraphQLSchema
  schemaInfo: GeneratedSchemaInfo | null
  handleRequest: (req: IncomingMessage, res: ServerResponse, opts?: { skipPathCheck?: boolean }) => Promise<void>
  createSubscriptionServer: (server: Server) => WebSocketServer | null
}

interface CachedGraphQLDocument {
  document: DocumentNode
  validationErrors: readonly GraphQLError[]
}

function getCachedGraphQLDocument(
  schema: GraphQLSchema,
  query: string,
  cache: Map<string, CachedGraphQLDocument>
): CachedGraphQLDocument {
  const key = hashGraphQLDocument(query)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const document = parse(query)
  const entry = { document, validationErrors: validate(schema, document) }
  cache.set(key, entry)
  if (cache.size > 1000) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest) cache.delete(oldest)
  }
  return entry
}

function createGraphQLHandlers(
  router: Router,
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  config: GraphQLAdapterOptions['config'],
  graphqlResources: GraphQLAdapterOptions['graphqlResources'] = [],
  policyBridge?: GraphQLAdapterOptions['policyBridge'],
  providers?: GraphQLAdapterOptions['providers'],
  authenticationRuntime?: GraphQLAdapterOptions['authenticationRuntime'],
): GraphQLHandlers {
  let schema: GraphQLSchema
  let schemaInfo: GeneratedSchemaInfo | null = null

  // Generate or use provided schema
  if (config.schema) {
    const warning = validateCustomSchemaSecurity(config, authenticationRuntime, policyBridge)
    if (warning) logger.warn(warning)
    schema = config.schema
  } else if (config.generateSchema !== false) {
    const generated = generateGraphQLSchema({
      registry,
      schemaRegistry,
      graphqlResources,
      options: { ...config.schemaOptions, exposure: config.exposure ?? config.schemaOptions?.exposure },
      schemaValidation: config.schemaValidation,
      security: config.security,
      authenticationAvailable: Boolean(authenticationRuntime),
      policyDefaultMode: policyBridge?.defaultMode,
    })
    schema = generated.schema
    schemaInfo = generated
    if ((config.exposure ?? config.schemaOptions?.exposure ?? 'all') === 'all' && process.env.NODE_ENV === 'production') {
      logger.warn('GraphQL exposure defaults to all registered handlers in Raffel 1.x; prefer exposure: explicit')
    }
  } else {
    throw new Error('GraphQL adapter requires either a schema or generateSchema: true')
  }

  const codecs = resolveCodecs(config.codecs)
  const documentCache = new Map<string, CachedGraphQLDocument>()
  const persistedOptions = typeof config.persistedOperations === 'object'
    ? config.persistedOperations
    : {}
  const persistedMode = config.persistedOperations === true
    ? 'allow'
    : config.persistedOperations === false || config.persistedOperations === undefined
      ? 'disabled'
      : persistedOptions.mode ?? 'allow'
  const persistedStore = persistedOptions.store ?? new InMemoryPersistedOperationStore(
    persistedOptions.maxEntries,
    persistedOptions.ttlMs
  )
  const persistedTtlMs = persistedOptions.ttlMs ?? 60 * 60 * 1000

  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    opts?: { skipPathCheck?: boolean }
  ) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // CORS preflight
    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res, config.cors)
      res.writeHead(204)
      res.end()
      return
    }

    // Only handle configured path
    if (!opts?.skipPathCheck && url.pathname !== config.path) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    setCorsHeaders(req, res, config.cors)

    // Serve GraphiQL for GET requests
    if (req.method === 'GET' && config.playground) {
      const accept = req.headers.accept || ''
      if (accept.includes('text/html')) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(getGraphiQLHTML(config.path))
        return
      }
    }

    const acceptHeader = typeof req.headers.accept === 'string' ? req.headers.accept : undefined
    const responseCodec = selectCodecForAccept(acceptHeader, codecs, jsonCodec)
    if (!responseCodec) {
      res.writeHead(406, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createErrorResult('NOT_ACCEPTABLE', 'Not acceptable')))
      return
    }
    const responseContentType = acceptHeader?.includes('application/graphql-response+json')
      ? 'application/graphql-response+json; charset=utf-8'
      : responseCodec.contentTypes[0] ?? 'application/json'

    // Handle GraphQL POST and idempotent GET queries
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const timeoutMs = config.timeout ?? 0
    const maxBodySize = config.maxBodySize ?? 1024 * 1024
    const abortController = new AbortController()
    const abortRequest = () => abortController.abort(new Error('GraphQL client disconnected'))
    req.once('aborted', abortRequest)
    res.once('close', () => {
      if (!res.writableEnded) abortRequest()
    })

    try {
      const result = await withTimeout((async () => {
        let gqlRequest: GraphQLRequest
        if (req.method === 'GET') {
          gqlRequest = parseGraphQLGetRequest(url)
        } else {
          const contentType = typeof req.headers['content-type'] === 'string'
            ? req.headers['content-type']
            : undefined
          let requestCodec = jsonCodec
          if (contentType) {
            const selected = selectCodecForContentType(contentType, codecs)
            if (!selected || selected.name === 'csv') {
              throw new GraphQLAdapterError('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported media type')
            }
            requestCodec = selected
          } else if (requestHasBody(req)) {
            throw new GraphQLAdapterError('UNSUPPORTED_MEDIA_TYPE', 415, 'Unsupported media type')
          }
          gqlRequest = await parseGraphQLRequest(req, maxBodySize, requestCodec)
        }
        gqlRequest = await resolvePersistedOperation(
          gqlRequest,
          persistedMode,
          persistedStore,
          schema,
          persistedTtlMs
        )

        const metadata = extractMetadataFromHeaders(req.headers)

        // Create context
        const ctx = createContext(sid(), {
          signal: abortController.signal,
          protocol: 'graphql',
          input: {
            body: gqlRequest.variables ?? {},
            metadata,
          },
          graphql: {
            kind: 'graphql',
            operationName: gqlRequest.operationName,
          },
        })
        attachGraphQLRuntimeContext(
          ctx,
          router,
          metadata,
          providers,
          policyBridge,
          authenticationRuntime,
          config.security?.mode ?? 'router',
        )
        if (timeoutMs > 0) {
          ctx.deadline = Date.now() + timeoutMs
        }

        // Add custom context if provided
        if (config.context) {
          const customCtx = await config.context({
            method: req.method || 'POST',
            url: req.url || '/',
            headers: req.headers as Record<string, string | string[] | undefined>,
          })
          // Merge custom context into extensions
          if (customCtx) {
            for (const [key, value] of Object.entries(customCtx)) {
              ctx.extensions.set(Symbol.for(key), value)
            }
          }
        }

        // Execute GraphQL
        const executionResult = await executeGraphQL(
          schema,
          gqlRequest,
          router,
          registry,
          schemaInfo,
          ctx,
          metadata,
          config.introspection !== false,
          config,
          req.method ?? 'POST',
          documentCache,
        )
        return formatExecutionResult(executionResult, config, ctx.requestId)
      })(), timeoutMs, () => abortController.abort(new Error('GraphQL request deadline exceeded')))

      res.writeHead(200, { 'Content-Type': responseContentType })
      res.end(responseCodec.encode(result))
    } catch (err) {
      if (err instanceof GraphQLAdapterError) {
        res.writeHead(err.status, { 'Content-Type': responseContentType })
        res.end(responseCodec.encode(createErrorResult(err.code, err.message)))
        return
      }

      logger.error({ err }, 'GraphQL execution error')
      res.writeHead(500, { 'Content-Type': responseContentType })
      res.end(responseCodec.encode({
        errors: [{ message: 'Internal server error' }],
      }))
    }
  }

  const createSubscriptionServer = (server: Server): WebSocketServer | null => {
    if (config.subscriptions === false || !schema.getSubscriptionType()) {
      return null
    }

    const subscriptionPath = typeof config.subscriptions === 'object'
      ? config.subscriptions.path ?? config.path
      : config.path
    const subscriptionOptions = typeof config.subscriptions === 'object'
      ? config.subscriptions
      : {}
    const wss = new WebSocketServer({
      server,
      path: subscriptionPath,
      maxPayload: subscriptionOptions.maxPayload ?? 1024 * 1024,
    })
    wss.on('connection', (ws, req) => {
      if (wss.clients.size > (subscriptionOptions.maxConnections ?? 1000)) {
        ws.close(1013, 'Too many connections')
        return
      }
      handleSubscriptionConnection(
        ws,
        req,
        schema,
        router,
        registry,
        schemaInfo,
        subscriptionOptions,
        config,
        policyBridge,
        providers,
        authenticationRuntime,
        documentCache,
        persistedMode,
        persistedStore,
        persistedTtlMs
      )
    })

    logger.debug({ path: subscriptionPath }, 'WebSocket subscriptions enabled')
    return wss
  }

  return { schema, schemaInfo, handleRequest, createSubscriptionServer }
}

// === Adapter Implementation ===

export function createGraphQLAdapter(options: GraphQLAdapterOptions): GraphQLAdapter {
  const {
    router,
    registry,
    schemaRegistry,
    config,
    host,
    port,
    graphqlResources,
    policyBridge,
    providers,
    authenticationRuntime,
  } = options

  let server: Server | null = null
  let wss: WebSocketServer | null = null
  let address: { host: string; port: number; path: string } | null = null

  const { schema, schemaInfo, handleRequest, createSubscriptionServer } = createGraphQLHandlers(
    router,
    registry,
    schemaRegistry,
    config,
    graphqlResources,
    policyBridge,
    providers,
    authenticationRuntime,
  )

  return {
    async start() {
      server = createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          logger.error({ err }, 'GraphQL request error')
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ errors: [{ message: 'Internal server error' }] }))
          }
        })
      })

      // Setup WebSocket for subscriptions if enabled
      wss = createSubscriptionServer(server) ?? null

      await new Promise<void>((resolve, reject) => {
        server!.on('error', reject)
        server!.listen(port, host, () => {
          address = { host, port, path: config.path }
          logger.info({ host, port, path: config.path }, 'GraphQL server started')
          resolve()
        })
      })
    },

    async stop() {
      if (wss) {
        for (const client of wss.clients) {
          client.close()
        }
        wss.close()
        wss = null
      }

      if (server) {
        const activeServer = server as ClosableHttpServer
        activeServer.closeIdleConnections?.()
        await new Promise<void>((resolve) => {
          activeServer.close(() => resolve())
        })
        activeServer.closeAllConnections?.()
        server = null
        address = null
        logger.info('GraphQL server stopped')
      }
    },

    get schema() {
      return schema
    },

    get schemaInfo() {
      return schemaInfo
    },

    get address() {
      return address
    },
  }
}

export function createGraphQLMiddleware(options: GraphQLMiddlewareOptions): GraphQLMiddleware {
  const {
    router,
    registry,
    schemaRegistry,
    config,
    graphqlResources,
    policyBridge,
    providers,
    authenticationRuntime,
  } = options
  const { schema, schemaInfo, handleRequest, createSubscriptionServer } = createGraphQLHandlers(
    router,
    registry,
    schemaRegistry,
    config,
    graphqlResources,
    policyBridge,
    providers,
    authenticationRuntime,
  )

  const middleware = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const urlPath = new URL(req.url || '/', `http://${req.headers.host}`).pathname
    if (urlPath !== config.path) {
      return false
    }

    try {
      await handleRequest(req, res, { skipPathCheck: true })
    } catch (err) {
      logger.error({ err }, 'GraphQL middleware error')
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ errors: [{ message: 'Internal server error' }] }))
      }
    }

    return true
  }

  return {
    middleware,
    schema,
    schemaInfo,
    createSubscriptionServer,
  }
}

// === GraphQL Execution ===

async function executeGraphQL(
  schema: GraphQLSchema,
  request: GraphQLRequest,
  router: Router,
  registry: Registry,
  schemaInfo: GeneratedSchemaInfo | null,
  ctx: Context,
  metadata: Record<string, string>,
  introspection: boolean,
  config: GraphQLOptions,
  method: string = 'POST',
  documentCache: Map<string, CachedGraphQLDocument> = new Map(),
): Promise<ExecutionResult> {
  const { query, operationName, variables } = request
  if (!query) return createErrorResult('INVALID_ARGUMENT', 'GraphQL query is required')

  // Parse document
  let document: DocumentNode
  let validationErrors: readonly GraphQLError[]
  try {
    const cached = getCachedGraphQLDocument(schema, query, documentCache)
    document = cached.document
    validationErrors = cached.validationErrors
  } catch (err) {
    return {
      errors: [{ message: `Syntax error: ${(err as Error).message}` } as any],
    }
  }

  const limitError = validateDocumentLimits(document, config, schema, operationName, variables)
  if (limitError) return { errors: [limitError] }

  const operation = getOperationAST(document, operationName)
  if (!operation) return createErrorResult('INVALID_ARGUMENT', 'Operation could not be determined')
  if (method === 'GET' && operation.operation !== 'query') {
    throw new GraphQLAdapterError('METHOD_NOT_ALLOWED', 405, 'GET may only execute GraphQL queries')
  }

  // Validate
  if (validationErrors.length > 0) {
    return { errors: [...validationErrors] }
  }

  // Check introspection
  if (!introspection) {
    const isIntrospection = query.includes('__schema') || query.includes('__type')
    if (isIntrospection) {
      return {
        errors: [{ message: 'Introspection is disabled' } as any],
      }
    }
  }

  if (!schemaInfo) {
    await enforceCustomSchemaSecurity(config, ctx, operation, variables)
  }

  // Create root value with resolvers
  const rootValue = schemaInfo
    ? createRootValue(router, registry, schemaInfo, ctx, metadata)
    : {}

  // Execute
  return ctx.tracing.trace(
    'raffel.graphql.operation',
    {
      'graphql.operation.type': operation.operation,
      'graphql.operation.name': operation.name?.value ?? 'anonymous',
    },
    () => execute({
      schema,
      document,
      rootValue,
      contextValue: ctx,
      variableValues: variables,
      operationName,
    })
  )
}

// === WebSocket Subscriptions ===

function handleSubscriptionConnection(
  ws: WebSocket,
  req: IncomingMessage,
  schema: GraphQLSchema,
  router: Router,
  registry: Registry,
  schemaInfo: GeneratedSchemaInfo | null,
  options: SubscriptionOptions,
  config: GraphQLOptions,
  policyBridge?: GraphQLAdapterOptions['policyBridge'],
  providers?: GraphQLAdapterOptions['providers'],
  authenticationRuntime?: GraphQLAdapterOptions['authenticationRuntime'],
  documentCache: Map<string, CachedGraphQLDocument> = new Map(),
  persistedMode: 'disabled' | 'allow' | 'require' = 'disabled',
  persistedStore: PersistedOperationStore = new InMemoryPersistedOperationStore(),
  persistedTtlMs = 60 * 60 * 1000
): void {
  const subscriptions = new Map<string, { iterator: AsyncIterator<unknown>; controller: AbortController }>()
  const connectionMetadata = extractMetadataFromHeaders(req.headers)
  let connectionInitPayload: unknown = undefined
  const keepAliveInterval = options.keepAliveInterval
  const pingTimer = keepAliveInterval && keepAliveInterval > 0
    ? setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, keepAliveInterval)
    : null
  let initialized = false
  const initTimer = setTimeout(() => {
    if (!initialized) ws.close(4408, 'Connection initialisation timeout')
  }, options.connectionInitTimeout ?? 5000)

  ws.on('message', async (data) => {
    let message: { id?: string; type?: string; payload?: unknown } = {}
    try {
      message = JSON.parse(data.toString())

      switch (message.type) {
        case 'connection_init': {
          if (initialized) {
            ws.close(4429, 'Too many initialisation requests')
            return
          }
          initialized = true
          clearTimeout(initTimer)
          connectionInitPayload = message.payload
          ws.send(JSON.stringify({ type: 'connection_ack' }))
          break
        }

        case 'subscribe': {
          if (!initialized) {
            ws.close(4401, 'Unauthorized')
            return
          }
          if (typeof message.id !== 'string' || !message.id) {
            ws.close(4400, 'Subscribe message requires an ID')
            return
          }
          if (subscriptions.size >= (options.maxSubscriptionsPerConnection ?? 100)) {
            ws.send(JSON.stringify({
              id: message.id,
              type: 'error',
              payload: [{ message: 'Too many subscriptions' }],
            }))
            return
          }
          if (subscriptions.has(message.id)) {
            ws.close(4409, 'Subscriber ID already exists')
            return
          }
          const { id, payload } = message
          const operationRequest = await resolvePersistedOperation(
            payload as GraphQLRequest,
            persistedMode,
            persistedStore,
            schema,
            persistedTtlMs
          )
          const { query, operationName, variables } = operationRequest
          if (!query) throw new GraphQLAdapterError('INVALID_ARGUMENT', 400, 'GraphQL query is required')
          const operationController = new AbortController()

          const metadata = mergeMetadata(
            connectionMetadata,
            extractMetadataFromRecord(connectionInitPayload),
            extractMetadataFromRecord((connectionInitPayload as { headers?: unknown })?.headers),
            extractMetadataFromRecord((connectionInitPayload as { metadata?: unknown })?.metadata)
          )
          const ctx = createContext(sid(), {
            signal: operationController.signal,
            protocol: 'graphql',
            input: {
              metadata,
            },
            graphql: {
              kind: 'graphql',
              operationType: 'subscription',
              operationName,
            },
          })
          attachGraphQLRuntimeContext(
            ctx,
            router,
            metadata,
            providers,
            policyBridge,
            authenticationRuntime,
            config.security?.mode ?? 'router',
          )
          if (connectionInitPayload !== undefined) {
            ctx.extensions.set(CONNECTION_INIT_KEY, connectionInitPayload)
          }

          if (config.context) {
            const customContext = await config.context({
              method: 'WS',
              url: req.url ?? config.path ?? '/graphql',
              headers: req.headers as Record<string, string | string[] | undefined>,
            })
            for (const [key, value] of Object.entries(customContext ?? {})) {
              ctx.extensions.set(Symbol.for(key), value)
            }
          }

          const { document, validationErrors } = getCachedGraphQLDocument(schema, query, documentCache)
          const limitError = validateDocumentLimits(document, config, schema, operationName, variables)
          if (limitError) {
            ws.send(JSON.stringify({ id, type: 'error', payload: [limitError] }))
            return
          }
          const operation = getOperationAST(document, operationName)
          if (!operation || operation.operation !== 'subscription') {
            ws.send(JSON.stringify({
              id,
              type: 'error',
              payload: [createGraphQLError('INVALID_ARGUMENT', 'WebSocket subscribe requires a subscription operation')],
            }))
            return
          }
          if (validationErrors.length > 0) {
            ws.send(JSON.stringify({ id, type: 'error', payload: [...validationErrors] }))
            return
          }
          if (!schemaInfo) {
            await enforceCustomSchemaSecurity(config, ctx, operation, variables)
          }
          const rootValue = schemaInfo ? createRootValue(router, registry, schemaInfo, ctx, metadata) : {}

          const result = await subscribe({
            schema,
            document,
            rootValue,
            contextValue: ctx,
            variableValues: variables,
            operationName,
          })

          if ('errors' in result) {
            ws.send(JSON.stringify({
              id,
              type: 'error',
              payload: result.errors,
            }))
            return
          }

          subscriptions.set(id, { iterator: result as AsyncIterator<unknown>, controller: operationController })

          // Stream results
          ;(async () => {
            try {
              for await (const value of result as AsyncIterable<ExecutionResult>) {
                if (ws.readyState !== WebSocket.OPEN) break
                if (ws.bufferedAmount > (options.maxBufferedAmount ?? 1024 * 1024)) {
                  ws.close(1013, 'Slow GraphQL subscription consumer')
                  break
                }
                try {
                  ws.send(JSON.stringify({
                    id,
                    type: 'next',
                    payload: value,
                  }))
                } catch {
                  break // Socket closing/closed, stop streaming
                }
              }
              try {
                ws.send(JSON.stringify({ id, type: 'complete' }))
              } catch {
                // Socket already closed, ignore
              }
            } catch (err) {
              try {
                ws.send(JSON.stringify({
                  id,
                  type: 'error',
                  payload: [{ message: 'Internal server error' }],
                }))
              } catch {
                // Socket already closed, ignore
              }
            } finally {
              operationController.abort(new Error('GraphQL subscription completed'))
              subscriptions.delete(id)
            }
          })()
          break
        }

        case 'complete': {
          const { id } = message
          if (typeof id !== 'string') return
          const subscription = subscriptions.get(id)
          subscription?.controller.abort(new Error('GraphQL subscription cancelled'))
          if (subscription?.iterator.return) {
            subscription.iterator.return(undefined)
          }
          subscriptions.delete(id)
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }))
          break
        }
      }
    } catch (err) {
      logger.error({ err }, 'WebSocket message error')
      if (message.id && ws.readyState === WebSocket.OPEN) {
        const error = err instanceof GraphQLAdapterError
          ? createGraphQLError(err.code, err.message)
          : createGraphQLError('INTERNAL', 'Internal server error')
        ws.send(JSON.stringify({ id: message.id, type: 'error', payload: [error] }))
      }
    }
  })

  ws.on('close', () => {
    clearTimeout(initTimer)
    if (pingTimer) {
      clearInterval(pingTimer)
    }
    // Clean up all subscriptions
    for (const [_id, subscription] of subscriptions) {
      subscription.controller.abort(new Error('GraphQL connection closed'))
      if (subscription.iterator.return) {
        subscription.iterator.return(undefined)
      }
    }
    subscriptions.clear()
  })
}

function validateDocumentLimits(
  document: DocumentNode,
  options: Pick<GraphQLOptions, 'maxQueryDepth' | 'maxQueryComplexity' | 'maxAliases'>,
  schema?: GraphQLSchema,
  operationName?: string,
  variables?: Record<string, unknown>,
): GraphQLError | null {
  const fragments = new Map<string, FragmentDefinitionNode>()
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition)
    }
  }

  let aliases = 0
  let complexity = 0
  let maxDepth = 0
  const fieldCosts = new Map<string, number>()
  for (const type of Object.values(schema?.getTypeMap() ?? {})) {
    if (!('getFields' in type) || typeof type.getFields !== 'function') continue
    for (const [name, field] of Object.entries(type.getFields())) {
      const configured = (field.extensions?.raffel as { cost?: unknown } | undefined)?.cost
      const cost = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
        ? configured
        : 1
      fieldCosts.set(name, Math.max(fieldCosts.get(name) ?? 1, cost))
    }
  }
  const paginationMultiplier = (field: FieldNode): number => {
    for (const arg of field.arguments ?? []) {
      if (arg.name.value !== 'first' && arg.name.value !== 'limit') continue
      const raw = arg.value.kind === Kind.INT
        ? Number.parseInt(arg.value.value, 10)
        : arg.value.kind === Kind.VARIABLE
          ? variables?.[arg.value.name.value]
          : undefined
      if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, Math.min(100, Math.floor(raw)))
    }
    return 1
  }
  const walk = (selectionSet: SelectionSetNode, depth: number, fragmentStack: Set<string>): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        complexity += (fieldCosts.get(selection.name.value) ?? 1) * paginationMultiplier(selection)
        if (selection.alias) aliases++
        maxDepth = Math.max(maxDepth, depth)
        if (selection.selectionSet) walk(selection.selectionSet, depth + 1, fragmentStack)
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        walk(selection.selectionSet, depth, fragmentStack)
      } else {
        const name = selection.name.value
        if (fragmentStack.has(name)) continue
        const fragment = fragments.get(name)
        if (fragment) {
          const nextStack = new Set(fragmentStack)
          nextStack.add(name)
          walk(fragment.selectionSet, depth, nextStack)
        }
      }
    }
  }
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      if (operationName && definition.name?.value !== operationName) continue
      walk(definition.selectionSet, 1, new Set())
    }
  }

  const maxQueryDepth = options.maxQueryDepth ?? 15
  const maxQueryComplexity = options.maxQueryComplexity ?? 1000
  const maxAliases = options.maxAliases ?? 50
  if (maxDepth > maxQueryDepth) {
    return new GraphQLError(`Query depth ${maxDepth} exceeds limit ${maxQueryDepth}`, {
      extensions: { code: 'QUERY_TOO_COMPLEX' },
    })
  }
  if (complexity > maxQueryComplexity) {
    return new GraphQLError(`Query complexity ${complexity} exceeds limit ${maxQueryComplexity}`, {
      extensions: { code: 'QUERY_TOO_COMPLEX' },
    })
  }
  if (aliases > maxAliases) {
    return new GraphQLError(`Query aliases ${aliases} exceeds limit ${maxAliases}`, {
      extensions: { code: 'QUERY_TOO_COMPLEX' },
    })
  }
  return null
}

// === CORS ===

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, cors: GraphQLOptions['cors']) {
  if (cors === false || cors === undefined) return

  const config = cors === true
    ? {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
      }
    : cors

  if (config.origin === true) {
    throw new TypeError('GraphQL CORS origin=true is not allowed; use an explicit origin string or allowlist')
  }

  if (config.credentials && config.origin === '*') {
    throw new TypeError('GraphQL CORS credentials require an explicit origin allowlist')
  }

  if (config.origin) {
    const requestOrigin = req.headers.origin
    if (Array.isArray(config.origin)) {
      if (requestOrigin && requestOrigin !== 'null' && config.origin.includes(requestOrigin)) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin)
        res.setHeader('Vary', 'Origin')
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', config.origin)
    }
  }

  if (config.methods) {
    res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '))
  }

  if (config.headers) {
    res.setHeader('Access-Control-Allow-Headers', config.headers.join(', '))
  }

  if (config.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
}
