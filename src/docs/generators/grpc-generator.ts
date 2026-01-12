/**
 * gRPC Generator for USD
 *
 * Converts Raffel procedures to USD gRPC specification (x-usd.grpc).
 */

import type { Registry } from '../../core/registry.js'
import type { HandlerMeta } from '../../types/index.js'
import type { SchemaRegistry, HandlerSchema } from '../../validation/index.js'
import type {
  USDGrpc,
  USDGrpcService,
  USDGrpcMethod,
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
 * gRPC generation options
 */
export interface GrpcGeneratorOptions {
  /** Proto package name */
  package?: string
  /** Proto syntax version */
  syntax?: 'proto3' | 'proto2'
  /** Proto file options */
  options?: Record<string, unknown>
  /** Protocol content types */
  contentTypes?: USDContentTypes
  /** Override service/method names for specific procedures */
  serviceNameOverrides?: Record<string, { service: string; method?: string }>
  /** Default service name for procedures without namespace */
  defaultServiceName?: string
}

/**
 * gRPC generation context
 */
export interface GrpcGeneratorContext {
  /** Handler registry */
  registry: Registry
  /** Schema registry for input/output schemas */
  schemaRegistry?: SchemaRegistry
}

/**
 * gRPC generation result
 */
export interface GrpcGeneratorResult {
  /** USD gRPC specification */
  grpc: USDGrpc
  /** Component schemas used */
  schemas: Record<string, USDSchema>
  /** Tags used */
  tags: Set<string>
}

/**
 * Generate USD gRPC specification from registered procedures
 */
export function generateGrpc(
  ctx: GrpcGeneratorContext,
  options: GrpcGeneratorOptions = {}
): GrpcGeneratorResult {
  const {
    package: packageName,
    syntax = 'proto3',
    options: grpcOptions,
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.grpc,
    serviceNameOverrides,
    defaultServiceName = 'Service',
  } = options

  const schemaRegistry = createSchemaRegistry()
  const services: Record<string, USDGrpcService> = {}
  const tags = new Set<string>()

  for (const meta of ctx.registry.listProcedures()) {
    const handlerSchema = ctx.schemaRegistry?.get(meta.name)
    const mapping = resolveServiceAndMethod(meta.name, serviceNameOverrides, defaultServiceName)

    if (!services[mapping.service]) {
      services[mapping.service] = {}
    }

    if (!services[mapping.service].methods) {
      services[mapping.service].methods = {}
    }

    services[mapping.service].methods![mapping.method] = createMethod(
      meta,
      handlerSchema,
      schemaRegistry,
      [mapping.service]
    )

    tags.add(mapping.service)
  }

  return {
    grpc: {
      package: packageName,
      syntax,
      contentTypes,
      services: Object.keys(services).length > 0 ? services : undefined,
      options: grpcOptions,
    },
    schemas: schemaRegistry.toObject(),
    tags,
  }
}

/**
 * Create gRPC method definition
 */
function createMethod(
  meta: HandlerMeta,
  handlerSchema: HandlerSchema | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
  tags: string[] | undefined
): USDGrpcMethod {
  const method: USDGrpcMethod = {
    input: { type: 'object' },
    output: { type: 'object' },
  }
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
    method.input = createRef(schemaName)
  }

  if (handlerSchema?.output) {
    const schemaName = generateSchemaName(meta.name, 'Output')
    schemaRegistry.add(schemaName, handlerSchema.output)
    method.output = createRef(schemaName)
  }

  if (meta.grpc?.clientStreaming) {
    method['x-usd-client-streaming'] = true
  }

  if (meta.grpc?.serverStreaming) {
    method['x-usd-server-streaming'] = true
  }

  if (resolvedContentTypes) {
    method.contentTypes = resolvedContentTypes
  }

  return method
}

function resolveServiceAndMethod(
  name: string,
  overrides: GrpcGeneratorOptions['serviceNameOverrides'],
  defaultServiceName: string
): { service: string; method: string } {
  const override = overrides?.[name]
  if (override) {
    const method = override.method ?? deriveMethodName(name)
    return { service: override.service, method }
  }

  const parts = name.split('.').filter(Boolean)
  if (parts.length > 1) {
    return {
      service: toPascalCase(parts[0]),
      method: toPascalCase(parts.slice(1).join('-')),
    }
  }

  return {
    service: defaultServiceName,
    method: toPascalCase(name),
  }
}

function deriveMethodName(name: string): string {
  const parts = name.split('.').filter(Boolean)
  if (parts.length > 1) {
    return toPascalCase(parts.slice(1).join('-'))
  }
  return toPascalCase(name)
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('')
}
