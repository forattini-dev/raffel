/**
 * Middleware Compose Tests
 *
 * Tests for middleware composition helpers.
 */

import { describe, it, expect } from 'vitest'
import {
  compose,
  pipe,
  when,
  forProcedures,
  forPattern,
  except,
  branch,
  passthrough,
} from './compose.js'
import type { Interceptor, Envelope, Context } from '../types/index.js'
import { createContext } from '../types/index.js'

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

describe('compose', () => {
  it('should return passthrough for empty interceptors', async () => {
    const composed = compose()
    const result = await composed(createEnvelope('test'), createTestContext(), async () => 'done')
    expect(result).toBe('done')
  })

  it('should return single interceptor as-is', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('single')
      return next()
    }

    const composed = compose(interceptor)
    await composed(createEnvelope('test'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['single', 'handler'])
  })

  it('should compose interceptors left-to-right (first is outermost)', async () => {
    const calls: string[] = []

    const first: Interceptor = async (_env, _ctx, next) => {
      calls.push('first-before')
      const result = await next()
      calls.push('first-after')
      return result
    }

    const second: Interceptor = async (_env, _ctx, next) => {
      calls.push('second-before')
      const result = await next()
      calls.push('second-after')
      return result
    }

    const third: Interceptor = async (_env, _ctx, next) => {
      calls.push('third-before')
      const result = await next()
      calls.push('third-after')
      return result
    }

    // compose(first, second, third) means first runs first (outermost)
    const composed = compose(first, second, third)
    await composed(createEnvelope('test'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    // first wraps second wraps third wraps handler
    expect(calls).toEqual([
      'first-before',
      'second-before',
      'third-before',
      'handler',
      'third-after',
      'second-after',
      'first-after',
    ])
  })
})

describe('pipe', () => {
  it('should compose interceptors left-to-right', async () => {
    const calls: string[] = []

    const first: Interceptor = async (_env, _ctx, next) => {
      calls.push('first-before')
      const result = await next()
      calls.push('first-after')
      return result
    }

    const second: Interceptor = async (_env, _ctx, next) => {
      calls.push('second-before')
      const result = await next()
      calls.push('second-after')
      return result
    }

    // pipe(first, second) means first runs first (as expected)
    const piped = pipe(first, second)
    await piped(createEnvelope('test'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual([
      'first-before',
      'second-before',
      'handler',
      'second-after',
      'first-after',
    ])
  })

  it('should return passthrough for empty interceptors', async () => {
    const piped = pipe()
    const result = await piped(createEnvelope('test'), createTestContext(), async () => 'done')
    expect(result).toBe('done')
  })
})

describe('when', () => {
  it('should run interceptor when predicate is true', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const conditional = when(
      (envelope) => envelope.procedure === 'target',
      interceptor
    )

    await conditional(createEnvelope('target'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['interceptor', 'handler'])
  })

  it('should skip interceptor when predicate is false', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const conditional = when(
      (envelope) => envelope.procedure === 'target',
      interceptor
    )

    await conditional(createEnvelope('other'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['handler'])
  })
})

describe('forProcedures', () => {
  it('should run interceptor for matching procedures', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const filtered = forProcedures(['users.create', 'users.update'], interceptor)

    await filtered(createEnvelope('users.create'), createTestContext(), async () => {
      calls.push('handler1')
      return 'done'
    })

    calls.length = 0

    await filtered(createEnvelope('users.delete'), createTestContext(), async () => {
      calls.push('handler2')
      return 'done'
    })

    expect(calls).toEqual(['handler2'])
  })
})

describe('forPattern', () => {
  it('should match wildcard patterns', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const filtered = forPattern('admin.*', interceptor)

    await filtered(createEnvelope('admin.users'), createTestContext(), async () => {
      calls.push('handler1')
      return 'done'
    })

    expect(calls).toEqual(['interceptor', 'handler1'])

    calls.length = 0

    await filtered(createEnvelope('users.list'), createTestContext(), async () => {
      calls.push('handler2')
      return 'done'
    })

    expect(calls).toEqual(['handler2'])
  })

  it('should match double wildcard patterns', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const filtered = forPattern('admin.**', interceptor)

    await filtered(createEnvelope('admin.users.create'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['interceptor', 'handler'])
  })

  it('should not match partial patterns', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const filtered = forPattern('admin', interceptor)

    await filtered(createEnvelope('admin.users'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    // Should NOT match because 'admin' !== 'admin.users'
    expect(calls).toEqual(['handler'])
  })
})

describe('except', () => {
  it('should skip interceptor for excluded procedures', async () => {
    const calls: string[] = []
    const interceptor: Interceptor = async (_env, _ctx, next) => {
      calls.push('interceptor')
      return next()
    }

    const filtered = except(['health.check', 'system.ping'], interceptor)

    await filtered(createEnvelope('health.check'), createTestContext(), async () => {
      calls.push('handler1')
      return 'done'
    })

    expect(calls).toEqual(['handler1'])

    calls.length = 0

    await filtered(createEnvelope('users.list'), createTestContext(), async () => {
      calls.push('handler2')
      return 'done'
    })

    expect(calls).toEqual(['interceptor', 'handler2'])
  })
})

describe('branch', () => {
  it('should run onTrue when predicate is true', async () => {
    const calls: string[] = []

    const onTrue: Interceptor = async (_env, _ctx, next) => {
      calls.push('onTrue')
      return next()
    }

    const onFalse: Interceptor = async (_env, _ctx, next) => {
      calls.push('onFalse')
      return next()
    }

    const branched = branch(
      (envelope) => envelope.procedure.startsWith('admin'),
      onTrue,
      onFalse
    )

    await branched(createEnvelope('admin.users'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['onTrue', 'handler'])
  })

  it('should run onFalse when predicate is false', async () => {
    const calls: string[] = []

    const onTrue: Interceptor = async (_env, _ctx, next) => {
      calls.push('onTrue')
      return next()
    }

    const onFalse: Interceptor = async (_env, _ctx, next) => {
      calls.push('onFalse')
      return next()
    }

    const branched = branch(
      (envelope) => envelope.procedure.startsWith('admin'),
      onTrue,
      onFalse
    )

    await branched(createEnvelope('users.list'), createTestContext(), async () => {
      calls.push('handler')
      return 'done'
    })

    expect(calls).toEqual(['onFalse', 'handler'])
  })
})

describe('passthrough', () => {
  it('should just call next', async () => {
    const result = await passthrough(
      createEnvelope('test'),
      createTestContext(),
      async () => 'done'
    )
    expect(result).toBe('done')
  })
})
