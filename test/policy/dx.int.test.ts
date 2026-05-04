/**
 * DX (T7.1, T7.2, T7.4)
 *  - structured log via LoggerPort
 *  - server.policy.explain / list
 *  - error body shape verbose vs production
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import type { LoggerPort } from '../../src/ports/outbound/logger.js'
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

const P: Principal = { id: 's1', tenantId: 't1', scopes: ['lead.read'], groups: [] }

function fakeLogger(): { logger: LoggerPort; calls: { level: string; data?: unknown; msg: string }[] } {
  const calls: { level: string; data?: unknown; msg: string }[] = []
  const make =
    (level: string) =>
    (...args: unknown[]) => {
      if (args.length === 1) calls.push({ level, msg: args[0] as string })
      else calls.push({ level, data: args[0], msg: args[1] as string })
    }
  return {
    calls,
    logger: {
      debug: make('debug'),
      info: make('info'),
      warn: make('warn'),
      error: make('error'),
    } as LoggerPort,
  }
}

describe('DX — structured logging via LoggerPort', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('logs an info entry on allow with full decision fields', async () => {
    const port = await getFreePort()
    const fl = fakeLogger()

    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        logger: fl.logger,
        policies: [
          {
            id: 'allow-read',
            effect: 'allow',
            principals: ['scope:lead.read'],
            actions: ['lead.read'],
            resources: ['lead:*'],
          },
        ],
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: ({ id }: { id: string }) => ({ type: 'lead', id, tenantId: 't1' }),
      })
      .handler(async ({ id }: { id: string }) => ({ id }))

    await server.start()
    await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      body: JSON.stringify({ id: 'l1' }),
      headers: { 'content-type': 'application/json' },
    })

    const policyLog = fl.calls.find((c) => c.msg.startsWith('policy:'))
    expect(policyLog).toBeDefined()
    expect(policyLog?.level).toBe('info')
    expect(policyLog?.msg).toContain('allow')
    const data = policyLog?.data as Record<string, unknown>
    expect(data.allowed).toBe(true)
    expect(data.action).toBe('lead.read')
    expect(data.principal).toMatchObject({ id: 's1', tenantId: 't1' })
    expect(data.resource).toMatchObject({ type: 'lead', id: 'l1' })
    expect(data.matchedPolicyIds).toEqual(['allow-read'])
    expect(data.durationMs).toBeTypeOf('number')
  })

  it('logs warn on explicit_deny', async () => {
    const port = await getFreePort()
    const fl = fakeLogger()

    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        logger: fl.logger,
        policies: [
          {
            id: 'deny-all',
            effect: 'deny',
            principals: ['**'],
            actions: ['lead.read'],
            resources: ['lead:*'],
          },
        ],
      },
    })

    server
      .procedure('lead.read')
      .authz({ resource: ({ id }: { id: string }) => ({ type: 'lead', id, tenantId: 't1' }) })
      .handler(async () => ({}))

    await server.start()
    await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      body: JSON.stringify({ id: 'l1' }),
      headers: { 'content-type': 'application/json' },
    })

    const denyLog = fl.calls.find((c) => c.msg.includes('explicit_deny'))
    expect(denyLog).toBeDefined()
    expect(denyLog?.level).toBe('warn')
  })

  it('logs warn on implicit_deny', async () => {
    const port = await getFreePort()
    const fl = fakeLogger()

    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        logger: fl.logger,
        policies: [],
      },
    })

    server
      .procedure('lead.read')
      .authz({ resource: ({ id }: { id: string }) => ({ type: 'lead', id, tenantId: 't1' }) })
      .handler(async () => ({}))

    await server.start()
    await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      body: JSON.stringify({ id: 'l1' }),
      headers: { 'content-type': 'application/json' },
    })

    const implicit = fl.calls.find((c) => c.msg.includes('implicit_deny'))
    expect(implicit).toBeDefined()
    expect(implicit?.level).toBe('warn')
  })
})

describe('DX — server.policy.explain / list (T7.4)', () => {
  let server: ReturnType<typeof createServer> | null = null
  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('server.policy is undefined when policy not configured', () => {
    const s = createServer({ port: 19998 })
    expect(s.policy).toBeUndefined()
  })

  it('server.policy.explain returns Decision without side effects', async () => {
    const fl = fakeLogger()
    const policies = [
      {
        id: 'allow-l1',
        effect: 'allow' as const,
        principals: ['**'],
        actions: ['lead.read'],
        resources: ['lead:l1'],
      },
    ]

    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        logger: fl.logger,
        policies,
      },
    })

    expect(server.policy).toBeDefined()

    const decision = await server.policy!.explain({
      principal: P,
      action: 'lead.read',
      resource: { type: 'lead', id: 'l1', tenantId: 't1' },
    })

    expect(decision.allowed).toBe(true)
    expect(decision.matchedPolicyIds).toEqual(['allow-l1'])
    // explain MUST NOT log
    const polLogs = fl.calls.filter((c) => c.msg.startsWith('policy:'))
    expect(polLogs).toHaveLength(0)
  })

  it('server.policy.list returns frozen snapshot', async () => {
    const policies = [
      {
        id: 'p1',
        effect: 'allow' as const,
        principals: ['*'],
        actions: ['*'],
        resources: ['*'],
      },
      {
        id: 'p2',
        effect: 'deny' as const,
        principals: ['*'],
        actions: ['*'],
        resources: ['*'],
      },
    ]
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies,
      },
    })

    const list = server.policy!.list()
    expect(list).toHaveLength(2)
    expect(list.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(Object.isFrozen(list)).toBe(true)
  })
})

describe('DX — production error body shape (T7.1, F12)', () => {
  let server: ReturnType<typeof createServer> | null = null
  const original = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  afterEach(async () => {
    process.env.NODE_ENV = original
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('production: deny body contains zero policy ids', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'deny-archived',
            effect: 'deny',
            principals: ['**'],
            actions: ['lead.read'],
            resources: ['lead:*'],
          },
        ],
      },
    })

    server
      .procedure('lead.read')
      .authz({ resource: ({ id }: { id: string }) => ({ type: 'lead', id, tenantId: 't1' }) })
      .handler(async () => ({}))

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      body: JSON.stringify({ id: 'l1' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).not.toContain('matchedPolicyIds')
    expect(text).not.toContain('candidatePolicies')
    expect(text).not.toContain('deny-archived')
  })
})
