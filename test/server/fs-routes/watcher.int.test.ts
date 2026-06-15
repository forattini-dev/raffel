/**
 * Hot-Reload Watcher Tests
 *
 * Regression coverage for the watcher's `getWatchDirs()` — it must accept
 * every shape that the loader does (string, boolean, single object,
 * array), not just plain strings. Earlier releases (1.1.26) crashed with
 * `TypeError: path must be of type string` when discovery slots were
 * arrays, because `getWatchDirs` called `join(baseDir, value)` directly.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDiscoveryWatcher,
  isDiscoveryWatchFile,
} from '../../../src/server/fs-routes/watcher.js'

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'raffel-watcher-'))
}

async function fixture(root: string, rel: string, body: string): Promise<void> {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body, 'utf-8')
}

describe('discovery watcher: getWatchDirs accepts every DiscoveryConfig shape', () => {
  let root: string | null = null
  let watcher: ReturnType<typeof createDiscoveryWatcher> | null = null

  afterEach(async () => {
    if (watcher) {
      watcher.stop()
      watcher = null
    }
    if (root) {
      await rm(root, { recursive: true, force: true })
      root = null
    }
  })

  it('starts with an array of DiscoverySourceEntry in resources (regression)', async () => {
    root = await tmpRoot()
    await fixture(
      root,
      'leads/leads.ts',
      `import { z } from 'zod'
export const schema = z.object({ id: z.string() })
export const list = async () => []
`,
    )
    await fixture(
      root,
      'tasks/tasks.ts',
      `import { z } from 'zod'
export const schema = z.object({ id: z.string() })
export const list = async () => []
`,
    )

    watcher = createDiscoveryWatcher({
      baseDir: root,
      discovery: {
        resources: [
          { dir: join(root, 'leads'), prefix: 'leads' },
          { dir: join(root, 'tasks'), prefix: 'tasks' },
        ],
      },
      hotReload: true,
    })

    // The bug was: start() threw synchronously inside getWatchDirs
    // when value was an array. Now it must succeed.
    const result = await watcher.start()
    expect(result.resources.map((r) => r.name).sort()).toEqual([
      'leads/leads',
      'tasks/tasks',
    ])
    expect(watcher.isWatching).toBe(true)
  })

  it('starts with a single DiscoverySourceEntry object', async () => {
    root = await tmpRoot()
    await fixture(root, 'http/ping/get.ts', 'export default () => ({})\n')

    watcher = createDiscoveryWatcher({
      baseDir: root,
      discovery: {
        http: { dir: join(root, 'http'), prefix: 'v1' },
      },
      hotReload: true,
    })

    const result = await watcher.start()
    expect(result.routes.map((r) => r.name)).toEqual(['v1/ping/get'])
    expect(watcher.isWatching).toBe(true)
  })

  it('still accepts plain string and boolean shapes (backwards compat)', async () => {
    root = await tmpRoot()
    await fixture(root, 'src/http/ping/get.ts', 'export default () => ({})\n')
    await fixture(root, 'custom/http/pong/get.ts', 'export default () => ({})\n')

    // boolean: use defaults
    const wA = createDiscoveryWatcher({
      baseDir: root,
      discovery: { http: true },
      hotReload: true,
    })
    const resA = await wA.start()
    expect(resA.routes.map((r) => r.name)).toEqual(['ping/get'])
    wA.stop()

    // string: custom path
    const wB = createDiscoveryWatcher({
      baseDir: root,
      discovery: { http: join(root, 'custom/http') },
      hotReload: true,
    })
    const resB = await wB.start()
    expect(resB.routes.map((r) => r.name)).toEqual(['pong/get'])
    wB.stop()
  })

  it('mixes plain strings and entries inside the same array', async () => {
    root = await tmpRoot()
    await fixture(root, 'a/http/x/get.ts', 'export default () => ({})\n')
    await fixture(root, 'b/http/y/get.ts', 'export default () => ({})\n')

    watcher = createDiscoveryWatcher({
      baseDir: root,
      discovery: {
        http: [
          join(root, 'a/http'),
          { dir: join(root, 'b/http'), prefix: 'b' },
        ],
      },
      hotReload: true,
    })

    const result = await watcher.start()
    expect(result.routes.map((r) => r.name).sort()).toEqual(['b/y/get', 'x/get'])
    expect(watcher.isWatching).toBe(true)
  })

  it('treats co-located policy files as discovery reload inputs', () => {
    expect(isDiscoveryWatchFile('_policy.yaml', ['.ts', '.js'])).toBe(true)
    expect(isDiscoveryWatchFile('leads.policy.yml', ['.ts', '.js'])).toBe(true)
    expect(isDiscoveryWatchFile('leads.policy.json', ['.ts', '.js'])).toBe(true)
    expect(isDiscoveryWatchFile('notes.yaml', ['.ts', '.js'])).toBe(false)
    expect(isDiscoveryWatchFile('leads.ts', ['.ts', '.js'])).toBe(true)
  })
})
