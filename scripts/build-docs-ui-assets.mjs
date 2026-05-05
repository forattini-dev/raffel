#!/usr/bin/env node

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const htmlBuilderUrl = pathToFileURL(join(root, 'dist/docs/ui/html-builder.js')).href
const { generateUICSS } = await import(htmlBuilderUrl)

const assetsDir = join(root, 'dist/docs/ui/assets')
await mkdir(assetsDir, { recursive: true })

await copyRuntimeAsset()
await copySupportAsset('dist/docs/ui/runtime/marked-renderer.js', 'marked-renderer.js')
await copySupportAsset('node_modules/marked/lib/marked.umd.js', 'marked.umd.js')

await writeFile(
  join(assetsDir, 'raffel-docs.css'),
  generateUICSS({
    basePath: '/docs',
    doc: {
      info: { title: 'API Documentation', version: '1.0.0' },
      paths: {},
    },
    ui: {},
  }),
  'utf8'
)

async function copyRuntimeAsset() {
  const runtimePath = join(root, 'dist/docs/ui/runtime/index.js')
  const assetPath = join(assetsDir, 'raffel-docs.js')
  await copyFile(runtimePath, assetPath)
  return ''
}

async function copySupportAsset(source, target) {
  try {
    await copyFile(join(root, source), join(assetsDir, target))
  } catch {
    await writeFile(join(assetsDir, target), '', 'utf8')
  }
}
