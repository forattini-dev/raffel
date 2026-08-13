import type { Envelope, StreamOperationalControls } from '../types/index.js'

export interface SseStreamWriterOptions {
  stream: AsyncIterable<Envelope>
  signal: AbortSignal
  controls?: StreamOperationalControls
  abort?: (reason: string) => void
  write: (chunk: string) => void
  end: () => void
  isClosed: () => boolean
  onError?: (error: Error) => void
}

function writeEnvelope(write: (chunk: string) => void, envelope: Envelope): void {
  let eventType = 'message'
  if (envelope.type === 'stream:data') eventType = 'data'
  else if (envelope.type === 'stream:end') eventType = 'end'
  else if (envelope.type === 'stream:error') eventType = 'error'

  write(`event: ${eventType}\n`)
  write(`data: ${JSON.stringify(envelope.payload)}\n\n`)
}

/**
 * Consume an envelope stream and frame it as SSE while owning every timer
 * associated with connection-scoped Live Stream controls.
 */
export async function writeSseStream(options: SseStreamWriterOptions): Promise<void> {
  const { stream, signal, controls, write, end, isClosed } = options
  const iterator = stream[Symbol.asyncIterator]()
  const timers = new Set<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let stop!: (reason: string) => void
  const stopped = new Promise<string>((resolve) => { stop = resolve })

  const stopStream = (reason: string) => {
    options.abort?.(reason)
    stop(reason)
  }
  const onAbort = () => stop(String(signal.reason ?? 'Live Stream cancelled'))
  signal.addEventListener('abort', onAbort, { once: true })

  const scheduleIdleTimeout = () => {
    if (!controls?.idleTimeoutMs) return
    if (idleTimer) {
      clearTimeout(idleTimer)
      timers.delete(idleTimer)
    }
    idleTimer = setTimeout(
      () => stopStream('Live Stream idle timeout exceeded'),
      controls.idleTimeoutMs
    )
    timers.add(idleTimer)
  }

  try {
    if (controls?.retryMs) {
      write(`retry: ${controls.retryMs}\n\n`)
    }

    if (controls?.heartbeatMs) {
      const heartbeat = setInterval(() => {
        if (!signal.aborted && !isClosed()) write(': heartbeat\n\n')
      }, controls.heartbeatMs)
      timers.add(heartbeat)
    }

    if (controls?.maxDurationMs) {
      const maximumDuration = setTimeout(
        () => stopStream('Live Stream maximum duration exceeded'),
        controls.maxDurationMs
      )
      timers.add(maximumDuration)
    }

    scheduleIdleTimeout()

    while (!signal.aborted && !isClosed()) {
      const outcome = await Promise.race([
        iterator.next().then((result) => ({ kind: 'next' as const, result })),
        stopped.then((reason) => ({ kind: 'stopped' as const, reason })),
      ])
      if (outcome.kind === 'stopped' || outcome.result.done) break

      writeEnvelope(write, outcome.result.value)
      if (outcome.result.value.type === 'stream:data') scheduleIdleTimeout()
    }
  } catch (error) {
    if (!signal.aborted && !isClosed()) {
      const message = error instanceof Error ? error.message : String(error)
      options.onError?.(error instanceof Error ? error : new Error(message))
      write('event: error\n')
      write(`data: ${JSON.stringify({ code: 'STREAM_ERROR', message })}\n\n`)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    for (const timer of timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    await iterator.return?.()
    end()
  }
}
