import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { HttpApp } from '../../src/http/app.js'
import { serveStatic } from '../../src/http/static.js'

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'raffel-static-'))
}

describe('serveStatic fallback routing', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('serves fallback for SPA routes', async () => {
    tempDir = await createTempDir()
    await writeFile(path.join(tempDir, 'index.html'), '<html><body>spa</body></html>')

    const app = new HttpApp()
    app.use('/*', serveStatic({ root: tempDir, fallback: 'index.html' }))

    const response = await app.fetch(new Request('http://localhost/dashboard/settings'))

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('spa')
  })

  it('skips fallback for excluded paths (api/ws)', async () => {
    tempDir = await createTempDir()
    await writeFile(path.join(tempDir, 'index.html'), '<html><body>spa</body></html>')

    const app = new HttpApp()
    app.get('/api/ping', (c) => c.json({ ok: true }))
    app.get('/ws', (c) => c.text('ws-handshake'))
    app.use('/*', serveStatic({
      root: tempDir,
      fallback: 'index.html',
      fallbackIgnore: ['/api', '/ws'],
    }))

    const apiResponse = await app.fetch(new Request('http://localhost/api/ping'))
    expect(apiResponse.status).toBe(200)
    expect(await apiResponse.json()).toEqual({ ok: true })

    const wsResponse = await app.fetch(new Request('http://localhost/ws'))
    expect(wsResponse.status).toBe(200)
    expect(await wsResponse.text()).toBe('ws-handshake')

    const spaResponse = await app.fetch(new Request('http://localhost/admin'))
    expect(spaResponse.status).toBe(200)
    expect(await spaResponse.text()).toContain('spa')
  })
})
