/**
 * Registration Service
 *
 * Orchestrates registration into the core registry while depending only on
 * injected discovery/resource-generation functions.
 */

import type { Registry } from '../core/registry.js'
import type { RuntimeInspectionOperationRegistration } from '../inspect/index.js'
import type { LoggerPort } from '../ports/outbound/logger.js'
import type { Interceptor } from '../types/index.js'
import type { SchemaRegistry } from '../validation/schema.js'
import type { HandlerSchema } from '../validation/types.js'

export interface LoadedChannelLike {
  name: string
}

export interface LoadedRestRouteLike {
  operation: string
  handler: unknown
  inputSchema?: unknown
  outputSchema?: unknown
  isCollection: boolean
}

export interface LoadedRestResourceLike {
  name: string
  filePath: string
  routes: LoadedRestRouteLike[]
}

export interface LoadedResourceLike {
  name: string
  filePath: string
}

export interface GeneratedResourceRouteLike {
  operation: string
  handler: unknown
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
    onRegistered?: (entry: RegisterDiscoveredHandlersEntry) => void
  ) => void
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
  } = ctx

  function registerChannel(
    channelRegistry: Map<string, TChannel>,
    channel: TChannel
  ): void {
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

      registry.procedure(name, route.handler as never, {
        interceptors: globalInterceptors.length > 0 ? [...globalInterceptors] : undefined,
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

      registry.procedure(name, route.handler as never, {
        interceptors: globalInterceptors.length > 0 ? [...globalInterceptors] : undefined,
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
    udpHandlers: TUdpHandler[]
  ): void {
    registerDiscoveredHandlers(result, registry, schemaRegistry, globalInterceptors, (entry) => {
      recordOperationRegistration(entry.name, {
        source: {
          kind: 'discovery',
          location: entry.filePath,
        },
      })
    })

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
