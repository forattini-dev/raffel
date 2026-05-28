/**
 * Multi-Source Discovery Tests
 *
 * Validates that the `DiscoveryConfig` accepts arrays of `{ dir, prefix }`
 * entries (domain-driven layouts), and that the prefix is correctly
 * applied to discovered route/channel/resource names.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDiscovery } from '../../../src/server/fs-routes/loader.js'

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'raffel-multisrc-'))
}

async function fixture(root: string, rel: string, body: string): Promise<void> {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body, 'utf-8')
}

describe('discovery: multi-source with prefix', () => {
  let root: string | null = null

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true })
      root = null
    }
  })

  it('loads HTTP routes from multiple directories and prefixes their names', async () => {
    root = await tmpRoot()
    await fixture(
      root,
      'leads/http/list/get.ts',
      'export default async () => ({ ok: true, domain: "leads" })\n',
    )
    await fixture(
      root,
      'tasks/http/today/get.ts',
      'export default async () => ({ ok: true, domain: "tasks" })\n',
    )

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        http: [
          { dir: join(root, 'leads/http'), prefix: 'leads' },
          { dir: join(root, 'tasks/http'), prefix: 'tasks' },
        ],
      },
    })

    const names = result.routes.map((r) => r.name).sort()
    expect(names).toEqual(['leads/list/get', 'tasks/today/get'])

    // Verb convention should have derived HTTP path with the prefix included.
    const leadsList = result.routes.find((r) => r.name === 'leads/list/get')
    expect(leadsList?.meta?.httpMethod).toBe('GET')
    expect(leadsList?.meta?.httpPath).toBe('/leads/list')

    const tasksToday = result.routes.find((r) => r.name === 'tasks/today/get')
    expect(tasksToday?.meta?.httpPath).toBe('/tasks/today')
  })

  it('mixes plain strings and prefixed entries in the same slot', async () => {
    root = await tmpRoot()
    await fixture(root, 'shared/http/ping/get.ts', 'export default () => ({})\n')
    await fixture(root, 'leads/http/list/get.ts', 'export default () => ({})\n')

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        http: [
          join(root, 'shared/http'), // no prefix
          { dir: join(root, 'leads/http'), prefix: 'leads' },
        ],
      },
    })

    const names = result.routes.map((r) => r.name).sort()
    expect(names).toEqual(['leads/list/get', 'ping/get'])
  })

  it('normalizes prefix slashes (/leads/ → leads)', async () => {
    root = await tmpRoot()
    await fixture(root, 'd/http/x/get.ts', 'export default () => ({})\n')

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        http: [{ dir: join(root, 'd/http'), prefix: '/leads/' }],
      },
    })

    expect(result.routes.map((r) => r.name)).toEqual(['leads/x/get'])
    expect(result.routes[0]?.meta?.httpPath).toBe('/leads/x')
  })

  it('prefixes channels', async () => {
    root = await tmpRoot()
    await fixture(
      root,
      'd/channels/orders.ts',
      'export const auth = "optional"\n',
    )

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        channels: [{ dir: join(root, 'd/channels'), prefix: 'leads' }],
      },
    })

    expect(result.channels.map((c) => c.name)).toEqual(['leads/orders'])
  })

  it('prefixes resource basePaths', async () => {
    root = await tmpRoot()
    await fixture(
      root,
      'd/resources/devices.ts',
      `import { z } from 'zod'
export const schema = z.object({ id: z.string() })
export const list = async () => []
`,
    )

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        resources: [{ dir: join(root, 'd/resources'), prefix: 'fleet' }],
      },
    })

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.name).toBe('fleet/devices')
    expect(result.resources[0]?.config.basePath).toBe('/fleet/devices')
  })

  it('accepts TCP/UDP as array of multiple directories (prefix ignored)', async () => {
    root = await tmpRoot()
    await fixture(
      root,
      'd1/tcp/echo.ts',
      `export const config = { port: 0 }
export const onMessage = () => {}
`,
    )
    await fixture(
      root,
      'd2/tcp/other.ts',
      `export const config = { port: 0 }
export const onMessage = () => {}
`,
    )
    await fixture(
      root,
      'd1/udp/recv.ts',
      `export const config = { port: 0 }
export const onMessage = () => {}
`,
    )

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        tcp: [
          { dir: join(root, 'd1/tcp'), prefix: 'ignored' },
          join(root, 'd2/tcp'),
        ],
        udp: [join(root, 'd1/udp')],
      },
    })

    expect(result.tcpHandlers.map((h) => h.name).sort()).toEqual(['echo', 'other'])
    expect(result.udpHandlers.map((h) => h.name)).toEqual(['recv'])
  })

  it('backwards-compatible: string and boolean still work', async () => {
    root = await tmpRoot()
    await fixture(root, 'src/http/ping/get.ts', 'export default () => ({})\n')

    // boolean = use defaults
    const resA = await loadDiscovery({
      baseDir: root,
      discovery: { http: true },
    })
    expect(resA.routes.map((r) => r.name)).toEqual(['ping/get'])

    // string = single custom path, no prefix
    const resB = await loadDiscovery({
      baseDir: root,
      discovery: { http: join(root, 'src/http') },
    })
    expect(resB.routes.map((r) => r.name)).toEqual(['ping/get'])
  })

  it('single DiscoverySourceEntry object (not array) works', async () => {
    root = await tmpRoot()
    await fixture(root, 'http/users/get.ts', 'export default () => ({})\n')

    const result = await loadDiscovery({
      baseDir: root,
      discovery: {
        http: { dir: join(root, 'http'), prefix: 'v1' },
      },
    })

    expect(result.routes.map((r) => r.name)).toEqual(['v1/users/get'])
    expect(result.routes[0]?.meta?.httpPath).toBe('/v1/users')
  })
})
