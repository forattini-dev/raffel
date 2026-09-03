/**
 * Registration Service
 *
 * Orchestrates registration into the core registry while depending only on
 * injected discovery/resource-generation functions.
 */

import type { Registry } from '../../core/registry.js'
import type { RuntimeInspectionOperationRegistration } from '../../inspect/index.js'
import type { LoggerPort } from '../../ports/outbound/logger.js'
import type { Interceptor } from '../../types/index.js'
import type { SchemaRegistry } from '../../validation/schema.js'
import type { HandlerSchema } from '../../validation/types.js'
import { createHttpAwareProcedureHandler } from '../http-lifecycle/index.js'
import type {
  Policy,
  Principal,
  ProcedurePolicyConfig,
  Resource,
  ResourceResolver,
} from '../../middleware/policy/types.js'

export interface LoadedChannelLike {
  name: string
  filePath?: string
  coLocatedPolicies?: readonly Policy[]
}

export interface LoadedRestRouteLike {
  operation: string
  handler: unknown
  inputSchema?: unknown
  outputSchema?: unknown
  isCollection: boolean
  middleware?: Interceptor[]
}

export interface LoadedRestResourceLike {
  name: string
  filePath: string
  config?: {
    primaryKey?: string
    policyResource?: ResourceResolver
  }
  routes: LoadedRestRouteLike[]
  coLocatedPolicies?: readonly Policy[]
  directoryMeta?: {
    tag?: string
    description?: string
  }
}

export interface LoadedResourceLike {
  name: string
  filePath: string
  config?: {
    idField?: string
    policyResource?: ResourceResolver
  }
  coLocatedPolicies?: readonly Policy[]
  directoryMeta?: {
    tag?: string
    description?: string
  }
}

export interface GeneratedResourceRouteLike {
  operation: string
  handler: unknown
  method?: string
  path?: string
  inputSchema?: unknown
  outputSchema?: unknown
  /**
   * Per-route interceptors composed by the route generator (issue #115).
   * Already includes the resource-level `config.middleware` floor plus any
   * per-action / per-CRUD-slot overrides, in execution order.
   *
   * The registration service appends these AFTER global interceptors and
   * authz interceptors, so global concerns (logging, tracing, policy)
   * always wrap the resource-specific middleware chain.
   */
  middleware?: Interceptor[]
}

export interface LoadedTransportHandlerLike {
  name: string
  config: {
    port: number
  }
}

export interface DiscoveryRegistrationLike<
  TChannel extends LoadedChannelLike,
  TRestResource extends LoadedRestResourceLike,
  TResource extends LoadedResourceLike,
  TTcpHandler extends LoadedTransportHandlerLike,
  TUdpHandler extends LoadedTransportHandlerLike,
> {
  channels: TChannel[]
  restResources: TRestResource[]
  resources: TResource[]
  tcpHandlers: TTcpHandler[]
  udpHandlers: TUdpHandler[]
}

export interface RegisterDiscoveredHandlersEntry {
  name: string
  kind: 'procedure' | 'stream' | 'event'
  filePath: string
}

export interface RegistrationContext<
  TChannel extends LoadedChannelLike,
  TRestResource extends LoadedRestResourceLike,
  TResource extends LoadedResourceLike,
  TTcpHandler extends LoadedTransportHandlerLike,
  TUdpHandler extends LoadedTransportHandlerLike,
  TDiscovery extends DiscoveryRegistrationLike<TChannel, TRestResource, TResource, TTcpHandler, TUdpHandler>,
> {
  registry: Registry
  schemaRegistry: SchemaRegistry
  globalInterceptors: Interceptor[]
  logger: LoggerPort
  recordOperationRegistration: (name: string, registration: RuntimeInspectionOperationRegistration) => void
  generateResourceRoutes: (resources: TResource[]) => GeneratedResourceRouteLike[]
  registerDiscoveredHandlers: (
    result: TDiscovery,
    registry: Registry,
    schemaRegistry: SchemaRegistry,
    globalInterceptors: Interceptor[],
    onRegistered?: (entry: RegisterDiscoveredHandlersEntry) => void,
    previouslyDiscovered?: ReadonlySet<string>
  ) => { discoveredNames: Set<string> }
  /**
   * Optional hook for synthesising authz interceptors for REST/resource
   * operations from co-located policies attached to the loaded resource.
   * Returns the interceptors to splice in alongside global interceptors.
   */
  buildAuthzInterceptorsForOperation?: (
    operationName: string,
    coLocatedPolicies: readonly Policy[] | undefined,
    diagnosticsFilePath?: string,
    policyConfig?: ProcedurePolicyConfig,
  ) => Interceptor[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return undefined
}

function nullableStringValue(value: unknown): string | null | undefined {
  if (value === null) return null
  return stringValue(value)
}

function readRecordField(value: unknown, field: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const next = value[field]
  return isRecord(next) ? next : undefined
}

function readPrincipal(ctx: unknown): Principal | undefined {
  if (!isRecord(ctx)) return undefined
  const principal = ctx.principal
  return isRecord(principal) && typeof principal.id === 'string'
    ? principal as unknown as Principal
    : undefined
}

function readInputData(input: unknown): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined
  const data = input.data
  return isRecord(data) ? data : input
}

function readPolicyResourceId(
  input: unknown,
  ctx: unknown,
  idField: string,
  collectionRoute: boolean,
): string {
  if (collectionRoute) return '*'

  const inputRecord = isRecord(input) ? input : undefined
  const data = readInputData(input)
  const params = readRecordField(ctx, 'params')

  return stringValue(params?.[idField])
    ?? stringValue(params?.id)
    ?? stringValue(inputRecord?.[idField])
    ?? stringValue(inputRecord?.id)
    ?? stringValue(data?.[idField])
    ?? stringValue(data?.id)
    ?? '*'
}

function readPolicyResourceTenantId(input: unknown, ctx: unknown): string | null {
  const data = readInputData(input)
  const inputRecord = isRecord(input) ? input : undefined
  const ctxRecord = isRecord(ctx) ? ctx : undefined
  const params = readRecordField(ctx, 'params')
  const query = readRecordField(ctx, 'query')
  const filters = readRecordField(query, 'filters')
  const principal = readPrincipal(ctx)

  return nullableStringValue(data?.tenantId)
    ?? nullableStringValue(inputRecord?.tenantId)
    ?? nullableStringValue(params?.tenantId)
    ?? nullableStringValue(filters?.tenantId)
    ?? nullableStringValue(query?.tenantId)
    ?? nullableStringValue(ctxRecord?.tenantId)
    ?? principal?.tenantId
    ?? null
}

function createPolicyResourceAttrs(
  input: unknown,
  ctx: unknown,
  operation: string,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = { operation }
  const data = readInputData(input)
  if (data) Object.assign(attrs, data)

  const params = readRecordField(ctx, 'params')
  if (params && Object.keys(params).length > 0) attrs.params = params

  const query = readRecordField(ctx, 'query')
  if (query && Object.keys(query).length > 0) attrs.query = query

  return attrs
}

function withResourcePolicyContext(
  ctx: unknown,
  resourceName: string,
  operation: string,
): unknown {
  return isRecord(ctx)
    ? { ...ctx, resource: resourceName, operation }
    : ctx
}

function createDefaultPolicyResourceResolver(
  resourceName: string,
  operation: string,
  idField: string,
  collectionRoute: boolean,
): ResourceResolver {
  return (input, ctx): Resource => ({
    type: resourceName,
    id: readPolicyResourceId(input, ctx, idField, collectionRoute),
    tenantId: readPolicyResourceTenantId(input, ctx),
    attrs: createPolicyResourceAttrs(input, ctx, operation),
  })
}

function createResourcePolicyConfig(
  resourceName: string,
  operation: string,
  idField: string,
  collectionRoute: boolean,
  configuredResolver: ResourceResolver | undefined,
): ProcedurePolicyConfig {
  if (configuredResolver) {
    return {
      resource: (input, ctx) =>
        configuredResolver(input, withResourcePolicyContext(ctx, resourceName, operation)),
    }
  }

  return {
    resource: createDefaultPolicyResourceResolver(resourceName, operation, idField, collectionRoute),
  }
}

export function createRegistrationService<
  TChannel extends LoadedChannelLike,
  TRestResource extends LoadedRestResourceLike,
  TResource extends LoadedResourceLike,
  TTcpHandler extends LoadedTransportHandlerLike,
  TUdpHandler extends LoadedTransportHandlerLike,
  TDiscovery extends DiscoveryRegistrationLike<TChannel, TRestResource, TResource, TTcpHandler, TUdpHandler>,
>(ctx: RegistrationContext<TChannel, TRestResource, TResource, TTcpHandler, TUdpHandler, TDiscovery>) {
  const {
    registry,
    schemaRegistry,
    globalInterceptors,
    logger,
    recordOperationRegistration,
    generateResourceRoutes,
    registerDiscoveredHandlers,
    buildAuthzInterceptorsForOperation,
  } = ctx

  function combineInterceptors(
    operationName: string,
    coLocatedPolicies: readonly Policy[] | undefined,
    diagnosticsFilePath?: string,
    extras?: Interceptor[],
    policyConfig?: ProcedurePolicyConfig,
  ): Interceptor[] | undefined {
    const authz = buildAuthzInterceptorsForOperation
      ? buildAuthzInterceptorsForOperation(operationName, coLocatedPolicies, diagnosticsFilePath, policyConfig)
      : []
    const combined = [...globalInterceptors, ...authz, ...(extras ?? [])]
    return combined.length > 0 ? combined : undefined
  }

  function registerChannel(
    channelRegistry: Map<string, TChannel>,
    channel: TChannel
  ): void {
    if (channel.coLocatedPolicies && channel.coLocatedPolicies.length > 0) {
      // Build the synth interceptors solely for the side-effect of pushing
      // the channel's co-located policies into the engine — channel-utils
      // evaluates them at subscribe time, not via interceptor.
      buildAuthzInterceptorsForOperation?.(channel.name, channel.coLocatedPolicies, channel.filePath)
    }
    channelRegistry.set(channel.name, channel)
  }

  function registerRestResource(
    restResourceRegistry: TRestResource[],
    resource: TRestResource
  ): void {
    restResourceRegistry.push(resource)

    for (const route of resource.routes) {
      const suffix =
        route.operation === 'head' || route.operation === 'options'
          ? route.isCollection
            ? ':collection'
            : ':item'
          : ''
      const name = `${resource.name}.${route.operation}${suffix}`

      if (route.inputSchema || route.outputSchema) {
        const schema: HandlerSchema = {}
        if (route.inputSchema) schema.input = route.inputSchema as never
        if (route.outputSchema) schema.output = route.outputSchema as never
        schemaRegistry.register(name, schema)
      }

      registry.procedure(name, createHttpAwareProcedureHandler(route.handler as never), {
        interceptors: combineInterceptors(
          name,
          resource.coLocatedPolicies,
          resource.filePath,
          route.middleware,
          createResourcePolicyConfig(
            resource.name,
            route.operation,
            resource.config?.primaryKey ?? 'id',
            route.isCollection,
            resource.config?.policyResource,
          ),
        ),
        description: resource.directoryMeta?.description,
        tags: resource.directoryMeta?.tag ? [resource.directoryMeta.tag] : undefined,
      })
      recordOperationRegistration(name, {
        source: {
          kind: 'rest-resource',
          location: resource.filePath,
        },
      })
    }

    logger.debug({ name: resource.name, routes: resource.routes.length }, 'Added REST resource')
  }

  function registerResource(resource: TResource): void {
    const routes = generateResourceRoutes([resource])

    for (const route of routes) {
      const name = `${resource.name}.${route.operation}`
      const httpSuccessStatus =
        route.operation === 'create'
          ? 201
          : route.operation === 'delete'
            ? 204
            : undefined

      if (route.inputSchema || route.outputSchema) {
        const schema: HandlerSchema = {}
        if (route.inputSchema) schema.input = route.inputSchema as never
        if (route.outputSchema) schema.output = route.outputSchema as never
        schemaRegistry.register(name, schema)
      }

      registry.procedure(name, createHttpAwareProcedureHandler(route.handler as never), {
        interceptors: combineInterceptors(
          name,
          resource.coLocatedPolicies,
          resource.filePath,
          route.middleware,
          createResourcePolicyConfig(
            resource.name,
            route.operation,
            resource.config?.idField ?? 'id',
            !route.path?.includes(':id'),
            resource.config?.policyResource,
          ),
        ),
        httpPath: route.path,
        httpMethod: route.method as never,
        httpSuccessStatus,
        description: resource.directoryMeta?.description,
        tags: resource.directoryMeta?.tag ? [resource.directoryMeta.tag] : undefined,
      })
      recordOperationRegistration(name, {
        source: {
          kind: 'resource',
          location: resource.filePath,
        },
      })
    }

    logger.debug({ name: resource.name, operations: routes.length }, 'Added resource')
  }

  function registerTcpHandler(
    tcpHandlers: TTcpHandler[],
    handler: TTcpHandler
  ): void {
    tcpHandlers.push(handler)
    logger.debug({ name: handler.name, port: handler.config.port }, 'Added TCP handler')
  }

  function registerUdpHandler(
    udpHandlers: TUdpHandler[],
    handler: TUdpHandler
  ): void {
    udpHandlers.push(handler)
    logger.debug({ name: handler.name, port: handler.config.port }, 'Added UDP handler')
  }

  function applyDiscoveryResult(
    result: TDiscovery,
    channelRegistry: Map<string, TChannel>,
    restResourceRegistry: TRestResource[],
    tcpHandlers: TTcpHandler[],
    udpHandlers: TUdpHandler[],
    previouslyDiscovered?: ReadonlySet<string>
  ): { discoveredNames: Set<string> } {
    const { discoveredNames } = registerDiscoveredHandlers(
      result,
      registry,
      schemaRegistry,
      globalInterceptors,
      (entry) => {
        recordOperationRegistration(entry.name, {
          source: {
            kind: 'discovery',
            location: entry.filePath,
          },
        })
      },
      previouslyDiscovered
    )

    // Note: channels, rest resources, resources, tcp and udp handlers are
    // append-only — the watcher does not drop entries on hot reload even
    // when the underlying file is deleted. A future cleanup pass should
    // diff `previouslyDiscovered` and drop the missing ones (tracked
    // separately; out of scope for the hot-reload fix below).

    for (const channel of result.channels) {
      registerChannel(channelRegistry, channel)
    }

    for (const resource of result.restResources) {
      registerRestResource(restResourceRegistry, resource)
    }

    for (const resource of result.resources) {
      registerResource(resource)
    }

    for (const handler of result.tcpHandlers) {
      registerTcpHandler(tcpHandlers, handler)
    }

    for (const handler of result.udpHandlers) {
      registerUdpHandler(udpHandlers, handler)
    }

    return { discoveredNames }
  }

  return {
    registerChannel,
    registerRestResource,
    registerResource,
    registerTcpHandler,
    registerUdpHandler,
    applyDiscoveryResult,
  }
}

export type RegistrationService<
  TChannel extends LoadedChannelLike = LoadedChannelLike,
  TRestResource extends LoadedRestResourceLike = LoadedRestResourceLike,
  TResource extends LoadedResourceLike = LoadedResourceLike,
  TTcpHandler extends LoadedTransportHandlerLike = LoadedTransportHandlerLike,
  TUdpHandler extends LoadedTransportHandlerLike = LoadedTransportHandlerLike,
  TDiscovery extends DiscoveryRegistrationLike<TChannel, TRestResource, TResource, TTcpHandler, TUdpHandler> =
    DiscoveryRegistrationLike<TChannel, TRestResource, TResource, TTcpHandler, TUdpHandler>,
> = ReturnType<
  typeof createRegistrationService<TChannel, TRestResource, TResource, TTcpHandler, TUdpHandler, TDiscovery>
>
