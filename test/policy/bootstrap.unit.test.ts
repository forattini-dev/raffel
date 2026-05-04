/**
 * createPolicyBootstrap — happy-path coverage.
 *
 * Validates the slice 10 consolidation: one call wires inline policies +
 * JSON loader + engine + principal resolver + interceptor factories.
 */

import { describe, expect, it, vi } from 'vitest'
import { createPolicyBootstrap } from '../../src/middleware/policy/bootstrap.js'
import type { LoggerPort } from '../../src/ports/outbound/logger.js'

function silentLogger(): LoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as LoggerPort
}

describe('createPolicyBootstrap', () => {
  it('returns null when config is undefined', () => {
    const result = createPolicyBootstrap(undefined, { logger: silentLogger() })
    expect(result).toBeNull()
  })

  it('wires engine, defaultMode, and interceptor factories from inline policies', () => {
    const result = createPolicyBootstrap(
      {
        principal: { from: 'session' },
        defaultMode: 'allow',
        policies: [
          {
            id: 'allow-everyone',
            effect: 'allow',
            principals: ['*'],
            actions: ['**'],
            resources: ['**'],
          },
        ],
      },
      { logger: silentLogger(), registerMcpProvider: false },
    )

    expect(result).not.toBeNull()
    expect(result!.defaultMode).toBe('allow')
    expect(result!.engine.list()).toHaveLength(1)
    expect(result!.engine.list()[0].id).toBe('allow-everyone')
    expect(typeof result!.interceptorFactory).toBe('function')
    expect(typeof result!.noPolicyDeclaredFactory).toBe('function')
  })

  it('respects user-supplied engine over the default', () => {
    const customEngine = {
      list: () => [],
      evaluate: () => ({ allowed: true, matchedPolicies: [] }) as never,
    }
    const result = createPolicyBootstrap(
      {
        principal: { from: 'session' },
        engine: customEngine as never,
      },
      { logger: silentLogger(), registerMcpProvider: false },
    )
    expect(result!.engine).toBe(customEngine)
  })

  it('defaults defaultMode to "allow" when omitted', () => {
    const result = createPolicyBootstrap(
      { principal: { from: 'session' }, policies: [] },
      { logger: silentLogger(), registerMcpProvider: false },
    )
    expect(result!.defaultMode).toBe('allow')
  })

  it('honours explicit "deny" defaultMode', () => {
    const result = createPolicyBootstrap(
      { principal: { from: 'session' }, policies: [], defaultMode: 'deny' },
      { logger: silentLogger(), registerMcpProvider: false },
    )
    expect(result!.defaultMode).toBe('deny')
  })

  it('builds a procedure interceptor for any procedure name', () => {
    const result = createPolicyBootstrap(
      { principal: { from: 'session' }, policies: [] },
      { logger: silentLogger(), registerMcpProvider: false },
    )
    const interceptor = result!.interceptorFactory('user.read', {
      resource: () => ({ type: 'user', id: '1' }),
    })
    expect(typeof interceptor).toBe('function')
  })
})
