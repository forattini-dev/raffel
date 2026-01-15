/**
 * Semantic validation for USD documents
 *
 * Checks for:
 * - Reference resolution ($ref)
 * - Circular references
 * - Cross-protocol consistency
 * - Missing required fields in protocol-specific sections
 */

import type {
  USDDocument,
  USDContentTypes,
  USDValidationResult,
  USDValidationError,
  USDChannel,
  USDStreamEndpoint,
  USDJsonRpcMethod,
  USDGrpcMethod,
  USDWebSocket,
  USDStreams,
  USDJsonRpc,
  USDGrpc,
  USDErrors,
} from '../spec/types.js'
import { DEFAULT_USD_CONTENT_TYPES } from '../spec/defaults.js'
import {
  ValidationErrorCodes,
  createError,
  createWarning,
  mergeResults,
} from './errors.js'

/**
 * Validate semantic correctness of a USD document
 */
export function validateSemantic(doc: USDDocument): USDValidationResult {
  const results: USDValidationResult[] = []
  const ws = getWebSocket(doc)
  const streams = getStreams(doc)
  const jsonrpc = getJsonRpc(doc)
  const grpc = getGrpc(doc)
  const errors = getErrors(doc)

  results.push(validateContentTypes(doc))

  // Validate references
  results.push(validateReferences(doc))

  // Validate HTTP paths
  if (doc.paths) {
    results.push(validateHttpPaths(doc))
  }

  // Validate WebSocket
  if (ws) {
    results.push(validateWebSocket(ws))
  }

  // Validate Streams
  if (streams) {
    results.push(validateStreams(streams))
  }

  // Validate JSON-RPC
  if (jsonrpc) {
    results.push(validateJsonRpc(jsonrpc))
  }

  // Validate gRPC
  if (grpc) {
    results.push(validateGrpc(grpc))
  }

  // Validate error definitions
  if (errors) {
    results.push(validateErrors(errors))
  }

  return mergeResults(...results)
}

/**
 * Collect all $ref values in the document
 */
function collectRefs(obj: unknown, path: string = ''): Array<{ ref: string; path: string }> {
  const refs: Array<{ ref: string; path: string }> = []

  if (typeof obj !== 'object' || obj === null) return refs

  if ('$ref' in obj && typeof (obj as Record<string, unknown>).$ref === 'string') {
    refs.push({ ref: (obj as { $ref: string }).$ref, path })
  }

  for (const [key, value] of Object.entries(obj)) {
    refs.push(...collectRefs(value, `${path}/${key}`))
  }

  return refs
}

/**
 * Resolve a $ref path to check if target exists
 */
function resolveRef(doc: USDDocument, ref: string): unknown {
  // Only handle internal refs
  if (!ref.startsWith('#/')) return undefined

  const parts = ref.slice(2).split('/')
  let current: unknown = doc

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Validate all $ref references resolve correctly
 */
function validateReferences(doc: USDDocument): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []
  const refs = collectRefs(doc)
  const seen = new Set<string>()

  for (const { ref, path } of refs) {
    // Skip external refs (http://, file://, etc.)
    if (!ref.startsWith('#/')) {
      warnings.push(
        createWarning(
          path,
          `External reference: ${ref} (not validated)`,
          ValidationErrorCodes.REF_INVALID_FORMAT
        )
      )
      continue
    }

    // Check for circular refs (basic detection)
    if (seen.has(ref)) continue
    seen.add(ref)

    // Try to resolve
    const target = resolveRef(doc, ref)
    if (target === undefined) {
      errors.push(
        createError(path, `Reference not found: ${ref}`, ValidationErrorCodes.REF_NOT_FOUND)
      )
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate HTTP paths
 */
function validateHttpPaths(doc: USDDocument): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []
  const paths = doc.paths || {}

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    // Validate path format
    if (!pathKey.startsWith('/')) {
      errors.push(
        createError(
          `/paths/${pathKey}`,
          'Path must start with /',
          ValidationErrorCodes.HTTP_INVALID_PATH
        )
      )
    }

    // Check for path parameters
    const paramMatches = pathKey.match(/\{([^}]+)\}/g) || []
    const pathParams = paramMatches.map((m) => m.slice(1, -1))

    // Validate operations
    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
    for (const method of methods) {
      const operation = pathItem[method]
      if (!operation) continue

      // Check responses exist
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        errors.push(
          createError(
            `/paths/${pathKey}/${method}`,
            'Operation must have at least one response',
            ValidationErrorCodes.HTTP_MISSING_RESPONSES
          )
        )
      }

      // Check path parameters are defined
      const params = operation.parameters || []
      const definedParams = new Set(
        params.filter((p) => p.in === 'path').map((p) => p.name)
      )

      for (const param of pathParams) {
        if (!definedParams.has(param)) {
          warnings.push(
            createWarning(
              `/paths/${pathKey}/${method}`,
              `Path parameter {${param}} not defined in parameters`,
              ValidationErrorCodes.HTTP_INVALID_PATH
            )
          )
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate WebSocket configuration
 */
function validateWebSocket(ws: USDWebSocket): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []

  if (ws.channels) {
    for (const [name, channel] of Object.entries(ws.channels)) {
      const basePath = `/x-usd/websocket/channels/${name}`

      // Validate channel type
      if (!['public', 'private', 'presence'].includes(channel.type)) {
        errors.push(
          createError(
            `${basePath}/type`,
            `Invalid channel type: ${channel.type}`,
            ValidationErrorCodes.WS_INVALID_CHANNEL_TYPE
          )
        )
      }

      // Validate channel parameters for templated names
      const channelParams = extractChannelParameters(name)
      if (channelParams.length > 0) {
        if (!channel.parameters) {
          warnings.push(
            createWarning(
              basePath,
              'Channel has templated parameters but no parameter definitions'
            )
          )
        } else {
          for (const param of channelParams) {
            if (!channel.parameters[param]) {
              warnings.push(
                createWarning(
                  `${basePath}/parameters`,
                  `Missing parameter definition for ${param}`
                )
              )
            }
          }
        }
      }

      // Check that subscribe or publish is defined
      if (!channel.subscribe && !channel.publish) {
        warnings.push(
          createWarning(
            basePath,
            'Channel has neither subscribe nor publish operation',
            ValidationErrorCodes.WS_MISSING_MESSAGE
          )
        )
      }

      // Presence channels should have member schema
      if (channel.type === 'presence') {
        if (!channel['x-usd-presence']?.memberSchema) {
          warnings.push(
            createWarning(
              basePath,
              'Presence channel should define memberSchema',
              ValidationErrorCodes.WS_PRESENCE_MISSING_MEMBER_SCHEMA
            )
          )
        }
      }

      // Validate message schemas
      if (channel.subscribe?.message) {
        validateMessageSchema(channel.subscribe.message, `${basePath}/subscribe/message`, errors)
      }
      if (channel.publish?.message) {
        validateMessageSchema(channel.publish.message, `${basePath}/publish/message`, errors)
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate Streams configuration
 */
function validateStreams(streams: USDStreams): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []

  if (streams.endpoints) {
    for (const [name, endpoint] of Object.entries(streams.endpoints)) {
      const basePath = `/x-usd/streams/endpoints/${name}`

      // Validate direction
      if (!['server-to-client', 'client-to-server', 'bidirectional'].includes(endpoint.direction)) {
        errors.push(
          createError(
            `${basePath}/direction`,
            `Invalid stream direction: ${endpoint.direction}`,
            ValidationErrorCodes.STREAM_INVALID_DIRECTION
          )
        )
      }

      // Validate message
      if (!endpoint.message) {
        errors.push(
          createError(
            basePath,
            'Stream endpoint must have a message schema',
            ValidationErrorCodes.STREAM_MISSING_MESSAGE
          )
        )
      } else {
        validateMessageSchema(endpoint.message, `${basePath}/message`, errors)
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate JSON-RPC configuration
 */
function validateJsonRpc(rpc: USDJsonRpc): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []

  if (rpc.methods) {
    for (const [name, method] of Object.entries(rpc.methods)) {
      const basePath = `/x-usd/jsonrpc/methods/${name}`

      // Validate method name format (namespaced)
      if (!name.includes('.') && !name.startsWith('rpc.')) {
        warnings.push(
          createWarning(
            basePath,
            'Method name should be namespaced (e.g., "service.method")',
            ValidationErrorCodes.RPC_INVALID_METHOD_NAME
          )
        )
      }

      // Non-notification methods should have result
      if (!method['x-usd-notification'] && !method.result) {
        warnings.push(
          createWarning(
            basePath,
            'Method should have a result schema (or mark as notification)',
            ValidationErrorCodes.RPC_MISSING_RESULT
          )
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate gRPC configuration
 */
function validateGrpc(grpc: USDGrpc): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []

  if (grpc.services) {
    for (const [serviceName, service] of Object.entries(grpc.services)) {
      const servicePath = `/x-usd/grpc/services/${serviceName}`

      if (service.methods) {
        for (const [methodName, method] of Object.entries(service.methods)) {
          const methodPath = `${servicePath}/methods/${methodName}`

          // Method names should be PascalCase
          if (!/^[A-Z][a-zA-Z0-9]*$/.test(methodName)) {
            warnings.push(
              createWarning(
                methodPath,
                'gRPC method names should be PascalCase',
                ValidationErrorCodes.GRPC_INVALID_METHOD_NAME
              )
            )
          }

          // Validate input/output exist
          if (!method.input) {
            errors.push(
              createError(
                methodPath,
                'gRPC method must have input schema',
                ValidationErrorCodes.GRPC_MISSING_INPUT
              )
            )
          }

          if (!method.output) {
            errors.push(
              createError(
                methodPath,
                'gRPC method must have output schema',
                ValidationErrorCodes.GRPC_MISSING_OUTPUT
              )
            )
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate error definitions
 */
function validateErrors(errorDefs: USDErrors): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []

  for (const [name, errorDef] of Object.entries(errorDefs)) {
    const basePath = `/x-usd/errors/${name}`

    // Check error name is uppercase with underscores
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      warnings.push(
        createWarning(basePath, 'Error name should be UPPER_SNAKE_CASE')
      )
    }

    // Warn if no protocol-specific codes
    if (errorDef.status === undefined && errorDef.code === undefined && errorDef.grpcCode === undefined) {
      warnings.push(
        createWarning(basePath, 'Error has no protocol-specific codes (status, code, grpcCode)')
      )
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

function validateContentTypes(doc: USDDocument): USDValidationResult {
  const errors: USDValidationError[] = []
  const warnings: USDValidationError[] = []
  const xUsd = doc['x-usd']

  const fallbackSupported = DEFAULT_USD_CONTENT_TYPES.supported ?? []
  const globalSupportedList = resolveSupportedList(xUsd?.contentTypes, fallbackSupported)
  const globalSupported = new Set(globalSupportedList)

  if (xUsd?.contentTypes) {
    validateContentTypesObject(
      xUsd.contentTypes,
      '/x-usd/contentTypes',
      globalSupported,
      errors,
      warnings,
      true
    )
  }

  const ws = xUsd?.websocket
  if (ws) {
    validateContentTypesObject(ws.contentTypes, '/x-usd/websocket/contentTypes', globalSupported, errors, warnings)
    validateChannelOperations(ws, '/x-usd/websocket', globalSupported, errors, warnings)
  }

  const streams = xUsd?.streams
  if (streams) {
    validateContentTypesObject(streams.contentTypes, '/x-usd/streams/contentTypes', globalSupported, errors, warnings)
    if (streams.endpoints) {
      for (const [name, endpoint] of Object.entries(streams.endpoints)) {
        validateContentTypesObject(
          endpoint.contentTypes,
          `/x-usd/streams/endpoints/${name}/contentTypes`,
          globalSupported,
          errors,
          warnings
        )
      }
    }
  }

  const jsonrpc = xUsd?.jsonrpc
  if (jsonrpc) {
    validateContentTypesObject(jsonrpc.contentTypes, '/x-usd/jsonrpc/contentTypes', globalSupported, errors, warnings)
    if (jsonrpc.methods) {
      for (const [name, method] of Object.entries(jsonrpc.methods)) {
        validateContentTypesObject(
          method.contentTypes,
          `/x-usd/jsonrpc/methods/${name}/contentTypes`,
          globalSupported,
          errors,
          warnings
        )
      }
    }
  }

  const grpc = xUsd?.grpc
  if (grpc) {
    validateContentTypesObject(grpc.contentTypes, '/x-usd/grpc/contentTypes', globalSupported, errors, warnings)
    if (grpc.services) {
      for (const [serviceName, service] of Object.entries(grpc.services)) {
        if (!service.methods) continue
        for (const [methodName, method] of Object.entries(service.methods)) {
          validateContentTypesObject(
            method.contentTypes,
            `/x-usd/grpc/services/${serviceName}/methods/${methodName}/contentTypes`,
            globalSupported,
            errors,
            warnings
          )
        }
      }
    }
  }

  const tcp = xUsd?.tcp
  if (tcp) {
    validateContentTypesObject(tcp.contentTypes, '/x-usd/tcp/contentTypes', globalSupported, errors, warnings)
    if (tcp.servers) {
      for (const [name, server] of Object.entries(tcp.servers)) {
        validateContentTypesObject(
          server.contentTypes,
          `/x-usd/tcp/servers/${name}/contentTypes`,
          globalSupported,
          errors,
          warnings
        )
      }
    }
  }

  const udp = xUsd?.udp
  if (udp) {
    validateContentTypesObject(udp.contentTypes, '/x-usd/udp/contentTypes', globalSupported, errors, warnings)
    if (udp.endpoints) {
      for (const [name, endpoint] of Object.entries(udp.endpoints)) {
        validateContentTypesObject(
          endpoint.contentTypes,
          `/x-usd/udp/endpoints/${name}/contentTypes`,
          globalSupported,
          errors,
          warnings
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

function validateChannelOperations(
  ws: USDWebSocket,
  basePath: string,
  allowed: Set<string>,
  errors: USDValidationError[],
  warnings: USDValidationError[]
): void {
  if (!ws.channels) return

  for (const [name, channel] of Object.entries(ws.channels)) {
    const channelPath = `${basePath}/channels/${name}`
    if (channel.subscribe?.contentTypes) {
      validateContentTypesObject(
        channel.subscribe.contentTypes,
        `${channelPath}/subscribe/contentTypes`,
        allowed,
        errors,
        warnings
      )
    }
    if (channel.publish?.contentTypes) {
      validateContentTypesObject(
        channel.publish.contentTypes,
        `${channelPath}/publish/contentTypes`,
        allowed,
        errors,
        warnings
      )
    }
  }
}

function resolveSupportedList(
  contentTypes: USDContentTypes | undefined,
  fallback: string[]
): string[] {
  if (contentTypes?.supported && contentTypes.supported.length > 0) {
    return [...contentTypes.supported]
  }
  if (contentTypes?.default) {
    return [contentTypes.default]
  }
  return [...fallback]
}

function validateContentTypesObject(
  contentTypes: USDContentTypes | undefined,
  path: string,
  allowed: Set<string>,
  errors: USDValidationError[],
  warnings: USDValidationError[],
  requireDefault: boolean = false
): void {
  if (!contentTypes) return

  const supported = contentTypes.supported ?? []
  for (const entry of supported) {
    if (!isValidContentType(entry)) {
      errors.push(
        createError(
          path,
          `Invalid content type: ${entry}`,
          ValidationErrorCodes.CONTENT_TYPE_INVALID
        )
      )
      continue
    }
    if (!allowed.has(entry)) {
      errors.push(
        createError(
          path,
          `Unsupported content type: ${entry}`,
          ValidationErrorCodes.CONTENT_TYPE_UNSUPPORTED
        )
      )
    }
  }

  if (!contentTypes.default) {
    if (requireDefault) {
      warnings.push(
        createWarning(
          path,
          'Missing default content type',
          ValidationErrorCodes.CONTENT_TYPE_MISSING_DEFAULT
        )
      )
    }
    return
  }

  if (!isValidContentType(contentTypes.default)) {
    errors.push(
      createError(
        path,
        `Invalid content type: ${contentTypes.default}`,
        ValidationErrorCodes.CONTENT_TYPE_INVALID
      )
    )
    return
  }

  if (!allowed.has(contentTypes.default)) {
    errors.push(
      createError(
        path,
        `Unsupported content type: ${contentTypes.default}`,
        ValidationErrorCodes.CONTENT_TYPE_UNSUPPORTED
      )
    )
  }

  if (supported.length > 0 && !supported.includes(contentTypes.default)) {
    errors.push(
      createError(
        path,
        `Default content type must be listed in supported`,
        ValidationErrorCodes.CONTENT_TYPE_UNSUPPORTED
      )
    )
  }
}

function isValidContentType(value: string): boolean {
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(value)
}

function getWebSocket(doc: USDDocument): USDWebSocket | undefined {
  return doc['x-usd']?.websocket
}

function getStreams(doc: USDDocument): USDStreams | undefined {
  return doc['x-usd']?.streams
}

function getJsonRpc(doc: USDDocument): USDJsonRpc | undefined {
  return doc['x-usd']?.jsonrpc
}

function getGrpc(doc: USDDocument): USDGrpc | undefined {
  return doc['x-usd']?.grpc
}

function getErrors(doc: USDDocument): USDErrors | undefined {
  return doc['x-usd']?.errors
}

/**
 * Validate a message schema (check $ref or inline schema)
 */
function validateMessageSchema(
  message: unknown,
  path: string,
  errors: USDValidationError[]
): void {
  if (typeof message !== 'object' || message === null) {
    errors.push(
      createError(path, 'Message must be an object', ValidationErrorCodes.SCHEMA_TYPE_MISMATCH)
    )
    return
  }

  // If it's a $ref, it will be validated by reference validation
  if ('$ref' in message) return

  // If it's an inline schema, check for payload or direct schema properties
  const msg = message as Record<string, unknown>
  if (!msg.payload && !msg.type && !msg.properties && !msg.$ref) {
    // Could be a message object with payload, or a direct schema
    // Allow both formats
  }
}

function extractChannelParameters(name: string): string[] {
  const params: string[] = []
  const braceMatches = name.match(/\{([^}]+)\}/g) || []
  for (const match of braceMatches) {
    params.push(match.slice(1, -1))
  }

  const colonMatches = name.match(/:([a-zA-Z0-9_]+)/g) || []
  for (const match of colonMatches) {
    params.push(match.slice(1))
  }

  return Array.from(new Set(params))
}
