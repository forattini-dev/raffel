/**
 * MCP Version Helper
 *
 * Reads the package.json version once and exposes it for CLI and server usage.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url))

function readVersion(): string {
  try {
    const raw = readFileSync(PACKAGE_JSON_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const MCP_VERSION = readVersion()
