import { execFileSync } from 'node:child_process'

const raw = execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
})

const roots = JSON.parse(raw)
const packages = new Map()

function collect(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    const version = dependency?.version
    if (typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version)) {
      packages.set(`${name}@${version}`, { name, version })
    }
    collect(dependency?.dependencies)
  }
}

for (const root of roots) collect(root.dependencies)

const entries = [...packages.values()]
const findings = []
const batchSize = 500

async function queryOsv(body) {
  try {
    const response = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    if (!response.ok) throw new Error(`OSV query failed with HTTP ${response.status}`)
    return response.json()
  } catch (fetchError) {
    try {
      const output = execFileSync('curl', [
        '--fail', '--silent', '--show-error',
        '--header', 'content-type: application/json',
        '--data-binary', '@-',
        'https://api.osv.dev/v1/querybatch',
      ], { input: body, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
      return JSON.parse(output)
    } catch (curlError) {
      throw new AggregateError([fetchError, curlError], 'Unable to query OSV')
    }
  }
}

for (let offset = 0; offset < entries.length; offset += batchSize) {
  const batch = entries.slice(offset, offset + batchSize)
  const payload = await queryOsv(JSON.stringify({
    queries: batch.map(({ name, version }) => ({
      package: { ecosystem: 'npm', name },
      version,
    })),
  }))
  for (const [index, result] of payload.results.entries()) {
    for (const vulnerability of result.vulns ?? []) {
      findings.push({ ...batch[index], id: vulnerability.id })
    }
  }
}

if (findings.length > 0) {
  console.error('Known vulnerabilities found in production dependencies:')
  for (const finding of findings) {
    console.error(`- ${finding.name}@${finding.version}: ${finding.id}`)
  }
  process.exitCode = 1
} else {
  console.log(`OSV audit passed for ${entries.length} production packages.`)
}
