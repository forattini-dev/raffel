import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

const PRISM_BROWSER_SOURCES = [
  'prismjs/prism.js',
  'prismjs/components/prism-bash.js',
  'prismjs/components/prism-typescript.js',
  'prismjs/components/prism-rust.js',
  'prismjs/components/prism-python.js',
  'prismjs/components/prism-go.js',
  'prismjs/components/prism-json.js',
]

/** Build the browser Prism asset used by both inline and external docs UI. */
export function generatePrismBrowserBundle(): string {
  return PRISM_BROWSER_SOURCES
    .map(readOptionalDependency)
    .filter(source => source.trim().length > 0)
    .join('\n')
}

function readOptionalDependency(specifier: string): string {
  try {
    return readFileSync(require.resolve(specifier), 'utf8')
  } catch {
    try {
      const [packageName, ...parts] = specifier.split('/')
      const packageRoot = dirname(require.resolve(`${packageName}/package.json`))
      return readFileSync(join(packageRoot, ...parts), 'utf8')
    } catch {
      return ''
    }
  }
}
