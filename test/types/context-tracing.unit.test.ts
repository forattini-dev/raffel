import { describe, expect, it, vi } from 'vitest'
import { createContext } from '../../src/types/context.js'

describe('context tracing', () => {
  it('runs traced operations as a no-op passthrough when tracing is disabled', async () => {
    const ctx = createContext('request-1')
    const operation = vi.fn(async () => 'cached-value')

    const result = await ctx.tracing.trace(
      'cache.agent-context.get',
      { 'cache.system': 'valkey' },
      operation
    )

    expect(result).toBe('cached-value')
    expect(operation).toHaveBeenCalledOnce()
  })
})
