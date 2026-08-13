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
  StreamOperationalControls,
  JsonRpcMeta,
  GrpcMeta,
  ContractPolicies,
} from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import type { RouteCacheConfig } from '../cache/server-runtime.js'
import { createProcedureBuilder } from './handler-builders.js'
import { mergeContractPolicies } from '../types/policies.js'
import type {
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
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Authorization policy config (synthesized at server.mount time). */
  authz?: import('../middleware/policy/types.js').ProcedurePolicyConfig
  /** Response cache override, applied by the host server at mount time. */
  cache?: RouteCacheConfig | false
  moduleInterceptors: Interceptor[]
  interceptors: Interceptor[]
  schema?: HandlerSchema
  streamDirection?: StreamDirection
  streamControls?: StreamOperationalControls
  delivery?: DeliveryGuarantee
  retryPolicy?: RetryPolicy
  deduplicationWindow?: number
  /** Procedure hooks (only for procedure kind) */
  beforeHooks?: BeforeHook<any>[]
  afterHooks?: AfterHook<any, any>[]
  errorHooks?: ErrorHook<any>[]
  /** GraphQL mapping (only for procedure kind) */
  graphql?: import('../types/index.js').GraphQLMeta
}

export interface RouterModuleDefinition {
  routes: ModuleRoute[]
  /** Module-level authz default — applied to procedures without `.authz()`. */
  defaultAuthz?: import('../middleware/policy/types.js').ProcedurePolicyConfig
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

function createStreamBuilder(
  definition: RouterModuleDefinition,
  name: string,
  moduleInterceptors: Interceptor[]
): StreamBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let description: string | undefined
  let streamDirection: StreamDirection | undefined
  let streamControls: StreamOperationalControls | undefined
  let policies: ContractPolicies | undefined
  let graphql: import('../types/index.js').GraphQLMeta | undefined
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
    controls(controls) {
      streamControls = controls
      return builder
    },
    description(desc) {
      description = desc
      return builder
    },
    graphql(config = 'subscription') {
      graphql = typeof config === 'string' ? { type: config } : config
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    policy(policyMeta) {
      policies = mergeContractPolicies(policies, policyMeta)
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
        policies,
        schema: schema.input || schema.output ? schema : undefined,
        streamDirection,
        streamControls,
        graphql,
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
  let policies: ContractPolicies | undefined
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
    policy(policyMeta) {
      policies = mergeContractPolicies(policies, policyMeta)
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
        policies,
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
      return createProcedureBuilder(
        undefined,
        undefined,
        fullName,
        [],
        undefined,
        undefined,
        (procedureName, handler, registration) => {
          definition.routes.push({
            kind: 'procedure',
            name: procedureName,
            handler: handler as ProcedureHandler,
            summary: registration.summary,
            description: registration.description,
            tags: registration.tags,
            httpPath: registration.httpPath,
            httpMethod: registration.httpMethod,
            jsonrpc: registration.jsonrpc,
            grpc: registration.grpc,
            policies: registration.policies,
            authz: registration.authz ?? definition.defaultAuthz,
            cache: registration.cache,
            moduleInterceptors: [...moduleInterceptors],
            interceptors:
              registration.interceptors.length > 0 ? [...registration.interceptors] : [],
            schema: registration.schema?.input || registration.schema?.output ? registration.schema : undefined,
            beforeHooks: registration.beforeHooks?.length ? [...registration.beforeHooks] : undefined,
            afterHooks: registration.afterHooks?.length ? [...registration.afterHooks] : undefined,
            errorHooks: registration.errorHooks?.length ? [...registration.errorHooks] : undefined,
            graphql: registration.graphql,
          })
        },
        undefined, // policyInterceptorFactory — not used in lazy mode
        undefined, // policyDefaultMode
        undefined, // noPolicyDeclaredFactory
        true,      // lazyAuthz: store config on registration, mount synthesizes
      )
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

export interface CreateRouterModuleOptions {
  /**
   * Module-level authorization defaults. Applied to procedures within this
   * module that did NOT call `.authz()` themselves. Per-procedure `.authz()`
   * always wins.
   */
  authz?: import('../middleware/policy/types.js').ProcedurePolicyConfig
}

export function createRouterModule(
  prefix = '',
  options: CreateRouterModuleOptions = {},
): RouterModule {
  const definition: RouterModuleDefinition = {
    routes: [],
    defaultAuthz: options.authz,
  }
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
