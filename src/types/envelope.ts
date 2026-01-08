/**
 * Envelope Types
 *
 * The Envelope is the fundamental unit of communication in Raffel.
 * All data entering or leaving the core passes through it.
 */

import type { Context } from './context.js'
import { getStatusForCode } from '../errors/codes.js'

/**
 * Envelope message types
 */
export type EnvelopeType =
  | 'request'       // Procedure call (expects response)
  | 'response'      // Procedure response
  | 'stream:start'  // Stream initiation
  | 'stream:data'   // Stream data chunk
  | 'stream:end'    // Stream termination
  | 'stream:error'  // Stream error
  | 'event'         // Fire-and-forget event
  | 'error'         // Generic error

/**
 * Base Envelope structure
 */
export interface Envelope<T = unknown> {
  /** Unique message ID (sid) */
  id: string

  /** Procedure/stream/event name */
  procedure: string

  /** Message type */
  type: EnvelopeType

  /** Payload data (typed by the procedure) */
  payload: T

  /** Protocol metadata (headers, etc.) - strings only */
  metadata: Record<string, string>

  /** Request context */
  context: Context
}

/**
 * Error payload structure
 */
export interface ErrorPayload {
  /** String error code (e.g., 'NOT_FOUND', 'INVALID_INPUT') */
  code: string

  /** Numeric status code (HTTP-compatible, e.g., 404, 500) */
  status: number

  /** Human-readable message */
  message: string

  /** Additional details (stack in dev, metadata) */
  details?: unknown
}

/**
 * Error envelope
 */
export interface ErrorEnvelope extends Envelope<ErrorPayload> {
  type: 'error' | 'stream:error'
  payload: ErrorPayload
}

/**
 * Create a response envelope from a request
 */
export function createResponseEnvelope<T>(
  request: Envelope,
  payload: T
): Envelope<T> {
  return {
    id: `${request.id}:response`,
    procedure: request.procedure,
    type: 'response',
    payload,
    metadata: {},
    context: request.context,
  }
}

/**
 * Create an error envelope from a request
 */
export function createErrorEnvelope(
  request: Envelope,
  code: string,
  message: string,
  details?: unknown,
  status?: number
): ErrorEnvelope {
  return {
    id: `${request.id}:error`,
    procedure: request.procedure,
    type: 'error',
    payload: {
      code,
      status: status ?? getStatusForCode(code),
      message,
      details,
    },
    metadata: {},
    context: request.context,
  }
}
