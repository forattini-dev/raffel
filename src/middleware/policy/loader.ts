/**
 * JSON Policy Loader.
 *
 * Walks a directory, loads `*.json` files, validates each against the policy
 * schema, resolves `customCondition` references against a TS registry, and
 * returns the merged policy array.
 *
 * Validation is eager — any error throws at startup. Path errors include the
 * source filename so operators can find the offending JSON quickly.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
// `ajv` is a CommonJS package without an ESM wrapper. Node 22's strict
// loader rejects `import { Ajv } from 'ajv'`, and `import Ajv from 'ajv'`
// trips TS NodeNext typings. Pull the constructor via createRequire — it
// works under both ESM and CJS.
import { createRequire } from 'node:module'
import type { Ajv as AjvInstance, Options as AjvOptions, ErrorObject } from 'ajv'

const requireAjv = createRequire(import.meta.url)
const Ajv = requireAjv('ajv') as new (options?: AjvOptions) => AjvInstance
import type {
  JsonPolicy,
  Policy,
  PolicyCondition,
} from './types.js'

// Lazy-load schema — JSON import via fs avoids bundler oddities and keeps
// loader free of import-assert syntax.
function loadSchema(): unknown {
  const schemaPath = new URL('./schema.json', import.meta.url)
  return JSON.parse(readFileSync(schemaPath, 'utf-8'))
}

let validator: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null } | undefined

function getValidator() {
  if (validator) return validator
  const ajv = new Ajv({ allErrors: true, strict: false })
  validator = ajv.compile(loadSchema() as object) as unknown as typeof validator
  return validator!
}

export interface LoadOptions {
  /** Directory to scan (recursive). */
  dir: string
  /** Named TS conditions referenced from JSON via `customCondition: "name"`. */
  customConditions?: Record<string, PolicyCondition>
}

export interface LoadResult {
  /** Resolved policies — `customCondition` strings replaced with the TS function. */
  policies: Policy[]
  /** Files that failed to load (collected for diagnostics; loader still throws). */
  loadedFiles: string[]
}

function walkJsonFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(cur)
    } catch (err) {
      throw new Error(`policy loader: cannot read directory "${cur}": ${(err as Error).message}`)
    }
    for (const name of entries) {
      const full = join(cur, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        stack.push(full)
      } else if (st.isFile() && name.endsWith('.json')) {
        out.push(full)
      }
    }
  }
  return out
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined, file: string): string {
  if (!errors || errors.length === 0) return `${file}: invalid (no error detail)`
  return errors
    .map((e) => `${file}${e.instancePath || '/'}: ${e.message ?? '?'} (${e.keyword})`)
    .join('\n  ')
}

/**
 * Load policies from a directory tree. Throws on:
 *   - I/O errors
 *   - JSON parse errors (with file path)
 *   - schema validation errors (with file path + JSON pointer)
 *   - missing `customCondition` references
 */
export function loadPoliciesFromDir(options: LoadOptions): LoadResult {
  const root = resolve(options.dir)
  const customConditions = options.customConditions ?? {}
  const validate = getValidator()

  const files = walkJsonFiles(root)
  const policies: Policy[] = []
  const loadedFiles: string[] = []

  for (const file of files) {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8'))
    } catch (err) {
      throw new Error(`policy loader: ${file}: invalid JSON — ${(err as Error).message}`)
    }

    const items = Array.isArray(raw) ? raw : [raw]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!validate(item)) {
        throw new Error(
          `policy loader: schema validation failed:\n  ${formatAjvErrors(validate.errors, `${file}[${i}]`)}`,
        )
      }
      const json = item as JsonPolicy

      let condition: PolicyCondition | undefined
      if (json.customCondition) {
        const fn = customConditions[json.customCondition]
        if (!fn) {
          throw new Error(
            `policy loader: ${file}[${i}] policy "${json.id}" references customCondition "${json.customCondition}" which is not registered.`,
          )
        }
        condition = fn
      }

      const { customCondition: _drop, match, ...rest } = json
      const policy: Policy = {
        ...rest,
        ...(condition ? { condition } : {}),
        ...(match ? { match } : {}),
        _source: file,
        _index: i,
      }
      policies.push(policy)
    }
    loadedFiles.push(file)
  }

  return { policies, loadedFiles }
}

/**
 * Merge inline + JSON-loaded policies. JSON wins on duplicate `id`.
 *
 * Returns `{ merged, warnings }`. Caller (server bootstrap) routes warnings
 * to the LoggerPort.
 */
export function mergePolicies(
  inline: readonly Policy[],
  fromJson: readonly Policy[],
): { merged: Policy[]; warnings: string[] } {
  const byId = new Map<string, Policy>()
  const warnings: string[] = []

  for (const p of inline) {
    if (byId.has(p.id)) {
      warnings.push(`policy: duplicate inline id "${p.id}" — last one wins`)
    }
    byId.set(p.id, p)
  }
  for (const p of fromJson) {
    if (byId.has(p.id)) {
      const prev = byId.get(p.id)!
      const prevSrc = prev._source ?? 'inline'
      warnings.push(`policy: id "${p.id}" from JSON (${p._source}) overrides ${prevSrc}`)
    }
    byId.set(p.id, p)
  }

  // Dead-policy warnings
  for (const p of byId.values()) {
    if (p.principals.length === 0) warnings.push(`policy "${p.id}": empty principals — never matches`)
    if (p.actions.length === 0) warnings.push(`policy "${p.id}": empty actions — never matches`)
    if (p.resources.length === 0) warnings.push(`policy "${p.id}": empty resources — never matches`)
  }

  return { merged: [...byId.values()], warnings }
}
