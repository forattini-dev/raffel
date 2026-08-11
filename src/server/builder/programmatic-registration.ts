/**
 * Programmatic registration methods for the server builder.
 *
 * `mount` (router modules) plus the `addProcedure` / `addStream` /
 * `addEvent` / `addChannel` / `addRest` / `addResource` /
 * `addTcpHandler` / `addUdpHandler` / `registerHandler` builder methods,
 * extracted from `builder.ts` as a factory that closes over the server's
 * registries and policy factories. Behaviour is identical to the inline
 * definitions; the methods are spread into the server object literal.
 */

import { getRouterModuleDefinition } from '../router-module.js'
import { joinHandlerName } from '../handler-builders.js'
import { policyMetadataFromRouteMeta, programmaticSource } from './metadata.js'
import type { createProcedureOperationRegistrar } from './operation-registrar.js'
import {
  createRouteInterceptors,
  type LoadedRoute,
  type LoadedChannel,
  type LoadedRestResource,
  type LoadedResource,
  type LoadedTcpHandler,
  type LoadedUdpHandler,
} from '../fs-routes/index.js'
import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type { Interceptor, ProcedureHandler, StreamHandler, EventHandler } from '../../types/index.js'
import type { HandlerSchema } from '../../validation/index.js'
import type { ProcedurePolicyConfig } from '../../middleware/policy/types.js'
import type { RuntimeInspectionOperationRegistration } from '../../inspect/index.js'
import type { RouteCacheConfig } from '../../cache/server-runtime.js'
import { insertCacheInterceptor } from '../interceptor-utils.js'
import type {
  RaffelServer,
  RouterModule,
  MountOptions,
  AddProcedureInput,
  AddStreamInput,
  AddEventInput,
} from '../types.js'

type RegisteredMethods = Pick<
  RaffelServer,
  | 'mount'
  | 'addProcedure'
  | 'addStream'
  | 'addEvent'
  | 'addChannel'
  | 'addRest'
  | 'addResource'
  | 'addTcpHandler'
  | 'addUdpHandler'
  | 'registerHandler'
>

export interface ProgrammaticRegistrationDeps {
  registry: Registry
  schemaRegistry: SchemaRegistry
  globalInterceptors: Interceptor[]
  normalizeInterceptors: (interceptors: Interceptor[], schema?: HandlerSchema) => Interceptor[]
  policyInterceptorFactory:
    | ((procedureName: string, config: ProcedurePolicyConfig) => Interceptor)
    | undefined
  policyDefaultMode: 'allow' | 'deny' | undefined
  noPolicyDeclaredFactory: ((procedureName: string) => Interceptor) | undefined
  recordOperationRegistration: (name: string, registration: RuntimeInspectionOperationRegistration) => void
  registerProcedureOperation: ReturnType<typeof createProcedureOperationRegistrar>
  registerChannel: (channel: LoadedChannel) => void
  registerRestResource: (resource: LoadedRestResource) => void
  registerResource: (resource: LoadedResource) => void
  registerTcpHandler: (handler: LoadedTcpHandler) => void
  registerUdpHandler: (handler: LoadedUdpHandler) => void
  logger: { debug(obj: unknown, msg: string): void }
  getServer: () => RaffelServer
  cacheInterceptorFor?: (
    procedureName: string,
    config: RouteCacheConfig | false | undefined,
  ) => Interceptor | undefined
}

export function createProgrammaticRegistration(
  deps: ProgrammaticRegistrationDeps,
): RegisteredMethods {
  const {
    registry,
    schemaRegistry,
    globalInterceptors,
    normalizeInterceptors,
    policyInterceptorFactory,
    policyDefaultMode,
    noPolicyDeclaredFactory,
    recordOperationRegistration,
    registerProcedureOperation,
    registerChannel,
    registerRestResource,
    registerResource,
    registerTcpHandler,
    registerUdpHandler,
    logger,
    getServer,
    cacheInterceptorFor,
  } = deps

  return {
    mount(prefix: string, module: RouterModule, options: MountOptions = {}) {
      const definition = getRouterModuleDefinition(module)
      const mountInterceptors = options.interceptors ?? []

      for (const route of definition.routes) {
        const fullName = joinHandlerName(prefix, route.name)
        const routeSchema = route.kind === 'procedure' ? route.schema : undefined

        // Synthesize policy interceptor at mount-time using the host server's
        // factory. Module routes carry `route.authz` (resolved from per-procedure
        // .authz() or module's defaultAuthz). When defaultMode is 'deny' and
        // no authz was declared, inject the no-policy-declared deny.
        const authzInterceptors: Interceptor[] = []
        if (route.kind === 'procedure') {
          if (route.authz && policyInterceptorFactory) {
            authzInterceptors.push(policyInterceptorFactory(fullName, route.authz))
          } else if (
            !route.authz &&
            policyDefaultMode === 'deny' &&
            noPolicyDeclaredFactory
          ) {
            authzInterceptors.push(noPolicyDeclaredFactory(fullName))
          }
        }

        let interceptors = normalizeInterceptors(
          [
            ...globalInterceptors,
            ...mountInterceptors,
            ...route.moduleInterceptors,
            ...authzInterceptors,
            ...route.interceptors,
          ],
          routeSchema
        )
        const cacheInterceptor = route.kind === 'procedure'
          ? cacheInterceptorFor?.(fullName, route.cache)
          : undefined
        if (cacheInterceptor) {
          interceptors = insertCacheInterceptor(interceptors, cacheInterceptor)
        }

        if (route.schema) {
          schemaRegistry.register(fullName, route.schema)
        }

        if (route.kind === 'procedure') {
          registry.procedure(fullName, route.handler as ProcedureHandler, {
            summary: route.summary,
            description: route.description,
            tags: route.tags,
            graphql: route.graphql,
            httpPath: route.httpPath,
            httpMethod: route.httpMethod,
            jsonrpc: route.jsonrpc,
            grpc: route.grpc,
            authz: route.authz,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
        } else if (route.kind === 'stream') {
          registry.stream(fullName, route.handler as StreamHandler, {
            description: route.description,
            direction: route.streamDirection,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
        } else {
          registry.event(fullName, route.handler as EventHandler, {
            description: route.description,
            delivery: route.delivery,
            retryPolicy: route.retryPolicy,
            deduplicationWindow: route.deduplicationWindow,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
        }
      }

      return getServer()
    },

    // === Programmatic Registration ===

    addProcedure(input: AddProcedureInput | LoadedRoute) {
      // Normalize input (LoadedRoute has 'handler' directly, AddProcedureInput also has 'handler')
      const name = input.name
      const handler = input.handler as ProcedureHandler
      const inputSchema = input.inputSchema
      const outputSchema = input.outputSchema
      const documentationOutputSchema = 'inferredOutputSchema' in input
        ? input.inferredOutputSchema
        : undefined
      const summary = 'meta' in input ? input.meta?.summary : (input as AddProcedureInput).summary
      const description = 'meta' in input ? input.meta?.description : (input as AddProcedureInput).description
      const tags = 'meta' in input ? input.meta?.tags : (input as AddProcedureInput).tags
      const graphql = 'meta' in input ? input.meta?.graphql : (input as AddProcedureInput).graphql
      const httpPath = 'meta' in input ? input.meta?.httpPath : (input as AddProcedureInput).httpPath
      const httpMethod = 'meta' in input ? input.meta?.httpMethod : (input as AddProcedureInput).httpMethod
      const jsonrpc = 'meta' in input ? input.meta?.jsonrpc : (input as AddProcedureInput).jsonrpc
      const grpc = 'meta' in input ? input.meta?.grpc : (input as AddProcedureInput).grpc
      const policies = 'meta' in input
        ? policyMetadataFromRouteMeta(input.meta)
        : (input as AddProcedureInput).policies
      const cache = 'meta' in input
        ? input.meta?.cache
        : (input as AddProcedureInput).cache
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddProcedureInput).interceptors ?? [] : []

      registerProcedureOperation({
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
        jsonrpc,
        grpc,
        policies,
        cache,
        interceptors: [...routeInterceptors, ...inputInterceptors],
        registration: {
          source: 'filePath' in input
            ? { kind: 'discovery', location: input.filePath }
            : programmaticSource(),
        },
      })

      logger.debug({ name }, 'Added procedure')
      return getServer()
    },

    addStream(input: AddStreamInput | LoadedRoute) {
      const name = input.name
      const handler = input.handler as StreamHandler
      const inputSchema = input.inputSchema
      const outputSchema = input.outputSchema
      const description = 'meta' in input ? input.meta?.description : (input as AddStreamInput).description
      const direction = 'meta' in input ? input.meta?.direction : (input as AddStreamInput).direction
      const policies = 'meta' in input
        ? policyMetadataFromRouteMeta(input.meta)
        : (input as AddStreamInput).policies
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddStreamInput).interceptors ?? [] : []

      const interceptors = [...globalInterceptors, ...routeInterceptors, ...inputInterceptors]

      if (inputSchema || outputSchema) {
        const schema: HandlerSchema = {}
        if (inputSchema) schema.input = inputSchema
        if (outputSchema) schema.output = outputSchema
        schemaRegistry.register(name, schema)
      }

      registry.stream(name, handler as any, {
        description,
        direction,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      recordOperationRegistration(name, {
        source: 'filePath' in input
          ? { kind: 'discovery', location: input.filePath }
          : programmaticSource(),
      })

      logger.debug({ name }, 'Added stream')
      return getServer()
    },

    addEvent(input: AddEventInput | LoadedRoute) {
      const name = input.name
      const handler = input.handler as EventHandler
      const inputSchema = input.inputSchema
      const description = 'meta' in input ? input.meta?.description : (input as AddEventInput).description
      const delivery = 'meta' in input ? input.meta?.delivery : (input as AddEventInput).delivery
      const retryPolicy = 'meta' in input ? input.meta?.retryPolicy : (input as AddEventInput).retryPolicy
      const deduplicationWindow = 'meta' in input ? input.meta?.deduplicationWindow : (input as AddEventInput).deduplicationWindow
      const policies = 'meta' in input
        ? policyMetadataFromRouteMeta(input.meta)
        : (input as AddEventInput).policies
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddEventInput).interceptors ?? [] : []

      const interceptors = [...globalInterceptors, ...routeInterceptors, ...inputInterceptors]

      if (inputSchema) {
        schemaRegistry.register(name, { input: inputSchema })
      }

      registry.event(name, handler as any, {
        description,
        delivery,
        retryPolicy,
        deduplicationWindow,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      recordOperationRegistration(name, {
        source: 'filePath' in input
          ? { kind: 'discovery', location: input.filePath }
          : programmaticSource(),
      })

      logger.debug({ name }, 'Added event')
      return getServer()
    },

    addChannel(channel: LoadedChannel) {
      registerChannel(channel)
      logger.debug({ name: channel.name }, 'Channel configuration registered')
      return getServer()
    },

    addRest(resource: LoadedRestResource) {
      registerRestResource(resource)
      return getServer()
    },

    addResource(resource: LoadedResource) {
      registerResource(resource)
      return getServer()
    },

    addTcpHandler(handler: LoadedTcpHandler) {
      registerTcpHandler(handler)
      return getServer()
    },

    addUdpHandler(handler: LoadedUdpHandler) {
      registerUdpHandler(handler)
      return getServer()
    },

    registerHandler(name: string, handler: any, opts?: any) {
      const kind = opts?.kind ?? 'procedure'
      if (kind === 'stream') {
        return getServer().addStream({
          name,
          handler: handler as StreamHandler,
          inputSchema: opts?.input,
          outputSchema: opts?.output,
          direction: opts?.direction,
          description: opts?.description,
          policies: opts?.policies,
          interceptors: opts?.interceptors,
        } as AddStreamInput)
      }
      if (kind === 'event') {
        return getServer().addEvent({
          name,
          handler: handler as EventHandler,
          inputSchema: opts?.input,
          description: opts?.description,
          delivery: opts?.delivery,
          retryPolicy: opts?.retryPolicy,
          deduplicationWindow: opts?.deduplicationWindow,
          policies: opts?.policies,
          interceptors: opts?.interceptors,
        } as AddEventInput)
      }
      return getServer().addProcedure({
        name,
        handler: handler as ProcedureHandler,
        inputSchema: opts?.input,
        outputSchema: opts?.output,
        summary: opts?.summary,
        description: opts?.description,
        tags: opts?.tags,
        graphql: opts?.graphql,
        httpPath: opts?.httpPath,
        httpMethod: opts?.httpMethod,
        jsonrpc: opts?.jsonrpc,
        grpc: opts?.grpc,
        policies: opts?.policies,
        interceptors: opts?.interceptors,
      } as AddProcedureInput)
    },
  }
}
