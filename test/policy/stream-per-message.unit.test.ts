/**
 * Per-message authz pattern in streams (Phase 9 — explicit ctx.policy approach)
 *
 * The declarative `streamMode: 'per-message'` is reserved for v1.x. v1 ships
 * the explicit pattern: call `ctx.policy.evaluate(action, resource)` inside
 * the stream handler loop. This test exercises that pattern directly against
 * the engine + ctx-helpers, without booting a real WS server.
 */

import { describe, it, expect } from 'vitest'
import { createDefaultEngine } from '../../src/middleware/policy/index.js'
import { attachPolicyHelpers } from '../../src/middleware/policy/ctx-helpers.js'
import type {
  Policy,
  PolicyCtxHelpers,
  Principal,
  Resource,
} from '../../src/middleware/policy/types.js'

const principal: Principal = {
  id: 's1',
  tenantId: 't1',
  scopes: ['chat.send'],
  groups: ['channel:c1', 'channel:c2'],
}

function makeCtxWithHelpers(policies: Policy[]) {
  const engine = createDefaultEngine({ policies })
  const ctx = {} as Record<string, unknown>
  attachPolicyHelpers(ctx as never, engine, principal)
  return { ctx, helpers: ctx.policy as PolicyCtxHelpers }
}

describe('streams — per-message authz via ctx.policy.evaluate', () => {
  const policies: Policy[] = [
    {
      id: 'allow-channel-member',
      effect: 'allow',
      principals: ['scope:chat.send'],
      actions: ['chat.send'],
      resources: ['channel:**'],
      match: {
        // Compose the principal-group form from the resource id at eval time.
        // The principal carries `channel:c1`, `channel:c2` in groups; the
        // resource id is the bare channel id (e.g. 'c1'). Build the match
        // by checking the prefixed form is in principal.groups.
        'resource.attrs.groupKey': '@principal.groups',
      },
    },
  ]

  it('allows messages targeting joined channels, denies others', async () => {
    const { helpers } = makeCtxWithHelpers(policies)

    const messages: { channelId: string; text: string }[] = [
      { channelId: 'c1', text: 'hello c1' },
      { channelId: 'c3', text: 'hello c3 (not joined)' },
      { channelId: 'c2', text: 'hello c2' },
    ]

    const accepted: string[] = []
    for (const msg of messages) {
      const resource: Resource = {
        type: 'channel',
        id: msg.channelId,
        tenantId: 't1',
        attrs: { groupKey: `channel:${msg.channelId}` },
      }
      const decision = await helpers.evaluate('chat.send', resource)
      if (decision.allowed) accepted.push(msg.channelId)
    }

    expect(accepted).toEqual(['c1', 'c2'])
  })

  it('async generator pattern — yields only allowed frames', async () => {
    const { helpers } = makeCtxWithHelpers(policies)

    async function* simulateStreamHandler(messages: { channelId: string; payload: string }[]) {
      for (const msg of messages) {
        const decision = await helpers.evaluate('chat.send', {
          type: 'channel',
          id: msg.channelId,
          tenantId: 't1',
          attrs: { groupKey: `channel:${msg.channelId}` },
        })
        if (!decision.allowed) continue
        yield { channelId: msg.channelId, ack: true, payload: msg.payload }
      }
    }

    const out: { channelId: string; ack: boolean; payload: string }[] = []
    for await (const ack of simulateStreamHandler([
      { channelId: 'c1', payload: 'a' },
      { channelId: 'cX', payload: 'denied' },
      { channelId: 'c2', payload: 'b' },
    ])) {
      out.push(ack)
    }

    expect(out).toHaveLength(2)
    expect(out.map((r) => r.channelId)).toEqual(['c1', 'c2'])
  })

  it('dedup: repeated channel evaluations hit the engine once', async () => {
    let evalCount = 0
    const countingEngine = {
      evaluate: (input: import('../../src/middleware/policy/types.js').AuthzInput) => {
        evalCount++
        return {
          allowed: true,
          reason: 'allow' as const,
          matchedPolicyIds: ['x'],
          auditedPolicyIds: [],
          candidatePolicies: [],
        }
      },
      list: () => [],
    }

    const ctx = {} as Record<string, unknown>
    attachPolicyHelpers(ctx as never, countingEngine, principal)
    const helpers = ctx.policy as PolicyCtxHelpers

    const resource: Resource = { type: 'channel', id: 'c1', tenantId: 't1' }
    for (let i = 0; i < 100; i++) {
      await helpers.evaluate('chat.send', resource)
    }

    expect(evalCount).toBe(1) // 100 calls → 1 engine eval (dedup'd)
  })
})
