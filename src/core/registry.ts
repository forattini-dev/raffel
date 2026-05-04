/**
 * Registry - Handler Registration
 *
 * Stores and retrieves handlers for procedures, streams, and events.
 * Provides introspection for adapters to generate schemas/routes.
 */

import type {
  ProcedureHandler,
  StreamHandler,
  EventHandler,
  HandlerMeta,
  RegisteredHandler,
  Interceptor,
  DeliveryGuarantee,
  RetryPolicy,
  StreamDirection,
  GraphQLMeta,
  HttpMethod,
  JsonRpcMeta,
  GrpcMeta,
} from '../types/handlers.js'
import { createPolicyInterceptors } from '../policy/runtime.js'
import type { ContractPolicies } from '../types/policies.js'
import { normalizeContractPolicies } from '../types/policies.js'

/**
 * Procedure registration options
 */
export interface ProcedureOptions {
  summary?: string
  description?: string
  /** Tags for OpenAPI grouping */
  tags?: string[]
  /** Content type shorthand */
  contentType?: string
  /** Content type configuration */
  contentTypes?: { default?: string; supported?: string[] }
  graphql?: GraphQLMeta
  httpPath?: string
  httpMethod?: HttpMethod
  jsonrpc?: JsonRpcMeta
  grpc?: GrpcMeta
  policies?: ContractPolicies
  /**
   * Authorization config — populated by the `.authz()` builder method.
   * Discovery / runtime-preview / MCP read this to surface the gate's
   * action / mode / public / hasResolver. Not used in the hot path.
   */
  authz?: import('../middleware/policy/types.js').ProcedurePolicyConfig
  interceptors?: Interceptor[]
}

/**
 * Stream registration options (low-level registry API)
 */
export interface StreamRegistryOptions {
  description?: string
  direction?: StreamDirection
  /** Content type shorthand */
  contentType?: string
  /** Content type configuration */
  contentTypes?: { default?: string; supported?: string[] }
  policies?: ContractPolicies
  interceptors?: Interceptor[]
}

/**
 * Event registration options
 */
export interface EventOptions {
  description?: string
  delivery?: DeliveryGuarantee
  retryPolicy?: RetryPolicy
  deduplicationWindow?: number
  /** Content type shorthand */
  contentType?: string
  /** Content type configuration */
  contentTypes?: { default?: string; supported?: string[] }
  policies?: ContractPolicies
  interceptors?: Interceptor[]
}

/**
 * Registry interface
 */
export interface Registry {
  // === Registration ===

  /** Register a procedure handler */
  procedure<TInput, TOutput>(
    name: string,
    handler: ProcedureHandler<TInput, TOutput>,
    options?: ProcedureOptions
  ): void

  /** Register a stream handler */
  stream<TInput, TOutput>(
    name: string,
    handler: StreamHandler<TInput, TOutput>,
    options?: StreamRegistryOptions
  ): void

  /** Register an event handler */
  event<TPayload>(
    name: string,
    handler: EventHandler<TPayload>,
    options?: EventOptions
  ): void

  // === Lookup ===

  /** Get a procedure handler by name */
  getProcedure(name: string): RegisteredHandler<ProcedureHandler> | undefined

  /** Get a stream handler by name */
  getStream(name: string): RegisteredHandler<StreamHandler> | undefined

  /** Get an event handler by name */
  getEvent(name: string): RegisteredHandler<EventHandler> | undefined

  /** Check if a handler exists */
  has(name: string): boolean

  // === Introspection ===

  /** List all registered handlers */
  list(): HandlerMeta[]

  /** List procedures only */
  listProcedures(): HandlerMeta[]

  /** List streams only */
  listStreams(): HandlerMeta[]

  /** List events only */
  listEvents(): HandlerMeta[]
}

/**
 * Create a new Registry
 */
export function createRegistry(): Registry {
  const procedures = new Map<string, RegisteredHandler<ProcedureHandler>>()
  const streams = new Map<string, RegisteredHandler<StreamHandler>>()
  const events = new Map<string, RegisteredHandler<EventHandler>>()

  return {
    // === Registration ===

    procedure<TInput, TOutput>(
      name: string,
      handler: ProcedureHandler<TInput, TOutput>,
      options: ProcedureOptions = {}
    ): void {
      if (procedures.has(name) || streams.has(name) || events.has(name)) {
        throw new Error(`Handler '${name}' already registered`)
      }

      const policies = normalizeContractPolicies(options.policies)
      const interceptors = [
        ...createPolicyInterceptors(policies),
        ...(options.interceptors ?? []),
      ]

      procedures.set(name, {
        handler: handler as ProcedureHandler,
        meta: {
          kind: 'procedure',
          name,
          summary: options.summary,
          description: options.description,
          tags: options.tags,
          contentType: options.contentType,
          contentTypes: options.contentTypes,
          graphql: options.graphql,
          httpPath: options.httpPath,
          httpMethod: options.httpMethod,
          jsonrpc: options.jsonrpc,
          grpc: options.grpc,
          policies,
          authz: options.authz,
        },
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },

    stream<TInput, TOutput>(
      name: string,
      handler: StreamHandler<TInput, TOutput>,
      options: StreamRegistryOptions = {}
    ): void {
      if (procedures.has(name) || streams.has(name) || events.has(name)) {
        throw new Error(`Handler '${name}' already registered`)
      }

      const policies = normalizeContractPolicies(options.policies)
      const interceptors = [
        ...createPolicyInterceptors(policies),
        ...(options.interceptors ?? []),
      ]

      streams.set(name, {
        handler: handler as StreamHandler,
        meta: {
          kind: 'stream',
          name,
          description: options.description,
          streamDirection: options.direction ?? 'server',
          contentType: options.contentType,
          contentTypes: options.contentTypes,
          policies,
        },
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },

    event<TPayload>(
      name: string,
      handler: EventHandler<TPayload>,
      options: EventOptions = {}
    ): void {
      if (procedures.has(name) || streams.has(name) || events.has(name)) {
        throw new Error(`Handler '${name}' already registered`)
      }

      const policies = normalizeContractPolicies(options.policies)
      const interceptors = [
        ...createPolicyInterceptors(policies),
        ...(options.interceptors ?? []),
      ]

      events.set(name, {
        handler: handler as EventHandler,
        meta: {
          kind: 'event',
          name,
          description: options.description,
          delivery: options.delivery ?? 'best-effort',
          retryPolicy: options.retryPolicy,
          deduplicationWindow: options.deduplicationWindow,
          contentType: options.contentType,
          contentTypes: options.contentTypes,
          policies,
        },
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },

    // === Lookup ===

    getProcedure(name: string): RegisteredHandler<ProcedureHandler> | undefined {
      return procedures.get(name)
    },

    getStream(name: string): RegisteredHandler<StreamHandler> | undefined {
      return streams.get(name)
    },

    getEvent(name: string): RegisteredHandler<EventHandler> | undefined {
      return events.get(name)
    },

    has(name: string): boolean {
      return procedures.has(name) || streams.has(name) || events.has(name)
    },

    // === Introspection ===

    list(): HandlerMeta[] {
      const results: HandlerMeta[] = new Array(procedures.size + streams.size + events.size)
      let index = 0

      for (const { meta } of procedures.values()) {
        results[index++] = meta
      }
      for (const { meta } of streams.values()) {
        results[index++] = meta
      }
      for (const { meta } of events.values()) {
        results[index++] = meta
      }

      return index === results.length ? results : results.slice(0, index)
    },

    listProcedures(): HandlerMeta[] {
      const results: HandlerMeta[] = new Array(procedures.size)
      let index = 0
      for (const { meta } of procedures.values()) {
        results[index++] = meta
      }
      return index === results.length ? results : results.slice(0, index)
    },

    listStreams(): HandlerMeta[] {
      const results: HandlerMeta[] = new Array(streams.size)
      let index = 0
      for (const { meta } of streams.values()) {
        results[index++] = meta
      }
      return index === results.length ? results : results.slice(0, index)
    },

    listEvents(): HandlerMeta[] {
      const results: HandlerMeta[] = new Array(events.size)
      let index = 0
      for (const { meta } of events.values()) {
        results[index++] = meta
      }
      return index === results.length ? results : results.slice(0, index)
    },
  }
}
