import type { z } from 'zod'

import type { Registry } from '../../core/registry.js'
import type { HandlerSchema, SchemaRegistry } from '../../validation/index.js'
import type { Interceptor, ProcedureHandler } from '../../types/index.js'
import type { ContractPolicies } from '../../types/index.js'
import type { AddProcedureInput } from '../types.js'
import type { RuntimeInspectionOperationRegistration } from '../../inspect/index.js'
import type { RuntimeInspectionSource } from '../../inspect/index.js'

export interface ProcedureOperationInput {
  name: string
  handler: ProcedureHandler
  inputSchema?: z.ZodType
  outputSchema?: z.ZodType
  summary?: string
  description?: string
  tags?: string[]
  graphql?: AddProcedureInput['graphql']
  httpPath?: AddProcedureInput['httpPath']
  httpMethod?: AddProcedureInput['httpMethod']
  jsonrpc?: AddProcedureInput['jsonrpc']
  grpc?: AddProcedureInput['grpc']
  policies?: ContractPolicies
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
}): (operation: ProcedureOperationInput) => void {
  const {
    globalInterceptors,
    registry,
    schemaRegistry,
    normalizeInterceptors,
    recordOperationRegistration,
    programmaticSource,
  } = input

  return (operation) => {
    const {
      name,
      handler,
      inputSchema,
      outputSchema,
      summary,
      description,
      tags,
      graphql,
      httpPath,
      httpMethod,
      jsonrpc,
      grpc,
      policies,
      interceptors = [],
      registration = { source: programmaticSource() },
    } = operation

    let normalizedInterceptors = normalizeInterceptors([...globalInterceptors, ...interceptors])

    if (inputSchema || outputSchema) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema
      schemaRegistry.register(name, schema)
      normalizedInterceptors = normalizeInterceptors(normalizedInterceptors, schema)
    }

    registry.procedure(name, handler, {
      summary,
      description,
      tags,
      graphql,
      httpPath,
      httpMethod,
      jsonrpc,
      grpc,
      policies,
      interceptors: normalizedInterceptors.length > 0 ? normalizedInterceptors : undefined,
    })
    recordOperationRegistration(name, registration)
  }
}
