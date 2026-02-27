import type {
  ProtocolDecisionPayload,
  ProtocolSniffer,
  ProtocolSnifferContext,
  SinglePortProtocolKind,
  ProtocolAliasMode,
} from '../types.js'

export interface SinglePortDetectorOptions {
  /** Maximum bytes consumed for protocol detection */
  sniffMaxBytes?: number
  /** Timeout (ms) for reading the first protocol packet */
  sniffTimeoutMs?: number
  /** Maximum concurrent detection operations */
  maxConcurrentDetections?: number
  /** Custom protocol sniffers executed after built-in detectors */
  sniffers?: ProtocolSniffer[]
  /** Optional protocol allowlist used to skip detections */
  protocols?: string[]
  /** Alias expansion mode for protocol names in allowlist. */
  protocolAliasMode?: ProtocolAliasMode
  /** Optional context shared across detectors */
  context?: ProtocolSnifferContext
}

export interface SinglePortStreamDetectInput {
  /** Async chunk reader from the protocol stream */
  readChunk: () => Promise<Buffer | null>
  /** Optional context shared across detectors */
  context?: ProtocolSnifferContext
}

export interface SinglePortChunkDetectInput {
  chunk: Buffer
  /** Optional context shared across detectors */
  context?: ProtocolSnifferContext
}

export interface SinglePortDetectionContext {
  detector: string
  protocol: SinglePortProtocolKind
  reason: ProtocolDecisionPayload['reason']
  elapsedMs: number
  bytesRead: number
  timedOut: boolean
}

export interface SinglePortStreamDetectionResult extends SinglePortDetectionContext {}
export interface SinglePortChunkDetectionResult extends SinglePortDetectionContext {}

export interface SinglePortDefaults {
  sniffMaxBytes: number
  sniffTimeoutMs: number
  maxConcurrentDetections: number
}
