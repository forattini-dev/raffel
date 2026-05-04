import { describe, it, expect, vi } from 'vitest'
import { createRegistry } from '../../src/core/registry.js'
import { createSchemaRegistry } from '../../src/validation/index.js'
import { createProcedureBuilder } from '../../src/server/handler-builders.js'
import { createDefaultEngine } from '../../src/middleware/policy/index.js'
import { createPolicyInterceptor } from '../../src/middleware/policy/interceptor.js'
import { createPrincipalResolver } from '../../src/middleware/policy/principal/index.js'
import type { ProcedurePolicyConfig, Principal, Policy } from '../../src/middleware/policy/types.js'
import type { Interceptor } from '../../src/types/index.js'

const SAMPLE_PRINCIPAL: Principal = {
  id: 's1',
  tenantId: 't1',
  scopes: ['lead.read'],
  groups: [],
}

function buildPolicyFactory(policies: Policy[]) {
  const engine = createDefaultEngine({ policies })
  const principalResolver = createPrincipalResolver({
    from: 'custom',
    map: () => SAMPLE_PRINCIPAL,
  })
  const factory = (procedureName: string, config: ProcedurePolicyConfig): Interceptor =>
    createPolicyInterceptor({
      engine,
      defaultAction: procedureName,
      config,
      principalResolver,
    })
  return { factory, engine }
}

describe('.authz() builder method (T1.3)', () => {
  it('throws if .authz() called without server-level policy config (no factory provided)', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    const builder = createProcedureBuilder(registry, schemaRegistry, 'lead.read')

    expect(() =>
      builder.authz({
        resource: () => ({ type: 'lead', id: 'l1', tenantId: 't1' }),
      }),
    ).toThrow(/requires `policy: \{ \.\.\. \}` on createServer/)
  })

  it('registers an interceptor when .authz() is called with factory configured', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    const { factory } = buildPolicyFactory([
      {
        id: 'allow-read',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ])

    const builder = createProcedureBuilder(
      registry,
      schemaRegistry,
      'lead.read',
      [],
      undefined,
      undefined,
      undefined,
      factory,
    )

    builder
      .authz({
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      })
      .handler(async () => ({ ok: true }))

    const procedure = registry.getProcedure('lead.read')
    expect(procedure).toBeDefined()
    expect(procedure?.interceptors).toBeDefined()
    expect(procedure?.interceptors!.length).toBeGreaterThan(0)
  })

  it('default action = procedure name when not overridden', async () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    const evaluateSpy = vi.fn(() => ({
      allowed: true,
      reason: 'allow' as const,
      matchedPolicyIds: ['x'],
      auditedPolicyIds: [],
      candidatePolicies: [],
    }))

    const factory = (procedureName: string, config: ProcedurePolicyConfig): Interceptor =>
      createPolicyInterceptor({
        engine: { evaluate: evaluateSpy, list: () => [] },
        defaultAction: procedureName,
        config,
        principalResolver: createPrincipalResolver({
          from: 'custom',
          map: () => SAMPLE_PRINCIPAL,
        }),
      })

    const builder = createProcedureBuilder(
      registry,
      schemaRegistry,
      'orders.list',
      [],
      undefined,
      undefined,
      undefined,
      factory,
    )

    builder
      .authz({
        resource: () => ({ type: 'order', id: '1', tenantId: 't1' }),
      })
      .handler(async () => ({ ok: true }))

    const procedure = registry.getProcedure('orders.list')!
    const interceptor = procedure.interceptors![0]!
    const env = {
      id: 'e',
      procedure: 'orders.list',
      type: 'request' as const,
      payload: {},
      metadata: {},
      context: { auth: {} } as any,
    }
    await interceptor(env, env.context, async () => 'ok')

    expect(evaluateSpy).toHaveBeenCalledOnce()
    expect(evaluateSpy.mock.calls[0]?.[0].action).toBe('orders.list')
  })

  it('action override takes precedence over procedure name', async () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    const evaluateSpy = vi.fn(() => ({
      allowed: true,
      reason: 'allow' as const,
      matchedPolicyIds: ['x'],
      auditedPolicyIds: [],
      candidatePolicies: [],
    }))

    const factory = (procedureName: string, config: ProcedurePolicyConfig): Interceptor =>
      createPolicyInterceptor({
        engine: { evaluate: evaluateSpy, list: () => [] },
        defaultAction: procedureName,
        config,
        principalResolver: createPrincipalResolver({
          from: 'custom',
          map: () => SAMPLE_PRINCIPAL,
        }),
      })

    const builder = createProcedureBuilder(
      registry,
      schemaRegistry,
      'orders.list',
      [],
      undefined,
      undefined,
      undefined,
      factory,
    )

    builder
      .authz({
        action: 'orders.read',
        resource: () => ({ type: 'order', id: '1', tenantId: 't1' }),
      })
      .handler(async () => ({ ok: true }))

    const interceptor = registry.getProcedure('orders.list')!.interceptors![0]!
    const env = {
      id: 'e',
      procedure: 'orders.list',
      type: 'request' as const,
      payload: {},
      metadata: {},
      context: { auth: {} } as any,
    }
    await interceptor(env, env.context, async () => 'ok')

    expect(evaluateSpy.mock.calls[0]?.[0].action).toBe('orders.read')
  })

  it('procedure WITHOUT .authz() registers no policy interceptor', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    const { factory } = buildPolicyFactory([])

    const builder = createProcedureBuilder(
      registry,
      schemaRegistry,
      'health.ping',
      [],
      undefined,
      undefined,
      undefined,
      factory,
    )

    builder.handler(async () => ({ ok: true }))

    const procedure = registry.getProcedure('health.ping')!
    expect(procedure.interceptors ?? []).toEqual([])
  })

  it('.authz() called twice on same procedure throws', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    const { factory } = buildPolicyFactory([])

    const builder = createProcedureBuilder(
      registry,
      schemaRegistry,
      'orders.list',
      [],
      undefined,
      undefined,
      undefined,
      factory,
    )

    builder.authz({
      resource: () => ({ type: 'order', id: '1', tenantId: 't1' }),
    })

    expect(() =>
      builder.authz({
        resource: () => ({ type: 'order', id: '1', tenantId: 't1' }),
      }),
    ).toThrow(/may only be called once/)
  })
})
