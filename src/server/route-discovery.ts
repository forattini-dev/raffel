/**
 * Route Discovery
 *
 * Loads route definitions from a directory tree and registers them
 * into a RouterModule with deterministic path-to-name mapping.
 */

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { z } from 'zod'
import type {
  ProcedureHandler,
  StreamHandler,
  EventHandler,
  Interceptor,
  DeliveryGuarantee,
  RetryPolicy,
  Context,
} from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import { createRouterModule } from './router-module.js'
import type { RouterModule } from './types.js'

export type RouteKind = 'procedure' | 'stream' | 'event'

export interface RouteDefinitionBase {
  kind: RouteKind
  description?: string
  interceptors?: Interceptor[]
  schema?: HandlerSchema
}

export interface ProcedureRouteDefinition extends RouteDefinitionBase {
  kind: 'procedure'
  handler: ProcedureHandler
}

export interface StreamRouteDefinition extends RouteDefinitionBase {
  kind: 'stream'
  handler: StreamHandler
}

export interface EventRouteDefinition extends RouteDefinitionBase {
  kind: 'event'
  handler: EventHandler
  delivery?: DeliveryGuarantee
  retryPolicy?: RetryPolicy
  deduplicationWindow?: number
}

export type RouteDefinition =
  | ProcedureRouteDefinition
  | StreamRouteDefinition
  | EventRouteDefinition

export interface RouteLoaderOptions {
  /** Root directory for route files */
  rootDir: string
  /** Optional prefix applied inside the module */
  prefix?: string
  /** Allowed file extensions (default: .js, .mjs, .ts) */
  extensions?: string[]
  /** Optional ignore predicate (receives absolute path) */
  ignore?: (filePath: string) => boolean
}

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.ts']
const DEFAULT_IGNORE_DIRS = new Set(['node_modules', '.git'])

/**
 * Convert a route file path into a canonical handler name.
 */
export function pathToRouteName(rootDir: string, filePath: string): string {
  const relativePath = path.relative(rootDir, filePath)
  const parsed = path.parse(relativePath)
  const segments = relativePath.split(path.sep)

  segments[segments.length - 1] = parsed.name

  if (segments[segments.length - 1] === 'index' && segments.length > 1) {
    segments.pop()
  }

  return segments.filter((segment) => segment.length > 0).join('.')
}

function normalizeExtensions(extensions?: string[]): string[] {
  if (!extensions || extensions.length === 0) return DEFAULT_EXTENSIONS
  return extensions.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
}

function isRouteDefinition(value: unknown): value is RouteDefinition {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind !== 'procedure' && record.kind !== 'stream' && record.kind !== 'event') {
    return false
  }
  if (typeof record.handler !== 'function') {
    return false
  }
  if (record.interceptors !== undefined && !Array.isArray(record.interceptors)) {
    return false
  }
  return true
}

async function collectRouteFiles(
  rootDir: string,
  extensions: string[],
  ignore?: (filePath: string) => boolean
): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue
      }
      if (ignore?.(fullPath)) {
        continue
      }
      files.push(...await collectRouteFiles(fullPath, extensions, ignore))
      continue
    }

    if (!entry.isFile()) continue

    if (ignore?.(fullPath)) {
      continue
    }

    const ext = path.extname(entry.name)
    if (extensions.includes(ext)) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Load route files into a RouterModule.
 */
export async function loadRouterModule(options: RouteLoaderOptions): Promise<RouterModule> {
  const rootDir = path.resolve(options.rootDir)
  const extensions = normalizeExtensions(options.extensions)
  const module = createRouterModule(options.prefix ?? '')

  const files = await collectRouteFiles(rootDir, extensions, options.ignore)
  const seen = new Map<string, string>()

  for (const filePath of files) {
    const routeName = pathToRouteName(rootDir, filePath)
    if (!routeName) {
      throw new Error(`Route file '${filePath}' resolves to an empty handler name`)
    }

    const existing = seen.get(routeName)
    if (existing) {
      throw new Error(`Duplicate route name '${routeName}' from '${existing}' and '${filePath}'`)
    }
    seen.set(routeName, filePath)

    const mod = await import(pathToFileURL(filePath).href)
    const definition = mod.route ?? mod.default

    if (!isRouteDefinition(definition)) {
      throw new Error(`Invalid route definition in '${filePath}'`)
    }

    registerRoute(module, routeName, definition)
  }

  return module
}

function registerRoute(module: RouterModule, name: string, definition: RouteDefinition): void {
  const interceptors = definition.interceptors ?? []
  const schema = definition.schema

  if (definition.kind === 'procedure') {
    const builder = module.procedure(name)
    // Cast to z.ZodType - the schema is expected to be a Zod schema for the builder API
    if (schema?.input) builder.input(schema.input as z.ZodType)
    if (schema?.output) builder.output(schema.output as z.ZodType)
    if (definition.description) builder.description(definition.description)
    for (const interceptor of interceptors) builder.use(interceptor)
    // Cast needed because ProcedureHandler allows sync returns but builder expects Promise
    builder.handler(definition.handler as (input: unknown, ctx: Context) => Promise<unknown>)
    return
  }

  if (definition.kind === 'stream') {
    const builder = module.stream(name)
    // Cast to z.ZodType - the schema is expected to be a Zod schema for the builder API
    if (schema?.input) builder.input(schema.input as z.ZodType)
    if (schema?.output) builder.output(schema.output as z.ZodType)
    if (definition.description) builder.description(definition.description)
    for (const interceptor of interceptors) builder.use(interceptor)
    // Cast needed because StreamHandler is a union type
    builder.handler(definition.handler as (input: unknown, ctx: Context) => AsyncIterable<unknown>)
    return
  }

  const builder = module.event(name)
  // Cast to z.ZodType - the schema is expected to be a Zod schema for the builder API
  if (schema?.input) builder.input(schema.input as z.ZodType)
  if (definition.description) builder.description(definition.description)
  for (const interceptor of interceptors) builder.use(interceptor)
  if (definition.delivery) builder.delivery(definition.delivery)
  if (definition.retryPolicy) builder.retryPolicy(definition.retryPolicy)
  if (definition.deduplicationWindow !== undefined) {
    builder.deduplicationWindow(definition.deduplicationWindow)
  }
  // Cast needed because EventHandler allows void return but builder expects Promise<void>
  builder.handler(definition.handler as (input: unknown, ctx: Context, ack: () => void) => Promise<void>)
}
