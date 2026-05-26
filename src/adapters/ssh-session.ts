/**
 * SSH Adapter — Session factory
 *
 * Wraps an ssh2 ServerChannel into the user-facing SshSession surface.
 * Owns the lifecycle: parses input keys, manages window-resize, dispatches
 * close events, builds the lazy tuiuiu bridge.
 */

import type { Readable, Writable } from 'node:stream'
import type {
  KeyEvent,
  SshClientInfo,
  SshPtyInfo,
  SshSession,
  TtyReadable,
  TtyWritable,
} from './ssh-types.js'
import { parseKeys } from './ssh-keys.js'
import { createTuiBridge, type TuiBridge } from './ssh-tui-bridge.js'

/**
 * Minimal subset of ssh2 ServerChannel we depend on. Declared structurally
 * so we don't need to import ssh2 types into adapter session code.
 */
export interface SshChannelLike {
  stderr: Writable
  write(chunk: string | Uint8Array): boolean
  end(): void
  exit(code: number): void
  on(event: 'data', listener: (chunk: Buffer) => void): this
  on(event: 'close' | 'end', listener: () => void): this
  once(event: 'close' | 'end', listener: () => void): this
  off(event: string, listener: (...args: unknown[]) => void): this
  destroyed?: boolean
  // Writable surface we forward as stdout
  pipe?: unknown
}

export interface CreateSshSessionOptions {
  id: string
  user: string
  authMethod: 'none' | 'password' | 'publickey'
  authData: { publicKey?: { algo: string; data: Buffer } }
  client: SshClientInfo
  env: Record<string, string>
  pty: SshPtyInfo | null
  channel: SshChannelLike
  kind: 'shell' | 'exec' | 'subsystem'
  command?: string
  subsystem?: string
}

export interface InternalSshSession extends SshSession {
  /** Update pty size — called when the SSH client sends window-change. */
  _updateSize(cols: number, rows: number): void
  /** Notify the session that the underlying channel closed. */
  _notifyClosed(): void
  /** Get the tui bridge if it was created, else null (for cleanup). */
  _tuiBridge(): TuiBridge | null
}

export function createSshSession(opts: CreateSshSessionOptions): InternalSshSession {
  const { id, user, authMethod, authData, client, env, channel, kind, command, subsystem } = opts
  let pty = opts.pty

  const abortController = new AbortController()
  const resizeHandlers = new Set<(cols: number, rows: number) => void>()
  const closeHandlers = new Set<() => void>()
  let closed = false
  let tuiBridge: TuiBridge | null = null

  // ----- raw key event channel -----
  // We buffer parsed KeyEvents in a queue and resolve pending iterators.
  const keyQueue: KeyEvent[] = []
  let keyWaiter: ((value: IteratorResult<KeyEvent>) => void) | null = null

  function pushKey(k: KeyEvent): void {
    if (keyWaiter) {
      const w = keyWaiter
      keyWaiter = null
      w({ value: k, done: false })
      return
    }
    keyQueue.push(k)
  }

  function endKeys(): void {
    if (keyWaiter) {
      const w = keyWaiter
      keyWaiter = null
      w({ value: undefined as unknown as KeyEvent, done: true })
    }
  }

  const onData = (chunk: Buffer) => {
    for (const k of parseKeys(chunk)) pushKey(k)
  }

  channel.on('data', onData)
  channel.once('close', () => notifyClosed())
  channel.once('end', () => notifyClosed())

  function notifyClosed(): void {
    if (closed) return
    closed = true
    abortController.abort()
    channel.off('data', onData as unknown as (...args: unknown[]) => void)
    endKeys()
    for (const h of closeHandlers) {
      try { h() } catch { /* user handler error — swallow */ }
    }
    if (tuiBridge) {
      try { tuiBridge.destroy() } catch { /* noop */ }
      tuiBridge = null
    }
  }

  // ----- stdout / stderr as Writable-like views over channel -----
  // ssh2 ServerChannel already IS a Duplex stream — we expose it directly
  // as `stdout`. For consistency with Node's TTY model, downstream code
  // calls `session.write(...)` or accesses `session.stdout`.
  const stdoutAsWritable = channel as unknown as Writable

  const session: InternalSshSession = {
    id,
    user,
    authMethod,
    authData,
    client,
    env,
    pty,
    kind,
    command,
    subsystem,
    signal: abortController.signal,

    get cols() {
      return pty?.cols ?? 80
    },
    get rows() {
      return pty?.rows ?? 24
    },
    get term() {
      return pty?.term ?? 'xterm'
    },

    // ssh2 ServerChannel extends Duplex, so the same object IS both the
    // readable input side and the writable output side. Multiple listeners
    // on 'data' coexist fine (Node EventEmitter), so the key parser, the
    // optional tui bridge, and user-attached listeners all receive chunks.
    stdin: channel as unknown as Readable,
    stdout: stdoutAsWritable,
    stderr: channel.stderr,

    write(text: string | Uint8Array): void {
      if (closed) return
      try {
        channel.write(text)
      } catch {
        // channel closed — ignore
      }
    },

    clear(): void {
      this.write('\x1b[2J\x1b[H')
    },

    get keys(): AsyncIterable<KeyEvent> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<KeyEvent> {
          return {
            next(): Promise<IteratorResult<KeyEvent>> {
              if (keyQueue.length > 0) {
                return Promise.resolve({ value: keyQueue.shift()!, done: false })
              }
              if (closed) {
                return Promise.resolve({
                  value: undefined as unknown as KeyEvent,
                  done: true,
                })
              }
              return new Promise<IteratorResult<KeyEvent>>((resolve) => {
                keyWaiter = resolve
              })
            },
            return(): Promise<IteratorResult<KeyEvent>> {
              return Promise.resolve({
                value: undefined as unknown as KeyEvent,
                done: true,
              })
            },
          }
        },
      }
    },

    onResize(handler: (cols: number, rows: number) => void): void {
      resizeHandlers.add(handler)
    },

    onClose(handler: () => void): void {
      if (closed) {
        // Already closed — fire async
        queueMicrotask(handler)
        return
      }
      closeHandlers.add(handler)
    },

    close(exitCode: number = 0): void {
      if (closed) return
      try {
        channel.exit(exitCode)
      } catch {
        // already exited
      }
      try {
        channel.end()
      } catch {
        // already ended
      }
      notifyClosed()
    },

    get tui(): { stdin: TtyReadable; stdout: TtyWritable } {
      if (!tuiBridge) {
        tuiBridge = createTuiBridge({
          source: channel as unknown as NodeJS.ReadableStream as unknown as import('node:stream').Readable,
          sink: stdoutAsWritable,
          cols: session.cols,
          rows: session.rows,
        })
      }
      return { stdin: tuiBridge.stdin, stdout: tuiBridge.stdout }
    },

    _updateSize(cols: number, rows: number): void {
      if (pty) pty = { ...pty, cols, rows }
      else pty = { cols, rows, width: 0, height: 0, term: 'xterm' }
      for (const h of resizeHandlers) {
        try { h(cols, rows) } catch { /* swallow */ }
      }
      if (tuiBridge) tuiBridge.updateSize(cols, rows)
    },

    _notifyClosed(): void {
      notifyClosed()
    },

    _tuiBridge(): TuiBridge | null {
      return tuiBridge
    },
  }

  return session
}
