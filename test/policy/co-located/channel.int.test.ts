/**
 * Channel co-located policies (issue #95).
 *
 * Sibling `<channel>.policy.yaml` and folder `_policy.yaml` next to or above
 * a discovered channel auto-attach authorization to subscribe attempts.
 * Unauthorised principals are rejected at subscribe time; authorised ones
 * pass.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import WebSocket from 'ws'
import { createServer } from '../../../src/server/builder.js'
import type { Principal } from '../../../src/middleware/policy/types.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      if (!address || typeof address === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

const CHANNEL_TS = `
export const config = { auth: 'none' }
`

let dir: string
let server: ReturnType<typeof createServer> | null = null

afterEach(async () => {
  if (server) {
    await server.stop().catch(() => {})
    server = null
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = ''
  }
})

async function trySubscribe(port: number, channelName: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    let settled = false
    const settle = (value: { ok: boolean; reason?: string }) => {
      if (settled) return
      settled = true
      try { ws.close() } catch {}
      resolve(value)
    }
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', channel: channelName }))
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'subscribed' && msg.channel === channelName) {
        settle({ ok: true })
      } else if (msg.type === 'error' || msg.type === 'subscribe_denied') {
        settle({ ok: false, reason: msg.reason ?? 'denied' })
      }
    })
    ws.on('error', (err) => settle({ ok: false, reason: String(err) }))
    ws.on('close', () => settle({ ok: false, reason: 'closed' }))
    setTimeout(() => settle({ ok: false, reason: 'timeout' }), 2000)
  })
}

describe('channel co-located policies (issue #95)', () => {
  it('sibling .policy.yaml gates channel subscribe', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-channel-policy-'))
    const channelsDir = path.join(dir, 'channels')
    await mkdir(channelsDir, { recursive: true })

    await writeFile(path.join(channelsDir, 'chat.js'), CHANNEL_TS)
    await writeFile(
      path.join(channelsDir, 'chat.policy.yaml'),
      `
id: chat-allow-members
effect: allow
principals:
  - scope:chat.read
actions:
  - chat
resources:
  - "**"
`.trim(),
    )

    const port = await getFreePort()
    let principal: Principal = {
      id: 'u-allowed', tenantId: 't', scopes: ['chat.read'], groups: [],
    }
    server = createServer({
      port,
      discovery: { channels: channelsDir },
      websocket: { path: '/ws' },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const allowed = await trySubscribe(port, 'chat')
    expect(allowed.ok).toBe(true)

    principal = { id: 'u-denied', tenantId: 't', scopes: [], groups: [] }
    const denied = await trySubscribe(port, 'chat')
    expect(denied.ok).toBe(false)
  })

  it('folder _policy.yaml in channels tree cascades to all channels', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-channel-cascade-'))
    const channelsDir = path.join(dir, 'channels')
    await mkdir(channelsDir, { recursive: true })

    await writeFile(
      path.join(channelsDir, '_policy.yaml'),
      `
id: chat-baseline
effect: allow
principals:
  - scope:chat.access
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )
    await writeFile(path.join(channelsDir, 'lobby.js'), CHANNEL_TS)

    const port = await getFreePort()
    const principal: Principal = {
      id: 'u', tenantId: 't', scopes: ['chat.access'], groups: [],
    }
    server = createServer({
      port,
      discovery: { channels: channelsDir },
      websocket: { path: '/ws' },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const result = await trySubscribe(port, 'lobby')
    expect(result.ok).toBe(true)
  })
})
