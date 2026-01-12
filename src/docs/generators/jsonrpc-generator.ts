/**
 * JSON-RPC Generator for USD
 *
 * Converts Raffel procedures to USD JSON-RPC specification (x-usd.jsonrpc).
 */

import type { Registry } from '../../core/registry.js'
import type { HandlerMeta } from '../../types/index.js'
import type { SchemaRegistry, HandlerSchema } from '../../validation/index.js'
import type {
  USDJsonRpc,
  USDJsonRpcMethod,
  USDJsonRpcError,
  USDContentTypes,
  USDSchema,
} from '../../usd/index.js'
import { USD_PROTOCOL_CONTENT_TYPES } from '../../usd/index.js'
import {
  createSchemaRegistry,
  generateSchemaName,
  createRef,
  type ConvertedSchemaRegistry,
} from './schema-converter.js'
import { resolveContentTypes } from './content-types.js'

/**
 * JSON-RPC generation options
 */
export interface JsonRpcGeneratorOptions {
  /** JSON-RPC endpoint path */
  endpoint?: string
  /** JSON-RPC version */
  version?: '2.0'
  /** Protocol content types */
  contentTypes?: USDContentTypes
  /** Enable batch support */
  batch?: {
    enabled?: boolean
    maxSize?: number
  }
  /** Group methods by namespace as tags */
  groupByNamespace?: boolean
  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>
}

/**
 * JSON-RPC generation context
 */
export interface JsonRpcGeneratorContext {
  /** Handler registry */
  registry: Registry
  /** Schema registry for input/output schemas */
  schemaRegistry?: SchemaRegistry
}

/**
 * JSON-RPC generation result
 */
export interface JsonRpcGeneratorResult {
  /** USD JSON-RPC specification */
  jsonrpc: USDJsonRpc
  /** Component schemas used */
  schemas: Record<string, USDSchema>
  /** Tags used */
  tags: Set<string>
}

/**
 * Generate USD JSON-RPC specification from registered procedures
 */
export function generateJsonRpc(
  ctx: JsonRpcGeneratorContext,
  options: JsonRpcGeneratorOptions = {}
): JsonRpcGeneratorResult {
  const {
    endpoint = '/rpc',
    version = '2.0',
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.jsonrpc,
    batch,
    groupByNamespace = true,
    defaultSecurity,
  } = options

  const schemaRegistry = createSchemaRegistry()
  const methods: Record<string, USDJsonRpcMethod> = {}
  const tags = new Set<string>()

  for (const meta of ctx.registry.listProcedures()) {
    const handlerSchema = ctx.schemaRegistry?.get(meta.name)
    const namespace = groupByNamespace ? extractNamespace(meta.name) : undefined

    if (namespace) {
      tags.add(namespace)
    }

    methods[meta.name] = createMethod(
      meta,
      handlerSchema,
      schemaRegistry,
      namespace ? [namespace] : undefined,
      defaultSecurity
    )
  }

  return {
    jsonrpc: {
      endpoint,
      version,
      contentTypes,
      methods: Object.keys(methods).length > 0 ? methods : undefined,
      batch,
    },
    schemas: schemaRegistry.toObject(),
    tags,
  }
}

/**
 * Create JSON-RPC method definition
 */
function createMethod(
  meta: HandlerMeta,
  handlerSchema: HandlerSchema | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
  tags: string[] | undefined,
  defaultSecurity?: Array<Record<string, string[]>>
): USDJsonRpcMethod {
  const method: USDJsonRpcMethod = {}
  const resolvedContentTypes = resolveContentTypes(meta)

  if (meta.description || meta.summary) {
    method.description = meta.description ?? meta.summary
  }

  if (tags && tags.length > 0) {
    method.tags = tags
  }

  if (handlerSchema?.input) {
    const schemaName = generateSchemaName(meta.name, 'Input')
    schemaRegistry.add(schemaName, handlerSchema.input)
    method.params = createRef(schemaName)
  } else {
    method.params = { type: 'object' }
  }

  if (handlerSchema?.output) {
    const schemaName = generateSchemaName(meta.name, 'Output')
    schemaRegistry.add(schemaName, handlerSchema.output)
    method.result = createRef(schemaName)
  } else {
    method.result = { type: 'object' }
  }

  if (defaultSecurity) {
    method.security = defaultSecurity
  }

  if (resolvedContentTypes) {
    method.contentTypes = resolvedContentTypes
  }

  if (meta.jsonrpc?.streaming) {
    method['x-usd-streaming'] = true
  }

  if (meta.jsonrpc?.notification) {
    method['x-usd-notification'] = true
  }

  const errors = convertJsonRpcErrors(meta, schemaRegistry)
  if (errors.length > 0) {
    method.errors = errors
  }

  return method
}

/**
 * Extract namespace from handler name
 */
function extractNamespace(name: string): string | undefined {
  const parts = name.split('.')
  if (parts.length > 1) {
    return parts[0]
  }
  return undefined
}

function convertJsonRpcErrors(
  meta: HandlerMeta,
  schemaRegistry: ConvertedSchemaRegistry
): USDJsonRpcError[] {
  const errors = meta.jsonrpc?.errors ?? []
  if (errors.length === 0) return []

  return errors.map((err, index) => {
    const definition: USDJsonRpcError = {
      code: err.code,
      message: err.message,
      description: err.description,
    }

    if (err.dataSchema) {
      const schemaName = generateSchemaName(meta.name, `Error${index + 1}Data`)
      schemaRegistry.add(schemaName, err.dataSchema)
      definition.data = createRef(schemaName)
    }

    return definition
  })
}
