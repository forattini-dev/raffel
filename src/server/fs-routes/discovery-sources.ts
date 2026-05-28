/**
 * Discovery Source Resolution
 *
 * Helpers shared between the loader and the watcher for normalizing the
 * `DiscoveryConfig` shape into a flat list of `{ dir, prefix }` entries.
 *
 * The discovery config accepts a union per slot:
 *   - `false`                              → disabled
 *   - `true`                               → use default directory, no prefix
 *   - `string`                             → single custom directory, no prefix
 *   - `DiscoverySourceEntry`               → single dir with optional prefix
 *   - `Array<string | DiscoverySourceEntry>` → multiple sources (domain-driven)
 *
 * Both `loader.ts` (route loading) and `watcher.ts` (hot-reload watching)
 * need to iterate over the same set of resolved directories, so the
 * resolution logic lives here in one place.
 */

import { isAbsolute, join } from 'node:path'
import type { DiscoveryConfig, DiscoverySourceEntry, DiscoverySourceValue } from './types.js'

/** Resolved discovery source — what consumers iterate over. */
export interface ResolvedDiscoverySource {
  dir: string
  /** Cleaned prefix (no leading/trailing slashes). Empty string means "no prefix". */
  prefix: string
}

/** Default directories used when a slot is `true`. */
export const DISCOVERY_DEFAULTS: Record<keyof DiscoveryConfig, string> = {
  http: './src/http',
  channels: './src/channels',
  rpc: './src/rpc',
  streams: './src/streams',
  rest: './src/rest',
  resources: './src/resources',
  tcp: './src/tcp',
  udp: './src/udp',
}

/**
 * Resolve a single directory path (absolute or relative to baseDir).
 */
export function resolveDiscoveryDir(baseDir: string, dir: string): string {
  return isAbsolute(dir) ? dir : join(baseDir, dir)
}

/**
 * Strip leading/trailing slashes from a prefix. Returns '' if empty/undefined.
 * `'/leads/'` → `'leads'`, `'leads'` → `'leads'`, `undefined` → `''`.
 */
export function normalizeDiscoveryPrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  return prefix.replace(/^\/+|\/+$/g, '')
}

/**
 * Prefix a discovered name with the source's prefix.
 * `prefix=''` returns name unchanged.
 * `prefix='leads', name='list/get'` → `'leads/list/get'`.
 */
export function applyDiscoveryPrefix(prefix: string, name: string): string {
  if (!prefix) return name
  return name ? `${prefix}/${name}` : prefix
}

/**
 * Normalize a discovery slot value into a flat list of resolved sources.
 *
 * Handles the union: `false | true | string | DiscoverySourceEntry | Array<...>`.
 * Returns an empty array for disabled slots.
 */
export function resolveDiscoverySources(
  baseDir: string,
  value: DiscoverySourceValue | undefined,
  defaultPath: string,
): ResolvedDiscoverySource[] {
  if (value === false || value === undefined) return []
  if (value === true) {
    return [{ dir: resolveDiscoveryDir(baseDir, defaultPath), prefix: '' }]
  }
  if (typeof value === 'string') {
    return [{ dir: resolveDiscoveryDir(baseDir, value), prefix: '' }]
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === 'string'
        ? { dir: resolveDiscoveryDir(baseDir, entry), prefix: '' }
        : {
            dir: resolveDiscoveryDir(baseDir, entry.dir),
            prefix: normalizeDiscoveryPrefix(entry.prefix),
          },
    )
  }
  // Single DiscoverySourceEntry object
  const entry = value as DiscoverySourceEntry
  return [
    {
      dir: resolveDiscoveryDir(baseDir, entry.dir),
      prefix: normalizeDiscoveryPrefix(entry.prefix),
    },
  ]
}

/**
 * Normalize a DiscoveryConfig (or boolean shortcut) into an explicit config.
 * `true` expands to every slot enabled; `false` becomes an empty object.
 */
export function normalizeDiscoveryConfig(config: DiscoveryConfig | boolean): DiscoveryConfig {
  if (config === true) {
    return {
      http: true,
      channels: true,
      rpc: true,
      streams: true,
      rest: true,
      resources: true,
      tcp: true,
      udp: true,
    }
  }
  if (config === false) return {}
  return config
}
