import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('discovered handler TypeScript ergonomics', () => {
  it('contextually types HandlerFunction as the procedure-style alias', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raffel-handler-types-'))
    const repoRoot = resolve(import.meta.dirname, '../..')
    const fixture = join(dir, 'handler-types.ts')
    await writeFile(fixture, `
import type { HandlerFunction, HttpHandlerFunction, ProcedureHandlerFunction } from '${repoRoot}/src/server/fs-routes/types.js'

const legacyProcedure: HandlerFunction = async (input) => input
const explicitProcedure: ProcedureHandlerFunction = async (input, ctx) => ctx.input.body ?? input
const httpStyle: HttpHandlerFunction = async (c) => c.json({ ok: true, id: c.req.param('id') })

void legacyProcedure
void explicitProcedure
void httpStyle
`)

    const { stderr } = await execFileAsync(
      './node_modules/.bin/tsc',
      [
        '--strict',
        '--noEmit',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--skipLibCheck',
        '--ignoreConfig',
        fixture,
      ],
      { cwd: repoRoot }
    )

    expect(stderr).toBe('')
  })
})
