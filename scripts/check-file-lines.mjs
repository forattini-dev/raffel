#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_LINES = 1000
const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const SCAN_DIRS = ['src', 'test']

const EXCLUDED_EXTS = new Set(['.d.ts', '.map', '.json'])
const TARGET_EXTS = new Set(['.ts', '.tsx'])

async function walkDirectory(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, files)
      continue
    }

    const ext = fullPath.slice(fullPath.lastIndexOf('.'))
    if (TARGET_EXTS.has(ext) && !EXCLUDED_EXTS.has(ext)) {
      files.push(fullPath)
    }
  }
  return files
}

async function getLineCount(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  return content.split('\n').length
}

async function run() {
  const files = []
  for (const dir of SCAN_DIRS) {
    const base = join(ROOT, dir)
    await walkDirectory(base, files)
  }

  const offenders = []
  for (const file of files) {
    const lines = await getLineCount(file)
    if (lines > MAX_LINES) {
      offenders.push({ file, lines })
    }
  }

  if (offenders.length === 0) {
    return
  }

  offenders.sort((a, b) => b.lines - a.lines)
  console.log(`Arquivos acima de ${MAX_LINES} linhas:`)
  for (const { file, lines } of offenders) {
    console.log(`  ${lines.toString().padStart(5, ' ')} ${file}`)
  }
  process.exit(1)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

