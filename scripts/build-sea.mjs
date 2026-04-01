#!/usr/bin/env node

import { accessSync, chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SEA_CONFIG_PATH = join(ROOT, 'scripts', 'sea.config.json')
const DIST_DIR = join(ROOT, 'dist')
const SEA_DIR = join(DIST_DIR, 'sea')
const BLOB_PATH = join(SEA_DIR, 'raffel.blob')
const BASE_BINARY = join(SEA_DIR, 'raffel-base')
const FINAL_BINARY = join(SEA_DIR, platform() === 'win32' ? 'raffel.exe' : 'raffel')
const NODE_MAJOR = Number(process.versions.node.split('.')[0])

function fail(message) {
  throw new Error(`[sea] ${message}`)
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: false,
    ...options,
  })

  if (result.status !== 0 || result.error) {
    const reason = result.error ? ` (${result.error.message})` : ` (exit ${result.status})`
    fail(`command failed: ${command} ${args.join(' ')}${reason}`)
  }
}

function resolvePostjectCommand() {
  const localBin = join(ROOT, 'node_modules', '.bin', 'postject')
  const localBinCmd = platform() === 'win32' ? `${localBin}.cmd` : localBin
  if (existsSync(localBinCmd)) return localBinCmd
  if (platform() === 'win32') {
    const localBinPs1 = `${localBin}.ps1`
    if (existsSync(localBinPs1)) return localBinPs1
  }
  return null
}

function assertPaths() {
  if (NODE_MAJOR < 20) {
    fail('SEA requires Node.js 20 or newer when generating the binary.')
  }

  try {
    accessSync(SEA_CONFIG_PATH)
  } catch {
    fail(`cannot read SEA config at ${SEA_CONFIG_PATH}`)
  }
}

let exitCode = 0

try {
  assertPaths()
  mkdirSync(SEA_DIR, { recursive: true })

  if (!existsSync(join(DIST_DIR, 'mcp', 'cli.js'))) {
    fail('dist/mcp/cli.js not found. Run `pnpm run build` before generating SEA.')
  }

  runCommand(process.execPath, ['--experimental-sea-config', SEA_CONFIG_PATH])
  if (!existsSync(BLOB_PATH)) {
    fail('SEA blob not found. generation step failed.')
  }

  copyFileSync(process.execPath, BASE_BINARY)
  if (platform() !== 'win32') {
    chmodSync(BASE_BINARY, 0o755)
  }

  const postject = resolvePostjectCommand()
  if (!postject) {
    fail('postject not found in node_modules/.bin. Install it with `pnpm add -D @vercel/postject`.')
  }

  copyFileSync(BASE_BINARY, FINAL_BINARY)
  const postjectShell = platform() === 'win32'
  runCommand(postject, [
    FINAL_BINARY,
    'NODE_SEA_BLOB',
    BLOB_PATH,
    '--sentinel-fuse',
    'NODE_SEA_BLOB',
  ], { shell: postjectShell })

  if (platform() !== 'win32') {
    chmodSync(FINAL_BINARY, 0o755)
  }

  console.log('')
  console.log('SEA binary created:')
  console.log(`  ${FINAL_BINARY}`)

} catch (error) {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(`[sea] ${error}`)
  }
  exitCode = 1
} finally {
  if (existsSync(BASE_BINARY)) {
    rmSync(BASE_BINARY)
  }
  if (existsSync(FINAL_BINARY)) {
    rmSync(FINAL_BINARY)
  }
  if (exitCode !== 0 && existsSync(BLOB_PATH)) {
    rmSync(BLOB_PATH)
  }
}

if (exitCode !== 0) {
  process.exit(exitCode)
}
