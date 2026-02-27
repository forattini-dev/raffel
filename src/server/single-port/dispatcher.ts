import type { ProtocolDecisionPayload, SinglePortProtocolKind } from '../types.js'
import type {
  SinglePortChunkDetectInput,
  SinglePortDefaults,
  SinglePortDetectorOptions,
  SinglePortStreamDetectInput,
} from './types.js'
import { DEFAULT_MAX_MESSAGE_SIZE } from '../../adapters/tcp.js'
import { getSinglePortProtocolAliases } from '../protocol-aliases.js'
import type { ProtocolAliasMode } from '../types.js'

const HTTP_PREFIXES = [
  'GET',
  'POST',
  'PUT',
  'HEAD',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT',
] as const

const HTTP2_PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'
const DETECTION_TIMEOUT_DEFAULT_MS = 75
const DETECTION_BYTES_DEFAULT = 4096
const CONCURRENT_DETECTION_DEFAULT = 256
const DEFAULT_SINGLE_PORTS: SinglePortDefaults = {
  sniffMaxBytes: DETECTION_BYTES_DEFAULT,
  sniffTimeoutMs: DETECTION_TIMEOUT_DEFAULT_MS,
  maxConcurrentDetections: CONCURRENT_DETECTION_DEFAULT,
}

let activeDetections = 0

function normalizeSinglePortProtocol(protocol: string): string {
  return protocol.trim().toLowerCase()
}

function normalizeSinglePortProtocols(
  protocols?: string[],
  protocolAliasMode: ProtocolAliasMode = 'standard'
): Set<string> | null {
  if (!protocols || protocols.length === 0) {
    return null
  }
  const aliases = getSinglePortProtocolAliases(protocolAliasMode)

  const normalized = protocols
    .map((protocol) => normalizeSinglePortProtocol(protocol))
    .filter((protocol) => protocol.length > 0)
    .map((protocol) => aliases[protocol as keyof typeof aliases] ?? protocol)

  return normalized.length > 0 ? new Set(normalized) : null
}

function isProtocolAllowed(protocol: string, allowedProtocols: Set<string> | null): boolean {
  if (!allowedProtocols) {
    return true
  }

  return allowedProtocols.has(protocol)
}

function createDecision(
  protocol: SinglePortProtocolKind,
  detector: string,
  reason: ProtocolDecisionPayload['reason'],
  elapsedMs: number,
  bytesRead: number,
  timedOut = false
): ProtocolDecisionPayload {
  return {
    protocol,
    detector,
    reason,
    elapsedMs,
    bytesRead,
    timedOut,
  }
}

function looksLikeHttp(chunk: Buffer): boolean {
  if (chunk.length < 4) return false
  const ascii = chunk.toString('ascii', 0, 8).toUpperCase()
  return HTTP_PREFIXES.some((method) => ascii.startsWith(method))
}

function isTlsClientHello(chunk: Buffer): boolean {
  return chunk.length >= 5 && chunk[0] === 0x16 && chunk[1] === 0x03
}

function isHttp2Preface(chunk: Buffer): boolean {
  if (chunk.length < HTTP2_PREFACE.length) return false
  return chunk.slice(0, HTTP2_PREFACE.length).equals(Buffer.from(HTTP2_PREFACE))
}

function isLikelyTcpFrame(chunk: Buffer): boolean {
  if (chunk.length < 4) return false
  const messageLength = chunk.readUInt32BE(0)
  return messageLength > 0 && messageLength <= DEFAULT_MAX_MESSAGE_SIZE
}

function isLikelyTextProtocolFrame(chunk: Buffer): boolean {
  if (chunk.length < 2) {
    return false
  }

  let printableCount = 0
  let hasLineBreak = false
  for (let i = 0; i < chunk.length; i += 1) {
    const byte = chunk[i]
    if (byte === 0x0d || byte === 0x0a) {
      hasLineBreak = true
      continue
    }
    if (byte < 0x20 || byte > 0x7e) {
      return false
    }
    if (byte !== 0x20 && byte !== 0x09) {
      printableCount += 1
    }
  }

  if (!hasLineBreak) {
    return false
  }

  return printableCount / chunk.length > 0.6
}

export function normalizeSinglePortDefaults(
  options?: SinglePortDetectorOptions
): SinglePortDefaults {
  return {
    sniffMaxBytes: options?.sniffMaxBytes ?? DEFAULT_SINGLE_PORTS.sniffMaxBytes,
    sniffTimeoutMs: options?.sniffTimeoutMs ?? DEFAULT_SINGLE_PORTS.sniffTimeoutMs,
    maxConcurrentDetections: options?.maxConcurrentDetections ?? DEFAULT_SINGLE_PORTS.maxConcurrentDetections,
  }
}

export function detectSinglePortProtocolFromChunk(
  input: SinglePortChunkDetectInput & SinglePortDetectorOptions
): ProtocolDecisionPayload {
  const startedAt = Date.now()
  const { sniffMaxBytes } = normalizeSinglePortDefaults(input)
  const chunk = input.chunk.slice(0, sniffMaxBytes)
  const bytesRead = chunk.length
  const allowedProtocols = normalizeSinglePortProtocols(
    input.protocols,
    input.protocolAliasMode ?? 'standard'
  )
  const hasProtocolFilter = !!allowedProtocols

  if (bytesRead === 0) {
    return createDecision(
      'unknown',
      'empty',
      hasProtocolFilter ? 'unsupported' : 'unknown',
      0,
      bytesRead
    )
  }

  if (isTlsClientHello(chunk) && isProtocolAllowed('tls', allowedProtocols)) {
    return createDecision('tls', 'tls', 'matched', Date.now() - startedAt, bytesRead)
  }

  if (isHttp2Preface(chunk) && isProtocolAllowed('http2', allowedProtocols)) {
    return createDecision('http2', 'http2-preface', 'matched', Date.now() - startedAt, bytesRead)
  }

  if (isLikelyTcpFrame(chunk) && isProtocolAllowed('tcp', allowedProtocols)) {
    return createDecision('tcp', 'tcp-length-prefix', 'matched', Date.now() - startedAt, bytesRead)
  }

  if (looksLikeHttp(chunk) && isProtocolAllowed('http', allowedProtocols)) {
    return createDecision('http', 'http-method', 'matched', Date.now() - startedAt, bytesRead)
  }

  if (isLikelyTextProtocolFrame(chunk) && isProtocolAllowed('tcp', allowedProtocols)) {
    return createDecision('tcp', 'text-protocol', 'matched', Date.now() - startedAt, bytesRead)
  }

  const sniffers = input.sniffers ?? []
  for (const sniffer of sniffers) {
    const result = sniffer.detect({
      chunk,
      bytesRead,
      context: input.context,
    })

    if (result && isProtocolAllowed(normalizeSinglePortProtocol(result), allowedProtocols)) {
      return createDecision(result, `sniffer:${sniffer.name}`, 'matched', Date.now() - startedAt, bytesRead)
    }
  }

  return createDecision(
    'unknown',
    'fallback',
    hasProtocolFilter ? 'unsupported' : 'unknown',
    Date.now() - startedAt,
    bytesRead
  )
}

function readWithTimeout(
  readChunk: () => Promise<Buffer | null>,
  timeoutMs: number
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve(null)
      }
    }, timeoutMs)

    readChunk().then((chunk) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(chunk)
    })
  })
}

export async function detectSinglePortProtocolFromStream(
  input: SinglePortStreamDetectInput & SinglePortDetectorOptions
): Promise<ProtocolDecisionPayload> {
  const startedAt = Date.now()
  const { sniffTimeoutMs, maxConcurrentDetections, sniffMaxBytes } = normalizeSinglePortDefaults(input)

  if (activeDetections >= maxConcurrentDetections) {
    return createDecision(
      'unknown',
      'concurrency',
      'concurrency_limit',
      Date.now() - startedAt,
      0,
      false
    )
  }

  activeDetections += 1

  try {
    const chunk = await readWithTimeout(input.readChunk, sniffTimeoutMs)
    if (chunk === null) {
      return createDecision(
        'unknown',
        'timeout',
        'timeout',
        Date.now() - startedAt,
        0,
        true
      )
    }

    return detectSinglePortProtocolFromChunk({
      ...input,
      chunk: chunk.slice(0, sniffMaxBytes),
    })
  } finally {
    activeDetections = Math.max(0, activeDetections - 1)
  }
}

export function getSinglePortConcurrencyState() {
  return {
    activeDetections,
    concurrencyLimit: DEFAULT_SINGLE_PORTS.maxConcurrentDetections,
  }
}
