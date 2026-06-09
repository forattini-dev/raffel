/**
 * Resource `delete` slot — reserved-word aliases.
 *
 * `delete` is a reserved word, so `export const delete = …` is a syntax error.
 * The loader accepts `_delete`, `destroy`, and `remove` as aliases and maps
 * the first present one onto the canonical `delete` slot.
 */

import { describe, it, expect } from 'vitest'
import { loadResources } from '../../../src/server/fs-routes/resources/loader.js'
import { createInMemoryDiscoverySource } from '../../../src/server/fs-routes/discovery-source.js'

const RESOURCES_DIR = '/app/resources'

async function loadOne(moduleExports: Record<string, unknown>) {
  const source = createInMemoryDiscoverySource({
    [`${RESOURCES_DIR}/orders.ts`]: { module: moduleExports },
  })
  return loadResources({ baseDir: '/app', resourcesDir: RESOURCES_DIR, source })
}

describe('loadResources — delete alias', () => {
  const del = async () => null
  const list = async () => []

  it('maps _delete onto the delete slot', async () => {
    const { resources } = await loadOne({ list, _delete: del })
    expect(resources).toHaveLength(1)
    expect(typeof resources[0].handlers.delete).toBe('function')
  })

  it('maps destroy onto the delete slot', async () => {
    const { resources } = await loadOne({ list, destroy: del })
    expect(typeof resources[0].handlers.delete).toBe('function')
  })

  it('maps remove onto the delete slot', async () => {
    const { resources } = await loadOne({ list, remove: del })
    expect(typeof resources[0].handlers.delete).toBe('function')
  })

  it('prefers an explicit delete over any alias', async () => {
    const realDelete = async () => null
    const { resources } = await loadOne({ list, delete: realDelete, destroy: del })
    expect(resources[0].handlers.delete).toBe(realDelete)
  })

  it('counts an aliased delete as an operation', async () => {
    const { stats } = await loadOne({ _delete: del })
    expect(stats.operations).toBeGreaterThanOrEqual(1)
  })
})
