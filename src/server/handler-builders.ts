/**
 * Handler Builders for Server
 *
 * Fluent builder functions for registering procedures, streams, events, and groups.
 */

import type { z } from 'zod'
import type { Registry } from '../core/registry.js'
import type { Interceptor, StreamDirection, JsonRpcMeta, GrpcMeta } from '../types/index.js'
import { createValidationInterceptor } from '../validation/index.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
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
}

/**
 * Create a procedure builder for fluent registration
 */
export function createProcedureBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  name: string,
  inheritedInterceptors: Interceptor[] = [],
  globalHooksResolver?: ProcedureBuilderOptions['globalHooksResolver']
): ProcedureBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let summary: string | undefined
  let description: string | undefined
  let procedureTags: string[] | undefined
  let graphqlMeta: { type: 'query' | 'mutation' } | undefined
  let httpPath: string | undefined
  let httpMethod: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined
  let jsonrpcMeta: JsonRpcMeta | undefined
  let grpcMeta: GrpcMeta | undefined
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
    http(path, method = 'POST') {
      httpPath = path
      httpMethod = method
      return builder
    },
    use(interceptor) {
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
      // Register schema
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema
      if (Object.keys(schema).length > 0) {
        schemaRegistry.register(name, schema)
        interceptors.unshift(createValidationInterceptor(schema))
      }

      // Resolve global hooks for this procedure
      const globalHooks = globalHooksResolver ? globalHooksResolver(name) : { before: [], after: [], error: [] }

      // Combine hooks: global first, then local
      const allBeforeHooks = [...globalHooks.before, ...beforeHooks]
      const allAfterHooks = [...globalHooks.after, ...afterHooks]
      const allErrorHooks = [...globalHooks.error, ...errorHooks]

      // If no hooks defined, use original handler
      if (allBeforeHooks.length === 0 && allAfterHooks.length === 0 && allErrorHooks.length === 0) {
        registry.procedure(name, fn, {
          summary,
          description,
          tags: procedureTags,
          graphql: graphqlMeta,
          httpPath,
          httpMethod,
          jsonrpc: jsonrpcMeta,
          grpc: grpcMeta,
          interceptors: interceptors.length > 0 ? interceptors : undefined,
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

      registry.procedure(name, wrappedHandler, {
        summary,
        description,
        tags: procedureTags,
        graphql: graphqlMeta,
        httpPath,
        httpMethod,
        jsonrpc: jsonrpcMeta,
        grpc: grpcMeta,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
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
  let description: string | undefined
  let direction: StreamDirection | undefined
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
    description(desc) {
      description = desc
      return builder
    },
    direction(dir) {
      direction = dir
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
      if (Object.keys(schema).length > 0) {
        schemaRegistry.register(name, schema)
      }

      registry.stream(name, fn, {
        description,
        direction,
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
  let deliveryGuarantee: 'best-effort' | 'at-least-once' | 'at-most-once' | undefined
  let retryPolicy: any
  let deduplicationWindow: number | undefined
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
    handler(fn) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (Object.keys(schema).length > 0) {
        schemaRegistry.register(name, schema)
      }

      // Cast to EventHandler since the types are compatible (ack optional vs required)
      registry.event(name, fn as any, {
        description,
        delivery: deliveryGuarantee,
        retryPolicy,
        deduplicationWindow,
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
  globalHooksResolver?: ProcedureBuilderOptions['globalHooksResolver']
): GroupBuilder {
  const groupInterceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: GroupBuilder = {
    use(interceptor) {
      groupInterceptors.push(interceptor)
      return builder
    },
    procedure(name) {
      const fullName = prefix ? `${prefix}.${name}` : name
      return createProcedureBuilder(registry, schemaRegistry, fullName, groupInterceptors, globalHooksResolver)
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
      return createGroupBuilder(registry, schemaRegistry, nestedPrefix, groupInterceptors, globalHooksResolver)
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
