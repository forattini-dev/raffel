import { describe, expect, it } from 'vitest'
import { createDocsRouteMiddleware } from '../../src/server/rest-middleware.js'

describe('createDocsRouteMiddleware', () => {
  it('dispatches embedded route parameters to documentation handlers', async () => {
    const middleware = createDocsRouteMiddleware([
      {
        method: 'GET',
        path: '/docs/openapi.:extension',
        handler: (_pathname, params) => new Response(params.extension, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
      },
    ])
    let status = 0
    let body = ''
    const response = {
      writeHead(nextStatus: number) {
        status = nextStatus
      },
      end(chunk: Uint8Array) {
        body = Buffer.from(chunk).toString('utf8')
      },
    }

    const handled = await middleware({
      method: 'GET',
      url: '/docs/openapi.toon',
      headers: { host: 'localhost' },
    }, response)

    expect(handled).toBe(true)
    expect(status).toBe(200)
    expect(body).toBe('toon')
  })
})
