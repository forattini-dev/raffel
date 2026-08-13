/**
 * SSH Adapter — Types
 *
 * Public types for the SSH adapter. Requires `ssh2` (optional peer dep)
 * at runtime. Types here are intentionally decoupled from ssh2's internal
 * types so the public surface stays stable.
 */

import type { Readable, Writable } from 'node:stream'
import type { ConnectionFilter } from './utils/connection-filter.js'

/**
 * A parsed key event from the SSH session stdin.
 *
 * Recognized names mirror Node's readline `keypress` event for familiarity:
 * 'return' (Enter), 'escape', 'backspace', 'tab', 'space',
 * 'up' | 'down' | 'left' | 'right', 'home' | 'end', 'pageup' | 'pagedown',
 * 'insert' | 'delete', 'f1'..'f12', single chars ('a', 'b', '1', ...).
 */
export interface KeyEvent {
  /** Raw bytes received from the client */
  raw: Buffer
  /** UTF-8 string representation */
  str: string
  /** Recognized key name, if any */
  name?: string
  /** Ctrl modifier was held */
  ctrl: boolean
  /** Shift modifier was held (best-effort for letter keys) */
  shift: boolean
  /** Meta/Alt modifier was held */
  meta: boolean
  /** Original escape sequence for unrecognized keys */
  sequence?: string
}

/**
 * Information about the requesting SSH client.
 */
export interface SshClientInfo {
  /** Remote IP address */
  ip: string
  /** Remote port */
  port: number
  /** Address family ('IPv4' | 'IPv6') */
  family: string
  /** Client software identifier (e.g. 'SSH-2.0-OpenSSH_9.0') */
  identRaw: string
}

/**
 * Authentication request the user handler can accept or reject.
 *
 * Returning `true` accepts; returning `false` (or throwing) rejects.
 */
export type SshAuthHandler =
  | ((req: SshAuthRequest) => boolean | Promise<boolean>)
  | true // alias for "always accept" (use with caution)

export interface SshAuthRequest {
  /** Username supplied by the client */
  username: string
  /** Auth method being attempted */
  method: 'none' | 'password' | 'publickey' | 'keyboard-interactive' | 'hostbased'
  /** Password, when method === 'password' */
  password?: string
  /** Public key info, when method === 'publickey' */
  publicKey?: {
    algo: string
    data: Buffer
  }
  /** Client info */
  client: SshClientInfo
}

/**
 * SSH authentication configuration. At least one method should be enabled.
 */
export interface SshAuthOptions {
  /**
   * Allow anonymous (no-auth) connections. Default: false.
   * When true, the username sent by the client is preserved but no
   * credential is required (terminal.shop-style).
   */
  none?: boolean | SshAuthHandler
  /** Password verifier */
  password?: SshAuthHandler
  /** Public key verifier */
  publicKey?: SshAuthHandler
}

/**
 * Pseudo-TTY information for the session.
 */
export interface SshPtyInfo {
  cols: number
  rows: number
  width: number
  height: number
  term: string
}

/**
 * Handler invoked once an authenticated client opens a shell or subsystem.
 *
 * The handler controls the session lifecycle — it should `await` something
 * (e.g. `session.signal` aborting, or `session.keys` iteration) to keep the
 * channel open. When the handler returns, the session is closed.
 */
export type SshSessionHandler = (session: SshSession) => void | Promise<void>

/**
 * The high-level SSH session object passed to user handlers.
 *
 * Provides three layers of API:
 *   1. Raw streams — `stdin`, `stdout`, `stderr`
 *   2. Helpers — `write`, `clear`, `keys`, `onResize`
 *   3. tuiuiu bridge — `tui` (lazy)
 *
 * The session is closed when the handler returns, when the client
 * disconnects, or when `close()` is called.
 */
export interface SshSession {
  /** Unique session id */
  readonly id: string
  /** Authenticated username */
  readonly user: string
  /**
   * Auth method used by this session.
   * 'none' = anonymous (public access).
   * Use this in handlers to branch between public and private behavior.
   */
  readonly authMethod: 'none' | 'password' | 'publickey'
  /**
   * Auth-method-specific data. Useful for identifying authenticated users
   * (e.g. key fingerprint from publicKey auth).
   */
  readonly authData: {
    publicKey?: { algo: string; data: Buffer }
  }
  /** Remote client info */
  readonly client: SshClientInfo
  /** Environment variables the client requested (SetEnv) */
  readonly env: Record<string, string>

  /** Pseudo-TTY info, or null if the client did not request a pty */
  readonly pty: SshPtyInfo | null
  /** Convenience: current cols (or 80 if no pty) */
  readonly cols: number
  /** Convenience: current rows (or 24 if no pty) */
  readonly rows: number
  /** Convenience: current TERM (or 'xterm' if no pty) */
  readonly term: string

  /** Raw stdin from the client (the pty input). */
  readonly stdin: Readable
  /** Raw stdout to the client. */
  readonly stdout: Writable
  /** Raw stderr to the client. */
  readonly stderr: Writable

  /** Whether the client requested a 'shell' (interactive) vs an 'exec' (one-shot command). */
  readonly kind: 'shell' | 'exec' | 'subsystem'
  /** For 'exec' sessions: the command line. */
  readonly command?: string
  /** For 'subsystem' sessions: the subsystem name. */
  readonly subsystem?: string

  /** Aborts when the session closes (either side). */
  readonly signal: AbortSignal

  /** Write text to stdout. Convenience for `stdout.write(text)`. */
  write(text: string | Uint8Array): void
  /** Clear screen and home cursor (ANSI `\x1b[2J\x1b[H`). */
  clear(): void

  /** Async iterable of parsed key events from stdin. */
  readonly keys: AsyncIterable<KeyEvent>

  /** Register a window-resize handler. Fires with new cols/rows. */
  onResize(handler: (cols: number, rows: number) => void): void
  /** Register a close handler. */
  onClose(handler: () => void): void

  /** Close the session. Optional exit code (default 0). */
  close(exitCode?: number): void

  /**
   * Lazy TTY-compatible streams for use with tuiuiu.js `render()`.
   * Returns `{ stdin, stdout }` where both wrap the raw streams with
   * `isTTY = true`, `columns`, `rows`, and resize events.
   *
   * Throws if tuiuiu.js is not installed.
   */
  readonly tui: { stdin: TtyReadable; stdout: TtyWritable }
}

/**
 * Minimal TTY-like Readable surface (subset Node's process.stdin offers).
 * Used by the tuiuiu bridge — declared here to avoid leaking ssh2 types.
 */
export interface TtyReadable extends Readable {
  isTTY: true
  setRawMode?(mode: boolean): this
}

/**
 * Minimal TTY-like Writable surface.
 */
export interface TtyWritable extends Writable {
  isTTY: true
  columns: number
  rows: number
}

/**
 * Host key — either a PEM/OpenSSH-formatted Buffer/string, or an object
 * with key + passphrase for encrypted keys.
 */
export type SshHostKey =
  | Buffer
  | string
  | { key: Buffer | string; passphrase?: Buffer | string }

/**
 * SSH adapter configuration.
 */
export interface SshAdapterOptions {
  /** Port to listen on (typical: 2222 for dev, 22 needs root) */
  port: number
  /** Host to bind to (default: '127.0.0.1') */
  host?: string

  /**
   * Host private keys. If omitted or empty, an ephemeral RSA 2048 key is
   * generated on `start()` — fine for dev, NOT for production (clients
   * will see a key-changed warning each restart). For production, pass
   * a stable key from disk.
   */
  hostKeys?: SshHostKey[]

  /** Banner sent to clients before authentication. */
  banner?: string
  /** Server software ident (default: 'SSH-2.0-Raffel') */
  ident?: string

  /**
   * Authentication configuration. If omitted, `none` is enabled
   * (anonymous access) — terminal.shop-style. Override for real auth.
   */
  auth?: SshAuthOptions

  /**
   * Session handler invoked once a client opens a shell.
   * Required for the adapter to be useful.
   */
  onSession: SshSessionHandler

  /**
   * Handler for `exec` requests (e.g. `ssh host some-command`).
   * If omitted, exec requests are rejected.
   */
  onExec?: SshSessionHandler

  /**
   * Handlers for named subsystems (e.g. SFTP would be 'sftp').
   * If omitted, subsystem requests are rejected.
   */
  subsystems?: Record<string, SshSessionHandler>

  /** Inbound connection filter — controls which source IPs may connect. */
  filter?: ConnectionFilter

  /** Keep-alive interval (ms). Default: 30000. 0 disables. */
  keepAliveInterval?: number
  /** Max failed keep-alive attempts before dropping. Default: 3. */
  keepAliveMaxFailures?: number
}

/**
 * SSH adapter handle.
 */
export interface SshAdapter {
  /** Start the SSH server. */
  start(): Promise<void>
  /** Stop the server and close all sessions. */
  stop(): Promise<void>
  /** Number of currently active sessions. */
  readonly sessionCount: number
  /** Bound port (after start). */
  readonly port: number
  /** Bound host (after start). */
  readonly host: string
}
