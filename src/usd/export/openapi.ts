/**
 * OpenAPI Export for USD
 *
 * Converts a USD document to pure OpenAPI 3.1 format,
 * stripping USD-specific extensions.
 */

import type {
  USDDocument,
  USDExportOptions,
  USDPaths,
  USDWebSocket,
  USDJsonRpc,
  USDStreams,
} from '../spec/types.js'

/**
 * OpenAPI 3.1 Document (subset of types)
 */
export interface OpenAPIDocument {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
    description?: string
    termsOfService?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
      identifier?: string
    }
    summary?: string
  }
  servers?: Array<{
    url: string
    description?: string
    variables?: Record<string, { enum?: string[]; default: string; description?: string }>
  }>
  paths?: Record<string, unknown>
  webhooks?: Record<string, unknown>
  components?: {
    schemas?: Record<string, unknown>
    responses?: Record<string, unknown>
    parameters?: Record<string, unknown>
    examples?: Record<string, unknown>
    requestBodies?: Record<string, unknown>
    headers?: Record<string, unknown>
    securitySchemes?: Record<string, unknown>
    links?: Record<string, unknown>
    callbacks?: Record<string, unknown>
    pathItems?: Record<string, unknown>
  }
  security?: Array<Record<string, string[]>>
  tags?: Array<{
    name: string
    description?: string
    externalDocs?: { url: string; description?: string }
  }>
  externalDocs?: {
    url: string
    description?: string
  }
}

/**
 * Export a USD document to pure OpenAPI 3.1
 *
 * @param doc - USD document
 * @param options - Export options
 * @returns OpenAPI 3.1 document
 */
export function exportOpenAPI(
  doc: USDDocument,
  options: USDExportOptions = {}
): OpenAPIDocument {
  const {
    includeWebSocketAsWebhooks = false,
    includeRpcAsEndpoints = false,
    includeStreamsAsEndpoints = false,
    stripExtensions = true,
  } = options
  const xUsd = doc['x-usd']

  // Start with base OpenAPI structure
  const openapi: OpenAPIDocument = {
    openapi: '3.1.0',
    info: {
      title: doc.info.title,
      version: doc.info.version,
    },
  }

  // Copy info fields (excluding USD extensions)
  if (doc.info.description) openapi.info.description = doc.info.description
  if (doc.info.termsOfService) openapi.info.termsOfService = doc.info.termsOfService
  if (doc.info.contact) openapi.info.contact = doc.info.contact
  if (doc.info.license) openapi.info.license = doc.info.license
  if (doc.info.summary) openapi.info.summary = doc.info.summary

  // Copy servers
  if (doc.servers) {
    openapi.servers = doc.servers.map((s) => {
      const server: NonNullable<OpenAPIDocument['servers']>[number] = { url: s.url }
      if (s.description) server.description = s.description
      if (s.variables) server.variables = s.variables
      return server
    })
  }

  // Copy paths (strip x-usd-* from operations)
  if (doc.paths) {
    openapi.paths = stripPathsExtensions(doc.paths, stripExtensions)
  }

  // Convert WebSocket channels to webhooks
  const websocket = xUsd?.websocket
  if (includeWebSocketAsWebhooks && websocket) {
    openapi.webhooks = convertWebSocketToWebhooks(websocket)
  }

  // Convert JSON-RPC methods to POST endpoints
  const jsonrpc = xUsd?.jsonrpc
  if (includeRpcAsEndpoints && jsonrpc) {
    const rpcPaths = convertJsonRpcToPaths(jsonrpc)
    openapi.paths = { ...(openapi.paths || {}), ...rpcPaths }
  }

  // Convert Streams to endpoints
  const streams = xUsd?.streams
  if (includeStreamsAsEndpoints && streams) {
    const streamPaths = convertStreamsToPaths(streams)
    openapi.paths = { ...(openapi.paths || {}), ...streamPaths }
  }

  // Copy components (strip USD-specific)
  if (doc.components) {
    openapi.components = {}

    if (doc.components.schemas) {
      openapi.components.schemas = stripExtensionsFromObject(doc.components.schemas, stripExtensions)
    }
    if (doc.components.responses) {
      openapi.components.responses = stripExtensionsFromObject(doc.components.responses, stripExtensions)
    }
    if (doc.components.parameters) {
      openapi.components.parameters = stripExtensionsFromObject(doc.components.parameters, stripExtensions)
    }
    if (doc.components.examples) {
      openapi.components.examples = doc.components.examples
    }
    if (doc.components.requestBodies) {
      openapi.components.requestBodies = doc.components.requestBodies
    }
    if (doc.components.headers) {
      openapi.components.headers = doc.components.headers
    }
    if (doc.components.securitySchemes) {
      // Filter out x-usd-* security schemes
      openapi.components.securitySchemes = {}
      for (const [name, scheme] of Object.entries(doc.components.securitySchemes)) {
        if (!name.startsWith('x-usd-')) {
          openapi.components.securitySchemes[name] = stripExtensionsFromObject(scheme, stripExtensions)
        }
      }
    }
    if (doc.components.links) {
      openapi.components.links = doc.components.links
    }
    if (doc.components.callbacks) {
      openapi.components.callbacks = doc.components.callbacks
    }
    if (doc.components.pathItems) {
      openapi.components.pathItems = doc.components.pathItems
    }
  }

  // Copy other standard OpenAPI fields
  if (doc.security) openapi.security = doc.security
  if (doc.tags) openapi.tags = doc.tags
  if (doc.externalDocs) openapi.externalDocs = doc.externalDocs

  return openapi
}

/**
 * Strip USD extensions from paths
 */
function stripPathsExtensions(paths: USDPaths, strip: boolean): Record<string, unknown> {
  if (!strip) return paths

  const result: Record<string, unknown> = {}

  for (const [path, item] of Object.entries(paths)) {
    result[path] = stripExtensionsFromObject(item, strip)
  }

  return result
}

/**
 * Strip USD extensions from an object recursively
 */
function stripExtensionsFromObject<T extends object>(obj: T, strip: boolean): T {
  if (!strip) return obj

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    // Skip USD extensions
    if (key === 'x-usd' || key.startsWith('x-usd-')) continue

    // Recursively strip from nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = stripExtensionsFromObject(value as object, strip)
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object' ? stripExtensionsFromObject(item, strip) : item
      )
    } else {
      result[key] = value
    }
  }

  return result as T
}

/**
 * Convert WebSocket channels to OpenAPI webhooks
 */
function convertWebSocketToWebhooks(ws: USDWebSocket): Record<string, unknown> {
  const webhooks: Record<string, unknown> = {}

  if (ws.channels) {
    for (const [name, channel] of Object.entries(ws.channels)) {
      // Create a webhook for each channel's subscribe operation
      if (channel.subscribe?.message) {
        webhooks[`ws-${name}-receive`] = {
          post: {
            summary: channel.subscribe.summary || `Receive messages from ${name} channel`,
            description: channel.description,
            tags: channel.tags,
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: getMessagePayload(channel.subscribe.message),
                },
              },
            },
            responses: {
              '200': { description: 'Message processed' },
            },
          },
        }
      }
    }
  }

  return webhooks
}

/**
 * Convert JSON-RPC methods to OpenAPI paths
 */
function convertJsonRpcToPaths(rpc: USDJsonRpc): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  const endpoint = rpc.endpoint || '/rpc'

  if (rpc.methods) {
    for (const [name, method] of Object.entries(rpc.methods)) {
      const path = `${endpoint}/${name.replace(/\./g, '/')}`

      paths[path] = {
        post: {
          operationId: name,
          summary: method.description,
          tags: method.tags,
          requestBody: method.params
            ? {
                required: true,
                content: {
                  'application/json': {
                    schema: method.params,
                  },
                },
              }
            : undefined,
          responses: {
            '200': {
              description: 'Success',
              content: method.result
                ? {
                    'application/json': {
                      schema: method.result,
                    },
                  }
                : undefined,
            },
          },
        },
      }
    }
  }

  return paths
}

/**
 * Convert Streams to OpenAPI paths
 */
function convertStreamsToPaths(streams: USDStreams): Record<string, unknown> {
  const paths: Record<string, unknown> = {}

  if (streams.endpoints) {
    for (const [name, endpoint] of Object.entries(streams.endpoints)) {
      const path = `/streams/${name.replace(/\./g, '/')}`
      const messageSchema = getMessagePayload(endpoint.message)

      if (endpoint.direction === 'server-to-client') {
        paths[path] = {
          get: {
            operationId: name,
            summary: endpoint.description || `Stream: ${name}`,
            tags: endpoint.tags,
            responses: {
              '200': {
                description: 'Stream of events',
                content: {
                  'text/event-stream': {
                    schema: messageSchema,
                  },
                },
              },
            },
          },
        }
      } else {
        paths[path] = {
          post: {
            operationId: name,
            summary: endpoint.description || `Stream upload: ${name}`,
            tags: endpoint.tags,
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: messageSchema,
                },
              },
            },
            responses: {
              '200': { description: 'Stream processed' },
            },
          },
        }
      }
    }
  }

  return paths
}

/**
 * Extract payload schema from a message
 */
function getMessagePayload(message: unknown): unknown {
  if (!message || typeof message !== 'object') return {}

  // If it's a $ref, return as-is
  if ('$ref' in message) return message

  // If it has payload, return that
  if ('payload' in message) return (message as { payload: unknown }).payload

  // Otherwise return the whole thing as schema
  return message
}
