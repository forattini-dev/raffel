import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const outputPath = process.argv[2] ?? 'bom.cdx.json'
const roots = JSON.parse(execFileSync(
  'pnpm',
  ['list', '--prod', '--depth', 'Infinity', '--json'],
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
))
const root = roots[0]
const components = new Map()
const dependencyGraph = new Map()

function refFor(name, version) {
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
}

function collect(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    const version = dependency?.version
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) continue
    const ref = refFor(name, version)
    components.set(ref, {
      type: 'library',
      'bom-ref': ref,
      name,
      version,
      purl: ref,
    })
    const children = []
    for (const [childName, child] of Object.entries(dependency.dependencies ?? {})) {
      if (typeof child?.version === 'string' && /^\d+\.\d+\.\d+/.test(child.version)) {
        children.push(refFor(childName, child.version))
      }
    }
    dependencyGraph.set(ref, [...new Set([...(dependencyGraph.get(ref) ?? []), ...children])])
    collect(dependency.dependencies)
  }
}

collect(root.dependencies)
const rootRef = refFor(root.name, root.version)
const rootDependencies = Object.entries(root.dependencies ?? {})
  .filter(([, dependency]) => typeof dependency?.version === 'string' && /^\d+\.\d+\.\d+/.test(dependency.version))
  .map(([name, dependency]) => refFor(name, dependency.version))
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'raffel-sbom-generator' }] },
    component: {
      type: 'library',
      'bom-ref': rootRef,
      name: root.name,
      version: root.version,
      purl: rootRef,
    },
  },
  components: [...components.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
  dependencies: [
    { ref: rootRef, dependsOn: rootDependencies },
    ...[...dependencyGraph.entries()].map(([ref, dependsOn]) => ({ ref, dependsOn })),
  ],
}

await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, { mode: 0o600 })
console.log(`CycloneDX SBOM written to ${outputPath} (${components.size} components).`)
