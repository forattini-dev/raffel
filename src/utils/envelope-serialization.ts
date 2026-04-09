import type { Envelope } from '../types/envelope.js'

/**
 * Serialize an envelope for wire transmission.
 * Explicitly picks only wire-safe fields, stripping context.
 */
export function serializeEnvelope(envelope: Envelope): string {
  return JSON.stringify({
    id: envelope.id,
    procedure: envelope.procedure,
    type: envelope.type,
    payload: envelope.payload,
    metadata: envelope.metadata,
  })
}
