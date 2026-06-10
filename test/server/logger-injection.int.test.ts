/**
 * Integration tests for createServer({ logger }) injection.
 *
 * Proves the host logger flows end to end: the request-scoped `ctx.logger`
 * (carrying requestId) and the built-in `ctx.log` provider (an app-scoped
 * singleton child) both write through the injected pino instance.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import pino from 'pino'
import { createServer } from '../../src/server/builder.js'
import { resetLogger } from '../../src/utils/logger.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNodeHttpServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      const { port } = address
      probe.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

function captureLogger(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const raw: string[] = []
  const logger = pino({ level: 'debug' }, { write: (s: string) => raw.push(s) } as never)
  return {
    logger,
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('createServer({ logger }) injection', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
    server = null
    resetLogger()
  })

  it('routes ctx.logger (requestId) and ctx.log (component: app) through the injected logger', async () => {
    const { logger, lines } = captureLogger()
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1', logger })

    server.http.get('/ping', async (_input: unknown, ctx: any) => {
      ctx.logger.info('from-request')
      ctx.log.info('from-app')
      return { ok: true }
    })

    await server.start()
    const response = await fetch(`http://127.0.0.1:${port}/ping`)
    expect(response.status).toBe(200)

    const entries = lines()
    const requestLine = entries.find((e) => e.msg === 'from-request')
    const appLine = entries.find((e) => e.msg === 'from-app')

    expect(requestLine).toBeDefined()
    expect(typeof requestLine?.requestId).toBe('string')

    expect(appLine).toBeDefined()
    expect(appLine).toMatchObject({ component: 'app' })
  })

  it('lets a user-defined `log` provider override the built-in app logger', async () => {
    const { logger } = captureLogger()
    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      logger,
      providers: {
        log: () => ({ marker: 'custom', info() {} }),
      },
    })

    server.http.get('/whoami', async (_input: unknown, ctx: any) => ({
      marker: ctx.log?.marker ?? null,
    }))

    await server.start()
    const response = await fetch(`http://127.0.0.1:${port}/whoami`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ marker: 'custom' })
  })
})
