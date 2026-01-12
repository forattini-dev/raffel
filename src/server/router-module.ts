/**
 * Router Module
 *
 * Reusable route bundles with prefix composition and module-level interceptors.
 */

import type { z } from 'zod'
import type {
  Interceptor,
  ProcedureHandler,
  StreamHandler,
  EventHandler,
  DeliveryGuarantee,
  RetryPolicy,
  StreamDirection,
  JsonRpcMeta,
  GrpcMeta,
} from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import type {
  ProcedureBuilder,
  StreamBuilder,
  EventBuilder,
  RouterModule,
  BeforeHook,
  AfterHook,
  ErrorHook,
} from './types.js'

type ModuleRouteKind = 'procedure' | 'stream' | 'event'

export interface ModuleRoute {
  kind: ModuleRouteKind
  name: string
  handler: ProcedureHandler | StreamHandler | EventHandler
  /** Short summary for OpenAPI (one-liner) */
  summary?: string
  /** Description for OpenAPI (supports markdown) */
  description?: string
  /** Tags for OpenAPI grouping */
  tags?: string[]
  /** HTTP path override for procedures */
  httpPath?: string
  /** HTTP method override for procedures */
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  /** JSON-RPC metadata for USD generation */
  jsonrpc?: JsonRpcMeta
  /** gRPC metadata for USD generation */
  grpc?: GrpcMeta
  moduleInterceptors: Interceptor[]
  interceptors: Interceptor[]
  schema?: HandlerSchema
  streamDirection?: StreamDirection
  delivery?: DeliveryGuarantee
  retryPolicy?: RetryPolicy
  deduplicationWindow?: number
  /** Procedure hooks (only for procedure kind) */
  beforeHooks?: BeforeHook<any>[]
  afterHooks?: AfterHook<any, any>[]
  errorHooks?: ErrorHook<any>[]
  /** GraphQL mapping (only for procedure kind) */
  graphql?: { type: 'query' | 'mutation' }
}

export interface RouterModuleDefinition {
  routes: ModuleRoute[]
}

const MODULE_DEF = Symbol('raffel.router-module')

interface RouterModuleInternal extends RouterModule {
  [MODULE_DEF]: RouterModuleDefinition
}

function buildName(prefix: string, name: string): string {
  if (!prefix) return name
  if (!name) return prefix
  return `${prefix}.${name}`
}

function createProcedureBuilder(
  definition: RouterModuleDefinition,
  name: string,
  moduleInterceptors: Interceptor[]
): ProcedureBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let summary: string | undefined
  let description: string | undefined
  let procedureTags: string[] | undefined
  let httpPath: string | undefined
  let httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | undefined
  const interceptors: Interceptor[] = []
  const beforeHooks: BeforeHook<any>[] = []
  const afterHooks: AfterHook<any, any>[] = []
  const errorHooks: ErrorHook<any>[] = []

  let graphqlMeta: { type: 'query' | 'mutation' } | undefined
  let jsonrpcMeta: JsonRpcMeta | undefined
  let grpcMeta: GrpcMeta | undefined

  const builder: ProcedureBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as ProcedureBuilder<z.infer<typeof schema>, unknown>
    },
    output(schema) {
      outputSchema = schema
      return builder as ProcedureBuilder<unknown, z.infer<typeof schema>>
    },
    summary(sum) {
      summary = sum
      return builder
    },
    tags(tagsArr) {
      procedureTags = tagsArr
      return builder
    },
    description(desc) {
      description = desc
      return builder
    },
    http(path, method) {
      httpPath = path
      httpMethod = method
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    graphql(type) {
      graphqlMeta = { type }
      return builder
    },
    jsonrpc(meta) {
      jsonrpcMeta = meta
      return builder
    },
    grpc(meta) {
      grpcMeta = meta
      return builder
    },
    before(hook) {
      beforeHooks.push(hook)
      return builder
    },
    after(hook) {
      afterHooks.push(hook)
      return builder
    },
    error(hook) {
      errorHooks.push(hook)
      return builder
    },
    handler(fn) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema

      definition.routes.push({
        kind: 'procedure',
        name,
        handler: fn as ProcedureHandler,
        summary,
        description,
        tags: procedureTags,
        httpPath,
        httpMethod,
        jsonrpc: jsonrpcMeta,
        grpc: grpcMeta,
        moduleInterceptors: [...moduleInterceptors],
        interceptors: [...interceptors],
        schema: schema.input || schema.output ? schema : undefined,
        beforeHooks: beforeHooks.length > 0 ? [...beforeHooks] : undefined,
        afterHooks: afterHooks.length > 0 ? [...afterHooks] : undefined,
        errorHooks: errorHooks.length > 0 ? [...errorHooks] : undefined,
        graphql: graphqlMeta,
      })
    },
  }

  return builder
}

function createStreamBuilder(
  definition: RouterModuleDefinition,
  name: string,
  moduleInterceptors: Interceptor[]
): StreamBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let description: string | undefined
  let streamDirection: StreamDirection | undefined
  const interceptors: Interceptor[] = []

  const builder: StreamBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as StreamBuilder<z.infer<typeof schema>, unknown>
    },
    output(schema) {
      outputSchema = schema
      return builder as StreamBuilder<unknown, z.infer<typeof schema>>
    },
    direction(direction) {
      streamDirection = direction
      return builder
    },
    description(desc) {
      description = desc
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    handler(fn) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema

      definition.routes.push({
        kind: 'stream',
        name,
        handler: fn as StreamHandler,
        description,
        moduleInterceptors: [...moduleInterceptors],
        interceptors: [...interceptors],
        schema: schema.input || schema.output ? schema : undefined,
        streamDirection,
      })
    },
  }

  return builder
}

function createEventBuilder(
  definition: RouterModuleDefinition,
  name: string,
  moduleInterceptors: Interceptor[]
): EventBuilder {
  let inputSchema: z.ZodType | undefined
  let description: string | undefined
  let deliveryGuarantee: DeliveryGuarantee = 'best-effort'
  let retryPolicy: RetryPolicy | undefined
  let deduplicationWindow: number | undefined
  const interceptors: Interceptor[] = []

  const builder: EventBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as EventBuilder<z.infer<typeof schema>>
    },
    description(desc) {
      description = desc
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    delivery(guarantee) {
      deliveryGuarantee = guarantee
      return builder
    },
    retryPolicy(policy) {
      retryPolicy = policy
      return builder
    },
    deduplicationWindow(ms) {
      deduplicationWindow = ms
      return builder
    },
    handler(fn) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema

      definition.routes.push({
        kind: 'event',
        name,
        handler: fn as EventHandler,
        description,
        moduleInterceptors: [...moduleInterceptors],
        interceptors: [...interceptors],
        schema: schema.input ? schema : undefined,
        delivery: deliveryGuarantee,
        retryPolicy,
        deduplicationWindow,
      })
    },
  }

  return builder
}

function createModuleView(
  definition: RouterModuleDefinition,
  prefix: string,
  inheritedInterceptors: Interceptor[]
): RouterModuleInternal {
  const moduleInterceptors: Interceptor[] = [...inheritedInterceptors]

  const module: RouterModuleInternal = {
    use(interceptor) {
      moduleInterceptors.push(interceptor)
      return module
    },
    procedure(name) {
      const fullName = buildName(prefix, name)
      return createProcedureBuilder(definition, fullName, [...moduleInterceptors])
    },
    stream(name) {
      const fullName = buildName(prefix, name)
      return createStreamBuilder(definition, fullName, [...moduleInterceptors])
    },
    event(name) {
      const fullName = buildName(prefix, name)
      return createEventBuilder(definition, fullName, [...moduleInterceptors])
    },
    group(subPrefix) {
      const fullPrefix = buildName(prefix, subPrefix)
      return createModuleView(definition, fullPrefix, [...moduleInterceptors])
    },
    [MODULE_DEF]: definition,
  }

  return module
}

export function createRouterModule(prefix = ''): RouterModule {
  const definition: RouterModuleDefinition = { routes: [] }
  return createModuleView(definition, prefix, [])
}

export function getRouterModuleDefinition(module: RouterModule): RouterModuleDefinition {
  const internal = module as RouterModuleInternal
  const definition = internal[MODULE_DEF]
  if (!definition) {
    throw new Error('Invalid RouterModule instance')
  }
  return definition
}
