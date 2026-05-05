import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const srcRoot = path.join(repoRoot, 'src')

const rules = [
  {
    scope: path.join(srcRoot, 'core'),
    forbidden: [path.join(srcRoot, 'adapters'), path.join(srcRoot, 'bootstrap')],
    label: 'core',
  },
  // Server orchestration lives under src/server/orchestration because it is
  // builder-internal orchestration, not a separate use-case/application layer.
  // There is intentionally no application→server boundary rule anymore.
  {
    scope: path.join(srcRoot, 'ports'),
    forbidden: [path.join(srcRoot, 'adapters'), path.join(srcRoot, 'bootstrap'), path.join(srcRoot, 'server')],
    label: 'ports',
  },
  {
    scope: path.join(srcRoot, 'adapters', 'outbound'),
    forbidden: [path.join(srcRoot, 'bootstrap')],
    label: 'adapters/outbound',
  },
  {
    scope: path.join(srcRoot, 'middleware'),
    forbidden: [path.join(srcRoot, 'server', 'builder')],
    label: 'middleware',
  },
]

const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

function normalizeImport(fromFile, specifier) {
  return path.normalize(path.resolve(path.dirname(fromFile), specifier))
}

const violations = []

for (const rule of rules) {
  for (const file of walk(rule.scope)) {
    const source = fs.readFileSync(file, 'utf8')

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) continue

      const resolved = normalizeImport(file, specifier)
      const forbidden = rule.forbidden.find((prefix) => resolved.startsWith(prefix))
      if (!forbidden) continue

      violations.push({
        layer: rule.label,
        file: path.relative(repoRoot, file),
        specifier,
        target: path.relative(repoRoot, resolved),
      })
    }
  }
}

if (violations.length > 0) {
  console.error('Hexagonal boundary violations detected:')
  for (const violation of violations) {
    console.error(
      `- [${violation.layer}] ${violation.file} imports ${violation.specifier} (${violation.target})`
    )
  }
  process.exit(1)
}

console.log('Hexagonal boundary checks passed.')
