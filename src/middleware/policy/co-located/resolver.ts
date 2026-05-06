/**
 * Co-located policy resolver — pure module, no I/O.
 *
 * Given a list of discovered route descriptors (handler file paths + procedure
 * names) and a list of parsed policy file descriptors, return the ordered list
 * of policies that apply to each route.
 *
 * Tracer-bullet (#92) supports only the `sibling` kind: a `<handler>.policy.*`
 * file living next to a handler. Folder cascade (#93), resource (#94), channel
 * (#95), and `match` patterns (#96) reuse the same descriptor shape and extend
 * this resolver.
 */

import { dirname, extname } from 'node:path'
import type { Policy } from '../types.js'

export interface RouteDescriptor {
  /** Resolved procedure name (e.g. `users/:id/get`). */
  name: string
  /** Absolute path of the handler file. */
  filePath: string
}

export type PolicyFileKind = 'sibling' | 'folder'

export interface PolicyFileDescriptor {
  /** Absolute path of the policy file. */
  filePath: string
  /** Parsed and validated policies from this file. */
  policies: readonly Policy[]
  /** Source kind for diagnostics and precedence. */
  kind: PolicyFileKind
  /**
   * For `folder` kind: the directory whose handlers (recursively) the file
   * covers. Sibling files leave this undefined.
   */
  dir?: string
}

export interface PolicySource {
  filePath: string
  kind: PolicyFileKind
}

export interface RoutePolicyDescriptor {
  /** Procedure name this descriptor applies to. */
  name: string
  /** Handler file path (1:1 with the route descriptor). */
  filePath: string
  /** Policies in apply order. Tracer-bullet emits the sibling file's policies. */
  policies: Policy[]
  /** File paths contributing to this descriptor (diagnostics). */
  sources: PolicySource[]
}

const POLICY_EXTENSIONS: readonly string[] = ['.yaml', '.yml', '.json']
const POLICY_INFIX = '.policy'
const FOLDER_POLICY_BASENAME = '_policy'

/**
 * Strip a `.policy.{yaml,yml,json}` suffix from a path. Returns null when the
 * file is not a policy file.
 */
export function policyFileBaseKey(policyPath: string): string | null {
  const ext = extname(policyPath)
  if (!POLICY_EXTENSIONS.includes(ext)) return null
  const stem = policyPath.slice(0, -ext.length)
  if (!stem.endsWith(POLICY_INFIX)) return null
  return stem.slice(0, -POLICY_INFIX.length)
}

/**
 * Strip the source extension from a handler path so it can be paired with a
 * policy file. We compare on the extension-less prefix because handlers may
 * be `.ts` or `.js` while sibling policies are `.yaml`/`.yml`/`.json`.
 */
export function handlerBaseKey(handlerPath: string): string {
  const ext = extname(handlerPath)
  if (!ext) return handlerPath
  return handlerPath.slice(0, -ext.length)
}

/**
 * Walk ancestor directories from a handler file up to (and including) the
 * provided root, returning the chain in broader→closer order. The handler's
 * own directory is the last entry. When `rootDir` is omitted the walk stops
 * at the filesystem root (loop guard via `parent === cur`).
 */
export function ancestorDirs(handlerPath: string, rootDir?: string): string[] {
  const chain: string[] = []
  let cur = dirname(handlerPath)
  while (true) {
    chain.unshift(cur)
    if (rootDir !== undefined && cur === rootDir) break
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return chain
}

/**
 * Match policy files to routes. Resolves both sibling files (`<handler>.policy.*`)
 * and folder cascades (`_policy.*` in any ancestor directory). Apply order
 * inside each route descriptor is broader→closer, with the sibling (when
 * present) appended last so deny semantics in the engine still bite.
 */
export function resolveCoLocatedPolicies(
  routes: readonly RouteDescriptor[],
  policyFiles: readonly PolicyFileDescriptor[],
): RoutePolicyDescriptor[] {
  const siblingByKey = new Map<string, PolicyFileDescriptor>()
  const folderByDir = new Map<string, PolicyFileDescriptor>()
  for (const file of policyFiles) {
    if (file.kind === 'sibling') {
      const key = policyFileBaseKey(file.filePath)
      if (key) siblingByKey.set(key, file)
    } else if (file.kind === 'folder' && file.dir) {
      folderByDir.set(file.dir, file)
    }
  }

  const out: RoutePolicyDescriptor[] = []
  for (const route of routes) {
    const policies: Policy[] = []
    const sources: PolicySource[] = []

    for (const dir of ancestorDirs(route.filePath)) {
      const folder = folderByDir.get(dir)
      if (!folder) continue
      policies.push(...folder.policies)
      sources.push({ filePath: folder.filePath, kind: 'folder' })
    }

    const sibling = siblingByKey.get(handlerBaseKey(route.filePath))
    if (sibling) {
      policies.push(...sibling.policies)
      sources.push({ filePath: sibling.filePath, kind: 'sibling' })
    }

    if (sources.length === 0) continue
    out.push({
      name: route.name,
      filePath: route.filePath,
      policies,
      sources,
    })
  }
  return out
}

/**
 * Helper for the loader: list every supported policy filename for a given
 * handler. Caller checks each candidate against its discovery source.
 */
export function siblingPolicyCandidates(handlerPath: string): string[] {
  const key = handlerBaseKey(handlerPath)
  return POLICY_EXTENSIONS.map((ext) => `${key}${POLICY_INFIX}${ext}`)
}

/**
 * Helper for the loader: list every supported `_policy.*` filename inside a
 * directory. Caller checks each candidate against its discovery source.
 */
export function folderPolicyCandidates(dir: string): string[] {
  return POLICY_EXTENSIONS.map((ext) => `${dir}/${FOLDER_POLICY_BASENAME}${ext}`)
}
