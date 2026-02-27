import type { Socket } from 'node:net'
import { sid } from '../../utils/id/index.js'
import type { ProtocolDecisionPayload, SinglePortConfig } from '../types.js'
import { detectSinglePortProtocolFromStream } from '../single-port/index.js'

export interface SinglePortLogger {
  debug: (context: Record<string, unknown>, message: string) => void
  warn: (context: Record<string, unknown>, message: string) => void
}

interface SinglePortTcpConnectionHandler {
  handleConnection: (socket: Socket) => void
}

export function createSinglePortUnsupportedResponse(
  decision: ProtocolDecisionPayload,
  connectionId: string
): string {
  const payload = JSON.stringify({
    error: {
      code: 'UNSUPPORTED_PROTOCOL',
      message: 'Connection rejected by single-port protocol classifier',
      details: {
        connectionId,
        protocol: decision.protocol,
        detector: decision.detector,
        reason: decision.reason,
        elapsedMs: decision.elapsedMs,
        bytesRead: decision.bytesRead,
        timedOut: decision.timedOut,
        timestamp: new Date().toISOString(),
      },
    },
  })

  return [
    'HTTP/1.1 400 Bad Request',
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(payload)}`,
    'Connection: close',
    '',
    payload,
  ].join('\r\n')
}

export function getSinglePortTcpHost(protocolsHost?: string): string {
  return protocolsHost ?? '0.0.0.0'
}

export function getSinglePortUdpHost(handlerHost?: string): string {
  return handlerHost ?? '0.0.0.0'
}

export function isSinglePortTcpHostCompatible(host: string, sharedHost: string): boolean {
  return host === '0.0.0.0' || sharedHost === '0.0.0.0' || host === sharedHost
}

export function isSinglePortTcpRouteEnabled(
  singlePortEnabled: boolean,
  tcpRouteEnabled: boolean | undefined,
  tcpRoutePort: number | undefined,
  tcpRouteHost: string | undefined,
  effectiveHost: string,
  effectivePort: number
): boolean {
  if (!singlePortEnabled || !tcpRouteEnabled) {
    return false
  }
  if (tcpRoutePort == null) {
    return false
  }

  const tcpHost = getSinglePortTcpHost(tcpRouteHost)
  return tcpRoutePort === effectivePort && isSinglePortTcpHostCompatible(effectiveHost, tcpHost)
}

export function isSinglePortUdpRouteEnabled(
  singlePortEnabled: boolean,
  udpRoutePort: number,
  udpRouteHost: string | undefined,
  effectiveHost: string,
  effectivePort: number
): boolean {
  if (!singlePortEnabled) {
    return false
  }

  const udpHost = getSinglePortUdpHost(udpRouteHost)
  return udpRoutePort === effectivePort && isSinglePortTcpHostCompatible(effectiveHost, udpHost)
}

export interface HandleSinglePortConnectionInput {
  socket: Socket
  singlePortConfig: SinglePortConfig
  getSinglePortAliasMode: () => 'standard' | 'extended'
  getSinglePortTcpConnectionHandler: () => SinglePortTcpConnectionHandler | null
  logger: SinglePortLogger
  /** Called for HTTP connections so the caller can forward to an http.Server without double-parse */
  onHttp?: (socket: Socket, firstChunk: Buffer) => void
}

export async function handleSinglePortConnection(
  input: HandleSinglePortConnectionInput
): Promise<void> {
  const socket = input.socket
  const connectionId = sid()
  const remoteAddress = socket.remoteAddress
  const remotePort = socket.remotePort
  let firstChunk: Buffer | null = null
  let cleanupReadChunk: (() => void) | null = null
  let forwardedToProtocol = false
  const getSinglePortTcpConnectionHandler = input.getSinglePortTcpConnectionHandler

  const readChunk = () => new Promise<Buffer | null>((resolve) => {
    let resolved = false
    const done = (chunk: Buffer | null) => {
      if (resolved) return
      resolved = true
      cleanupReadChunk?.()
      resolve(chunk)
    }

    const onData = (chunk: Buffer) => {
      firstChunk = chunk
      done(chunk)
    }
    const onError = () => done(null)
    const onClose = () => done(null)
    const onEnd = () => done(null)
    cleanupReadChunk = () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      socket.off('end', onEnd)
      cleanupReadChunk = null
    }

    if (socket.destroyed) {
      done(null)
      return
    }

    socket.once('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.once('end', onEnd)
    socket.resume()
  })

  try {
    socket.pause()
    const decision = await detectSinglePortProtocolFromStream({
      readChunk,
      sniffers: input.singlePortConfig.sniffers,
      protocols: input.singlePortConfig.protocols,
      protocolAliasMode: input.getSinglePortAliasMode(),
      sniffMaxBytes: input.singlePortConfig.sniffMaxBytes,
      sniffTimeoutMs: input.singlePortConfig.sniffTimeoutMs,
      maxConcurrentDetections: input.singlePortConfig.maxConcurrentDetections,
      context: {
        remoteAddress: remoteAddress,
        remotePort: remotePort,
        connectionId,
        bytesRead: 0,
      },
    })

    input.logger.debug(
      {
        connectionId,
        protocol: decision.protocol,
        detector: decision.detector,
        reason: decision.reason,
        elapsedMs: decision.elapsedMs,
        bytesRead: decision.bytesRead,
        remoteAddress,
        remotePort,
      },
      'Single-port protocol decision'
    )

    const capturedChunk = firstChunk as Buffer | null
    if (decision.protocol === 'http' && capturedChunk !== null && capturedChunk.length > 0) {
      forwardedToProtocol = true
      if (input.onHttp) {
        input.onHttp(socket, capturedChunk)
      } else {
        socket.unshift(capturedChunk)
        socket.resume()
      }
      return
    }

    const connectionHandler = getSinglePortTcpConnectionHandler()
    if (
      decision.protocol === 'tcp'
      && connectionHandler !== null
      && capturedChunk !== null
      && capturedChunk.length > 0
    ) {
      forwardedToProtocol = true
      socket.unshift(capturedChunk)
      connectionHandler.handleConnection(socket)
      socket.resume()
      return
    }

    const response = createSinglePortUnsupportedResponse(decision, connectionId)
    if (!socket.destroyed && socket.writable) {
      socket.end(response)
    } else {
      socket.destroy()
    }
  } catch (err) {
    input.logger.warn({ err, connectionId }, 'Single-port protocol detection failed')
    if (!socket.destroyed) {
      socket.destroy()
    }
  } finally {
    const cleanup = cleanupReadChunk as (() => void) | null
    if (cleanup !== null) cleanup()
    if (!forwardedToProtocol && !socket.destroyed) {
      socket.pause()
    }
  }
}
