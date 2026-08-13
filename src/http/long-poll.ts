/** Opaque application-owned position used by a Long Poll Interaction. */
export type PollCursor = string

/** A change found strictly after the requested cursor. */
export interface LongPollChange<TData> {
  cursor: PollCursor
  data: TData
}

/** The bounded result of one ordinary HTTP long-poll request. */
export type LongPollOutcome<TData> =
  | {
      outcome: 'change'
      cursor: PollCursor
      retryAfterMs: number
      data: TData
    }
  | {
      outcome: 'timeout'
      cursor: PollCursor | null
      retryAfterMs: number
    }

export interface LongPollWaitContext {
  /** Return the first change strictly after this opaque cursor. */
  after: PollCursor | null
  /** Aborted when the request is cancelled or its wait window expires. */
  signal: AbortSignal
}

export interface RunLongPollOptions<TData> {
  cursor: PollCursor | null
  waitMs: number
  retryMs: number
  signal: AbortSignal
  wait(context: LongPollWaitContext): Promise<LongPollChange<TData> | null>
}

/** Raised when the HTTP request is cancelled before its wait completes. */
export class LongPollAbortedError extends Error {
  readonly reason: unknown

  constructor(reason?: unknown) {
    super('Long Poll Interaction aborted because the request was cancelled')
    this.name = 'LongPollAbortedError'
    this.reason = reason
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`)
  }
}

/**
 * Run one bounded Long Poll Interaction.
 *
 * Raffel owns request cancellation and timeout bookkeeping only. The
 * application remains responsible for observing its own change source and for
 * producing an opaque cursor that advances strictly past `after`.
 */
export async function runLongPoll<TData>(
  options: RunLongPollOptions<TData>,
): Promise<LongPollOutcome<TData>> {
  assertPositiveFinite('waitMs', options.waitMs)
  assertPositiveFinite('retryMs', options.retryMs)

  if (options.signal.aborted) {
    throw new LongPollAbortedError(options.signal.reason)
  }

  const applicationWait = new AbortController()
  const timedOut = Symbol('long-poll-timeout')
  const cancelled = Symbol('long-poll-cancelled')
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined

  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), options.waitMs)
  })
  const cancellation = new Promise<typeof cancelled>((resolve) => {
    onAbort = () => resolve(cancelled)
    options.signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    const change = options.wait({
      after: options.cursor,
      signal: applicationWait.signal,
    })
    const result = await Promise.race([change, timeout, cancellation])

    if (result === cancelled) {
      applicationWait.abort(options.signal.reason)
      throw new LongPollAbortedError(options.signal.reason)
    }
    if (result === timedOut || result === null) {
      applicationWait.abort(timedOut)
      return {
        outcome: 'timeout',
        cursor: options.cursor,
        retryAfterMs: options.retryMs,
      }
    }
    if (options.cursor !== null && result.cursor === options.cursor) {
      throw new Error(
        'Long Poll source must return a cursor after the exclusive Poll Cursor',
      )
    }

    return {
      outcome: 'change',
      cursor: result.cursor,
      retryAfterMs: options.retryMs,
      data: result.data,
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort) options.signal.removeEventListener('abort', onAbort)
  }
}
