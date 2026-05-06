/**
 * Policy `scope` — applicability filter (issue #96).
 *
 * Unit-level tests against the engine. Verifies that policies declaring
 * `scope.protocols`, `scope.routes`, or `scope.channels` short-circuit when
 * the input does not match, and pass through otherwise.
 */

import { describe, it, expect } from 'vitest'
import { createDefaultEngine } from '../../src/middleware/policy/engine/index.js'
import type { Policy } from '../../src/middleware/policy/types.js'

const allowAll = (overrides: Partial<Policy>): Policy => ({
  id: 'allow',
  effect: 'allow',
  principals: ['*'],
  actions: ['**'],
  resources: ['**'],
  ...overrides,
})

describe('policy scope filter', () => {
  it('scope.protocols — policy applies only when AuthzInput.protocol matches', () => {
    const engine = createDefaultEngine({
      policies: [allowAll({ id: 'http-only', scope: { protocols: ['http'] } })],
    })

    const httpDecision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'leads.list',
      resource: { type: 'lead', id: '1', tenantId: null },
      protocol: 'http',
    })
    expect(httpDecision.allowed).toBe(true)

    const wsDecision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'leads.list',
      resource: { type: 'lead', id: '1', tenantId: null },
      protocol: 'websocket',
    })
    expect(wsDecision.allowed).toBe(false)
  })

  it('scope.routes — policy applies only to matching action names', () => {
    const engine = createDefaultEngine({
      policies: [allowAll({ id: 'admin-only', scope: { routes: ['admin/*'] } })],
    })

    const adminDecision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'admin/users',
      resource: { type: 'user', id: '*', tenantId: null },
    })
    expect(adminDecision.allowed).toBe(true)

    const usersDecision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'public/leads',
      resource: { type: 'lead', id: '*', tenantId: null },
    })
    expect(usersDecision.allowed).toBe(false)
  })

  it('scope.channels — policy applies only to matching channel names', () => {
    const engine = createDefaultEngine({
      policies: [allowAll({ id: 'chat-only', scope: { channels: ['chat-*'] } })],
    })

    const chatDecision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'chat-lobby',
      resource: { type: 'channel', id: 'chat-lobby', tenantId: null },
      protocol: 'websocket',
    })
    expect(chatDecision.allowed).toBe(true)

    const presenceDecision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'presence-room',
      resource: { type: 'channel', id: 'presence-room', tenantId: null },
      protocol: 'websocket',
    })
    expect(presenceDecision.allowed).toBe(false)
  })

  it('multiple scope facets compose with implicit AND', () => {
    const engine = createDefaultEngine({
      policies: [
        allowAll({
          id: 'ws-chat-only',
          scope: { protocols: ['websocket'], channels: ['chat-*'] },
        }),
      ],
    })

    const both = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'chat-lobby',
      resource: { type: 'channel', id: 'chat-lobby', tenantId: null },
      protocol: 'websocket',
    })
    expect(both.allowed).toBe(true)

    const wsButNotChat = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'presence',
      resource: { type: 'channel', id: 'presence', tenantId: null },
      protocol: 'websocket',
    })
    expect(wsButNotChat.allowed).toBe(false)

    const chatButNotWs = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'chat-lobby',
      resource: { type: 'channel', id: 'chat-lobby', tenantId: null },
      protocol: 'http',
    })
    expect(chatButNotWs.allowed).toBe(false)
  })

  it('absence of scope means policy applies to every protocol/route/channel', () => {
    const engine = createDefaultEngine({
      policies: [allowAll({ id: 'unscoped' })],
    })

    for (const protocol of ['http', 'websocket', 'grpc', 'jsonrpc', 'tcp', 'udp']) {
      const decision = engine.evaluate({
        principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
        action: 'whatever',
        resource: { type: 'thing', id: '*', tenantId: null },
        protocol,
      })
      expect(decision.allowed).toBe(true)
    }
  })

  it('empty pattern arrays in scope are no-ops (ignored)', () => {
    const engine = createDefaultEngine({
      policies: [allowAll({ id: 'empty-scope', scope: { protocols: [], channels: [] } })],
    })

    const decision = engine.evaluate({
      principal: { id: 'u', tenantId: null, scopes: [], groups: [] },
      action: 'whatever',
      resource: { type: 'thing', id: '*', tenantId: null },
    })
    expect(decision.allowed).toBe(true)
  })
})
