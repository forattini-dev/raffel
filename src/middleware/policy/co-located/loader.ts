/**
 * Co-located policy loader.
 *
 * Walks an FS-discovery tree and reads sibling `<handler>.policy.{yaml,yml,
 * json}` files. The parsed policies are validated against the same JSON schema
 * the root `loadFromDir` loader uses, so authors get identical error messages
 * regardless of where a policy lives.
 *
 * Pure validation lives in the JSON schema — the loader only adds I/O.
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
// `ajv` is a CommonJS package without an ESM wrapper. Node 22's strict
// loader rejects `import { Ajv } from 'ajv'`, and `import Ajv from 'ajv'`
// trips TS NodeNext typings. Pull the constructor via createRequire — it
// works under both ESM and CJS.
import { createRequire } from 'node:module'
import type { Ajv as AjvInstance, Options as AjvOptions, ErrorObject } from 'ajv'

const requireAjv = createRequire(import.meta.url)
const Ajv = requireAjv('ajv') as new (options?: AjvOptions) => AjvInstance
import { load as parseYaml } from 'js-yaml'
import type {
  JsonPolicy,
  Policy,
  PolicyAuditMeta,
  PolicyCondition,
  PolicyFileMeta,
} from '../types.js'
import type { DiscoverySource } from '../../../server/fs-routes/discovery-source.js'
import { policySchema } from '../schema.js'
import {
  ancestorDirs,
  folderPolicyCandidates,
  type PolicyFileDescriptor,
  siblingPolicyCandidates,
} from './resolver.js'

let validator:
  | (((data: unknown) => boolean) & { errors?: ErrorObject[] | null })
  | undefined

function getValidator() {
  if (validator) return validator
  const ajv = new Ajv({ allErrors: true, strict: false })
  // Canonical schema is the TS literal in `../schema.ts`. The equivalent
  // `../schema.json` exists for external tooling and is kept in sync by
  // `schema-sync.unit.test.ts`.
  validator = ajv.compile(policySchema as unknown as object) as unknown as typeof validator
  return validator!
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined, file: string): string {
  if (!errors || errors.length === 0) return `${file}: invalid (no error detail)`
  return errors
    .map((e) => `${file}${e.instancePath || '/'}: ${e.message ?? '?'} (${e.keyword})`)
    .join('\n  ')
}

export interface CoLocatedLoadOptions {
  source: DiscoverySource
  handlerFilePaths: readonly string[]
  customConditions?: Record<string, PolicyCondition>
  /**
   * Discovery root. When provided, folder-cascade scanning stops here so we
   * never read `_policy.*` files outside the discovered tree.
   */
  rootDir?: string
}

export interface CoLocatedLoadResult {
  files: PolicyFileDescriptor[]
}

function parsePolicyText(file: string, raw: string): unknown {
  const ext = extname(file).toLowerCase()
  try {
    if (ext === '.json') return JSON.parse(raw)
    return parseYaml(raw)
  } catch (err) {
    throw new Error(
      `co-located policy loader: ${file}: invalid ${ext === '.json' ? 'JSON' : 'YAML'} — ${(err as Error).message}`,
    )
  }
}

/**
 * A co-located policy file may be written in three shapes:
 *   1. A single policy object:               `{ id: '...', effect: '...', ... }`
 *   2. An array of policy objects:            `[{ id: '...', ... }, ...]`
 *   3. A wrapper with file-level metadata:   `{ _meta: { mode, owner, ... }, policies: [...] }`
 *
 * This function normalises the parsed content into a `(fileMeta, policies)`
 * pair, where `fileMeta` is undefined for shapes 1 and 2 (legacy form) and
 * carries the file-level metadata for shape 3. The per-policy `_meta` is
 * preserved on the policy object under `policy._meta` and survives through
 * to `server.policy.list()` and `policyCoverage()`.
 */
interface NormalisedPolicyFile {
  fileMeta?: PolicyFileMeta
  policies: JsonPolicy[]
}

function normalisePolicyFile(parsed: unknown): NormalisedPolicyFile {
  // Shape 3: { _meta, policies: [...] }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'policies' in parsed
  ) {
    const obj = parsed as { _meta?: unknown; policies: unknown }
    if (!Array.isArray(obj.policies)) {
      throw new Error(
        `co-located policy loader: file wrapper must have a "policies" array (got ${typeof obj.policies})`,
      )
    }
    return {
      fileMeta: isPolicyFileMeta(obj._meta) ? obj._meta : undefined,
      policies: obj.policies as JsonPolicy[],
    }
  }

  // Shape 1 or 2: bare policy or array of policies
  const items = Array.isArray(parsed) ? parsed : [parsed]
  return { policies: items as JsonPolicy[] }
}

function isPolicyFileMeta(value: unknown): value is PolicyFileMeta {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if ('mode' in v && v.mode !== 'cascade' && v.mode !== 'scope') return false
  return true
}

function isPolicyAuditMeta(value: unknown): value is PolicyAuditMeta {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}

function validateFileMeta(fileMeta: PolicyFileMeta | undefined, file: string): void {
  if (!fileMeta) return
  if (fileMeta.mode !== undefined && fileMeta.mode !== 'cascade' && fileMeta.mode !== 'scope') {
    throw new Error(
      `co-located policy loader: ${file}: _meta.mode must be "cascade" or "scope" (got "${fileMeta.mode}")`,
    )
  }
  if (fileMeta.deprecation !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fileMeta.deprecation)) {
    throw new Error(
      `co-located policy loader: ${file}: _meta.deprecation must be ISO-8601 date YYYY-MM-DD (got "${fileMeta.deprecation}")`,
    )
  }
}

function mergeFileMetaIntoPolicy(
  policy: JsonPolicy,
  fileMeta: PolicyFileMeta | undefined,
  index: number,
): JsonPolicy {
  if (!fileMeta) return policy
  // Per-policy _meta (if any) wins over file-level _meta. We do not
  // require the per-policy block to be present — it just overrides when
  // it is.
  const merged: PolicyAuditMeta = {
    ...(fileMeta.owner ? { owner: fileMeta.owner } : {}),
    ...(fileMeta.ticket ? { ticket: fileMeta.ticket } : {}),
    ...(fileMeta.description ? { description: fileMeta.description } : {}),
    ...(fileMeta.deprecation ? { deprecation: fileMeta.deprecation } : {}),
    ...(isPolicyAuditMeta(policy._meta) ? policy._meta : {}),
  }
  const hasAny = Object.keys(merged).length > 0
  return { ...policy, ...(hasAny ? { _meta: merged } : {}), _index: index }
}

function materializePolicy(
  file: string,
  index: number,
  raw: unknown,
  customConditions: Record<string, PolicyCondition>,
): Policy {
  const validate = getValidator()
  if (!validate(raw)) {
    throw new Error(
      `co-located policy loader: schema validation failed:\n  ${formatAjvErrors(validate.errors, `${file}[${index}]`)}`,
    )
  }
  const json = raw as JsonPolicy

  let condition: PolicyCondition | undefined
  if (json.customCondition) {
    const fn = customConditions[json.customCondition]
    if (!fn) {
      throw new Error(
        `co-located policy loader: ${file}[${index}] policy "${json.id}" references customCondition "${json.customCondition}" which is not registered.`,
      )
    }
    condition = fn
  }

  const { customCondition: _drop, match, ...rest } = json
  return {
    ...rest,
    ...(condition ? { condition } : {}),
    ...(match ? { match } : {}),
    _source: file,
    _index: index,
  }
}

/**
 * Look up sibling policy files for each handler. Reads + parses + validates
 * eagerly; throws on the first malformed file so authors fix issues at
 * startup rather than at request time.
 */
export async function loadCoLocatedPolicies(
  options: CoLocatedLoadOptions,
): Promise<CoLocatedLoadResult> {
  const { source, handlerFilePaths, rootDir } = options
  const customConditions = options.customConditions ?? {}
  const files: PolicyFileDescriptor[] = []

  for (const handlerPath of handlerFilePaths) {
    for (const candidate of siblingPolicyCandidates(handlerPath)) {
      if (!(await source.exists(candidate))) continue
      const text = await source.readText(candidate)
      const parsed = parsePolicyText(candidate, text)
      const { fileMeta, policies: items } = normalisePolicyFile(parsed)
      validateFileMeta(fileMeta, candidate)
      const policies: Policy[] = items.map((item, i) =>
        materializePolicy(candidate, i, mergeFileMetaIntoPolicy(item, fileMeta, i), customConditions),
      )
      files.push({
        filePath: candidate,
        policies,
        kind: 'sibling',
        ...(fileMeta?.mode ? { mode: fileMeta.mode } : {}),
        ...(fileMeta ? { fileMeta } : {}),
      })
      break
    }
  }

  const dirs = new Set<string>()
  for (const handlerPath of handlerFilePaths) {
    for (const dir of ancestorDirs(handlerPath, rootDir)) {
      if (rootDir !== undefined && dir !== rootDir && !dir.startsWith(`${rootDir}/`)) continue
      dirs.add(dir)
    }
  }

  for (const dir of dirs) {
    for (const candidate of folderPolicyCandidates(dir)) {
      if (!(await source.exists(candidate))) continue
      const text = await source.readText(candidate)
      const parsed = parsePolicyText(candidate, text)
      const { fileMeta, policies: items } = normalisePolicyFile(parsed)
      validateFileMeta(fileMeta, candidate)
      const policies: Policy[] = items.map((item, i) =>
        materializePolicy(candidate, i, mergeFileMetaIntoPolicy(item, fileMeta, i), customConditions),
      )
      files.push({
        filePath: candidate,
        policies,
        kind: 'folder',
        dir,
        ...(fileMeta?.mode ? { mode: fileMeta.mode } : {}),
        ...(fileMeta ? { fileMeta } : {}),
      })
      break
    }
  }

  return { files }
}
