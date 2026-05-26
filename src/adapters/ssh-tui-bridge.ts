/**
 * SSH Adapter — tuiuiu.js bridge
 *
 * Wraps SSH session stdin/stdout streams as TTY-compatible streams that
 * tuiuiu.js `render()` (and similar TUI libs that check `isTTY`) can use
 * transparently.
 *
 * - `isTTY = true` so tuiuiu enters interactive mode
 * - `columns` / `rows` exposed and kept in sync with SSH window-change
 * - `setRawMode()` is a no-op (SSH already delivers raw input)
 * - `'resize'` events forwarded so tuiuiu can re-layout
 *
 * The bridge does NOT depend on tuiuiu.js at runtime — it just produces
 * streams compatible with what tuiuiu expects. Users dynamically import
 * tuiuiu in their handler and pass `session.tui`.
 */

import { Readable, Writable } from 'node:stream'
import type { Readable as ReadableType, Writable as WritableType } from 'node:stream'
import type { TtyReadable, TtyWritable } from './ssh-types.js'

export interface TuiBridge {
  stdin: TtyReadable
  stdout: TtyWritable
  /** Update reported window size; emits 'resize' on stdout. */
  updateSize(cols: number, rows: number): void
  /** Close both ends — for adapter cleanup. */
  destroy(): void
}

/**
 * Build a TTY-compatible {stdin, stdout} pair forwarding to/from the SSH
 * channel's underlying streams.
 */
export function createTuiBridge(opts: {
  source: ReadableType
  sink: WritableType
  cols: number
  rows: number
}): TuiBridge {
  let cols = opts.cols
  let rows = opts.rows

  // --- stdin: a Readable that mirrors `source` and exposes TTY surface
  const stdin = new Readable({
    read() {
      // pulled on demand from source via 'data' listener below
    },
  }) as unknown as TtyReadable & { push: Readable['push'] }
  ;(stdin as unknown as { isTTY: boolean }).isTTY = true
  ;(stdin as unknown as { setRawMode: (m: boolean) => unknown }).setRawMode =
    function setRawMode(this: TtyReadable) {
      return this
    }

  const onSourceData = (chunk: Buffer) => {
    stdin.push(chunk)
  }
  const onSourceEnd = () => {
    stdin.push(null)
  }
  opts.source.on('data', onSourceData)
  opts.source.once('end', onSourceEnd)
  opts.source.once('close', onSourceEnd)

  // --- stdout: a Writable that forwards to `sink` and exposes TTY surface
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      // Best-effort write; ignore failed writes (channel may have closed)
      try {
        opts.sink.write(chunk, cb)
      } catch {
        cb()
      }
    },
  }) as unknown as TtyWritable
  ;(stdout as unknown as { isTTY: boolean }).isTTY = true
  Object.defineProperty(stdout, 'columns', {
    get: () => cols,
    configurable: true,
  })
  Object.defineProperty(stdout, 'rows', {
    get: () => rows,
    configurable: true,
  })

  function updateSize(newCols: number, newRows: number): void {
    cols = newCols
    rows = newRows
    stdout.emit('resize')
  }

  function destroy(): void {
    opts.source.off('data', onSourceData)
    opts.source.off('end', onSourceEnd)
    opts.source.off('close', onSourceEnd)
    try {
      stdin.push(null)
    } catch {
      // already ended
    }
    try {
      stdout.end()
    } catch {
      // already ended
    }
  }

  return { stdin, stdout, updateSize, destroy }
}
