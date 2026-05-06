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
import { Ajv } from 'ajv'
import type { ErrorObject } from 'ajv'
import { load as parseYaml } from 'js-yaml'
import type {
  JsonPolicy,
  Policy,
  PolicyCondition,
} from '../types.js'
import type { DiscoverySource } from '../../../server/fs-routes/discovery-source.js'
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
  const schemaPath = new URL('../schema.json', import.meta.url)
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
  const ajv = new Ajv({ allErrors: true, strict: false })
  validator = ajv.compile(schema as object) as unknown as typeof validator
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
      const items = Array.isArray(parsed) ? parsed : [parsed]
      const policies: Policy[] = items.map((item, i) =>
        materializePolicy(candidate, i, item, customConditions),
      )
      files.push({ filePath: candidate, policies, kind: 'sibling' })
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
      const items = Array.isArray(parsed) ? parsed : [parsed]
      const policies: Policy[] = items.map((item, i) =>
        materializePolicy(candidate, i, item, customConditions),
      )
      files.push({ filePath: candidate, policies, kind: 'folder', dir })
      break
    }
  }

  return { files }
}
