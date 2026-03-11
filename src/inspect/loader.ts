import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { serializeRuntimeInspectionGraph } from './runtime-graph.js'
import type { RuntimeInspectionGraph } from './types.js'

const TS_ENTRY_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

export const DEFAULT_INSPECTION_ENTRYPOINTS = [
  'raffel.preview.ts',
  'raffel.preview.mts',
  'raffel.preview.js',
  'raffel.preview.mjs',
  'src/server.ts',
  'src/server.mts',
  'src/server.js',
  'src/server.mjs',
  'src/index.ts',
  'src/index.mts',
  'src/index.js',
  'src/index.mjs',
  'server.ts',
  'server.mts',
  'server.js',
  'server.mjs',
] as const

export interface RuntimeInspectionLoadOptions {
  entry?: string
  cwd?: string
}

export interface LoadedRuntimeInspectionPreview {
  entrypoint: string
  graph: RuntimeInspectionGraph
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return isObject(value) && typeof value.then === 'function'
}

function isRuntimeInspectionGraph(value: unknown): value is RuntimeInspectionGraph {
  return (
    isObject(value)
    && typeof value.version === 'number'
    && typeof value.generatedAt === 'string'
    && Array.isArray(value.operations)
    && Array.isArray(value.services)
    && Array.isArray(value.diagnostics)
  )
}

function hasPreviewMethod(value: unknown): value is { preview: () => unknown } {
  return isObject(value) && typeof value.preview === 'function'
}

async function importEntrypointModule(entrypoint: string): Promise<Record<string, unknown>> {
  const extension = path.extname(entrypoint).toLowerCase()

  if (TS_ENTRY_EXTENSIONS.has(extension)) {
    const { tsImport } = await import('tsx/esm/api')
    return tsImport(entrypoint, import.meta.url) as Promise<Record<string, unknown>>
  }

  return import(pathToFileURL(entrypoint).href) as Promise<Record<string, unknown>>
}

async function unwrapPreviewCandidate(
  value: unknown,
  label: string,
  depth = 0
): Promise<RuntimeInspectionGraph | null> {
  if (depth > 6 || value === undefined || value === null) {
    return null
  }

  const resolved = isPromiseLike(value) ? await value : value

  if (isRuntimeInspectionGraph(resolved)) {
    return serializeRuntimeInspectionGraph(resolved)
  }

  if (hasPreviewMethod(resolved)) {
    return unwrapPreviewCandidate(resolved.preview(), `${label}.preview()`, depth + 1)
  }

  if (typeof resolved === 'function') {
    return unwrapPreviewCandidate(resolved(), `${label}()`, depth + 1)
  }

  if (!isObject(resolved)) {
    return null
  }

  for (const key of ['graph', 'preview', 'createPreview', 'server', 'app', 'default'] as const) {
    if (!(key in resolved)) continue
    const next = await unwrapPreviewCandidate(resolved[key], `${label}.${key}`, depth + 1)
    if (next) {
      return next
    }
  }

  return null
}

export function resolveInspectionEntrypoint(
  options: RuntimeInspectionLoadOptions = {}
): string {
  const cwd = path.resolve(options.cwd ?? process.cwd())

  if (options.entry) {
    const entrypoint = path.resolve(cwd, options.entry)
    if (!existsSync(entrypoint)) {
      throw new Error(`Inspection entrypoint not found: ${entrypoint}`)
    }
    return entrypoint
  }

  for (const candidate of DEFAULT_INSPECTION_ENTRYPOINTS) {
    const entrypoint = path.resolve(cwd, candidate)
    if (existsSync(entrypoint)) {
      return entrypoint
    }
  }

  throw new Error(
    `No preview entrypoint found in ${cwd}. Checked: ${DEFAULT_INSPECTION_ENTRYPOINTS.join(', ')}`
  )
}

export async function loadRuntimeInspectionPreview(
  options: RuntimeInspectionLoadOptions = {}
): Promise<LoadedRuntimeInspectionPreview> {
  const entrypoint = resolveInspectionEntrypoint(options)
  const moduleExports = await importEntrypointModule(entrypoint)

  const preview =
    await unwrapPreviewCandidate(moduleExports.preview, 'module.preview')
    ?? await unwrapPreviewCandidate(moduleExports.createPreview, 'module.createPreview')
    ?? await unwrapPreviewCandidate(moduleExports.server, 'module.server')
    ?? await unwrapPreviewCandidate(moduleExports.default, 'module.default')
    ?? await unwrapPreviewCandidate(moduleExports, 'module')

  if (!preview) {
    throw new Error(
      [
        `No previewable export found in ${entrypoint}.`,
        'Export one of the following:',
        '- `export default server` where `server.preview()` exists',
        '- `export const server = createServer(...)`',
        '- `export const preview = () => server.preview()`',
      ].join('\n')
    )
  }

  return {
    entrypoint,
    graph: preview,
  }
}
