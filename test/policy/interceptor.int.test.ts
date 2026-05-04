import { describe, it, expect, vi } from 'vitest'
import { createDefaultEngine } from '../../src/middleware/policy/index.js'
import { createPolicyInterceptor } from '../../src/middleware/policy/interceptor.js'
import { createPrincipalResolver } from '../../src/middleware/policy/principal/index.js'
import { RaffelError } from '../../src/core/error.js'
import { createContext, type Envelope } from '../../src/types/index.js'
import type { Policy, Principal } from '../../src/middleware/policy/types.js'

const SAMPLE_PRINCIPAL: Principal = {
  id: 's1',
  tenantId: 't1',
  scopes: ['lead.read'],
  groups: ['channel:c1'],
}

function envelope(payload: unknown = { id: 'l1' }): Envelope {
  return {
    id: 'test',
    procedure: 'lead.read',
    type: 'request',
    payload,
    metadata: {},
    context: createContext('req-1'),
  }
}

function buildSetup(policies: Policy[]) {
  const engine = createDefaultEngine({ policies })
  const principalResolver = createPrincipalResolver({
    from: 'custom',
    map: () => SAMPLE_PRINCIPAL,
  })
  return { engine, principalResolver }
}

describe('policy interceptor — tracer (Phase 1)', () => {
  it('allows when policy matches → calls next() and attaches ctx.policyDecision', async () => {
    const { engine, principalResolver } = buildSetup([
      {
        id: 'allow-read',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ])

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'lead.read',
      config: {
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      },
      principalResolver,
    })

    const env = envelope({ id: 'l1' })
    const next = vi.fn(async () => 'handler-result')

    const result = await interceptor(env, env.context, next)

    expect(result).toBe('handler-result')
    expect(next).toHaveBeenCalledOnce()
    const decision = (env.context as unknown as Record<string, unknown>).policyDecision
    expect(decision).toMatchObject({ allowed: true, reason: 'allow' })
  })

  it('denies (implicit) when no policy matches → throws PERMISSION_DENIED', async () => {
    const { engine, principalResolver } = buildSetup([])

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'lead.read',
      config: {
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      },
      principalResolver,
    })

    const env = envelope()
    const next = vi.fn()

    await expect(interceptor(env, env.context, next)).rejects.toBeInstanceOf(RaffelError)
    expect(next).not.toHaveBeenCalled()
  })

  it('explicit deny → throws with verbose body in dev (matchedPolicyIds populated)', async () => {
    const { engine, principalResolver } = buildSetup([
      {
        id: 'deny-archived',
        effect: 'deny',
        principals: ['**'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        condition: ({ resource }) => resource.attrs?.status === 'archived',
      },
      {
        id: 'allow-read',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ])

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'lead.read',
      config: {
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
          attrs: { status: 'archived' },
        }),
      },
      principalResolver,
      productionErrorBody: false,
    })

    const env = envelope()

    try {
      await interceptor(env, env.context, vi.fn())
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RaffelError)
      const re = err as RaffelError
      expect(re.code).toBe('PERMISSION_DENIED')
      expect(re.status).toBe(403)
      const body = re.details as { reason: string; matchedPolicyIds: string[] }
      expect(body.reason).toBe('explicit_deny')
      expect(body.matchedPolicyIds).toEqual(['deny-archived'])
    }
  })

  it('production mode → deny body contains zero policy ids', async () => {
    const { engine, principalResolver } = buildSetup([])

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'lead.read',
      config: {
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      },
      principalResolver,
      productionErrorBody: true,
    })

    const env = envelope()

    try {
      await interceptor(env, env.context, vi.fn())
      throw new Error('should have thrown')
    } catch (err) {
      const re = err as RaffelError
      const body = re.details as Record<string, unknown>
      expect(body).toEqual({ error: 'forbidden', code: 'POLICY_DENIED' })
      // F12: zero ids leak
      expect(JSON.stringify(body)).not.toContain('matchedPolicyIds')
      expect(JSON.stringify(body)).not.toContain('candidatePolicies')
    }
  })

  it('public: true → bypasses engine, calls next without resolving principal', async () => {
    const principalResolver = vi.fn(async () => SAMPLE_PRINCIPAL)
    const engine = createDefaultEngine({ policies: [] })

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'health.ping',
      config: { public: true },
      principalResolver,
    })

    const env = envelope({})
    const next = vi.fn(async () => 'ok')

    const result = await interceptor(env, env.context, next)

    expect(result).toBe('ok')
    expect(principalResolver).not.toHaveBeenCalled()
  })

  it('mode: any → at least one resource passes', async () => {
    const { engine, principalResolver } = buildSetup([
      {
        id: 'allow-l1-only',
        effect: 'allow',
        principals: ['**'],
        actions: ['lead.read'],
        resources: ['lead:l1'],
      },
    ])

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'lead.read',
      config: {
        mode: 'any',
        resource: () => [
          { type: 'lead', id: 'lX', tenantId: 't1' },
          { type: 'lead', id: 'l1', tenantId: 't1' },
          { type: 'lead', id: 'lY', tenantId: 't1' },
        ],
      },
      principalResolver,
    })

    const env = envelope()
    const next = vi.fn(async () => 'ok')
    const result = await interceptor(env, env.context, next)
    expect(result).toBe('ok')
  })

  it('principal resolver invoked once per request (cached)', async () => {
    const principalResolver = vi.fn(async () => SAMPLE_PRINCIPAL)
    const engine = createDefaultEngine({
      policies: [
        {
          id: 'allow-all',
          effect: 'allow',
          principals: ['**'],
          actions: ['**'],
          resources: ['**'],
        },
      ],
    })

    const interceptor = createPolicyInterceptor({
      engine,
      defaultAction: 'a',
      config: {
        resource: () => ({ type: 'r', id: '1', tenantId: 't1' }),
      },
      principalResolver,
    })

    const env = envelope()
    await interceptor(env, env.context, async () => 'ok')
    await interceptor(env, env.context, async () => 'ok')
    await interceptor(env, env.context, async () => 'ok')

    expect(principalResolver).toHaveBeenCalledOnce()
  })
})
