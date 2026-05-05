import type { ChannelManager } from '../channels/index.js'
import {
  generateRecoveryToken,
  type ConnectionRecoveryPort,
  type RecoverableSession,
} from '../channels/recovery.js'
import type { ClientConnection } from './websocket-types.js'

export async function recoverWebSocketClient(options: {
  client: ClientConnection
  recoveryToken: string
  recoveryStore: ConnectionRecoveryPort
  channelManager: ChannelManager
  clientRecoveryTokens: Map<string, string>
  sendRawMessage: (client: ClientConnection, message: unknown) => void
  logRecovered?: (details: { clientId: string; oldSocketId: string }) => void
}): Promise<void> {
  const {
    client,
    recoveryToken,
    recoveryStore,
    channelManager,
    clientRecoveryTokens,
    sendRawMessage,
    logRecovered,
  } = options
  const session = recoveryStore.get(recoveryToken)
  if (!session) {
    sendRawMessage(client, {
      type: 'error',
      code: 'RECOVERY_FAILED',
      status: 404,
      message: 'Recovery token not found or expired',
    })
    return
  }

  recoveryStore.delete(recoveryToken)

  if (!channelManager.getClient(client.id)) {
    channelManager.registerClient(client.id, {
      userId: session.userId,
      data: session.metadata,
    })
  }

  channelManager.recoverClient(session.socketId, client.id, session.channels)

  for (const groupName of session.groups) {
    channelManager.joinGroup(groupName, client.id)
  }

  const newToken = generateRecoveryToken()
  clientRecoveryTokens.set(client.id, newToken)

  sendRawMessage(client, {
    type: 'connection:recovered',
    socketId: client.id,
    recoveryToken: newToken,
    channels: session.channels.map((c) => c.name),
    groups: session.groups,
  })
  logRecovered?.({ clientId: client.id, oldSocketId: session.socketId })
}

export function saveWebSocketRecoverySession(options: {
  client: ClientConnection
  recoveryStore: ConnectionRecoveryPort
  channelManager: ChannelManager
  clientRecoveryTokens: Map<string, string>
  ttl: number
}): void {
  const { client, recoveryStore, channelManager, clientRecoveryTokens, ttl } = options
  const token = clientRecoveryTokens.get(client.id)
  if (!token) return

  const subs = channelManager.getSubscriptions(client.id)
  const clientInfo = channelManager.getClient(client.id)
  const groups = channelManager.getClientGroups(client.id).map((g) => g.name)

  const session: RecoverableSession = {
    recoveryToken: token,
    socketId: client.id,
    userId: clientInfo?.userId,
    channels: subs.map((name) => ({ name, lastSeq: 0 })),
    groups,
    metadata: clientInfo?.data ?? {},
    expiresAt: Date.now() + ttl,
  }

  recoveryStore.save(session)
  clientRecoveryTokens.delete(client.id)
}
