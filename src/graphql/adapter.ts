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
  parse,
  validate,
  subscribe,
  GraphQLError,
  type GraphQLSchema,
  type ExecutionResult,
  type DocumentNode,
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
} from './types.js'
import { generateGraphQLSchema } from './schema-generator.js'
import { createLogger } from '../utils/logger.js'
import { sid } from '../utils/id/index.js'
import {
  extractMetadataFromHeaders,
  extractMetadataFromRecord,
  mergeMetadata,
} from '../utils/header-metadata.js'
import {
  jsonCodec,
  resolveCodecs,
  selectCodecForAccept,
  selectCodecForContentType,
  type Codec,
} from '../utils/content-codecs.js'

const logger = createLogger('graphql-adapter')
const CONNECTION_INIT_KEY = Symbol.for('raffel.connection_init')

class GraphQLAdapterError extends Error {
  code: string
  status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

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
  query: string
  operationName?: string
  variables?: Record<string, unknown>
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
        })
      } catch (err) {
        reject(new GraphQLAdapterError('PARSE_ERROR', 400, 'Invalid request body'))
      }
    })
    req.on('error', reject)
  })
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GraphQLAdapterError('DEADLINE_EXCEEDED', 504, 'Request deadline exceeded'))
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
  const envelope: Envelope = {
    id: sid(),
    procedure,
    type: 'request',
    payload: input,
    metadata,
    context: ctx,
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
  const envelope: Envelope = {
    id: sid(),
    procedure: event,
    type: 'event',
    payload: input,
    metadata,
    context: ctx,
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
  const envelope: Envelope = {
    id: sid(),
    procedure: stream,
    type: 'stream:start',
    payload: input,
    metadata,
    context: ctx,
  }

  const result = await router.handle(envelope)

  // If result is async iterable (stream)
  if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
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
  for (const queryName of schemaInfo.queries) {
    if (queryName === '_health') {
      root[fieldName(queryName)] = () => true
      continue
    }
    root[fieldName(queryName)] = (args: Record<string, unknown>) =>
      executeProcedure(router, queryName, args, ctx, metadata)
  }

  // Map mutations
  for (const mutationName of schemaInfo.mutations) {
    // Check if it's a procedure or event
    const procedure = registry.getProcedure(mutationName)
    if (procedure) {
      root[fieldName(mutationName)] = (args: Record<string, unknown>) =>
        executeProcedure(router, mutationName, args, ctx, metadata)
    } else {
      // It's an event
      root[fieldName(mutationName)] = (args: Record<string, unknown>) =>
        emitEvent(router, mutationName, args, ctx, metadata)
    }
  }

  // Map subscriptions (return async iterators)
  for (const subscriptionName of schemaInfo.subscriptions) {
    root[fieldName(subscriptionName)] = (args: Record<string, unknown>) =>
      executeStream(router, subscriptionName, args, ctx, metadata)
  }

  return root
}

interface GraphQLHandlers {
  schema: GraphQLSchema
  schemaInfo: GeneratedSchemaInfo | null
  handleRequest: (req: IncomingMessage, res: ServerResponse, opts?: { skipPathCheck?: boolean }) => Promise<void>
  createSubscriptionServer: (server: Server) => WebSocketServer | null
}

function createGraphQLHandlers(
  router: Router,
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  config: GraphQLAdapterOptions['config']
): GraphQLHandlers {
  let schema: GraphQLSchema
  let schemaInfo: GeneratedSchemaInfo | null = null

  // Generate or use provided schema
  if (config.schema) {
    schema = config.schema
  } else if (config.generateSchema !== false) {
    const generated = generateGraphQLSchema({
      registry,
      schemaRegistry,
      options: config.schemaOptions,
    })
    schema = generated.schema
    schemaInfo = generated
  } else {
    throw new Error('GraphQL adapter requires either a schema or generateSchema: true')
  }

  const codecs = resolveCodecs(config.codecs)

  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    opts?: { skipPathCheck?: boolean }
  ) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // CORS preflight
    if (req.method === 'OPTIONS') {
      setCorsHeaders(res, config.cors)
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

    setCorsHeaders(res, config.cors)

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

    // Handle GraphQL POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const timeoutMs = config.timeout ?? 0
    const maxBodySize = config.maxBodySize ?? 1024 * 1024

    try {
      const result = await withTimeout((async () => {
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

        const gqlRequest = await parseGraphQLRequest(req, maxBodySize, requestCodec)

        const metadata = extractMetadataFromHeaders(req.headers)

        // Create context
        const ctx = createContext(sid())
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
        return executeGraphQL(
          schema,
          gqlRequest,
          router,
          registry,
          schemaInfo,
          ctx,
          metadata,
          config.introspection !== false
        )
      })(), timeoutMs)

      res.writeHead(200, { 'Content-Type': responseCodec.contentTypes[0] ?? 'application/json' })
      res.end(responseCodec.encode(result))
    } catch (err) {
      if (err instanceof GraphQLAdapterError) {
        res.writeHead(err.status, { 'Content-Type': responseCodec.contentTypes[0] ?? 'application/json' })
        res.end(responseCodec.encode(createErrorResult(err.code, err.message)))
        return
      }

      logger.error({ err }, 'GraphQL execution error')
      res.writeHead(500, { 'Content-Type': responseCodec.contentTypes[0] ?? 'application/json' })
      res.end(responseCodec.encode({
        errors: [{ message: (err as Error).message }],
      }))
    }
  }

  const createSubscriptionServer = (server: Server): WebSocketServer | null => {
    if (config.subscriptions === false || !schemaInfo?.subscriptions.length) {
      return null
    }

    const subscriptionPath = typeof config.subscriptions === 'object'
      ? config.subscriptions.path ?? config.path
      : config.path
    const keepAliveInterval = typeof config.subscriptions === 'object'
      ? config.subscriptions.keepAliveInterval
      : undefined

    const wss = new WebSocketServer({ server, path: subscriptionPath })
    wss.on('connection', (ws, req) => {
      handleSubscriptionConnection(
        ws,
        req,
        schema,
        router,
        registry,
        schemaInfo!,
        keepAliveInterval
      )
    })

    logger.debug({ path: subscriptionPath }, 'WebSocket subscriptions enabled')
    return wss
  }

  return { schema, schemaInfo, handleRequest, createSubscriptionServer }
}

function fieldName(handlerName: string): string {
  // Convert 'users.get' to 'usersGet'
  const parts = handlerName.split(/[.\-_]/)
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

// === Adapter Implementation ===

export function createGraphQLAdapter(options: GraphQLAdapterOptions): GraphQLAdapter {
  const { router, registry, schemaRegistry, config, host, port } = options

  let server: Server | null = null
  let wss: WebSocketServer | null = null
  let address: { host: string; port: number; path: string } | null = null

  const { schema, schemaInfo, handleRequest, createSubscriptionServer } = createGraphQLHandlers(
    router,
    registry,
    schemaRegistry,
    config
  )

  return {
    async start() {
      server = createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          logger.error({ err }, 'GraphQL request error')
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ errors: [{ message: (err as Error).message }] }))
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
        await new Promise<void>((resolve) => {
          server!.close(() => resolve())
        })
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
  const { router, registry, schemaRegistry, config } = options
  const { schema, schemaInfo, handleRequest, createSubscriptionServer } = createGraphQLHandlers(
    router,
    registry,
    schemaRegistry,
    config
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
        res.end(JSON.stringify({ errors: [{ message: (err as Error).message }] }))
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
  introspection: boolean
): Promise<ExecutionResult> {
  const { query, operationName, variables } = request

  // Parse document
  let document: DocumentNode
  try {
    document = parse(query)
  } catch (err) {
    return {
      errors: [{ message: `Syntax error: ${(err as Error).message}` } as any],
    }
  }

  // Validate
  const validationErrors = validate(schema, document)
  if (validationErrors.length > 0) {
    return { errors: validationErrors }
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

  // Create root value with resolvers
  const rootValue = schemaInfo
    ? createRootValue(router, registry, schemaInfo, ctx, metadata)
    : {}

  // Execute
  return graphql({
    schema,
    source: query,
    rootValue,
    contextValue: ctx,
    variableValues: variables,
    operationName,
  })
}

// === WebSocket Subscriptions ===

function handleSubscriptionConnection(
  ws: WebSocket,
  req: IncomingMessage,
  schema: GraphQLSchema,
  router: Router,
  registry: Registry,
  schemaInfo: GeneratedSchemaInfo,
  keepAliveInterval?: number
): void {
  const subscriptions = new Map<string, AsyncIterator<unknown>>()
  const connectionMetadata = extractMetadataFromHeaders(req.headers)
  let connectionInitPayload: unknown = undefined
  const pingTimer = keepAliveInterval && keepAliveInterval > 0
    ? setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, keepAliveInterval)
    : null

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'connection_init': {
          connectionInitPayload = message.payload
          ws.send(JSON.stringify({ type: 'connection_ack' }))
          break
        }

        case 'subscribe': {
          const { id, payload } = message
          const { query, operationName, variables } = payload

          const ctx = createContext(sid())
          if (connectionInitPayload !== undefined) {
            ctx.extensions.set(CONNECTION_INIT_KEY, connectionInitPayload)
          }

          const metadata = mergeMetadata(
            connectionMetadata,
            extractMetadataFromRecord(connectionInitPayload),
            extractMetadataFromRecord((connectionInitPayload as { headers?: unknown })?.headers),
            extractMetadataFromRecord((connectionInitPayload as { metadata?: unknown })?.metadata)
          )

          const document = parse(query)
          const rootValue = createRootValue(router, registry, schemaInfo, ctx, metadata)

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

          subscriptions.set(id, result as AsyncIterator<unknown>)

          // Stream results
          ;(async () => {
            try {
              for await (const value of result as AsyncIterable<ExecutionResult>) {
                if (ws.readyState !== WebSocket.OPEN) break
                ws.send(JSON.stringify({
                  id,
                  type: 'next',
                  payload: value,
                }))
              }
              ws.send(JSON.stringify({ id, type: 'complete' }))
            } catch (err) {
              ws.send(JSON.stringify({
                id,
                type: 'error',
                payload: [{ message: (err as Error).message }],
              }))
            } finally {
              subscriptions.delete(id)
            }
          })()
          break
        }

        case 'complete': {
          const { id } = message
          const iterator = subscriptions.get(id)
          if (iterator?.return) {
            iterator.return(undefined)
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
    }
  })

  ws.on('close', () => {
    if (pingTimer) {
      clearInterval(pingTimer)
    }
    // Clean up all subscriptions
    for (const [_id, iterator] of subscriptions) {
      if (iterator?.return) {
        iterator.return(undefined)
      }
    }
    subscriptions.clear()
  })
}

// === CORS ===

function setCorsHeaders(res: ServerResponse, cors: GraphQLOptions['cors']) {
  if (cors === false) return

  const config = cors === true || cors === undefined
    ? {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
      }
    : cors

  if (config.origin) {
    const origin = Array.isArray(config.origin)
      ? config.origin.join(', ')
      : config.origin === true
        ? '*'
        : config.origin
    res.setHeader('Access-Control-Allow-Origin', origin)
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
