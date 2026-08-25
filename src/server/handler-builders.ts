/**
 * Handler Builders for Server
 *
 * Fluent builder functions for registering procedures, streams, events, and groups.
 */

import type { z } from 'zod'
import type { Registry } from '../core/registry.js'
import type {
  Interceptor,
  StreamDirection,
  JsonRpcMeta,
  GrpcMeta,
  GraphQLMeta,
  ContractPolicies,
  HandlerDocumentationMeta,
} from '../types/index.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import { mergeContractPolicies } from '../types/policies.js'
import { normalizeInterceptors } from './interceptor-utils.js'
import { createSourceBackedStreamHandler } from '../stream/resumable.js'
import type { ProcedurePolicyConfig } from '../middleware/policy/types.js'
import type { RouteCacheConfig } from '../cache/server-runtime.js'
import type {
  ProcedureBuilder,
  StreamBuilder,
  EventBuilder,
  GroupBuilder,
  BeforeHook,
  AfterHook,
  ErrorHook,
} from './types.js'

/**
 * Options for procedure builder with hooks support
 */
export interface ProcedureBuilderOptions {
  registry: Registry
  schemaRegistry: SchemaRegistry
  name: string
  inheritedInterceptors?: Interceptor[]
  globalHooksResolver?: (name: string) => {
    before: BeforeHook<any>[]
    after: AfterHook<any, any>[]
    error: ErrorHook<any>[]
  }
  /**
   * Synthesize the policy interceptor for this procedure when `.authz()` is
   * called. Provided by the server bootstrap when `policy: { ... }` is
   * configured on `createServer`. Absent → `.authz()` throws at registration.
   */
  policyInterceptorFactory?: (
    procedureName: string,
    config: ProcedurePolicyConfig
  ) => Interceptor
  /**
   * Server-level `policy.defaultMode`. When `'deny'`, procedures that did not
   * call `.authz()` (and did not opt out via `.authz({ public: true })`)
   * receive a "no-policy-declared" deny interceptor at registration.
   */
  policyDefaultMode?: 'allow' | 'deny'
  /**
   * Synthesize a "no-policy-declared" deny interceptor for procedures that
   * skipped `.authz()` under `defaultMode: 'deny'`.
   */
  noPolicyDeclaredFactory?: (procedureName: string) => Interceptor
}

export interface ProcedureRegistrationMeta {
  summary?: string
  description?: string
  tags?: string[]
  docs?: HandlerDocumentationMeta
  graphql?: GraphQLMeta
  httpPath?: string
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  longPoll?: import('../types/index.js').LongPollContract
  jsonrpc?: JsonRpcMeta
  grpc?: GrpcMeta
  policies?: ContractPolicies
  authz?: ProcedurePolicyConfig
  cache?: RouteCacheConfig | false
  interceptors: Interceptor[]
  schema?: HandlerSchema
  beforeHooks?: BeforeHook<any>[]
  afterHooks?: AfterHook<any, any>[]
  errorHooks?: ErrorHook<any>[]
}

export type ProcedureRegistration = (
  name: string,
  handler: (input: unknown, ctx: any) => any,
  registration: ProcedureRegistrationMeta
) => void

/**
 * Create a procedure builder for fluent registration
 */
export function createProcedureBuilder(
  registry: Registry | undefined,
  schemaRegistry: SchemaRegistry | undefined,
  name: string,
  inheritedInterceptors: Interceptor[] = [],
  globalHooksResolver?: ProcedureBuilderOptions['globalHooksResolver'],
  envelopeInterceptor?: Interceptor,
  registerProcedure: ProcedureRegistration = (procedureName, handler, registration) => {
    if (!registry) {
      throw new Error('createProcedureBuilder requires a registry unless a custom registerProcedure is provided')
    }
    registry.procedure(procedureName, handler as any, {
      summary: registration.summary,
      description: registration.description,
      tags: registration.tags,
      docs: registration.docs,
      graphql: registration.graphql,
      httpPath: registration.httpPath,
      httpMethod: registration.httpMethod,
      longPoll: registration.longPoll,
      jsonrpc: registration.jsonrpc,
      grpc: registration.grpc,
      policies: registration.policies,
      interceptors: registration.interceptors,
    })
  },
  policyInterceptorFactory?: ProcedureBuilderOptions['policyInterceptorFactory'],
  policyDefaultMode?: 'allow' | 'deny',
  noPolicyDeclaredFactory?: (procedureName: string) => Interceptor,
  /**
   * When true, `.authz()` stores config on registration meta only (no interceptor
   * pushed). Used by router-module so server.mount() can synthesize the real
   * interceptor with the host server's factory and defaultMode.
   */
  lazyAuthz = false
): ProcedureBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let summary: string | undefined
  let description: string | undefined
  let procedureTags: string[] | undefined
  let docsMeta: HandlerDocumentationMeta | undefined
  let graphqlMeta: GraphQLMeta | undefined
  let httpPath: string | undefined
  let httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined
  let longPoll: import('../types/index.js').LongPollContract | undefined
  let jsonrpcMeta: JsonRpcMeta | undefined
  let grpcMeta: GrpcMeta | undefined
  let policies: ContractPolicies | undefined
  let authzConfig: ProcedurePolicyConfig | undefined
  let cacheConfig: RouteCacheConfig | false | undefined
  const interceptors: Interceptor[] = [...inheritedInterceptors]

  // Local hooks (procedure-specific)
  const beforeHooks: BeforeHook<any>[] = []
  const afterHooks: AfterHook<any, any>[] = []
  const errorHooks: ErrorHook<any>[] = []

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
    description(desc) {
      description = desc
      return builder
    },
    tags(tagsArr) {
      procedureTags = tagsArr
      return builder
    },
    docs(meta) {
      docsMeta = meta
      return builder
    },
    graphql(config) {
      graphqlMeta = typeof config === 'string' ? { type: config } : config
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
    http(path, method = 'POST') {
      httpPath = path
      httpMethod = method
      return builder
    },
    longPoll(contract) {
      longPoll = contract
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    cache(config = {}) {
      cacheConfig = config === false ? false : { enabled: true, ...config }
      return builder
    },
    policy(policyMeta) {
      policies = mergeContractPolicies(policies, policyMeta)
      return builder
    },
    authz(config) {
      if (authzConfig) {
        throw new Error(
          `procedure '${name}': .authz() may only be called once per procedure.`,
        )
      }
      authzConfig = config as ProcedurePolicyConfig
      if (lazyAuthz) {
        // Module-builder mode: server.mount() synthesizes the interceptor.
        return builder
      }
      if (!policyInterceptorFactory) {
        throw new Error(
          `procedure '${name}': .authz() requires \`policy: { ... }\` on createServer().`,
        )
      }
      const interceptor = policyInterceptorFactory(name, authzConfig)
      interceptors.push(interceptor)
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
      // Default-deny: procedures that did not declare .authz() get a
      // "no-policy-declared" deny interceptor injected at the front.
      if (
        policyDefaultMode === 'deny' &&
        !authzConfig &&
        noPolicyDeclaredFactory
      ) {
        interceptors.unshift(noPolicyDeclaredFactory(name))
      }
      const hasSchema = inputSchema || outputSchema

      // Register schema
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema
      if (schema.input || schema.output) {
        if (schemaRegistry) {
          schemaRegistry.register(name, schema)
        }
      }

      const normalizedInterceptors = normalizeInterceptors(
        [...interceptors],
        { envelopeInterceptor, schema: hasSchema ? schema : undefined }
      )

      // Resolve global hooks for this procedure
      const globalHooks = globalHooksResolver ? globalHooksResolver(name) : { before: [], after: [], error: [] }

      // Combine hooks: global first, then local
      const allBeforeHooks = [...globalHooks.before, ...beforeHooks]
      const allAfterHooks = [...globalHooks.after, ...afterHooks]
      const allErrorHooks = [...globalHooks.error, ...errorHooks]

      // If no hooks defined, use original handler
      if (allBeforeHooks.length === 0 && allAfterHooks.length === 0 && allErrorHooks.length === 0) {
        registerProcedure(name, fn as any, {
          summary,
          description,
          tags: procedureTags,
          docs: docsMeta,
          graphql: graphqlMeta,
          httpPath,
          httpMethod,
          longPoll,
          jsonrpc: jsonrpcMeta,
          grpc: grpcMeta,
          policies,
          authz: authzConfig,
          cache: cacheConfig,
          interceptors: normalizedInterceptors,
          schema: hasSchema ? schema : undefined,
        })
        return
      }

      // Wrap handler with hooks
      const wrappedHandler = async (input: any, ctx: any) => {
        // Run before hooks
        for (const hook of allBeforeHooks) {
          await hook(input, ctx)
        }

        let result: any
        try {
          result = await fn(input, ctx)
        } catch (error: any) {
          // Run error hooks
          for (const hook of allErrorHooks) {
            const recovered = await hook(input, ctx, error)
            if (recovered !== undefined) {
              return recovered
            }
          }
          throw error
        }

        // Run after hooks
        for (const hook of allAfterHooks) {
          const updated = await hook(input, ctx, result)
          if (updated !== undefined) {
            result = updated
          }
        }

        return result
      }

      registerProcedure(name, wrappedHandler as any, {
        summary,
        description,
        tags: procedureTags,
        docs: docsMeta,
        graphql: graphqlMeta,
        httpPath,
        httpMethod,
        longPoll,
        jsonrpc: jsonrpcMeta,
        grpc: grpcMeta,
        policies,
        cache: cacheConfig,
        interceptors: normalizedInterceptors,
        schema: hasSchema ? schema : undefined,
        beforeHooks: allBeforeHooks,
        afterHooks: allAfterHooks,
        errorHooks: allErrorHooks,
      })
    },
  }

  return builder
}

/**
 * Create a stream builder for fluent registration
 */
export function createStreamBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  name: string,
  inheritedInterceptors: Interceptor[] = []
): StreamBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let snapshotSchema: z.ZodType | undefined
  let description: string | undefined
  let docsMeta: HandlerDocumentationMeta | undefined
  let direction: StreamDirection | undefined
  let controls: import('../types/index.js').StreamOperationalControls | undefined
  let graphqlMeta: GraphQLMeta | undefined
  let policies: ContractPolicies | undefined
  const interceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: StreamBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as StreamBuilder<z.infer<typeof schema>, unknown>
    },
    output(schema) {
      outputSchema = schema
      return builder as StreamBuilder<unknown, z.infer<typeof schema>>
    },
    snapshot(schema) {
      snapshotSchema = schema
      return builder
    },
    description(desc) {
      description = desc
      return builder
    },
    docs(meta) {
      docsMeta = meta
      return builder
    },
    graphql(config = 'subscription') {
      graphqlMeta = typeof config === 'string' ? { type: config } : config
      return builder
    },
    direction(dir) {
      direction = dir
      return builder
    },
    controls(config) {
      controls = config
      return builder
    },
    resumable(config) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema
      if (snapshotSchema) schema.snapshot = snapshotSchema
      if (schema.input || schema.output || schema.snapshot) schemaRegistry.register(name, schema)

      registry.stream(name, createSourceBackedStreamHandler(config), {
        description,
        docs: docsMeta,
        direction: 'server',
        controls,
        resumable: config,
        graphql: graphqlMeta,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
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
      if (schema.input || schema.output) {
        schemaRegistry.register(name, schema)
      }

      registry.stream(name, fn, {
        description,
        docs: docsMeta,
        direction,
        controls,
        graphql: graphqlMeta,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },
  }

  return builder
}

/**
 * Create an event builder for fluent registration
 */
export function createEventBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  name: string,
  inheritedInterceptors: Interceptor[] = []
): EventBuilder {
  let inputSchema: z.ZodType | undefined
  let description: string | undefined
  let docsMeta: HandlerDocumentationMeta | undefined
  let deliveryGuarantee: 'best-effort' | 'at-least-once' | 'at-most-once' | undefined
  let retryPolicy: any
  let deduplicationWindow: number | undefined
  let policies: ContractPolicies | undefined
  const interceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: EventBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as EventBuilder<z.infer<typeof schema>>
    },
    description(desc) {
      description = desc
      return builder
    },
    docs(meta) {
      docsMeta = meta
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
      if (schema.input || schema.output) {
        schemaRegistry.register(name, schema)
      }

      // Cast to EventHandler since the types are compatible (ack optional vs required)
      registry.event(name, fn as any, {
        description,
        docs: docsMeta,
        delivery: deliveryGuarantee,
        retryPolicy,
        deduplicationWindow,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },
  }

  return builder
}

/**
 * Create a group builder for organizing related handlers
 */
export function createGroupBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  prefix: string,
  inheritedInterceptors: Interceptor[] = [],
  globalHooksResolver?: ProcedureBuilderOptions['globalHooksResolver'],
  envelopeInterceptor?: Interceptor
): GroupBuilder {
  const groupInterceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: GroupBuilder = {
    use(interceptor) {
      groupInterceptors.push(interceptor)
      return builder
    },
    procedure(name) {
      const fullName = prefix ? `${prefix}.${name}` : name
      return createProcedureBuilder(
        registry,
        schemaRegistry,
        fullName,
        groupInterceptors,
        globalHooksResolver,
        envelopeInterceptor
      )
    },
    stream(name) {
      const fullName = prefix ? `${prefix}.${name}` : name
      return createStreamBuilder(registry, schemaRegistry, fullName, groupInterceptors)
    },
    event(name) {
      const fullName = prefix ? `${prefix}.${name}` : name
      return createEventBuilder(registry, schemaRegistry, fullName, groupInterceptors)
    },
    group(name) {
      const nestedPrefix = prefix ? `${prefix}.${name}` : name
      return createGroupBuilder(
        registry,
        schemaRegistry,
        nestedPrefix,
        groupInterceptors,
        globalHooksResolver,
        envelopeInterceptor
      )
    },
  }

  return builder
}

/**
 * Join handler name with prefix
 */
export function joinHandlerName(prefix: string, name: string): string {
  if (!prefix) return name
  if (!name) return prefix
  return `${prefix}.${name}`
}
