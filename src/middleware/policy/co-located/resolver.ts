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

import { extname } from 'node:path'
import type { Policy } from '../types.js'

export interface RouteDescriptor {
  /** Resolved procedure name (e.g. `users/:id/get`). */
  name: string
  /** Absolute path of the handler file. */
  filePath: string
}

export type PolicyFileKind = 'sibling'

export interface PolicyFileDescriptor {
  /** Absolute path of the policy file. */
  filePath: string
  /** Parsed and validated policies from this file. */
  policies: readonly Policy[]
  /** Source kind for diagnostics and precedence. */
  kind: PolicyFileKind
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
 * Match policy files to routes by sibling file convention. Pure function —
 * accepts pre-loaded descriptors so unit tests can drive it from in-memory
 * fixtures.
 */
export function resolveCoLocatedPolicies(
  routes: readonly RouteDescriptor[],
  policyFiles: readonly PolicyFileDescriptor[],
): RoutePolicyDescriptor[] {
  const byKey = new Map<string, PolicyFileDescriptor>()
  for (const file of policyFiles) {
    if (file.kind !== 'sibling') continue
    const key = policyFileBaseKey(file.filePath)
    if (!key) continue
    byKey.set(key, file)
  }

  const out: RoutePolicyDescriptor[] = []
  for (const route of routes) {
    const key = handlerBaseKey(route.filePath)
    const file = byKey.get(key)
    if (!file) continue
    out.push({
      name: route.name,
      filePath: route.filePath,
      policies: [...file.policies],
      sources: [{ filePath: file.filePath, kind: file.kind }],
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
