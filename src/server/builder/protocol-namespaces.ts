/**
 * Protocol Namespace Factories
 *
 * Per-protocol namespace builders extracted from server/builder.ts (slice 1
 * of the architecture-deepening initiative). Each factory receives the
 * builder-internal closures it depends on and returns the namespace object
 * the public RaffelServer surface exposes.
 *
 * Behaviour-preserving extraction; no semantic changes.
 */

import type { Registry } from '../../core/registry.js'
import type { Interceptor, ProcedureHandler, StreamHandler } from '../../types/index.js'
import type { HandlerSchema, SchemaRegistry } from '../../validation/index.js'
import type {
  RuntimeInspectionOperationRegistration,
  RuntimeInspectionSource,
} from '../../inspect/index.js'
import { isAsyncIterable } from '../../utils/type-guards.js'
import type {
  HttpNamespace,
  HttpRouteHandler,
  HttpRouteOptions,
  WebSocketNamespace,
  WebSocketChannelOptions,
  WebSocketSubscribeHandler,
  WebSocketMessageHandler,
  WebSocketUnsubscribeHandler,
  StreamsNamespace,
  StreamOptions,
  RpcNamespace,
  RpcMethodOptions,
  TcpNamespace,
  TcpHandlerBuilder,
  TcpHandlerOptions,
  UdpNamespace,
  UdpHandlerBuilder,
  UdpHandlerOptions,
  GrpcNamespace,
  GrpcServiceBuilder,
  GrpcServiceOptions,
  GrpcMethodOptions,
  RaffelServer,
} from '../types.js'
import type {
  LoadedChannel,
  LoadedTcpHandler,
  LoadedUdpHandler,
} from '../fs-routes/index.js'
import type {
  TcpConnectHandler,
  TcpDataHandler,
  TcpCloseHandler,
  TcpErrorHandler,
  TcpMessageHandler,
} from '../fs-routes/tcp/types.js'
import type {
  UdpMessageHandler,
  UdpErrorHandler,
} from '../fs-routes/udp/types.js'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

interface NamespaceLogger {
  debug(obj: object, msg?: string): void
}

// === HTTP ===

export interface HttpNamespaceContext {
  registerHttpRoute: (
    method: HttpMethod,
    path: string,
    optionsOrHandler: HttpRouteOptions | HttpRouteHandler,
    maybeHandler?: HttpRouteHandler
  ) => RaffelServer
  httpInterceptors: Interceptor[]
}

export function createHttpNamespace(ctx: HttpNamespaceContext): HttpNamespace {
  const { registerHttpRoute, httpInterceptors } = ctx
  const httpNamespace: HttpNamespace = {
    get(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('GET', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    post(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('POST', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    put(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('PUT', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    patch(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('PATCH', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    delete(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('DELETE', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    options(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('OPTIONS', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    head(path: string, optionsOrHandler: any, maybeHandler?: any) {
      registerHttpRoute('HEAD', path, optionsOrHandler, maybeHandler)
      return httpNamespace
    },
    use(interceptor: Interceptor) {
      httpInterceptors.push(interceptor)
      return httpNamespace
    },
  }
  return httpNamespace
}

// === WebSocket ===

export interface WebSocketNamespaceContext {
  channelRegistry: Map<string, LoadedChannel>
  wsInterceptors: Interceptor[]
  setSubscribeHandler: (handler: WebSocketSubscribeHandler) => void
  setMessageHandler: (handler: WebSocketMessageHandler) => void
  setUnsubscribeHandler: (handler: WebSocketUnsubscribeHandler) => void
  logger: NamespaceLogger
}

export function createWebSocketNamespace(ctx: WebSocketNamespaceContext): WebSocketNamespace {
  const {
    channelRegistry,
    wsInterceptors,
    setSubscribeHandler,
    setMessageHandler,
    setUnsubscribeHandler,
    logger,
  } = ctx

  const wsNamespace: WebSocketNamespace = {
    channel(channelName: string, options?: WebSocketChannelOptions) {
      const authRequirement = options?.type === 'public' ? 'none' : 'required'
      const channelDef: LoadedChannel = {
        name: channelName,
        filePath: '<programmatic>',
        config: { auth: authRequirement },
        type: options?.type ?? 'public',
        description: options?.description,
        tags: options?.tags,
      }
      channelRegistry.set(channelName, channelDef)
      logger.debug(
        { name: channelName, type: options?.type ?? 'public', auth: authRequirement },
        'Added WebSocket channel'
      )
      return wsNamespace
    },
    onSubscribe(handler) {
      setSubscribeHandler(handler)
      return wsNamespace
    },
    onMessage(handler) {
      setMessageHandler(handler)
      return wsNamespace
    },
    onUnsubscribe(handler) {
      setUnsubscribeHandler(handler)
      return wsNamespace
    },
    use(interceptor) {
      wsInterceptors.push(interceptor)
      return wsNamespace
    },
  }
  return wsNamespace
}

// === Streams ===

export interface StreamsNamespaceContext {
  globalInterceptors: Interceptor[]
  streamInterceptors: Interceptor[]
  registry: Registry
  schemaRegistry: SchemaRegistry
  normalizeInterceptors: (interceptors: Interceptor[], schema?: HandlerSchema) => Interceptor[]
  recordOperationRegistration: (name: string, registration: RuntimeInspectionOperationRegistration) => void
  programmaticSource: (kind?: RuntimeInspectionSource['kind']) => RuntimeInspectionSource
  logger: NamespaceLogger
}

export function createStreamsNamespace(ctx: StreamsNamespaceContext): StreamsNamespace {
  const {
    globalInterceptors,
    streamInterceptors,
    registry,
    schemaRegistry,
    normalizeInterceptors,
    recordOperationRegistration,
    programmaticSource,
    logger,
  } = ctx

  const isStreamOptions = (optionsOrHandler: any): optionsOrHandler is StreamOptions =>
    typeof optionsOrHandler === 'object'
    && optionsOrHandler !== null
    && !isAsyncIterable(optionsOrHandler)

  function registerStream(
    direction: 'server' | 'client' | 'bidi',
    label: string,
    name: string,
    optionsOrHandler: any,
    maybeHandler?: any
  ): void {
    const isOptionsObject = isStreamOptions(optionsOrHandler)
    const options = isOptionsObject ? (optionsOrHandler as StreamOptions) : ({} as StreamOptions)
    const handler = isOptionsObject ? maybeHandler : optionsOrHandler

    const streamName = `stream:${name}`
    let interceptors = normalizeInterceptors([...globalInterceptors, ...streamInterceptors])

    if (options.input) {
      const schema: HandlerSchema = { input: options.input }
      schemaRegistry.register(streamName, schema)
      interceptors = normalizeInterceptors(interceptors, schema)
    }

    registry.stream(streamName, handler, {
      description: options.description,
      direction,
      interceptors: interceptors.length > 0 ? interceptors : undefined,
    })
    recordOperationRegistration(streamName, { source: programmaticSource() })
    logger.debug({ name: streamName, path: options.path ?? `/${name}` }, label)
  }

  const streamsNamespace: StreamsNamespace = {
    source(name: string, optionsOrHandler: any, maybeHandler?: any) {
      registerStream('server', 'Added stream source', name, optionsOrHandler, maybeHandler)
      return streamsNamespace
    },
    sink(name: string, optionsOrHandler: any, maybeHandler?: any) {
      registerStream('client', 'Added stream sink', name, optionsOrHandler, maybeHandler)
      return streamsNamespace
    },
    duplex(name: string, optionsOrHandler: any, maybeHandler?: any) {
      registerStream('bidi', 'Added stream duplex', name, optionsOrHandler, maybeHandler)
      return streamsNamespace
    },
    use(interceptor: Interceptor) {
      streamInterceptors.push(interceptor)
      return streamsNamespace
    },
  }
  return streamsNamespace
}

// === RPC (JSON-RPC) ===

export interface RpcNamespaceContext {
  globalInterceptors: Interceptor[]
  rpcInterceptors: Interceptor[]
  registry: Registry
  schemaRegistry: SchemaRegistry
  normalizeInterceptors: (interceptors: Interceptor[], schema?: HandlerSchema) => Interceptor[]
  recordOperationRegistration: (name: string, registration: RuntimeInspectionOperationRegistration) => void
  programmaticSource: (kind?: RuntimeInspectionSource['kind']) => RuntimeInspectionSource
  logger: NamespaceLogger
}

export function createRpcNamespace(ctx: RpcNamespaceContext): RpcNamespace {
  const {
    globalInterceptors,
    rpcInterceptors,
    registry,
    schemaRegistry,
    normalizeInterceptors,
    recordOperationRegistration,
    programmaticSource,
    logger,
  } = ctx

  const registerRpcMethod = (
    name: string,
    optionsOrHandler: RpcMethodOptions | ProcedureHandler,
    maybeHandler?: ProcedureHandler,
    isNotification = false
  ) => {
    const isOptionsObject =
      typeof optionsOrHandler === 'object' && optionsOrHandler !== null && typeof maybeHandler === 'function'
    const options = isOptionsObject ? (optionsOrHandler as RpcMethodOptions) : ({} as RpcMethodOptions)
    const handler = isOptionsObject ? maybeHandler! : (optionsOrHandler as ProcedureHandler)

    let interceptors = normalizeInterceptors([...globalInterceptors, ...rpcInterceptors])

    if (options.input) {
      const schema: HandlerSchema = { input: options.input, output: options.output }
      schemaRegistry.register(name, schema)
      interceptors = normalizeInterceptors(interceptors, schema)
    }

    registry.procedure(name, handler, {
      description: options.description,
      tags: options.tags,
      jsonrpc: { notification: isNotification },
      interceptors: interceptors.length > 0 ? interceptors : undefined,
    })
    recordOperationRegistration(name, { source: programmaticSource('rpc-namespace') })
    logger.debug({ name, notification: isNotification }, 'Added RPC method')
  }

  const rpcNamespace: RpcNamespace = {
    method(name: string, optionsOrHandler: any, maybeHandler?: any) {
      registerRpcMethod(name, optionsOrHandler, maybeHandler, false)
      return rpcNamespace
    },
    notification(name: string, optionsOrHandler: any, maybeHandler?: any) {
      registerRpcMethod(name, optionsOrHandler, maybeHandler, true)
      return rpcNamespace
    },
    use(interceptor: Interceptor) {
      rpcInterceptors.push(interceptor)
      return rpcNamespace
    },
  }
  return rpcNamespace
}

// === TCP ===

export interface TcpNamespaceContext {
  tcpHandlers: LoadedTcpHandler[]
  tcpInterceptors: Interceptor[]
  logger: NamespaceLogger
}

export function createTcpNamespace(ctx: TcpNamespaceContext): TcpNamespace {
  const { tcpHandlers, tcpInterceptors, logger } = ctx

  const tcpNamespace: TcpNamespace = {
    handler(name: string, options?: TcpHandlerOptions): TcpHandlerBuilder {
      let connectHandler: TcpConnectHandler | undefined
      let dataHandler: TcpDataHandler | undefined
      let closeHandler: TcpCloseHandler | undefined
      let errorHandler: TcpErrorHandler | undefined

      const handlerBuilder: TcpHandlerBuilder = {
        onConnect(handler) {
          connectHandler = handler as unknown as TcpConnectHandler
          return handlerBuilder
        },
        onData(handler) {
          dataHandler = handler as unknown as TcpDataHandler
          return handlerBuilder
        },
        onClose(handler) {
          closeHandler = handler as unknown as TcpCloseHandler
          return handlerBuilder
        },
        onError(handler) {
          errorHandler = handler as unknown as TcpErrorHandler
          return handlerBuilder
        },
        end() {
          let framingConfig: LoadedTcpHandler['config']['framing'] = null
          if (options?.framing === 'length-prefixed') {
            framingConfig = {
              type: 'length-prefixed',
              lengthBytes: 4,
              lengthEncoding: 'BE',
              maxMessageSize: 16 * 1024 * 1024,
              delimiter: undefined,
            }
          } else if (options?.framing === 'delimiter' || options?.framing === 'line') {
            framingConfig = {
              type: 'delimiter',
              lengthBytes: 4,
              lengthEncoding: 'BE',
              maxMessageSize: 16 * 1024 * 1024,
              delimiter: Buffer.from(options.delimiter ?? '\n'),
            }
          }

          const tcpHandler: LoadedTcpHandler = {
            name,
            filePath: '<programmatic>',
            config: {
              port: options?.port ?? 0,
              host: options?.host ?? '127.0.0.1',
              keepAlive: true,
              keepAliveInitialDelay: 30000,
              timeout: 0,
              maxConnections: 0,
              noDelay: true,
              framing: framingConfig,
            },
            handlers: {
              onConnect: connectHandler,
              onData: framingConfig ? undefined : dataHandler,
              onMessage: framingConfig
                ? (dataHandler as unknown as TcpMessageHandler)
                : undefined,
              onClose: closeHandler,
              onError: errorHandler,
            },
          }
          tcpHandlers.push(tcpHandler)
          logger.debug({ name, port: options?.port }, 'Added TCP handler')
          return tcpNamespace
        },
      }

      return handlerBuilder
    },
    use(interceptor: Interceptor) {
      tcpInterceptors.push(interceptor)
      return tcpNamespace
    },
  }
  return tcpNamespace
}

// === UDP ===

export interface UdpNamespaceContext {
  udpHandlers: LoadedUdpHandler[]
  udpInterceptors: Interceptor[]
  logger: NamespaceLogger
}

export function createUdpNamespace(ctx: UdpNamespaceContext): UdpNamespace {
  const { udpHandlers, udpInterceptors, logger } = ctx

  const udpNamespace: UdpNamespace = {
    handler(name: string, options?: UdpHandlerOptions): UdpHandlerBuilder {
      let messageHandler: UdpMessageHandler | undefined
      let errorHandler: UdpErrorHandler | undefined

      const handlerBuilder: UdpHandlerBuilder = {
        onMessage(handler) {
          messageHandler = handler as unknown as UdpMessageHandler
          return handlerBuilder
        },
        onError(handler) {
          errorHandler = handler as unknown as UdpErrorHandler
          return handlerBuilder
        },
        end() {
          const multicastConfig = options?.multicast
            ? { group: options.multicast, ttl: 1, loopback: false }
            : null

          const udpHandler: LoadedUdpHandler = {
            name,
            filePath: '<programmatic>',
            config: {
              port: options?.port ?? 0,
              host: options?.host ?? '127.0.0.1',
              type: options?.type ?? 'udp4',
              reuseAddr: true,
              reusePort: false,
              recvBufferSize: 65536,
              sendBufferSize: 65536,
              ipv6Only: false,
              multicast: multicastConfig,
            },
            handlers: {
              onMessage: messageHandler!,
              onError: errorHandler,
            },
          }
          udpHandlers.push(udpHandler)
          logger.debug({ name, port: options?.port }, 'Added UDP handler')
          return udpNamespace
        },
      }

      return handlerBuilder
    },
    use(interceptor: Interceptor) {
      udpInterceptors.push(interceptor)
      return udpNamespace
    },
  }
  return udpNamespace
}

// === gRPC ===

export interface GrpcNamespaceContext {
  globalInterceptors: Interceptor[]
  grpcInterceptors: Interceptor[]
  registry: Registry
  schemaRegistry: SchemaRegistry
  normalizeInterceptors: (interceptors: Interceptor[], schema?: HandlerSchema) => Interceptor[]
  recordOperationRegistration: (name: string, registration: RuntimeInspectionOperationRegistration) => void
  programmaticSource: (kind?: RuntimeInspectionSource['kind']) => RuntimeInspectionSource
  logger: NamespaceLogger
}

export function createGrpcNamespace(ctx: GrpcNamespaceContext): GrpcNamespace {
  const {
    globalInterceptors,
    grpcInterceptors,
    registry,
    schemaRegistry,
    normalizeInterceptors,
    recordOperationRegistration,
    programmaticSource,
    logger,
  } = ctx

  const grpcNamespace: GrpcNamespace = {
    service(serviceName: string, serviceOptions?: GrpcServiceOptions): GrpcServiceBuilder {
      const packageName = serviceOptions?.packageName ?? ''
      const fullServiceName = packageName ? `${packageName}.${serviceName}` : serviceName

      const buildSchemaIfNeeded = (
        procedureName: string,
        options: GrpcMethodOptions
      ): HandlerSchema | undefined => {
        if (!options.input && !options.output) return undefined
        const schema: HandlerSchema = {}
        if (options.input) schema.input = options.input
        if (options.output) schema.output = options.output
        schemaRegistry.register(procedureName, schema)
        return schema
      }

      const serviceBuilder: GrpcServiceBuilder = {
        method(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject =
            typeof optionsOrHandler === 'object'
            && optionsOrHandler !== null
            && typeof maybeHandler === 'function'
          const options = isOptionsObject ? (optionsOrHandler as GrpcMethodOptions) : ({} as GrpcMethodOptions)
          const handler = isOptionsObject ? maybeHandler : (optionsOrHandler as ProcedureHandler)

          const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
          let interceptors = normalizeInterceptors([...globalInterceptors, ...grpcInterceptors])
          const schema = buildSchemaIfNeeded(procedureName, options)
          if (schema) interceptors = normalizeInterceptors(interceptors, schema)

          registry.procedure(procedureName, handler as ProcedureHandler, {
            description: options.description,
            grpc: { serviceName, methodName: name, type: 'unary' },
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
          recordOperationRegistration(procedureName, {
            source: programmaticSource('grpc-namespace'),
            grpc: { serviceName: fullServiceName, methodName: name, type: 'unary' },
          })
          logger.debug({ name: procedureName, type: 'unary' }, 'Added gRPC method')
          return serviceBuilder
        },

        serverStream(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject =
            typeof optionsOrHandler === 'object'
            && optionsOrHandler !== null
            && typeof maybeHandler === 'function'
          const options = isOptionsObject ? (optionsOrHandler as GrpcMethodOptions) : ({} as GrpcMethodOptions)
          const handler = isOptionsObject ? maybeHandler : (optionsOrHandler as StreamHandler)

          const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
          const interceptors = [...globalInterceptors, ...grpcInterceptors]
          buildSchemaIfNeeded(procedureName, options)

          registry.stream(procedureName, handler as StreamHandler, {
            description: options.description,
            direction: 'server',
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
          recordOperationRegistration(procedureName, {
            source: programmaticSource('grpc-namespace'),
            grpc: { serviceName: fullServiceName, methodName: name, type: 'server-streaming' },
          })
          logger.debug({ name: procedureName, type: 'server-stream' }, 'Added gRPC server stream')
          return serviceBuilder
        },

        clientStream(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject =
            typeof optionsOrHandler === 'object'
            && optionsOrHandler !== null
            && typeof maybeHandler === 'function'
          const options = isOptionsObject ? (optionsOrHandler as GrpcMethodOptions) : ({} as GrpcMethodOptions)
          const handler = isOptionsObject ? maybeHandler : (optionsOrHandler as StreamHandler)

          const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
          const interceptors = [...globalInterceptors, ...grpcInterceptors]
          buildSchemaIfNeeded(procedureName, options)

          registry.stream(procedureName, handler as StreamHandler, {
            description: options.description,
            direction: 'client',
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
          recordOperationRegistration(procedureName, {
            source: programmaticSource('grpc-namespace'),
            grpc: { serviceName: fullServiceName, methodName: name, type: 'client-streaming' },
          })
          logger.debug({ name: procedureName, type: 'client-stream' }, 'Added gRPC client stream')
          return serviceBuilder
        },

        bidiStream(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject =
            typeof optionsOrHandler === 'object'
            && optionsOrHandler !== null
            && typeof maybeHandler === 'function'
          const options = isOptionsObject ? (optionsOrHandler as GrpcMethodOptions) : ({} as GrpcMethodOptions)
          const handler = isOptionsObject ? maybeHandler : (optionsOrHandler as StreamHandler)

          const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
          const interceptors = [...globalInterceptors, ...grpcInterceptors]
          buildSchemaIfNeeded(procedureName, options)

          registry.stream(procedureName, handler as StreamHandler, {
            description: options.description,
            direction: 'bidi',
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
          recordOperationRegistration(procedureName, {
            source: programmaticSource('grpc-namespace'),
            grpc: { serviceName: fullServiceName, methodName: name, type: 'bidirectional' },
          })
          logger.debug({ name: procedureName, type: 'bidi-stream' }, 'Added gRPC bidi stream')
          return serviceBuilder
        },

        end() {
          return grpcNamespace
        },
      }

      return serviceBuilder
    },

    use(interceptor: Interceptor) {
      grpcInterceptors.push(interceptor)
      return grpcNamespace
    },
  }

  return grpcNamespace
}
