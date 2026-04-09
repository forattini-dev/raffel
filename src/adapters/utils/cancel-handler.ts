/**
 * Shared cancel and cleanup logic for TCP and WebSocket adapters.
 */

export interface CancellableClient {
  activeStreams: Map<string, AbortController>
  activeRequests: Map<string, AbortController>
}

export type SendErrorFn = (
  client: CancellableClient,
  code: string,
  message: string,
  requestId?: string,
  envelopeType?: string
) => void

/**
 * Handle a cancel message from a client.
 * Returns true if the message was a cancel message (handled), false otherwise.
 */
export function handleCancelMessage(
  client: CancellableClient,
  parsed: Record<string, unknown>,
  sendError: SendErrorFn
): boolean {
  if (parsed.type !== 'cancel') return false
  const requestId = parsed.id !== undefined ? String(parsed.id) : undefined
  if (!requestId) return true

  const streamController = client.activeStreams.get(requestId)
  if (streamController) {
    streamController.abort('Client cancelled')
    client.activeStreams.delete(requestId)
    sendError(client, 'CANCELLED', 'Stream cancelled', requestId, 'stream:error')
    return true
  }

  const requestController = client.activeRequests.get(requestId)
  if (requestController) {
    requestController.abort('Client cancelled')
    client.activeRequests.delete(requestId)
    sendError(client, 'CANCELLED', 'Request cancelled', requestId)
    return true
  }

  return true
}

/**
 * Abort all active streams and requests for a disconnecting client.
 */
export function cleanupClientConnections(client: CancellableClient): void {
  for (const controller of client.activeStreams.values()) {
    controller.abort('Client disconnected')
  }
  client.activeStreams.clear()
  for (const controller of client.activeRequests.values()) {
    controller.abort('Client disconnected')
  }
  client.activeRequests.clear()
}
