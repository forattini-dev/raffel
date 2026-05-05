import type { ContextSeed } from '../types/index.js'
import type { ClientConnection, WebSocketClientInfo } from './websocket-types.js'

export function buildWebSocketSeed(
  client: ClientConnection,
  metadata: Record<string, string>,
  body?: unknown
): ContextSeed {
  const url = new URL(client.request.url || '/', 'http://localhost')
  return {
    protocol: 'websocket',
    input: {
      body,
      metadata,
    },
    ws: {
      kind: 'websocket',
      connectionId: client.id,
      path: url.pathname,
      subprotocol: client.ws.protocol || undefined,
    },
  }
}

export function toWebSocketClientInfo(
  client: ClientConnection,
  connectedAt = client.connectedAt
): WebSocketClientInfo {
  return {
    id: client.id,
    remoteAddress: client.request.socket.remoteAddress,
    metadata: { ...client.connectionMetadata },
    authSeed: client.authSeed,
    connectedAt,
  }
}
