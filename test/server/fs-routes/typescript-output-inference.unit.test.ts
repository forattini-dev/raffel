import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTypeScriptOutputSchemaInferrer } from '../../../src/server/fs-routes/typescript-output-inference.js'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('TypeScript filesystem output inference', () => {
  it('resolves imported return types, optional fields, arrays, enums, and dates', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-output-types-'))
    await mkdir(path.join(dir, 'routes'), { recursive: true })
    await writeFile(
      path.join(dir, 'result.ts'),
      `export interface RouteResult {
  /** Stable route identifier. */
  id: string
  count: number
  note?: string
  state: 'ready' | 'degraded'
  createdAt: Date
  entries: Array<{ name: string; enabled: boolean }>
}
`,
    )
    const routePath = path.join(dir, 'routes', 'get.ts')
    await writeFile(
      routePath,
      `import type { RouteResult } from '../result.js'

const handler = async (): Promise<RouteResult> => ({
  id: 'route-1',
  count: 1,
  state: 'ready',
  createdAt: new Date(),
  entries: [{ name: 'database', enabled: true }],
})

export default handler
`,
    )

    const result = createTypeScriptOutputSchemaInferrer().infer(routePath)

    expect(result.status).toBe('inferred')
    if (result.status !== 'inferred') return
    expect(result.schema).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable route identifier.' },
        count: { type: 'number' },
        note: { type: 'string' },
        state: { type: 'string', enum: ['ready', 'degraded'] },
        createdAt: { type: 'string', format: 'date-time' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              enabled: { type: 'boolean' },
            },
            required: ['name', 'enabled'],
          },
        },
      },
      required: ['id', 'count', 'state', 'createdAt', 'entries'],
      'x-raffel-inferred-from': 'typescript',
    })
  })

  it('skips handlers whose return type is unknown', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-output-unknown-'))
    const routePath = path.join(dir, 'get.ts')
    await writeFile(routePath, `export default async function (): Promise<unknown> { return {} }\n`)

    expect(createTypeScriptOutputSchemaInferrer().infer(routePath)).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('not representable'),
    })
  })
})
