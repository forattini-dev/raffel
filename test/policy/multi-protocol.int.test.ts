/**
 * Multi-protocol authz coverage (T4.2 / T4.3 / T4.4)
 *
 * Engine + interceptor are transport-agnostic. Verifies same procedure with
 * .authz() works through HTTP RPC, JSON-RPC, and WebSocket RPC.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { WebSocket } from 'ws'
import { createServer } from '../../src/server/builder.js'
import type { Principal } from '../../src/middleware/policy/types.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      if (!a || typeof a === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = a
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

const SAMPLE_PRINCIPAL: Principal = {
  id: 's1',
  tenantId: 't1',
  scopes: ['lead.read'],
  groups: [],
}

const ALLOW_POLICY = {
  id: 'allow-read',
  effect: 'allow' as const,
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
}

describe('multi-protocol authz coverage', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('JSON-RPC over HTTP — allow path', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      jsonrpc: { path: '/rpc' },
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [ALLOW_POLICY],
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      })
      .handler(async ({ id }: { id: string }) => ({ id, name: `lead-${id}` }))

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'lead.read',
        params: { id: 'l1' },
        id: 1,
      }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { result?: unknown; error?: unknown }
    expect(body.result).toMatchObject({ id: 'l1', name: 'lead-l1' })
    expect(body.error).toBeUndefined()
  })

  it('JSON-RPC over HTTP — deny path returns JSON-RPC error', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      jsonrpc: { path: '/rpc' },
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [], // nothing matches
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      })
      .handler(async ({ id }: { id: string }) => ({ id }))

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'lead.read',
        params: { id: 'l1' },
        id: 1,
      }),
    })

    const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
    expect(body.error).toBeDefined()
    expect(body.result).toBeUndefined()
  })

  it('WebSocket RPC — allow path', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      websocket: { path: '/ws' },
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [ALLOW_POLICY],
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      })
      .handler(async ({ id }: { id: string }) => ({ id, ok: true }))

    await server.start()

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('timeout'))
      }, 5000)

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            id: 'req-1',
            type: 'request',
            procedure: 'lead.read',
            payload: { id: 'l1' },
          }),
        )
      })

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        clearTimeout(timeout)
        ws.close()
        try {
          expect(msg.payload).toMatchObject({ id: 'l1', ok: true })
          resolve()
        } catch (err) {
          reject(err)
        }
      })

      ws.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })
})
