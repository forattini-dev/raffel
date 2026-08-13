import type { z } from 'zod'

import type { Registry } from '../../core/registry.js'
import type { HandlerSchema, SchemaRegistry } from '../../validation/index.js'
import type { Interceptor, ProcedureHandler } from '../../types/index.js'
import type { ContractPolicies } from '../../types/index.js'
import type { AddProcedureInput } from '../types.js'
import type { RuntimeInspectionOperationRegistration } from '../../inspect/index.js'
import type { RuntimeInspectionSource } from '../../inspect/index.js'
import type { RouteCacheConfig } from '../../cache/server-runtime.js'
import { insertCacheInterceptor } from '../interceptor-utils.js'

export interface ProcedureOperationInput {
  name: string
  handler: ProcedureHandler
  inputSchema?: z.ZodType
  outputSchema?: z.ZodType
  documentationOutputSchema?: unknown
  summary?: string
  description?: string
  tags?: string[]
  graphql?: AddProcedureInput['graphql']
  httpPath?: AddProcedureInput['httpPath']
  httpMethod?: AddProcedureInput['httpMethod']
  longPoll?: AddProcedureInput['longPoll']
  httpSuccessStatus?: number
  jsonrpc?: AddProcedureInput['jsonrpc']
  grpc?: AddProcedureInput['grpc']
  policies?: ContractPolicies
  cache?: RouteCacheConfig | false
  interceptors?: Interceptor[]
  registration?: RuntimeInspectionOperationRegistration
}

export function createProcedureOperationRegistrar(input: {
  globalInterceptors: Interceptor[]
  registry: Registry
  schemaRegistry: SchemaRegistry
  normalizeInterceptors: (interceptors: Interceptor[], schema?: HandlerSchema) => Interceptor[]
  recordOperationRegistration: (
    name: string,
    registration: RuntimeInspectionOperationRegistration
  ) => void
  programmaticSource: (kind?: RuntimeInspectionSource['kind']) => RuntimeInspectionSource
  cacheInterceptorFor?: (
    procedureName: string,
    config: RouteCacheConfig | false | undefined,
  ) => Interceptor | undefined
}): (operation: ProcedureOperationInput) => void {
  const {
    globalInterceptors,
    registry,
    schemaRegistry,
    normalizeInterceptors,
    recordOperationRegistration,
    programmaticSource,
    cacheInterceptorFor,
  } = input

  return (operation) => {
    const {
      name,
      handler,
      inputSchema,
      outputSchema,
      documentationOutputSchema,
      summary,
      description,
      tags,
      graphql,
      httpPath,
      httpMethod,
      longPoll,
      httpSuccessStatus,
      jsonrpc,
      grpc,
      policies,
      cache,
      interceptors = [],
      registration = { source: programmaticSource() },
    } = operation

    let normalizedInterceptors = normalizeInterceptors([...globalInterceptors, ...interceptors])

    if (inputSchema || outputSchema || documentationOutputSchema) {
      const registeredSchema: HandlerSchema = {}
      if (inputSchema) registeredSchema.input = inputSchema
      if (outputSchema) registeredSchema.output = outputSchema
      if (!outputSchema && documentationOutputSchema) {
        registeredSchema.documentationOutput = documentationOutputSchema
      }
      schemaRegistry.register(name, registeredSchema)

      if (inputSchema || outputSchema) {
        const validationSchema: HandlerSchema = {}
        if (inputSchema) validationSchema.input = inputSchema
        if (outputSchema) validationSchema.output = outputSchema
        normalizedInterceptors = normalizeInterceptors(normalizedInterceptors, validationSchema)
      }
    }

    const cacheInterceptor = cacheInterceptorFor?.(name, cache)
    if (cacheInterceptor) {
      normalizedInterceptors = insertCacheInterceptor(normalizedInterceptors, cacheInterceptor)
    }

    registry.procedure(name, handler, {
      summary,
      description,
      tags,
      graphql,
      httpPath,
      httpMethod,
      longPoll,
      httpSuccessStatus,
      jsonrpc,
      grpc,
      policies,
      interceptors: normalizedInterceptors.length > 0 ? normalizedInterceptors : undefined,
    })
    recordOperationRegistration(name, registration)
  }
}
