# SSH Adapter

Expose interactive terminal experiences (TUIs, prompts, shells) over SSH —
inspired by [terminal.shop](https://terminal.shop) and Charm's
[Wish](https://github.com/charmbracelet/wish). Users connect with the
familiar `ssh your.app` and land in a real, rendered terminal app.

The adapter is **standalone**: it does not multiplex with HTTP or share the
front-door port (the SSH banner would conflict with TLS sniffing). Plug it
in alongside your other Raffel protocols.

> **Optional peer dependency.** Install `ssh2` (and `tuiuiu.js` if you want
> reactive UIs) when you use the SSH adapter:
> ```bash
> pnpm add ssh2
> pnpm add tuiuiu.js   # only if you want the TUI bridge
> ```

## Quick Start

```ts
import { createSshAdapter } from 'raffel'

const ssh = createSshAdapter({
  port: 2222,
  onSession: async (session) => {
    session.write(`☕ Hi ${session.user}!\r\n`)
    for await (const key of session.keys) {
      if (key.name === 'q' || (key.ctrl && key.name === 'c')) break
      session.write(key.str)
    }
  },
})

await ssh.start()
```

Connect from your terminal:

```bash
ssh -p 2222 anything@localhost
```

## API Layers

The adapter exposes the SSH session at three levels of abstraction. Pick the
one that matches your needs; you can mix them in the same handler.

### 1. Raw streams

`session.stdin` / `session.stdout` / `session.stderr` are real Node Duplex
streams. Pipe them, write to them, attach `'data'` listeners — they behave
like any TTY.

### 2. Parsed keys + screen helpers

`session.keys` is an `AsyncIterable<KeyEvent>` with arrow keys, function
keys, ctrl/alt modifiers, and UTF-8 already decoded. `session.write()`,
`session.clear()`, `session.onResize()` cover the common ergonomics.

```ts
for await (const key of session.keys) {
  if (key.name === 'up')    moveSelectionUp()
  if (key.name === 'down')  moveSelectionDown()
  if (key.name === 'return') select()
  if (key.ctrl && key.name === 'c') break
}
```

### 3. tuiuiu.js bridge (optional)

`session.tui` returns a `{ stdin, stdout }` pair that satisfies tuiuiu's
TTY contract (`isTTY = true`, `columns`/`rows`, `'resize'` event). Plug it
directly into `render()`:

```ts
import { render, Box, Text } from 'tuiuiu.js'

createSshAdapter({
  port: 2222,
  onSession: async (session) => {
    const app = render(
      () => Box({}, Text({ color: 'cyan' }, `Hello, ${session.user}!`)),
      session.tui,
    )
    await app.waitUntilExit()
  },
})
```

Resize, exit handling, and cleanup are wired up for you.

## Public vs Private (mixed auth)

Anonymous and authenticated users can share the same adapter. The session
handler branches on `session.authMethod`:

```ts
createSshAdapter({
  port: 2222,
  auth: {
    none: true,                                          // public path
    publicKey: async (req) => isKnownFingerprint(req.publicKey),
  },
  onSession: async (session) => {
    if (session.authMethod === 'none') {
      renderPublicMenu(session)                          // limited features
    } else {
      renderAuthenticatedDashboard(session)              // full features
    }
  },
})
```

`session.authData.publicKey` gives you `{ algo, data }` to compute a
fingerprint and look up the user.

## Exec & Subsystems

Beyond interactive shells, the adapter supports one-shot commands
(`ssh host some-cmd`) and named subsystems (used by tools like SFTP).
Both are rejected by default.

```ts
createSshAdapter({
  port: 2222,
  onSession: async (s) => { /* interactive shell */ },
  onExec: async (s) => {
    // Available as session.command
    if (s.command === 'menu') s.write(MENU)
    else s.close(1)
  },
  subsystems: {
    weather: async (s) => s.write(`${await fetchWeather()}\n`),
  },
})
```

## Host Keys

For production, pass a stable private key so clients don't see a
"host key changed" warning on every restart:

```ts
import { readFileSync } from 'node:fs'

createSshAdapter({
  port: 2222,
  hostKeys: [readFileSync('./ssh-host-key')],
  onSession: async (s) => { /* ... */ },
})
```

If `hostKeys` is omitted or empty, the adapter generates an ephemeral
**RSA 2048** key on `start()` and logs a warning. Fine for dev, not for
production. You can generate a key for disk yourself:

```ts
import { generateEphemeralHostKey } from 'raffel'
import { writeFileSync } from 'node:fs'

writeFileSync('./ssh-host-key', generateEphemeralHostKey())
```

## Connection Filter

Inbound IP filtering, identical to the TCP/UDP/WebSocket adapters:

```ts
createSshAdapter({
  port: 2222,
  filter: {
    denyHosts: ['10.0.0.0/8', '*.evil.com'],
    onDenied: (info) => log.warn(`SSH denied from ${info.host}: ${info.reason}`),
  },
  onSession: async (s) => { /* ... */ },
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | required | Port to listen on (2222 typical for dev) |
| `host` | string | `'127.0.0.1'` | Bind address |
| `hostKeys` | `SshHostKey[]` | ephemeral RSA 2048 | Host private keys (PEM, OpenSSH, or `{ key, passphrase }`) |
| `banner` | string | – | Pre-auth banner sent to the client |
| `ident` | string | `'SSH-2.0-Raffel'` | Server software identifier |
| `auth` | `SshAuthOptions` | `{ none: false }` | Auth handlers per method |
| `auth.none` | `boolean \| handler` | `false` | Allow anonymous (public) access |
| `auth.password` | `handler` | – | `(req) => boolean \| Promise<boolean>` |
| `auth.publicKey` | `handler` | – | `(req) => boolean \| Promise<boolean>` |
| `onSession` | `handler` | required | Interactive shell handler |
| `onExec` | `handler` | – | `ssh host <cmd>` one-shot handler |
| `subsystems` | `Record<string, handler>` | – | Named subsystem handlers |
| `filter` | `ConnectionFilter` | – | Inbound IP allow/deny |
| `keepAliveInterval` | number | `30000` | ms; `0` disables |
| `keepAliveMaxFailures` | number | `3` | Drop after N failed keep-alives |

## SshSession Surface

```ts
session.id          // unique per session
session.user        // SSH username
session.authMethod  // 'none' | 'password' | 'publickey'
session.authData    // { publicKey?: { algo, data } }
session.client      // { ip, port, family, identRaw }
session.env         // env vars from the client

session.pty         // PTY info or null (cols/rows/term/width/height)
session.cols        // shortcut (80 if no pty)
session.rows        // shortcut (24 if no pty)
session.term        // shortcut ('xterm' if no pty)

session.stdin       // Readable
session.stdout      // Writable
session.stderr      // Writable
session.write(s)    // shortcut for stdout.write
session.clear()     // ANSI clear screen
session.keys        // AsyncIterable<KeyEvent>
session.onResize(fn) // (cols, rows) => void
session.onClose(fn)
session.close(exitCode?)

session.signal      // AbortSignal that fires on close
session.tui         // { stdin, stdout } — TTY-compatible for tuiuiu.js
session.kind        // 'shell' | 'exec' | 'subsystem'
session.command     // exec command line (when kind === 'exec')
session.subsystem   // subsystem name (when kind === 'subsystem')
```

## KeyEvent Shape

```ts
{
  raw: Buffer            // bytes received
  str: string            // utf-8 representation
  name?: string          // 'up' | 'down' | 'return' | 'a' | 'f5' | …
  ctrl: boolean
  shift: boolean
  meta: boolean          // alt
  sequence?: string      // raw escape sequence for unrecognized keys
}
```

Recognized names mirror Node's readline keypress event: `up`, `down`,
`left`, `right`, `home`, `end`, `pageup`, `pagedown`, `insert`, `delete`,
`return`, `escape`, `backspace`, `tab`, `space`, `f1`..`f12`, and ASCII
characters.

## Production Notes

- **Run on a non-privileged port** (≥ 1024) unless you have a reason to
  bind 22; SSH on 22 needs root or a setcap helper.
- **Persist your host key.** Generate once with `generateEphemeralHostKey()`
  (or `ssh-keygen`), commit it as a secret, mount it in production.
- **Set `keepAliveInterval`** to detect dead clients quickly behind NAT.
- **Rate-limit at the network edge.** SSH brute-force probes are constant
  on the public internet.
- **`ConnectionFilter`** is enough for IP blocklists; for fail2ban-style
  dynamic blocking, plug a custom `check()` that consults your store.

## Use Cases

- terminal.shop-style storefronts
- DevOps tooling exposed over SSH (no web UI required)
- Interactive admin consoles for internal services
- Demos and showcases that work from any terminal
- Status dashboards reachable from anywhere `ssh` is installed
