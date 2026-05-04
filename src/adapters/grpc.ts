/**
 * gRPC Adapter
 *
 * Exposes Raffel services over gRPC with proto-based service definitions.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { Context, Envelope, ContextSeed } from '../types/index.js'
import { mergeContextSeeds } from '../types/index.js'
import { createAbortableContextAsync } from '../utils/context-utils.js'
import { createStream } from '../stream/raffel-stream.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('grpc-adapter')

import { resolveTlsOptions, type TlsOptions } from '../utils/tls.js'
import { isAsyncIterable } from '../utils/type-guards.js'

export interface GrpcTlsOptions extends TlsOptions {
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
  /**
   * TLS configuration.
   * - `true`: auto-generates a self-signed certificate
   * - `GrpcTlsOptions`: inline PEM, file paths, or env vars
   */
  tls?: boolean | GrpcTlsOptions
  maxReceiveMessageLength?: number
  maxSendMessageLength?: number
  contextFactory?: (
    call: GrpcServerCallBase,
    method: GrpcMethodInfo
  ) => ContextSeed | Promise<ContextSeed>
}

export interface GrpcAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  readonly server: grpc.Server | null
  readonly address: { host: string; port: number } | null
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
    case 'INVALID_TYPE':
    case 'INVALID_ENVELOPE':
    case 'PARSE_ERROR':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return grpc.status.INVALID_ARGUMENT
    case 'UNAUTHENTICATED':
      return grpc.status.UNAUTHENTICATED
    case 'PERMISSION_DENIED':
      return grpc.status.PERMISSION_DENIED
    case 'ALREADY_EXISTS':
      return grpc.status.ALREADY_EXISTS
    case 'NOT_ACCEPTABLE':
    case 'FAILED_PRECONDITION':
    case 'UNPROCESSABLE_ENTITY':
      return grpc.status.FAILED_PRECONDITION
    case 'RESOURCE_EXHAUSTED':
    case 'RATE_LIMITED':
    case 'PAYLOAD_TOO_LARGE':
    case 'MESSAGE_TOO_LARGE':
      return grpc.status.RESOURCE_EXHAUSTED
    case 'DEADLINE_EXCEEDED':
      return grpc.status.DEADLINE_EXCEEDED
    case 'UNIMPLEMENTED':
      return grpc.status.UNIMPLEMENTED
    case 'UNAVAILABLE':
    case 'BAD_GATEWAY':
    case 'GATEWAY_TIMEOUT':
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

  async function createServerCredentials(): Promise<grpc.ServerCredentials> {
    if (!tls) {
      return grpc.ServerCredentials.createInsecure()
    }

    const tlsConfig = tls === true ? {} : tls
    const resolved = await resolveTlsOptions(tlsConfig)

    const keyCertPair = {
      private_key: resolved.key,
      cert_chain: resolved.cert,
    }

    return grpc.ServerCredentials.createSsl(
      resolved.ca ?? null,
      [keyCertPair],
      tlsConfig.requireClientCert ?? false
    )
  }

  async function buildContext(
    call: GrpcServerCallBase,
    method: GrpcMethodInfo
  ): Promise<{ ctx: Context; metadata: Record<string, string> }> {
    const metadata = metadataToRecord(call.metadata)
    const requestId = metadata['x-request-id'] ?? sid()
    const abortController = new AbortController()

    const ctx = await createAbortableContextAsync(
      requestId,
      mergeContextSeeds(
        {
          protocol: 'grpc',
          input: {
            metadata,
          },
          grpc: {
            kind: 'grpc',
            service: method.serviceName,
            method: method.methodName,
            metadata,
          },
        },
        await options.contextFactory?.(call, method)
      ),
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
    const { ctx, metadata } = await buildContext(call, method)
    ctx.input = {
      ...ctx.input,
      body: call.request,
    }
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

  /**
   * Pump router stream chunks out to a gRPC writable/duplex call. Shared
   * by handleServerStream (server-streaming) and handleBidiStream
   * (bidirectional). Translates Raffel envelopes (`stream:data`,
   * `stream:end`, `stream:error`, `error`) into gRPC write/end/error
   * calls. Returns when the stream is exhausted, errored, cancelled, or
   * its context is aborted.
   */
  async function pumpRouterStreamToGrpc(
    call: grpc.ServerWritableStream<any, any> | grpc.ServerDuplexStream<any, any>,
    ctx: Context,
    envelope: Envelope,
  ): Promise<void> {
    try {
      const result = await router.handle(envelope)
      if (!isAsyncIterable(result)) {
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
        } else if (response.type === 'stream:error' || response.type === 'error') {
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

  async function handleServerStream(
    call: grpc.ServerWritableStream<any, any>,
    method: GrpcMethodInfo
  ): Promise<void> {
    const { ctx, metadata } = await buildContext(call, method)
    ctx.input = {
      ...ctx.input,
      body: call.request,
    }
    const envelope = createEnvelope(ctx.requestId, method.fullName, 'stream:start', call.request, metadata, ctx)
    await pumpRouterStreamToGrpc(call, ctx, envelope)
  }

  /**
   * Wire a gRPC inbound stream call into a Raffel input stream and the
   * surrounding context/envelope. Shared by client-stream and bidi-stream
   * handlers — both consume the call's data/end/error events identically
   * and produce a 'stream:start' envelope.
   */
  async function buildInputStreamEnvelope(
    call: grpc.ServerReadableStream<any, any> | grpc.ServerDuplexStream<any, any>,
    method: GrpcMethodInfo,
    mode: 'client' | 'bidi',
  ): Promise<{ ctx: Context; metadata: Record<string, string>; envelope: Envelope; inputStream: ReturnType<typeof createStream> }> {
    const { ctx, metadata } = await buildContext(call as never, method)
    ctx.stream = { kind: 'stream', mode, id: ctx.requestId }
    const inputStream = createStream<any>()

    call.on('data', (chunk) => {
      call.pause()
      inputStream
        .write(chunk)
        .catch((err) => inputStream.error(err as Error))
        .finally(() => call.resume())
    })
    call.on('end', () => { inputStream.end() })
    call.on('error', (err) => { inputStream.error(err as Error) })

    const envelope = createEnvelope(ctx.requestId, method.fullName, 'stream:start', inputStream, metadata, ctx)
    return { ctx, metadata, envelope, inputStream }
  }

  async function handleClientStream(
    call: grpc.ServerReadableStream<any, any>,
    callback: grpc.sendUnaryData<any>,
    method: GrpcMethodInfo
  ): Promise<void> {
    const { envelope } = await buildInputStreamEnvelope(call, method, 'client')

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
    const { ctx, envelope } = await buildInputStreamEnvelope(call, method, 'bidi')
    await pumpRouterStreamToGrpc(call, ctx, envelope)
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

      const credentials = await createServerCredentials()
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
