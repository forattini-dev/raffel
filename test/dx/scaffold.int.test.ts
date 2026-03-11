import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createScaffoldProject,
  listScaffoldPresets,
} from '../../src/dx/index.js'

const cliPath = path.resolve(process.cwd(), 'src', 'mcp', 'cli.ts')
const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const target = await mkdtemp(path.join(process.cwd(), prefix))
  tempDirs.push(target)
  return target
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('service scaffolding', () => {
  it('generates stable file inventories and scripts for all official presets', () => {
    const summary = listScaffoldPresets().map((preset) => {
      const project = createScaffoldProject({
        preset: preset.name,
        projectName: preset.defaultDirectory,
      })
      const packageJson = JSON.parse(project.files['package.json']) as {
        scripts: Record<string, string>
      }

      return {
        preset: preset.name,
        files: Object.keys(project.files).sort(),
        scripts: packageJson.scripts,
      }
    })

    expect(summary).toMatchInlineSnapshot(`
      [
        {
          "files": [
            ".gitignore",
            "README.md",
            "package.json",
            "src/server.ts",
            "test/server.test.ts",
            "tsconfig.json",
          ],
          "preset": "api",
          "scripts": {
            "build": "tsc",
            "contract-tests": "raffel contract-tests src/server.ts",
            "dev": "tsx watch src/server.ts",
            "doctor": "raffel doctor src/server.ts --fail-on warning",
            "inspect": "raffel inspect src/server.ts",
            "playground": "raffel playground src/server.ts --port 4301",
            "start": "node dist/server.js",
            "test": "vitest run",
            "typecheck": "tsc --noEmit",
          },
        },
        {
          "files": [
            ".gitignore",
            "README.md",
            "package.json",
            "src/server.ts",
            "test/server.test.ts",
            "tsconfig.json",
          ],
          "preset": "realtime",
          "scripts": {
            "build": "tsc",
            "contract-tests": "raffel contract-tests src/server.ts",
            "dev": "tsx watch src/server.ts",
            "doctor": "raffel doctor src/server.ts --fail-on warning",
            "inspect": "raffel inspect src/server.ts",
            "playground": "raffel playground src/server.ts --port 4301",
            "start": "node dist/server.js",
            "test": "vitest run",
            "typecheck": "tsc --noEmit",
          },
        },
        {
          "files": [
            ".gitignore",
            "README.md",
            "package.json",
            "proto/service.proto",
            "src/server.ts",
            "test/server.test.ts",
            "tsconfig.json",
          ],
          "preset": "rpc",
          "scripts": {
            "build": "tsc",
            "contract-tests": "raffel contract-tests src/server.ts",
            "dev": "tsx watch src/server.ts",
            "doctor": "raffel doctor src/server.ts --fail-on warning",
            "inspect": "raffel inspect src/server.ts",
            "playground": "raffel playground src/server.ts --port 4301",
            "start": "node dist/server.js",
            "test": "vitest run",
            "typecheck": "tsc --noEmit",
          },
        },
        {
          "files": [
            ".gitignore",
            "README.md",
            "package.json",
            "src/server.ts",
            "test/server.test.ts",
            "tsconfig.json",
          ],
          "preset": "gateway",
          "scripts": {
            "build": "tsc",
            "contract-tests": "raffel contract-tests src/server.ts",
            "dev": "tsx watch src/server.ts",
            "doctor": "raffel doctor src/server.ts --fail-on warning",
            "inspect": "raffel inspect src/server.ts",
            "playground": "raffel playground src/server.ts --port 4301",
            "start": "node dist/server.js",
            "test": "vitest run",
            "typecheck": "tsc --noEmit",
          },
        },
        {
          "files": [
            ".gitignore",
            "README.md",
            "package.json",
            "proto/service.proto",
            "src/server.ts",
            "test/server.test.ts",
            "tsconfig.json",
          ],
          "preset": "internal-service",
          "scripts": {
            "build": "tsc",
            "contract-tests": "raffel contract-tests src/server.ts",
            "dev": "tsx watch src/server.ts",
            "doctor": "raffel doctor src/server.ts --fail-on warning",
            "inspect": "raffel inspect src/server.ts",
            "playground": "raffel playground src/server.ts --port 4301",
            "start": "node dist/server.js",
            "test": "vitest run",
            "typecheck": "tsc --noEmit",
          },
        },
      ]
    `)
  })

  it('writes starter auth, logging, health, docs, and tests through the CLI', async () => {
    const root = await createTempDir('.tmp-scaffold-')

    for (const preset of ['api', 'internal-service'] as const) {
      const targetDir = path.join(root, preset)
      const createResult = spawnSync(process.execPath, ['--import', 'tsx', cliPath, 'new', preset, targetDir], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      expect(createResult.status).toBe(0)
      expect(createResult.stdout).toContain(`Created ${preset} scaffold`)
      const serverSource = await readFile(path.join(targetDir, 'src', 'server.ts'), 'utf8')
      const readme = await readFile(path.join(targetDir, 'README.md'), 'utf8')
      const packageJson = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }

      expect(serverSource).toContain('createAuthMiddleware')
      expect(serverSource).toContain('createLoggingInterceptor')
      expect(serverSource).toContain(".procedure('system.health')")
      expect(serverSource).toContain('server.enableUSD')
      expect(serverSource).toContain('export default server')
      expect(readme).toContain('npx raffel inspect src/server.ts')
      expect(readme).toContain('npx raffel playground src/server.ts --port 4301')
      expect(readme).toContain('npx raffel contract-tests src/server.ts')
      expect(packageJson.scripts.inspect).toBe('raffel inspect src/server.ts')
      expect(packageJson.scripts.doctor).toBe('raffel doctor src/server.ts --fail-on warning')
      expect(packageJson.scripts.playground).toBe('raffel playground src/server.ts --port 4301')
      expect(packageJson.scripts['contract-tests']).toBe('raffel contract-tests src/server.ts')

      if (preset === 'internal-service') {
        const proto = await readFile(path.join(targetDir, 'proto', 'service.proto'), 'utf8')
        expect(proto).toContain('service EchoService')
      }
    }
  })
})
