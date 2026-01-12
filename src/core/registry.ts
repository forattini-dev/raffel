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
  interceptors?: Interceptor[]
}

/**
 * Stream registration options
 */
export interface StreamOptions {
  description?: string
  direction?: StreamDirection
  /** Content type shorthand */
  contentType?: string
  /** Content type configuration */
  contentTypes?: { default?: string; supported?: string[] }
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
    options?: StreamOptions
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
        },
        interceptors: options.interceptors,
      })
    },

    stream<TInput, TOutput>(
      name: string,
      handler: StreamHandler<TInput, TOutput>,
      options: StreamOptions = {}
    ): void {
      if (procedures.has(name) || streams.has(name) || events.has(name)) {
        throw new Error(`Handler '${name}' already registered`)
      }

      streams.set(name, {
        handler: handler as StreamHandler,
        meta: {
          kind: 'stream',
          name,
          description: options.description,
          streamDirection: options.direction ?? 'server',
          contentType: options.contentType,
          contentTypes: options.contentTypes,
        },
        interceptors: options.interceptors,
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
        },
        interceptors: options.interceptors,
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
      return [
        ...Array.from(procedures.values()).map((h) => h.meta),
        ...Array.from(streams.values()).map((h) => h.meta),
        ...Array.from(events.values()).map((h) => h.meta),
      ]
    },

    listProcedures(): HandlerMeta[] {
      return Array.from(procedures.values()).map((h) => h.meta)
    },

    listStreams(): HandlerMeta[] {
      return Array.from(streams.values()).map((h) => h.meta)
    },

    listEvents(): HandlerMeta[] {
      return Array.from(events.values()).map((h) => h.meta)
    },
  }
}
