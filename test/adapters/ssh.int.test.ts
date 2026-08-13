/**
 * SSH Adapter Integration Tests
 *
 * Spins up the SSH adapter on an ephemeral port and connects with a real
 * ssh2 Client to exercise the full handshake → pty → shell → I/O flow.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Client as Ssh2Client, utils as ssh2Utils } from 'ssh2'
import { createSshAdapter } from '../../src/adapters/ssh.js'
import type { SshAdapter, SshSession } from '../../src/adapters/ssh-types.js'
import { parseKeys } from '../../src/adapters/ssh-keys.js'

interface ConnectedClient {
  client: Ssh2Client
  /** Open a shell session and return a duplex stream */
  openShell(opts?: { cols?: number; rows?: number }): Promise<{
    write(data: string): void
    onData(handler: (chunk: Buffer) => void): void
    close(): void
    end(): Promise<void>
    resize(cols: number, rows: number): void
  }>
}

function connect(port: number): Promise<ConnectedClient> {
  return new Promise((resolve, reject) => {
    const client = new Ssh2Client()
    client
      .on('ready', () => {
        resolve({
          client,
          openShell(opts?: { cols?: number; rows?: number }) {
            return new Promise((resolveShell, rejectShell) => {
              client.shell(
                { cols: opts?.cols ?? 80, rows: opts?.rows ?? 24, term: 'xterm' },
                (err, stream) => {
                  if (err) return rejectShell(err)
                  resolveShell({
                    write: (data: string) => {
                      stream.write(data)
                    },
                    onData: (handler) => {
                      stream.on('data', handler)
                    },
                    close: () => stream.close(),
                    end: () =>
                      new Promise<void>((res) => {
                        stream.once('close', () => res())
                        stream.end()
                      }),
                    resize: (cols: number, rows: number) => {
                      // ssh2 client uses setWindow(rows, cols, h, w)
                      stream.setWindow(rows, cols, 0, 0)
                    },
                  })
                },
              )
            })
          },
        })
      })
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port,
        username: 'guest',
        // No password/key — relies on adapter's default `none` auth
        // The ssh2 client requires _something_, so pass an empty password
        password: '',
        // Don't try to verify server's host key (it's ephemeral in tests)
        hostHash: 'sha256' as 'sha256',
        hostVerifier: () => true,
        readyTimeout: 5000,
      })
  })
}

describe('SshAdapter', () => {
  let adapter: SshAdapter | null = null
  let sessionRef: SshSession | null = null
  let port = 0

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
    sessionRef = null
  })

  it('accepts connection and runs handler with anonymous (none) auth', async () => {
    let sessionReceived: SshSession | null = null
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        sessionReceived = session
        sessionRef = session
        session.write(`hi ${session.user}\r\n`)
        // hold the session open until client closes
        await new Promise<void>((resolve) => session.onClose(resolve))
      },
    })
    await adapter.start()
    port = adapter.port

    const { client, openShell } = await connect(port)
    const shell = await openShell()
    const data = await collectFor(shell, 200)
    expect(data.toString()).toContain('hi guest')
    expect(sessionReceived).not.toBeNull()
    expect(sessionReceived!.user).toBe('guest')
    expect(sessionReceived!.cols).toBe(80)
    expect(sessionReceived!.rows).toBe(24)

    shell.close()
    client.end()
  })

  it('echoes input back via raw stdin/stdout', async () => {
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        for await (const key of session.keys) {
          if (key.ctrl && key.name === 'c') break
          if (key.name === 'q') break
          session.write(key.str || '')
        }
      },
    })
    await adapter.start()
    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell()

    const buffers: Buffer[] = []
    shell.onData((b) => buffers.push(b))

    shell.write('hello')
    await wait(150)
    shell.write('q')
    await wait(100)

    const out = Buffer.concat(buffers).toString()
    expect(out).toContain('hello')

    client.end()
  })

  it('rejects auth when none is disabled and no method matches', async () => {
    adapter = createSshAdapter({
      port: 0,
      auth: { password: async (req) => req.password === 'secret' },
      onSession: async () => { /* unreachable */ },
    })
    await adapter.start()

    await expect(connect(adapter.port)).rejects.toThrow()
  })

  it('rejects anonymous authentication by default', async () => {
    adapter = createSshAdapter({
      port: 0,
      onSession: async () => { /* unreachable */ },
    })
    await adapter.start()

    await expect(connect(adapter.port)).rejects.toThrow()
  })

  it('accepts password auth when handler returns true', async () => {
    let connected = false
    adapter = createSshAdapter({
      port: 0,
      auth: { password: async (req) => req.password === 'opensesame' },
      onSession: async (session) => {
        connected = true
        session.write('ok\r\n')
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()

    await new Promise<void>((resolve, reject) => {
      const c = new Ssh2Client()
      c.on('ready', () => {
        c.shell({ cols: 80, rows: 24, term: 'xterm' }, (err, stream) => {
          if (err) return reject(err)
          stream.on('data', () => { /* drain */ })
          setTimeout(() => {
            stream.close()
            c.end()
            resolve()
          }, 150)
        })
      })
        .on('error', reject)
        .connect({
          host: '127.0.0.1',
          port: adapter!.port,
          username: 'alice',
          password: 'opensesame',
          hostVerifier: () => true,
          readyTimeout: 5000,
        })
    })
    expect(connected).toBe(true)
  })

  it('forwards window-change resize events to onResize handler', async () => {
    const resizes: Array<[number, number]> = []
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        session.onResize((cols, rows) => resizes.push([cols, rows]))
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()
    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell()

    await wait(100)
    shell.resize(120, 40)
    await wait(150)
    shell.resize(200, 50)
    await wait(150)

    expect(resizes).toContainEqual([120, 40])
    expect(resizes).toContainEqual([200, 50])

    shell.close()
    client.end()
  })

  it('exposes parsed key events via session.keys', async () => {
    const captured: string[] = []
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        for await (const key of session.keys) {
          captured.push(`${key.name ?? key.str}${key.ctrl ? '+ctrl' : ''}`)
          if (key.name === 'q') break
        }
      },
    })
    await adapter.start()
    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell()

    shell.write('a')
    await wait(50)
    shell.write('\x1b[A') // up arrow
    await wait(50)
    shell.write('\r')      // enter -> return
    await wait(50)
    shell.write('q')
    await wait(150)

    expect(captured).toContain('a')
    expect(captured).toContain('up')
    expect(captured).toContain('return')

    client.end()
  })

  it('closes session when client disconnects', async () => {
    let closed = false
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        session.onClose(() => { closed = true })
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()
    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell()
    await wait(80)
    expect(adapter.sessionCount).toBe(1)

    shell.close()
    client.end()
    await wait(150)

    expect(closed).toBe(true)
    expect(adapter.sessionCount).toBe(0)
  })

  it('session.tui returns TTY-compatible streams', async () => {
    let tuiCols = 0
    let tuiRows = 0
    let tuiIsTTY = false
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        const { stdout } = session.tui
        tuiCols = stdout.columns
        tuiRows = stdout.rows
        tuiIsTTY = stdout.isTTY === true
        stdout.write('via-tui\r\n')
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()
    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell({ cols: 100, rows: 30 })
    const data = await collectFor(shell, 200)

    expect(tuiIsTTY).toBe(true)
    expect(tuiCols).toBe(100)
    expect(tuiRows).toBe(30)
    expect(data.toString()).toContain('via-tui')

    shell.close()
    client.end()
  })
})

describe('parseKeys (unit)', () => {
  it('parses ASCII chars', () => {
    const keys = parseKeys(Buffer.from('abc'))
    expect(keys).toHaveLength(3)
    expect(keys[0]).toMatchObject({ str: 'a', name: 'a', ctrl: false })
  })

  it('parses arrow keys', () => {
    const up = parseKeys(Buffer.from([0x1b, 0x5b, 0x41]))
    expect(up).toHaveLength(1)
    expect(up[0]!.name).toBe('up')
  })

  it('parses ctrl+c', () => {
    const k = parseKeys(Buffer.from([0x03]))
    expect(k[0]!).toMatchObject({ name: 'c', ctrl: true })
  })

  it('parses enter as return', () => {
    expect(parseKeys(Buffer.from([0x0d]))[0]!.name).toBe('return')
    expect(parseKeys(Buffer.from([0x0a]))[0]!.name).toBe('return')
  })

  it('parses backspace', () => {
    expect(parseKeys(Buffer.from([0x7f]))[0]!.name).toBe('backspace')
  })

  it('parses pageup (CSI 5~)', () => {
    const k = parseKeys(Buffer.from([0x1b, 0x5b, 0x35, 0x7e]))
    expect(k[0]!.name).toBe('pageup')
  })

  it('parses alt+a', () => {
    const k = parseKeys(Buffer.from([0x1b, 0x61]))
    expect(k[0]!).toMatchObject({ str: 'a', meta: true, name: 'a' })
  })

  it('parses multi-key chunks', () => {
    const k = parseKeys(Buffer.from('hi'))
    expect(k.map((x) => x.str)).toEqual(['h', 'i'])
  })
})

// ===========================================================================
// onExec + subsystem handlers
// ===========================================================================

describe('SshAdapter — exec & subsystems', () => {
  let adapter: SshAdapter | null = null
  afterEach(async () => {
    if (adapter) { await adapter.stop(); adapter = null }
  })

  it('rejects exec when onExec is not provided', async () => {
    adapter = createSshAdapter({ port: 0, auth: { none: true }, onSession: async () => { /* noop */ } })
    await adapter.start()

    await new Promise<void>((resolve) => {
      const c = new Ssh2Client()
      c.on('ready', () => {
        c.exec('ls -la', (err) => {
          // Server should reject the exec request
          expect(err).toBeTruthy()
          c.end()
          resolve()
        })
      })
        .on('error', () => resolve()) // error path also fine
        .connect({
          host: '127.0.0.1', port: adapter!.port, username: 'u',
          password: '', hostVerifier: () => true, readyTimeout: 5000,
        })
    })
  })

  it('runs onExec handler with the command string available', async () => {
    let receivedCommand = ''
    let kindObserved: string | undefined
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async () => { /* shell unused */ },
      onExec: async (session) => {
        receivedCommand = session.command ?? ''
        kindObserved = session.kind
        session.write('exec-result\n')
        // exec should close itself when handler returns; no need to wait
      },
    })
    await adapter.start()

    const output = await new Promise<string>((resolve, reject) => {
      const c = new Ssh2Client()
      const chunks: Buffer[] = []
      c.on('ready', () => {
        c.exec('say-hello arg1 arg2', (err, stream) => {
          if (err) return reject(err)
          stream.on('data', (b: Buffer) => chunks.push(b))
          stream.on('close', () => {
            c.end()
            resolve(Buffer.concat(chunks).toString())
          })
        })
      })
        .on('error', reject)
        .connect({
          host: '127.0.0.1', port: adapter!.port, username: 'u',
          password: '', hostVerifier: () => true, readyTimeout: 5000,
        })
    })

    expect(receivedCommand).toBe('say-hello arg1 arg2')
    expect(kindObserved).toBe('exec')
    expect(output).toContain('exec-result')
  })

  it('routes named subsystems to the matching handler', async () => {
    let subsystemSeen: string | undefined
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async () => { /* unused */ },
      subsystems: {
        weather: async (session) => {
          subsystemSeen = session.subsystem
          session.write('sunny\n')
        },
      },
    })
    await adapter.start()

    const output = await new Promise<string>((resolve, reject) => {
      const c = new Ssh2Client()
      const chunks: Buffer[] = []
      c.on('ready', () => {
        c.subsys('weather', (err, stream) => {
          if (err) return reject(err)
          stream.on('data', (b: Buffer) => chunks.push(b))
          stream.on('close', () => {
            c.end()
            resolve(Buffer.concat(chunks).toString())
          })
        })
      })
        .on('error', reject)
        .connect({
          host: '127.0.0.1', port: adapter!.port, username: 'u',
          password: '', hostVerifier: () => true, readyTimeout: 5000,
        })
    })

    expect(subsystemSeen).toBe('weather')
    expect(output).toContain('sunny')
  })

  it('rejects unknown subsystem requests', async () => {
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async () => { /* unused */ },
      subsystems: { foo: async () => { /* noop */ } },
    })
    await adapter.start()

    await new Promise<void>((resolve) => {
      const c = new Ssh2Client()
      c.on('ready', () => {
        c.subsys('bar' /* unknown */, (err) => {
          expect(err).toBeTruthy()
          c.end()
          resolve()
        })
      })
        .on('error', () => resolve())
        .connect({
          host: '127.0.0.1', port: adapter!.port, username: 'u',
          password: '', hostVerifier: () => true, readyTimeout: 5000,
        })
    })
  })
})

// ===========================================================================
// Public-key auth
// ===========================================================================

describe('SshAdapter — publicKey auth', () => {
  let adapter: SshAdapter | null = null
  afterEach(async () => {
    if (adapter) { await adapter.stop(); adapter = null }
  })

  /** Generate an RSA keypair as both PEM (for client) and ssh2 ParsedKey. */
  function genClientKey(): { pem: string; parsed: ReturnType<typeof ssh2Utils.parseKey> } {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    })
    const pem = privateKey as string
    const parsed = ssh2Utils.parseKey(pem)
    return { pem, parsed }
  }

  it('accepts the client when handler approves the key', async () => {
    const { pem, parsed } = genClientKey()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedAlgo = (parsed as any).type ?? 'ssh-rsa'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expectedPublicSshKey = (parsed as any).getPublicSSH()

    let observedMethod: string | undefined
    let observedKeyAlgo: string | undefined
    adapter = createSshAdapter({
      port: 0,
      auth: {
        publicKey: async (req) => {
          if (!req.publicKey) return false
          // Match by comparing the SSH-formatted public key bytes
          return req.publicKey.data.equals(expectedPublicSshKey)
        },
      },
      onSession: async (session) => {
        observedMethod = session.authMethod
        observedKeyAlgo = session.authData.publicKey?.algo
        session.write('welcome\r\n')
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()

    const output = await new Promise<string>((resolve, reject) => {
      const c = new Ssh2Client()
      const chunks: Buffer[] = []
      c.on('ready', () => {
        c.shell({ cols: 80, rows: 24, term: 'xterm' }, (err, stream) => {
          if (err) return reject(err)
          stream.on('data', (b: Buffer) => chunks.push(b))
          setTimeout(() => {
            stream.close()
            c.end()
            resolve(Buffer.concat(chunks).toString())
          }, 200)
        })
      })
        .on('error', reject)
        .connect({
          host: '127.0.0.1', port: adapter!.port, username: 'alice',
          privateKey: pem,
          hostVerifier: () => true, readyTimeout: 5000,
        })
    })

    expect(output).toContain('welcome')
    expect(observedMethod).toBe('publickey')
    expect(observedKeyAlgo).toBe(expectedAlgo)
  })

  it('rejects the client when handler refuses the key', async () => {
    const { pem } = genClientKey()
    adapter = createSshAdapter({
      port: 0,
      auth: { publicKey: async () => false },
      onSession: async () => { /* unreachable */ },
    })
    await adapter.start()

    await expect(
      new Promise<void>((resolve, reject) => {
        const c = new Ssh2Client()
        c.on('ready', () => { c.end(); resolve() })
          .on('error', reject)
          .connect({
            host: '127.0.0.1', port: adapter!.port, username: 'alice',
            privateKey: pem,
            hostVerifier: () => true, readyTimeout: 5000,
          })
      }),
    ).rejects.toThrow()
  })

  it('supports mixed public+private auth (public via none, private via pubkey)', async () => {
    const { pem, parsed } = genClientKey()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trustedKey = (parsed as any).getPublicSSH()

    adapter = createSshAdapter({
      port: 0,
      auth: {
        none: true,
        publicKey: async (req) => req.publicKey?.data.equals(trustedKey) === true,
      },
      onSession: async (session) => {
        if (session.authMethod === 'none') {
          session.write('PUBLIC\r\n')
        } else if (session.authMethod === 'publickey') {
          session.write('PRIVATE\r\n')
        }
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()

    // Anonymous client → PUBLIC
    const anonOutput = await runClient(adapter.port, { username: 'anon', password: '' })
    expect(anonOutput).toContain('PUBLIC')

    // Authenticated client → PRIVATE
    // Force ssh2 to use publickey only (its default tries 'none' first which
    // would succeed here and never exercise the publicKey verifier).
    const authOutput = await runClient(adapter.port, {
      username: 'alice', privateKey: pem, authMethods: ['publickey'],
    })
    expect(authOutput).toContain('PRIVATE')
  })
})

// ===========================================================================
// Connection filter
// ===========================================================================

describe('SshAdapter — connection filter', () => {
  let adapter: SshAdapter | null = null
  afterEach(async () => {
    if (adapter) { await adapter.stop(); adapter = null }
  })

  /**
   * Attempt a connect; resolve to 'ready' if it gets that far, 'rejected'
   * if it errors out or closes before ready. Filter rejections close the
   * socket cleanly (DISCONNECT_REASON), which ssh2 surfaces as 'close'
   * before 'ready' — not 'error'.
   */
  function tryConnect(port: number): Promise<'ready' | 'rejected'> {
    return new Promise((resolve) => {
      const c = new Ssh2Client()
      let settled = false
      const settle = (result: 'ready' | 'rejected') => {
        if (settled) return
        settled = true
        try { c.end() } catch { /* noop */ }
        resolve(result)
      }
      c.on('ready', () => settle('ready'))
        .on('error', () => settle('rejected'))
        .on('close', () => settle('rejected'))
        .connect({
          host: '127.0.0.1', port, username: 'u', password: '',
          hostVerifier: () => true, readyTimeout: 3000,
        })
    })
  }

  it('denies connections from blocked hosts before the SSH handshake', async () => {
    const denied: Array<{ host: string; reason: string }> = []
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      filter: {
        denyHosts: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
        onDenied: (info) => denied.push({ host: info.host, reason: info.reason }),
      },
      onSession: async () => { /* unreachable */ },
    })
    await adapter.start()

    const result = await tryConnect(adapter.port)
    expect(result).toBe('rejected')

    await wait(50)
    expect(denied.length).toBeGreaterThanOrEqual(1)
    expect(denied[0]!.reason).toMatch(/deny/i)
  })

  it('allows connections through allowHosts and rejects others', async () => {
    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      filter: { allowHosts: ['10.0.0.99'] },
      onSession: async () => { /* unreachable */ },
    })
    await adapter.start()

    const result = await tryConnect(adapter.port)
    expect(result).toBe('rejected')
  })
})

// ===========================================================================
// tuiuiu real render
// ===========================================================================

describe('SshAdapter — tuiuiu integration', () => {
  let adapter: SshAdapter | null = null
  afterEach(async () => {
    if (adapter) { await adapter.stop(); adapter = null }
  })

  it('renders a tuiuiu component to a real SSH session', async () => {
    // tuiuiu.js is a devDependency; users would `pnpm add tuiuiu.js` to use it.
    let tuiuiu: typeof import('tuiuiu.js') | null = null
    try {
      tuiuiu = await import('tuiuiu.js')
    } catch {
      console.warn('tuiuiu.js not installed; skipping tuiuiu integration test')
      return
    }
    const { render, Box, Text } = tuiuiu

    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        const instance = render(
          () => Box({}, Text({ color: 'green' }, `Hello, ${session.user}!`)),
          {
            ...session.tui,
            // turn off features that don't make sense over network for tests:
            clearOnStart: false,
            alternateScreen: false,
            exitOnCtrlC: false,
            maxFps: 60,
            useDeltaRenderer: false,
          },
        )
        // give tuiuiu time to flush
        await wait(150)
        instance.unmount()
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()

    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell({ cols: 80, rows: 24 })
    const data = await collectFor(shell, 350)
    const ansi = data.toString()

    // tuiuiu outputs ANSI escapes + the text content. Assert both.
    expect(ansi).toContain('Hello,')
    expect(ansi).toContain('guest')
    expect(ansi).toMatch(/\x1b\[/) // contains at least one ANSI escape

    shell.close()
    client.end()
  })

  it('updates tui stdout columns/rows on window-change', async () => {
    let initialCols = 0
    let resizedCols = 0
    let resizeFiredOnTuiStdout = false

    adapter = createSshAdapter({
      port: 0,
      auth: { none: true },
      onSession: async (session) => {
        const { stdout } = session.tui
        initialCols = stdout.columns
        stdout.on('resize', () => {
          resizeFiredOnTuiStdout = true
          resizedCols = stdout.columns
        })
        await new Promise<void>((r) => session.onClose(r))
      },
    })
    await adapter.start()
    const { client, openShell } = await connect(adapter.port)
    const shell = await openShell({ cols: 80, rows: 24 })
    await wait(80)
    shell.resize(140, 50)
    await wait(150)

    expect(initialCols).toBe(80)
    expect(resizeFiredOnTuiStdout).toBe(true)
    expect(resizedCols).toBe(140)

    shell.close()
    client.end()
  })
})

// ----- helpers -----

interface ClientOpts {
  username: string
  password?: string
  privateKey?: string
  /** Restrict ssh2 to specific auth methods (default: ssh2's auto sequence). */
  authMethods?: Array<'none' | 'password' | 'publickey'>
}

function runClient(port: number, opts: ClientOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = new Ssh2Client()
    const chunks: Buffer[] = []
    c.on('ready', () => {
      c.shell({ cols: 80, rows: 24, term: 'xterm' }, (err, stream) => {
        if (err) return reject(err)
        stream.on('data', (b: Buffer) => chunks.push(b))
        setTimeout(() => {
          stream.close()
          c.end()
          resolve(Buffer.concat(chunks).toString())
        }, 200)
      })
    })
      .on('error', reject)
      .connect({
        host: '127.0.0.1', port,
        username: opts.username,
        password: opts.password,
        privateKey: opts.privateKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(opts.authMethods ? { authHandler: opts.authMethods as any } : {}),
        hostVerifier: () => true,
        readyTimeout: 5000,
      })
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function collectFor(
  shell: { onData: (h: (b: Buffer) => void) => void },
  ms: number,
): Promise<Buffer> {
  const buffers: Buffer[] = []
  shell.onData((b) => buffers.push(b))
  await wait(ms)
  return Buffer.concat(buffers)
}
