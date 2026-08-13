/**
 * SSH Adapter
 *
 * Exposes a Raffel-flavored SSH server. Users provide a session handler
 * that receives a high-level SshSession (raw streams + parsed keys +
 * resize events + optional tuiuiu bridge).
 *
 * Requires `ssh2` as an optional peer dependency. The module dynamically
 * imports ssh2 in `start()` so users that don't enable SSH don't pay the
 * cost (and don't need ssh2 installed).
 *
 * Inspired by terminal.shop / Charm Wish — the goal is "ssh your.app"
 * works and drops the user into a real TUI.
 *
 * Example — public access (terminal.shop style):
 *
 *   createSshAdapter({
 *     port: 2222,
 *     onSession: async (session) => {
 *       session.write(`Hi ${session.user}!\r\n`)
 *     },
 *   })
 *
 * Example — mixed public/private (both anonymous and authenticated users):
 *
 *   createSshAdapter({
 *     port: 2222,
 *     auth: {
 *       none: true,                                          // public path
 *       publicKey: async (req) => isKnownKey(req.publicKey), // private path
 *     },
 *     onSession: async (session) => {
 *       if (session.authMethod === 'none') {
 *         renderPublicMenu(session)                          // limited features
 *       } else {
 *         renderAuthenticatedDashboard(session)              // full features
 *       }
 *     },
 *   })
 */

import { sid } from '../utils/id/index.js'
import { createLogger } from '../utils/logger.js'
import { checkConnectionFilter } from './utils/connection-filter.js'
import {
  createSshSession,
  type InternalSshSession,
  type SshChannelLike,
} from './ssh-session.js'
import { generateEphemeralHostKey } from './ssh-host-key.js'
import type {
  SshAdapter,
  SshAdapterOptions,
  SshAuthOptions,
  SshAuthRequest,
  SshClientInfo,
  SshPtyInfo,
  SshSessionHandler,
} from './ssh-types.js'

const logger = createLogger('ssh-adapter')

// Structural ssh2 types — keep loose to avoid hard dependency on @types/ssh2
// at consumer compile time. The runtime checks are good enough.
type Ssh2Module = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Server: new (config: any, listener?: (client: any, info: any) => void) => any
}

let cachedSsh2: Ssh2Module | null = null

async function loadSsh2(): Promise<Ssh2Module> {
  if (cachedSsh2) return cachedSsh2
  try {
    const mod = (await import('ssh2')) as unknown as Ssh2Module
    cachedSsh2 = mod
    return mod
  } catch (err) {
    throw new Error(
      'SSH adapter requires the `ssh2` package. Install it with: pnpm add ssh2',
      { cause: err as Error },
    )
  }
}

export function createSshAdapter(options: SshAdapterOptions): SshAdapter {
  const {
    port,
    host = '127.0.0.1',
    banner,
    ident = 'SSH-2.0-Raffel',
    onSession,
    onExec,
    subsystems,
    filter,
    keepAliveInterval = 30000,
    keepAliveMaxFailures = 3,
  } = options

  // Authentication is fail-closed. Public terminal-style access must opt in.
  const auth: SshAuthOptions = options.auth ?? { none: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any = null
  let boundPort = port
  let boundHost = host

  const activeSessions = new Map<string, InternalSshSession>()

  async function evalAuth(req: SshAuthRequest): Promise<boolean> {
    const method = req.method
    let handler: SshAuthOptions[keyof SshAuthOptions] | undefined
    if (method === 'none') handler = auth.none
    else if (method === 'password') handler = auth.password
    else if (method === 'publickey') handler = auth.publicKey
    else return false

    if (handler === undefined) return false
    if (handler === true) return true
    if (typeof handler === 'function') {
      try {
        const result = await handler(req)
        return result === true
      } catch (err) {
        logger.warn({ err, method, user: req.username }, 'auth handler threw')
        return false
      }
    }
    return false
  }

  function startSession(
    sessionEvents: unknown,
    user: string,
    authMethod: 'none' | 'password' | 'publickey',
    authData: { publicKey?: { algo: string; data: Buffer } },
    clientInfo: SshClientInfo,
  ): void {
    // ssh2 emits 'session' with (accept, reject). The caller has already
    // accepted; we attach sub-listeners for env/pty/window-change/shell/exec/subsystem.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionEvents as any
    let pty: SshPtyInfo | null = null
    const env: Record<string, string> = {}

    session.on('pty', (a: () => void, _r: () => void, info: SshPtyInfo & { term?: string }) => {
      pty = {
        cols: info.cols,
        rows: info.rows,
        width: info.width,
        height: info.height,
        // ssh2 puts term name on info.term but types may miss it
        term: (info as { term?: string }).term ?? 'xterm',
      }
      a()
    })

    session.on(
      'window-change',
      (
        a: undefined | (() => void),
        _r: undefined | (() => void),
        info: { cols: number; rows: number; width: number; height: number },
      ) => {
        if (pty) pty = { ...pty, cols: info.cols, rows: info.rows, width: info.width, height: info.height }
        // accept may be undefined for window-change (ssh2 quirk — it's not always provided)
        if (typeof a === 'function') a()
        if (activeShellSession) activeShellSession._updateSize(info.cols, info.rows)
      },
    )

    session.on('env', (a: () => void, _r: () => void, info: { key: string; val: string }) => {
      env[info.key] = info.val
      a()
    })

    // Track the active session (one per ssh session, since shell/exec/subsystem are mutually exclusive)
    let activeShellSession: InternalSshSession | null = null

    function spawn(channel: SshChannelLike, kind: 'shell' | 'exec' | 'subsystem', extra?: { command?: string; subsystem?: string }, handler?: SshSessionHandler): void {
      if (!handler) {
        try { (channel as { end?: () => void }).end?.() } catch { /* noop */ }
        return
      }
      const id = sid()
      const sshSession = createSshSession({
        id,
        user,
        authMethod,
        authData,
        client: clientInfo,
        env,
        pty,
        channel,
        kind,
        command: extra?.command,
        subsystem: extra?.subsystem,
      })
      activeShellSession = sshSession
      activeSessions.set(id, sshSession)
      sshSession.onClose(() => {
        activeSessions.delete(id)
        if (activeShellSession === sshSession) activeShellSession = null
      })
      Promise.resolve()
        .then(() => handler(sshSession))
        .catch((err) => {
          logger.error({ err, sessionId: id, kind }, 'session handler threw')
          try { sshSession.close(1) } catch { /* noop */ }
        })
        .finally(() => {
          // Handler returned — close the session unless already closed
          try { sshSession.close(0) } catch { /* noop */ }
        })
    }

    session.on('shell', (accept: () => SshChannelLike, _reject: () => void) => {
      const channel = accept()
      spawn(channel, 'shell', undefined, onSession)
    })

    session.on(
      'exec',
      (accept: () => SshChannelLike, reject: () => void, info: { command: string }) => {
        if (!onExec) {
          reject()
          return
        }
        const channel = accept()
        spawn(channel, 'exec', { command: info.command }, onExec)
      },
    )

    session.on(
      'subsystem',
      (accept: () => SshChannelLike, reject: () => void, info: { name: string }) => {
        const handler = subsystems?.[info.name]
        if (!handler) {
          reject()
          return
        }
        const channel = accept()
        spawn(channel, 'subsystem', { subsystem: info.name }, handler)
      },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleClient(client: any, info: any): void {
    const clientInfo: SshClientInfo = {
      ip: info?.ip ?? '',
      port: info?.port ?? 0,
      family: info?.family ?? '',
      identRaw: info?.header?.identRaw ?? info?.header?.versions?.software ?? '',
    }

    if (filter) {
      checkConnectionFilter(filter, clientInfo.ip, clientInfo.port)
        .then(({ allowed, reason }) => {
          if (!allowed) {
            filter.onDenied?.({ host: clientInfo.ip, port: clientInfo.port, reason: reason! })
            // client.end() sends DISCONNECT_REASON and ends the socket — the
            // recommended way to cleanly drop an ssh2 server connection.
            try { client.end() } catch { /* noop */ }
            return
          }
          attachClient(client, clientInfo)
        })
        .catch(() => { try { client.end() } catch { /* noop */ } })
      return
    }
    attachClient(client, clientInfo)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function attachClient(client: any, clientInfo: SshClientInfo): void {
    let authenticatedUser = ''
    let authedMethod: 'none' | 'password' | 'publickey' = 'none'
    const authedData: { publicKey?: { algo: string; data: Buffer } } = {}

    client.on('authentication', (ctx: AuthCtx) => {
      const method = ctx.method
      const username = ctx.username
      const req: SshAuthRequest = {
        username,
        method,
        client: clientInfo,
        password: method === 'password' ? ctx.password : undefined,
        publicKey:
          method === 'publickey' && ctx.key
            ? { algo: ctx.key.algo, data: ctx.key.data }
            : undefined,
      }
      evalAuth(req)
        .then((ok) => {
          if (ok) {
            authenticatedUser = username
            // Only record methods we actually authenticate via (skip hostbased/keyboard-interactive)
            if (method === 'none' || method === 'password' || method === 'publickey') {
              authedMethod = method
              if (method === 'publickey' && req.publicKey) {
                authedData.publicKey = req.publicKey
              }
            }
            ctx.accept()
          } else {
            // Suggest other methods the user might try
            const left: AuthCtx['method'][] = []
            if (auth.password) left.push('password')
            if (auth.publicKey) left.push('publickey')
            if (auth.none) left.push('none')
            ctx.reject(left.length ? left : undefined)
          }
        })
        .catch(() => ctx.reject())
    })

    client.on('ready', () => {
      logger.debug({ user: authenticatedUser, method: authedMethod, ip: clientInfo.ip }, 'ssh client ready')
    })

    client.on('session', (accept: () => unknown, _reject: () => void) => {
      const sessionEvents = accept()
      startSession(sessionEvents, authenticatedUser, authedMethod, authedData, clientInfo)
    })

    client.on('error', (err: Error) => {
      logger.debug({ err, ip: clientInfo.ip }, 'ssh client error')
    })

    client.on('end', () => {
      logger.debug({ ip: clientInfo.ip }, 'ssh client disconnected')
    })
  }

  return {
    async start(): Promise<void> {
      const ssh2 = await loadSsh2()

      const hostKeys = (options.hostKeys && options.hostKeys.length > 0)
        ? options.hostKeys
        : [generateEphemeralHostKey()]
      if (!options.hostKeys || options.hostKeys.length === 0) {
        logger.warn(
          'No SSH host keys provided — generated an ephemeral RSA 2048 key. ' +
          'For production, pass a stable key via `hostKeys` to avoid client warnings.',
        )
      }

      server = new ssh2.Server(
        {
          hostKeys,
          banner,
          ident,
          keepaliveInterval: keepAliveInterval,
          keepaliveCountMax: keepAliveMaxFailures,
        },
        handleClient,
      )

      await new Promise<void>((resolve, reject) => {
        server.on('error', (err: Error) => {
          logger.error({ err }, 'SSH server error')
          reject(err)
        })
        server.listen(port, host, () => {
          const addr = server.address()
          if (addr && typeof addr === 'object') {
            boundPort = addr.port
            boundHost = addr.address
          }
          logger.info({ port: boundPort, host: boundHost }, 'SSH server listening')
          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      // Close active sessions
      for (const session of activeSessions.values()) {
        try { session.close(0) } catch { /* noop */ }
      }
      activeSessions.clear()
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
        server = null
        logger.info('SSH server stopped')
      }
    },

    get sessionCount(): number {
      return activeSessions.size
    },
    get port(): number {
      return boundPort
    },
    get host(): string {
      return boundHost
    },
  }
}

// Internal ssh2 auth context structural shape — we mirror just what we use.
type AuthCtx = {
  method: 'none' | 'password' | 'publickey' | 'keyboard-interactive' | 'hostbased'
  username: string
  password: string
  key?: { algo: string; data: Buffer }
  accept(): void
  reject(methodsLeft?: AuthCtx['method'][], partial?: boolean): void
}
