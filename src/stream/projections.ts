import type {
  ResumableStreamConfig,
  ResumableStreamProjectedContract,
} from '../types/index.js'

/** Build the canonical, machine-readable protocol projection diagnostics. */
export function projectResumableStreamContract(
  config: ResumableStreamConfig,
  snapshotSchemaRef?: string,
): ResumableStreamProjectedContract {
  return {
    ...config,
    replay: {
      owner: 'application',
      provider: config.provider,
    },
    snapshot: {
      owner: 'application',
      event: config.expiredCursor.event,
      cursor: 'application',
      ...(snapshotSchemaRef && { schema: { $ref: snapshotSchemaRef } }),
    },
    projections: {
      httpSse: {
        status: 'preserved',
        transport: 'HTTP / SSE',
        resumeCursor: config.cursor.header,
        recordCursor: 'sse-id',
        snapshot: 'named-event:snapshot',
      },
      websocket: {
        status: 'adapted',
        transport: 'WebSocket envelope metadata',
        resumeCursor: 'metadata.last-event-id',
        recordCursor: 'metadata.x-raffel-stream-cursor',
        snapshot: 'metadata.x-raffel-stream-event=snapshot',
      },
      grpc: {
        status: 'unsupported',
        transport: 'gRPC',
        reason: 'The current gRPC adapter does not carry Resume Cursor or Stream Snapshot metadata.',
      },
    },
  }
}
