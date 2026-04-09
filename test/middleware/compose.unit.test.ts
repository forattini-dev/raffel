/**
 * Middleware Compose Unit Tests
 *
 * Focused unit tests for compose.ts helpers that complement
 * the existing integration tests in compose.int.test.ts.
 *
 * Covers: error propagation, return value threading, context/envelope
 * passthrough, and edge cases not covered by the int tests.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  compose,
  when,
  forProcedures,
  forPattern,
  except,
  branch,
  passthrough,
} from '../../src/middleware/compose.js'
import type { Interceptor, Envelope, Context } from '../../src/types/index.js'
import { createContext } from '../../src/types/index.js'

function createEnvelope(procedure: string): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: {},
    context: createContext('test-id'),
  }
}

function createTestContext(): Context {
  return createContext('test')
}

describe('compose — error propagation', () => {
  it('should propagate errors thrown by an inner interceptor', async () => {
    const outer: Interceptor = async (_env, _ctx, next) => next()
    const failing: Interceptor = async () => {
      throw new Error('boom')
    }

    const composed = compose(outer, failing)

    await expect(
      composed(createEnvelope('test'), createTestContext(), async () => 'done'),
    ).rejects.toThrow('boom')
  })

  it('should propagate errors thrown by the handler', async () => {
    const interceptor: Interceptor = async (_env, _ctx, next) => next()
    const composed = compose(interceptor)

    await expect(
      composed(createEnvelope('test'), createTestContext(), async () => {
        throw new Error('handler-error')
      }),
    ).rejects.toThrow('handler-error')
  })

  it('should allow an interceptor to catch and replace an error', async () => {
    const catcher: Interceptor = async (_env, _ctx, next) => {
      try {
        return await next()
      } catch {
        return 'recovered'
      }
    }

    const composed = compose(catcher)
    const result = await composed(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('will be caught')
      },
    )

    expect(result).toBe('recovered')
  })

  it('should propagate errors from the first interceptor outwards', async () => {
    const first: Interceptor = async () => {
      throw new Error('first-error')
    }
    const second: Interceptor = async (_env, _ctx, next) => next()

    const composed = compose(first, second)

    await expect(
      composed(createEnvelope('test'), createTestContext(), async () => 'done'),
    ).rejects.toThrow('first-error')
  })
})

describe('compose — return value threading', () => {
  it('should thread return values from handler through all interceptors', async () => {
    const doubler: Interceptor = async (_env, _ctx, next) => {
      const result = (await next()) as number
      return result * 2
    }

    const adder: Interceptor = async (_env, _ctx, next) => {
      const result = (await next()) as number
      return result + 1
    }

    // compose(doubler, adder): doubler is outer, adder is inner
    // handler returns 5 -> adder makes it 6 -> doubler makes it 12
    const composed = compose(doubler, adder)
    const result = await composed(
      createEnvelope('test'),
      createTestContext(),
      async () => 5,
    )

    expect(result).toBe(12)
  })

  it('should pass the correct envelope and context to all interceptors', async () => {
    const captured: Array<{ procedure: string; requestId: string }> = []

    const a: Interceptor = async (env, ctx, next) => {
      captured.push({ procedure: env.procedure, requestId: ctx.requestId })
      return next()
    }
    const b: Interceptor = async (env, ctx, next) => {
      captured.push({ procedure: env.procedure, requestId: ctx.requestId })
      return next()
    }

    const envelope = createEnvelope('my.proc')
    const ctx = createContext('req-123')

    const composed = compose(a, b)
    await composed(envelope, ctx, async () => 'ok')

    expect(captured).toEqual([
      { procedure: 'my.proc', requestId: 'req-123' },
      { procedure: 'my.proc', requestId: 'req-123' },
    ])
  })
})

describe('compose — edge cases', () => {
  it('should handle an interceptor that does not call next', async () => {
    const short: Interceptor = async () => 'short-circuited'
    const never: Interceptor = async (_env, _ctx, next) => {
      return next()
    }

    const composed = compose(short, never)
    const result = await composed(
      createEnvelope('test'),
      createTestContext(),
      async () => 'handler',
    )

    expect(result).toBe('short-circuited')
  })

  it('should handle synchronous interceptors', async () => {
    const sync: Interceptor = (_env, _ctx, next) => next()
    const composed = compose(sync, sync, sync)

    const result = await composed(
      createEnvelope('test'),
      createTestContext(),
      async () => 42,
    )
    expect(result).toBe(42)
  })
})

describe('when — edge cases', () => {
  it('should pass envelope and context to predicate', async () => {
    const spy = vi.fn().mockReturnValue(false)
    const interceptor: Interceptor = async (_env, _ctx, next) => next()

    const conditional = when(spy, interceptor)
    const env = createEnvelope('test')
    const ctx = createTestContext()

    await conditional(env, ctx, async () => 'done')

    expect(spy).toHaveBeenCalledWith(env, ctx)
  })
})

describe('forProcedures — edge cases', () => {
  it('should not match partial procedure names', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('intercepted')
      return next()
    }

    const filtered = forProcedures(['users'], interceptor)

    await filtered(createEnvelope('users.create'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    // 'users' !== 'users.create', so no interception
    expect(calls).toEqual(['handler'])
  })

  it('should handle empty procedure list', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('intercepted')
      return next()
    }

    const filtered = forProcedures([], interceptor)

    await filtered(createEnvelope('anything'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['handler'])
  })
})

describe('forPattern — edge cases', () => {
  it('should match exact procedure names', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('intercepted')
      return next()
    }

    const filtered = forPattern('users.list', interceptor)
    await filtered(createEnvelope('users.list'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['intercepted', 'handler'])
  })

  it('should not match across dots with single wildcard', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('intercepted')
      return next()
    }

    const filtered = forPattern('admin.*', interceptor)

    await filtered(createEnvelope('admin.users.create'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    // 'admin.*' should NOT match 'admin.users.create' (single * doesn't cross dots)
    expect(calls).toEqual(['handler'])
  })

  it('should match across dots with double wildcard', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('intercepted')
      return next()
    }

    const filtered = forPattern('admin.**', interceptor)

    await filtered(createEnvelope('admin.users.create'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['intercepted', 'handler'])
  })
})

describe('except — edge cases', () => {
  it('should run interceptor for non-excluded procedures', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('intercepted')
      return next()
    }

    const filtered = except([], interceptor)

    await filtered(createEnvelope('anything'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    // Empty except list = always run interceptor
    expect(calls).toEqual(['intercepted', 'handler'])
  })
})

describe('branch — edge cases', () => {
  it('should pass envelope and context to both branches', async () => {
    const trueSpy = vi.fn(async (_env: Envelope, _ctx: Context, next: () => Promise<unknown>) => next())
    const falseSpy = vi.fn(async (_env: Envelope, _ctx: Context, next: () => Promise<unknown>) => next())

    const branched = branch(() => true, trueSpy, falseSpy)
    const env = createEnvelope('test')
    const ctx = createTestContext()

    await branched(env, ctx, async () => 'done')

    expect(trueSpy).toHaveBeenCalledTimes(1)
    expect(falseSpy).not.toHaveBeenCalled()
    expect(trueSpy.mock.calls[0][0]).toBe(env)
    expect(trueSpy.mock.calls[0][1]).toBe(ctx)
  })
})

describe('passthrough', () => {
  it('should not modify the return value', async () => {
    const result = await passthrough(
      createEnvelope('test'),
      createTestContext(),
      async () => ({ complex: [1, 2, 3] }),
    )
    expect(result).toEqual({ complex: [1, 2, 3] })
  })

  it('should propagate handler errors', async () => {
    await expect(
      passthrough(createEnvelope('test'), createTestContext(), async () => {
        throw new Error('passthrough-error')
      }),
    ).rejects.toThrow('passthrough-error')
  })
})
