/**
 * Docs UI client script assembly.
 *
 * Inline and external docs delivery share the runtime modules in
 * src/docs/ui/runtime. Inline delivery bundles those modules into one script
 * at generation time; external delivery serves the same modules as assets.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePrismBrowserBundle } from '../prism-browser-bundle.js'

const require = createRequire(import.meta.url)
let cachedSharedRuntimeScript: string | null = null

/**
 * Generate the per-document data bootstrap.
 */
export function generateClientDataScript(
  escapedSpec: string,
  escapedTagGroups: string,
  escapedHero: string,
  escapedSidebar: string,
  escapedIntroduction: string,
  escapedDocsPages: string,
  escapedDocsAliases: string,
  escapedSearchIndex: string,
  escapedDocsSidebar: string,
  escapedDocsAssetBasePath: string,
  escapedFooter: string,
  escapedToc: string,
  escapedMarkdown: string,
  escapedDocsRepo: string = 'null',
  escapedBreadcrumbs: string = '{"enabled":true,"hideOnHome":true}',
  escapedPageNav: string = '{"enabled":true,"hide":[]}',
  escapedMermaid: string = '{"enabled":true,"src":"https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js","viewer":true}',
  escapedResponseExamples: string = '{}',
  escapedTryIt: string = '{"enabled":false,"mode":"direct"}'
): string {
  return `
    window.__RAFFEL_DOCS__ = {
      spec: ${escapedSpec},
      tagGroups: ${escapedTagGroups},
      heroConfig: ${escapedHero},
      sidebarConfig: ${escapedSidebar},
      introductionMarkdown: ${escapedIntroduction},
      docsPages: ${escapedDocsPages},
      docsAliases: ${escapedDocsAliases},
      searchIndex: ${escapedSearchIndex},
      docsSidebar: ${escapedDocsSidebar},
      docsAssetBasePath: ${escapedDocsAssetBasePath},
      footerMarkdown: ${escapedFooter},
      tocConfig: ${escapedToc},
      markdownConfig: ${escapedMarkdown},
      docsRepoConfig: ${escapedDocsRepo},
      breadcrumbsConfig: ${escapedBreadcrumbs},
      pageNavConfig: ${escapedPageNav},
      mermaidConfig: ${escapedMermaid},
      responseExamples: ${escapedResponseExamples},
      tryIt: ${escapedTryIt}
    };
`
}

/**
 * Generate the reusable client-side runtime.
 *
 * This runtime is document-agnostic and can be served as a release asset.
 */
export function generateClientRuntimeScript(): string {
  cachedSharedRuntimeScript ??= generateSharedRuntimeScript()
  if (cachedSharedRuntimeScript) return cachedSharedRuntimeScript
  throw new Error(
    'Raffel docs runtime could not be located. Expected the compiled runtime at '
    + 'dist/docs/ui/runtime or the TypeScript source at src/docs/ui/runtime relative to the docs UI '
    + 'package. Reinstall raffel or run `pnpm run build` so the docs UI runtime asset is present.',
  )
}

export function generateInlineRuntimeDependencyScripts(): string {
  return [
    inlineDependencyScript('marked', readOptionalDependency('marked/lib/marked.umd.js')),
    inlineDependencyScript('prism', generatePrismBrowserBundle()),
  ].filter(Boolean).join('\n  ')
}

function inlineDependencyScript(name: string, source: string): string {
  if (!source.trim()) return ''
  return `<script data-raffel-inline-dependency="${name}">
${escapeScriptBody(source)}
  </script>`
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

function generateSharedRuntimeScript(): string | null {
  const runtimeDir = findRuntimeDir()
  if (!runtimeDir) return null
  const extension = existsSync(join(runtimeDir, 'index.ts')) ? '.ts' : '.js'
  const modules = ['marked-renderer', 'protocol-console', 'sidebar-tree', 'code-block-toolbar', 'page-nav', 'search-modal', 'index']
  const chunks: string[] = []
  for (const moduleName of modules) {
    const path = join(runtimeDir, `${moduleName}${extension}`)
    if (!existsSync(path)) return null
    const source = readFileSync(path, 'utf8')
    const js = extension === '.ts' ? transpileRuntimeSource(source, path) : source
    chunks.push(stripModuleSyntax(js))
  }
  return `(function () {
${chunks.join('\n')}
})();`
}

function findRuntimeDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', 'runtime'),
    join(here, '..', '..', '..', 'dist', 'docs', 'ui', 'runtime'),
    join(here, '..', '..', '..', '..', 'dist', 'docs', 'ui', 'runtime'),
    join(here, '..', '..', '..', 'src', 'docs', 'ui', 'runtime'),
    join(here, '..', '..', '..', '..', 'src', 'docs', 'ui', 'runtime'),
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.ts')) || existsSync(join(candidate, 'index.js'))) return candidate
  }
  return null
}

function transpileRuntimeSource(source: string, fileName: string): string {
  try {
    const typescript = require('typescript') as typeof import('typescript')
    return typescript.transpileModule(source, {
      fileName,
      compilerOptions: {
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.ES2022,
      },
    }).outputText
  } catch {
    return ''
  }
}

function stripModuleSyntax(source: string): string {
  return source
    .replace(/^import\s+[^;]+;\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(function|const|let|var|class)\s+/gm, '$1 ')
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trim()
}

function escapeScriptBody(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/**
 * Generate client-side JavaScript with inline data and runtime.
 */
export function generateClientScript(
  escapedSpec: string,
  escapedTagGroups: string,
  escapedHero: string,
  escapedSidebar: string,
  escapedIntroduction: string,
  escapedDocsPages: string,
  escapedDocsAliases: string,
  escapedSearchIndex: string,
  escapedDocsSidebar: string,
  escapedDocsAssetBasePath: string,
  escapedFooter: string,
  escapedToc: string,
  escapedMarkdown: string,
  escapedDocsRepo: string = 'null',
  escapedBreadcrumbs?: string,
  escapedPageNav: string = '{"enabled":true,"hide":[]}'
): string {
  return `${generateClientDataScript(
    escapedSpec,
    escapedTagGroups,
    escapedHero,
    escapedSidebar,
    escapedIntroduction,
    escapedDocsPages,
    escapedDocsAliases,
    escapedSearchIndex,
    escapedDocsSidebar,
    escapedDocsAssetBasePath,
    escapedFooter,
    escapedToc,
    escapedMarkdown,
    escapedDocsRepo,
    escapedBreadcrumbs,
    escapedPageNav
  )}
${generateClientRuntimeScript()}`
}
