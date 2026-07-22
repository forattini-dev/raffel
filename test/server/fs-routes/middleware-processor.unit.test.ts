import { describe, expect, it, vi } from 'vitest'

import { createRouteInterceptors } from '../../../src/server/fs-routes/middleware-processor.js'
import type { LoadedRoute } from '../../../src/server/fs-routes/types.js'
import { createContext } from '../../../src/types/context.js'
import type { Envelope } from '../../../src/types/index.js'

describe('filesystem route middleware processor', () => {
  it('preserves rejected API-key presentation on optional anonymous routes', async () => {
    const [authenticate] = createRouteInterceptors({
      meta: { auth: 'optional' },
      authConfig: {
        strategy: 'api-key',
        verify: vi.fn(async () => {
          throw new Error('rejected')
        }),
        anonymous: { principal: 'guest' },
      },
      middlewares: [],
    } as unknown as LoadedRoute)
    const context = createContext('request-1')
    const envelope: Envelope = {
      id: 'request-1',
      procedure: 'catalog.list',
      type: 'request',
      payload: {},
      metadata: { 'x-api-key': 'rejected' },
      context,
    }

    await authenticate!(envelope, context, vi.fn().mockResolvedValue({ ok: true }))

    expect(context.auth).toMatchObject({
      authenticated: false,
      credentialsPresented: true,
      principal: 'guest',
    })
  })
})
