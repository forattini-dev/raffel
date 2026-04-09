/**
 * Registry Bridge — Procedure → MCP Tool Conversion
 *
 * Introspects a Raffel Registry + SchemaRegistry and registers every
 * procedure as an MCP tool on a McpProtocolHandler. Calls flow through
 * the Router (full interceptor chain: auth, rate-limit, logging, etc.).
 */

import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry } from '../../validation/schema.js'
import type { Router } from '../../core/router.js'
import type { HandlerMeta } from '../../types/handlers.js'
import type { Envelope, ErrorPayload } from '../../types/envelope.js'
import { createContext } from '../../types/context.js'
import { normalizeSchemaDescriptor } from '../../validation/descriptor.js'
import { sid } from '../../utils/id/index.js'
import type { McpProtocolHandler } from './protocol.js'
import type { McpToolAnnotations, McpCallContext, JsonSchema } from './types.js'
import { mcpJson, mcpError } from './response-helpers.js'

export interface RegistryBridgeOptions {
  /** The Raffel Router — tool calls are dispatched through it */
  router: Router

  /** Filter which procedures become MCP tools */
  filter?: (meta: HandlerMeta) => boolean

  /** Transform procedure name to MCP tool name (default: dots → underscores) */
  toolName?: (procedureName: string) => string

  /** Validator type hint for schema conversion */
  validator?: string
}

const DEFAULT_TOOL_NAME = (name: string): string => name.replace(/\./g, '_')

/**
 * Derive tool annotations from procedure metadata.
 */
function deriveAnnotations(meta: HandlerMeta): McpToolAnnotations | undefined {
  const name = meta.name.toLowerCase()
  const method = meta.httpMethod?.toUpperCase()

  const readOnly = method === 'GET'
    || name.startsWith('get.')
    || name.startsWith('get_')
    || name.startsWith('list.')
    || name.startsWith('list_')
    || name.startsWith('find.')
    || name.startsWith('find_')
    || name.startsWith('search.')
    || name.startsWith('search_')

  const destructive = method === 'DELETE'
    || name.startsWith('delete.')
    || name.startsWith('delete_')
    || name.startsWith('remove.')
    || name.startsWith('remove_')
    || name.startsWith('destroy.')
    || name.startsWith('destroy_')

  const idempotent = method === 'GET' || method === 'PUT' || method === 'DELETE'

  if (!readOnly && !destructive && !idempotent) return undefined

  return {
    ...(readOnly ? { readOnlyHint: true } : {}),
    ...(destructive ? { destructiveHint: true } : {}),
    ...(idempotent ? { idempotentHint: true } : {}),
  }
}

/**
 * Convert a registry schema to MCP-compatible JSON Schema.
 */
function convertSchema(
  schemaRegistry: SchemaRegistry,
  procedureName: string,
  validator?: string
): JsonSchema {
  const handlerSchema = schemaRegistry.get(procedureName)
  if (!handlerSchema?.input) {
    return { type: 'object' }
  }

  const descriptor = normalizeSchemaDescriptor(handlerSchema.input, {
    validator: validator ?? handlerSchema.validator,
  })

  return descriptor.jsonSchema as JsonSchema
}

/**
 * Register all procedures from a Registry as MCP tools on the protocol handler.
 */
export function bridgeRegistry(
  handler: McpProtocolHandler,
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  options: RegistryBridgeOptions
): void {
  const { router, filter, validator } = options
  const toolNameFn = options.toolName ?? DEFAULT_TOOL_NAME

  const procedures = registry.listProcedures()

  for (const meta of procedures) {
    if (filter && !filter(meta)) continue

    const toolName = toolNameFn(meta.name)
    const inputSchema = convertSchema(schemaRegistry, meta.name, validator)
    const annotations = deriveAnnotations(meta)
    const description = meta.summary || meta.description || `Procedure: ${meta.name}`

    handler.registerTool({
      name: toolName,
      description,
      // Pass the JSON Schema directly — no Zod needed for bridged tools
      input: inputSchema,
      annotations,
      handler: createRouterHandler(router, meta.name),
    })
  }
}

/**
 * Create an MCP tool handler that dispatches through the Raffel Router.
 * The call goes through the full interceptor chain (auth, rate-limit, etc.).
 */
function createRouterHandler(
  router: Router,
  procedureName: string
): (args: Record<string, unknown>, ctx: McpCallContext) => Promise<import('./types.js').McpToolResult> {
  return async (args, mcpCtx) => {
    const requestId = sid()
    const context = createContext(requestId, {
      signal: mcpCtx.signal,
      protocol: 'internal',
      input: { body: args },
    })

    // Expose ctx.call for inter-procedure calls
    context.call = async (proc, input) => {
      const nestedId = sid()
      const nestedCtx = createContext(nestedId, {
        signal: mcpCtx.signal,
        protocol: 'internal',
        input: { body: input },
      })
      const nestedEnvelope: Envelope = {
        id: nestedId,
        procedure: proc,
        type: 'request',
        payload: input,
        metadata: {},
        context: nestedCtx,
      }
      const result = await router.handle(nestedEnvelope) as Envelope
      if (result.type === 'error') {
        const errPayload = result.payload as ErrorPayload
        throw new Error(errPayload.message)
      }
      return result.payload as never
    }

    const envelope: Envelope = {
      id: requestId,
      procedure: procedureName,
      type: 'request',
      payload: args,
      metadata: {},
      context,
    }

    try {
      const result = await router.handle(envelope) as Envelope

      if (result.type === 'error') {
        const errPayload = result.payload as ErrorPayload
        return mcpError(errPayload.message, {
          code: errPayload.code,
          status: errPayload.status,
          details: errPayload.details,
        })
      }

      return mcpJson(result.payload)
    } catch (error) {
      return mcpError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      )
    }
  }
}
