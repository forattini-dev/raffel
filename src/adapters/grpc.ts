/**
 * gRPC Adapter
 *
 * Exposes Raffel services over gRPC with proto-based service definitions.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { Context, Envelope } from '../types/index.js'
import { createContext } from '../types/context.js'
import { createStream } from '../stream/raffel-stream.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('grpc-adapter')

export interface GrpcTlsOptions {
  key: string | Buffer
  cert: string | Buffer
  ca?: string | Buffer
  requireClientCert?: boolean
}

export interface GrpcMethodInfo {
  serviceName: string
  methodName: string
  fullName: string
  requestStream: boolean
  responseStream: boolean
}

/**
 * Base interface for gRPC server calls
 * (ServerCall is not exported from @grpc/grpc-js, so we define what we need)
 */
interface GrpcServerCallBase {
  metadata: grpc.Metadata
  cancelled: boolean
  getDeadline?(): grpc.Deadline
  on(event: string, listener: (...args: unknown[]) => void): void
}

export interface GrpcAdapterOptions {
  port: number
  host?: string
  protoPath: string | string[]
  packageName?: string
  serviceNames?: string[]
  loaderOptions?: protoLoader.Options
  tls?: GrpcTlsOptions
  maxReceiveMessageLength?: number
  maxSendMessageLength?: number
  contextFactory?: (
    call: GrpcServerCallBase,
    method: GrpcMethodInfo
  ) => Partial<Context>
}

export interface GrpcAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  readonly server: grpc.Server | null
  readonly address: { host: string; port: number } | null
}

function createAbortableContext(
  requestId: string,
  overrides: Partial<Context> | undefined,
  abortController: AbortController
): Context {
  const { signal: upstreamSignal, ...rest } = overrides ?? {}

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortController.abort(upstreamSignal.reason)
    } else {
      upstreamSignal.addEventListener(
        'abort',
        () => {
          abortController.abort(upstreamSignal.reason)
        },
        { once: true }
      )
    }
  }

  return createContext(
    requestId,
    { ...(rest as Partial<Omit<Context, 'requestId' | 'extensions'>>), signal: abortController.signal }
  )
}

function metadataToRecord(metadata: grpc.Metadata): Record<string, string> {
  const map = metadata.getMap()
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(map)) {
    const values = Array.isArray(value) ? value : [value]
    const normalized = values.map((item) =>
      Buffer.isBuffer(item) ? item.toString('base64') : String(item)
    )
    result[key] = normalized.join(', ')
  }

  return result
}

function mapErrorCodeToStatus(code: string): grpc.status {
  switch (code) {
    case 'NOT_FOUND':
      return grpc.status.NOT_FOUND
    case 'INVALID_ARGUMENT':
    case 'VALIDATION_ERROR':
      return grpc.status.INVALID_ARGUMENT
    case 'UNAUTHENTICATED':
      return grpc.status.UNAUTHENTICATED
    case 'PERMISSION_DENIED':
      return grpc.status.PERMISSION_DENIED
    case 'ALREADY_EXISTS':
      return grpc.status.ALREADY_EXISTS
    case 'FAILED_PRECONDITION':
      return grpc.status.FAILED_PRECONDITION
    case 'RESOURCE_EXHAUSTED':
    case 'RATE_LIMITED':
      return grpc.status.RESOURCE_EXHAUSTED
    case 'DEADLINE_EXCEEDED':
      return grpc.status.DEADLINE_EXCEEDED
    case 'UNIMPLEMENTED':
      return grpc.status.UNIMPLEMENTED
    case 'UNAVAILABLE':
      return grpc.status.UNAVAILABLE
    case 'CANCELLED':
      return grpc.status.CANCELLED
    case 'DATA_LOSS':
      return grpc.status.DATA_LOSS
    case 'OUTPUT_VALIDATION_ERROR':
    case 'INTERNAL_ERROR':
    default:
      return grpc.status.INTERNAL
  }
}

function toServiceError(code: string, message: string): grpc.ServiceError {
  const error = new Error(message) as grpc.ServiceError
  error.code = mapErrorCodeToStatus(code)
  error.details = message
  return error
}

function mapServiceName(packageName: string | undefined, serviceName: string): string {
  if (!packageName) return serviceName
  return `${packageName}.${serviceName}`
}

function collectServices(
  root: Record<string, unknown>,
  prefix = ''
): Array<{ name: string; service: grpc.ServiceDefinition }> {
  const services: Array<{ name: string; service: grpc.ServiceDefinition }> = []

  for (const [key, value] of Object.entries(root)) {
    const currentName = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'function' && (value as any).service) {
      services.push({ name: currentName, service: (value as any).service })
      continue
    }
    if (value && typeof value === 'object') {
      services.push(...collectServices(value as Record<string, unknown>, currentName))
    }
  }

  return services
}

function selectPackage(
  root: Record<string, unknown>,
  packageName?: string
): Record<string, unknown> {
  if (!packageName) return root
  const parts = packageName.split('.').filter(Boolean)
  let current: Record<string, unknown> | undefined = root
  for (const part of parts) {
    const next = current?.[part]
    if (!next || typeof next !== 'object') {
      throw new Error(`Package '${packageName}' not found in proto definition`)
    }
    current = next as Record<string, unknown>
  }
  return current ?? root
}

export function createGrpcAdapter(
  router: Router,
  options: GrpcAdapterOptions
): GrpcAdapter {
  const {
    port,
    host = '0.0.0.0',
    protoPath,
    packageName,
    serviceNames,
    loaderOptions,
    tls,
    maxReceiveMessageLength,
    maxSendMessageLength,
  } = options

  let server: grpc.Server | null = null
  let address: { host: string; port: number } | null = null

  function createServerCredentials(): grpc.ServerCredentials {
    if (!tls) {
      return grpc.ServerCredentials.createInsecure()
    }

    const keyCertPair = {
      private_key: typeof tls.key === 'string' ? Buffer.from(tls.key) : tls.key,
      cert_chain: typeof tls.cert === 'string' ? Buffer.from(tls.cert) : tls.cert,
    }

    const rootCerts = tls.ca
      ? typeof tls.ca === 'string'
        ? Buffer.from(tls.ca)
        : tls.ca
      : null

    return grpc.ServerCredentials.createSsl(
      rootCerts,
      [keyCertPair],
      tls.requireClientCert ?? false
    )
  }

  function buildContext(
    call: GrpcServerCallBase,
    method: GrpcMethodInfo
  ): { ctx: Context; metadata: Record<string, string> } {
    const metadata = metadataToRecord(call.metadata)
    const requestId = metadata['x-request-id'] ?? sid()
    const abortController = new AbortController()

    const ctx = createAbortableContext(
      requestId,
      options.contextFactory?.(call, method),
      abortController
    )

    const deadline = call.getDeadline?.()
    if (deadline instanceof Date) {
      ctx.deadline = deadline.getTime()
    } else if (typeof deadline === 'number' && Number.isFinite(deadline)) {
      ctx.deadline = deadline
    }

    const abort = (reason: string) => {
      if (!abortController.signal.aborted) {
        abortController.abort(reason)
      }
    }

    call.on('cancelled', () => abort('gRPC call cancelled'))
    call.on('close', () => {
      if (call.cancelled) {
        abort('gRPC call cancelled')
      }
    })

    return { ctx, metadata }
  }

  function createEnvelope(
    requestId: string,
    procedure: string,
    type: Envelope['type'],
    payload: unknown,
    metadata: Record<string, string>,
    ctx: Context
  ): Envelope {
    return {
      id: requestId,
      procedure,
      type,
      payload,
      metadata,
      context: ctx,
    }
  }

  async function handleUnary(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
    method: GrpcMethodInfo
  ): Promise<void> {
    const { ctx, metadata } = buildContext(call, method)
    const envelope = createEnvelope(ctx.requestId, method.fullName, 'request', call.request, metadata, ctx)

    try {
      const result = await router.handle(envelope)
      if (!result || typeof result !== 'object' || !('type' in result)) {
        callback(toServiceError('INTERNAL_ERROR', 'Invalid router response'))
        return
      }

      const responseEnvelope = result as Envelope
      if (responseEnvelope.type === 'error') {
        const errorPayload = responseEnvelope.payload as { code: string; message: string }
        callback(toServiceError(errorPayload.code, errorPayload.message))
        return
      }

      callback(null, responseEnvelope.payload)
    } catch (err) {
      const error = err as Error
      callback(toServiceError('INTERNAL_ERROR', error.message ?? 'Internal error'))
    }
  }

  async function handleServerStream(
    call: grpc.ServerWritableStream<any, any>,
    method: GrpcMethodInfo
  ): Promise<void> {
    const { ctx, metadata } = buildContext(call, method)
    const envelope = createEnvelope(ctx.requestId, method.fullName, 'stream:start', call.request, metadata, ctx)

    try {
      const result = await router.handle(envelope)
      if (!result || typeof result !== 'object' || !(Symbol.asyncIterator in result)) {
        call.emit('error', toServiceError('INTERNAL_ERROR', 'Handler did not return a stream'))
        return
      }

      for await (const chunk of result as AsyncIterable<Envelope>) {
        if (ctx.signal.aborted || call.cancelled) break

        const response = chunk as Envelope
        if (response.type === 'stream:data') {
          call.write(response.payload)
        } else if (response.type === 'stream:end') {
          call.end()
          break
        } else if (response.type === 'stream:error') {
          const errorPayload = response.payload as { code: string; message: string }
          call.emit('error', toServiceError(errorPayload.code, errorPayload.message))
          call.end()
          break
        } else if (response.type === 'error') {
          const errorPayload = response.payload as { code: string; message: string }
          call.emit('error', toServiceError(errorPayload.code, errorPayload.message))
          call.end()
          break
        }
      }
    } catch (err) {
      const error = err as Error
      call.emit('error', toServiceError('INTERNAL_ERROR', error.message ?? 'Internal error'))
    }
  }

  async function handleClientStream(
    call: grpc.ServerReadableStream<any, any>,
    callback: grpc.sendUnaryData<any>,
    method: GrpcMethodInfo
  ): Promise<void> {
    const { ctx, metadata } = buildContext(call, method)
    const inputStream = createStream<any>()

    call.on('data', (chunk) => {
      call.pause()
      inputStream
        .write(chunk)
        .catch((err) => inputStream.error(err as Error))
        .finally(() => call.resume())
    })

    call.on('end', () => {
      inputStream.end()
    })

    call.on('error', (err) => {
      inputStream.error(err as Error)
    })

    const envelope = createEnvelope(ctx.requestId, method.fullName, 'stream:start', inputStream, metadata, ctx)

    try {
      const result = await router.handle(envelope)
      if (!result || typeof result !== 'object' || !('type' in result)) {
        callback(toServiceError('INTERNAL_ERROR', 'Invalid router response'))
        return
      }

      const responseEnvelope = result as Envelope
      if (responseEnvelope.type === 'error') {
        const errorPayload = responseEnvelope.payload as { code: string; message: string }
        callback(toServiceError(errorPayload.code, errorPayload.message))
        return
      }

      callback(null, responseEnvelope.payload)
    } catch (err) {
      const error = err as Error
      callback(toServiceError('INTERNAL_ERROR', error.message ?? 'Internal error'))
    }
  }

  async function handleBidiStream(
    call: grpc.ServerDuplexStream<any, any>,
    method: GrpcMethodInfo
  ): Promise<void> {
    const { ctx, metadata } = buildContext(call, method)
    const inputStream = createStream<any>()

    call.on('data', (chunk) => {
      call.pause()
      inputStream
        .write(chunk)
        .catch((err) => inputStream.error(err as Error))
        .finally(() => call.resume())
    })

    call.on('end', () => {
      inputStream.end()
    })

    call.on('error', (err) => {
      inputStream.error(err as Error)
    })

    const envelope = createEnvelope(ctx.requestId, method.fullName, 'stream:start', inputStream, metadata, ctx)

    try {
      const result = await router.handle(envelope)
      if (!result || typeof result !== 'object' || !(Symbol.asyncIterator in result)) {
        call.emit('error', toServiceError('INTERNAL_ERROR', 'Handler did not return a stream'))
        return
      }

      for await (const chunk of result as AsyncIterable<Envelope>) {
        if (ctx.signal.aborted || call.cancelled) break

        const response = chunk as Envelope
        if (response.type === 'stream:data') {
          call.write(response.payload)
        } else if (response.type === 'stream:end') {
          call.end()
          break
        } else if (response.type === 'stream:error') {
          const errorPayload = response.payload as { code: string; message: string }
          call.emit('error', toServiceError(errorPayload.code, errorPayload.message))
          call.end()
          break
        } else if (response.type === 'error') {
          const errorPayload = response.payload as { code: string; message: string }
          call.emit('error', toServiceError(errorPayload.code, errorPayload.message))
          call.end()
          break
        }
      }
    } catch (err) {
      const error = err as Error
      call.emit('error', toServiceError('INTERNAL_ERROR', error.message ?? 'Internal error'))
    }
  }

  function createImplementation(
    serviceName: string,
    serviceDef: grpc.ServiceDefinition
  ): grpc.UntypedServiceImplementation {
    const implementation: grpc.UntypedServiceImplementation = {}

    for (const [methodName, methodDef] of Object.entries(serviceDef)) {
      const definition = methodDef as grpc.MethodDefinition<any, any>
      const fullName = `${serviceName}.${methodName}`
      const methodInfo: GrpcMethodInfo = {
        serviceName,
        methodName,
        fullName,
        requestStream: definition.requestStream ?? false,
        responseStream: definition.responseStream ?? false,
      }

      if (!definition.requestStream && !definition.responseStream) {
        implementation[methodName] = (
          call: grpc.ServerUnaryCall<unknown, unknown>,
          callback: grpc.sendUnaryData<unknown>
        ) => {
          void handleUnary(call, callback, methodInfo)
        }
      } else if (!definition.requestStream && definition.responseStream) {
        implementation[methodName] = (call: grpc.ServerWritableStream<unknown, unknown>) => {
          void handleServerStream(call, methodInfo)
        }
      } else if (definition.requestStream && !definition.responseStream) {
        implementation[methodName] = (
          call: grpc.ServerReadableStream<unknown, unknown>,
          callback: grpc.sendUnaryData<unknown>
        ) => {
          void handleClientStream(call, callback, methodInfo)
        }
      } else {
        implementation[methodName] = (call: grpc.ServerDuplexStream<unknown, unknown>) => {
          void handleBidiStream(call, methodInfo)
        }
      }
    }

    return implementation
  }

  return {
    get server() {
      return server
    },
    get address() {
      return address
    },
    async start(): Promise<void> {
      if (server) {
        throw new Error('gRPC server is already running')
      }

      const serverOptions: grpc.ServerOptions = {}
      if (maxReceiveMessageLength !== undefined) {
        serverOptions['grpc.max_receive_message_length'] = maxReceiveMessageLength
      }
      if (maxSendMessageLength !== undefined) {
        serverOptions['grpc.max_send_message_length'] = maxSendMessageLength
      }

      server = new grpc.Server(serverOptions)

      const loaderDefaults: protoLoader.Options = {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      }

      const packageDefinition = protoLoader.loadSync(
        Array.isArray(protoPath) ? protoPath : [protoPath],
        { ...loaderDefaults, ...(loaderOptions ?? {}) }
      )

      const loaded = grpc.loadPackageDefinition(packageDefinition) as Record<string, unknown>
      const root = selectPackage(loaded, packageName)
      const services = collectServices(root)
      const filtered = serviceNames
        ? services.filter((service) => {
          const fullName = mapServiceName(packageName, service.name)
          return serviceNames.includes(service.name) || serviceNames.includes(fullName)
        })
        : services

      if (filtered.length === 0) {
        throw new Error('No gRPC services found for adapter')
      }

      for (const service of filtered) {
        const serviceName = mapServiceName(packageName, service.name)
        server.addService(service.service, createImplementation(serviceName, service.service))
      }

      const credentials = createServerCredentials()
      const boundPort = await new Promise<number>((resolve, reject) => {
        server!.bindAsync(`${host}:${port}`, credentials, (err, portNumber) => {
          if (err) {
            reject(err)
            return
          }
          resolve(portNumber)
        })
      })

      address = { host, port: boundPort }
      logger.info({ host, port: boundPort }, 'gRPC server listening')
    },
    async stop(): Promise<void> {
      if (!server) return

      const current = server
      server = null
      address = null

      await new Promise<void>((resolve, reject) => {
        current.tryShutdown((err) => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
      })

      logger.info('gRPC server stopped')
    },
  }
}
