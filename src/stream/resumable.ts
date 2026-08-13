import type {
  Context,
  ResumableStreamConfig,
  ResumableStreamProvider,
  StreamHandler,
  StreamRecord,
  StreamSnapshot,
} from '../types/index.js'

export class ResumeCursorExpiredError<TState = unknown> extends Error {
  readonly snapshot: StreamSnapshot<TState>

  constructor(snapshot: StreamSnapshot<TState>) {
    super('Resume Cursor expired; recover from the application Stream Snapshot')
    this.name = 'ResumeCursorExpiredError'
    this.snapshot = snapshot
  }
}

function resolveProvider<TInput, TData, TState>(
  config: ResumableStreamConfig,
  ctx: Context,
): ResumableStreamProvider<TInput, TData, TState> {
  const candidate = ctx.services[config.provider] as Partial<ResumableStreamProvider<TInput, TData, TState>> | undefined
  if (!candidate?.source || typeof candidate.source.subscribe !== 'function') {
    throw new TypeError(`Resumable Stream provider '${config.provider}' must expose source.subscribe()`)
  }
  if (!candidate.replay || typeof candidate.replay.replay !== 'function') {
    throw new TypeError(`Resumable Stream provider '${config.provider}' must expose replay.replay()`)
  }
  return candidate as ResumableStreamProvider<TInput, TData, TState>
}

function resolveCursor<TInput>(
  input: TInput,
  config: ResumableStreamConfig,
  ctx: Context,
): string | undefined {
  const header = ctx.input.metadata[config.cursor.header.toLowerCase()]
  if (header !== undefined) return header
  if (!config.cursor.query || !input || typeof input !== 'object') return undefined
  const query = (input as Record<string, unknown>)[config.cursor.query]
  return typeof query === 'string' ? query : undefined
}

async function* ensureRecords<TData>(
  records: AsyncIterable<StreamRecord<TData>>,
): AsyncIterable<StreamRecord<TData>> {
  for await (const record of records) {
    if (!record || typeof record.cursor !== 'string' || !('data' in record)) {
      throw new TypeError('Durable Stream Source must emit StreamRecord { cursor, data } values')
    }
    assertSseSafeCursor(record.cursor)
    yield record
  }
}

function assertSseSafeCursor(cursor: string): void {
  if (cursor.length === 0 || /[\0\r\n]/u.test(cursor)) {
    throw new TypeError('Stream Record cursor must be safe for SSE framing')
  }
}

function ensureSnapshot<TState>(snapshot: StreamSnapshot<TState>): StreamSnapshot<TState> {
  if (!snapshot || typeof snapshot.cursor !== 'string' || !('data' in snapshot)) {
    throw new TypeError('Replay Provider must return StreamSnapshot { cursor, data }')
  }
  assertSseSafeCursor(snapshot.cursor)
  return snapshot
}

/** Build the synthetic handler used by a Source-Backed Resumable Stream. */
export function createSourceBackedStreamHandler<
  TInput = unknown,
  TData = unknown,
  TState = unknown,
>(config: ResumableStreamConfig): StreamHandler<TInput, StreamRecord<TData>> {
  return async function* sourceBackedStream(input: TInput, ctx: Context) {
    const provider = resolveProvider<TInput, TData, TState>(config, ctx)
    const cursor = resolveCursor(input, config, ctx)
    let liveAfter = cursor

    if (cursor !== undefined) {
      const replay = await provider.replay.replay(input, {
        after: cursor,
        signal: ctx.signal,
      })
      if (replay.outcome === 'cursor-expired') {
        throw new ResumeCursorExpiredError(ensureSnapshot(replay.snapshot))
      }
      yield* ensureRecords(replay.records)
      liveAfter = replay.through
    }

    yield* ensureRecords(provider.source.subscribe(input, {
      after: liveAfter,
      signal: ctx.signal,
    }))
  }
}
