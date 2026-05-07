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
import { markdownClientScript } from './markdown.js'
import { protocolClientScript } from './protocols.js'
import { docsPagesClientScript } from './docs-pages.js'
import { navigationClientScript } from './navigation.js'
import { contentClientScript } from './content.js'
import { tryItClientScript } from './try-it.js'
import { cardsAndCodeClientScript } from './cards-and-code.js'
import { schemaRenderingClientScript } from './schema-rendering.js'
import { endpointDetailsClientScript } from './endpoint-details.js'
import { initClientScript } from './init.js'

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
  escapedMarkdown: string
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
      markdownConfig: ${escapedMarkdown}
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
  return generateLegacyClientRuntimeScript()
}

export function generateInlineRuntimeDependencyScripts(): string {
  return [
    inlineDependencyScript('marked', readOptionalDependency('marked/lib/marked.umd.js')),
    inlineDependencyScript('prism', readOptionalDependency('prismjs/prism.js')),
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
  const extension = existsSync(join(runtimeDir, 'index.js')) ? '.js' : '.ts'
  const modules = ['marked-renderer', 'protocol-console', 'sidebar-tree', 'search-modal', 'index']
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
  return candidates.find(candidate => existsSync(join(candidate, 'index.js')))
    ?? candidates.find(candidate => existsSync(join(candidate, 'index.ts')))
    ?? null
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

function generateLegacyClientRuntimeScript(): string {
  return `
    (function () {
    const docsData = window.__RAFFEL_DOCS__ || {};
    const spec = docsData.spec || { info: { title: 'API', version: '1.0.0' }, paths: {} };
    const tagGroups = docsData.tagGroups || [];
    const heroConfig = docsData.heroConfig || null;
    const sidebarConfig = docsData.sidebarConfig || {};
    const introductionMarkdown = docsData.introductionMarkdown || null;
    const docsPages = docsData.docsPages || [];
    const docsAliases = docsData.docsAliases || {};
    const searchIndex = docsData.searchIndex || [];
    const docsSidebar = Array.isArray(docsData.docsSidebar) ? docsData.docsSidebar : [];
    const docsAssetBasePath = docsData.docsAssetBasePath || '';
    const footerMarkdown = docsData.footerMarkdown || null;
    const tocConfig = docsData.tocConfig || {};
    const markdownConfig = docsData.markdownConfig || {};
    const docsPlugins = [];
    function getDocsRuntimeState() {
      return { activePagePath, activeHeadingId, activeProtocol, searchQuery };
    }
    function getPluginContext(extra = {}) {
      return Object.assign({}, getDocsRuntimeState(), extra);
    }
    function registerDocsPlugin(plugin) {
      if (!plugin) return;
      if (typeof plugin === 'function') {
        plugin({ use: registerDocsPlugin, getState: getDocsRuntimeState });
        return;
      }
      if (typeof plugin === 'object') docsPlugins.push(plugin);
    }
    function installDocsPluginApi() {
      (window.__RAFFEL_DOCS_PLUGINS__ || []).forEach(registerDocsPlugin);
      window.RaffelDocs = Object.assign({}, window.RaffelDocs || {}, {
        apiVersion: 1,
        use: registerDocsPlugin,
        plugins: docsPlugins,
        getState: getDocsRuntimeState
      });
    }
    function applyStringHook(hookName, value, context) {
      return docsPlugins.reduce((current, plugin) => {
        const next = plugin[hookName] ? plugin[hookName](current, context) : undefined;
        return typeof next === 'string' ? next : current;
      }, value);
    }
    function runVoidHook(hookName, context) {
      docsPlugins.forEach(plugin => plugin[hookName]?.(context));
    }
    function applySearchResultsHook(results, context) {
      return docsPlugins.reduce((current, plugin) => {
        const next = plugin.onSearchResults ? plugin.onSearchResults(current, context) : undefined;
        return Array.isArray(next) ? next : current;
      }, results);
    }
    function unmountDocsComponents(root = document) {
      root?.querySelectorAll?.('[data-raffel-component-mounted="true"]').forEach(target => {
        docsPlugins.forEach(plugin => plugin.unmountComponent?.(target, getPluginContext({
          pagePath: target.getAttribute?.('data-page-path') || activePagePath
        })));
        delete target.dataset.raffelComponentMounted;
      });
    }
${[
      markdownClientScript,
      protocolClientScript,
      docsPagesClientScript,
      navigationClientScript,
      contentClientScript,
      tryItClientScript,
      cardsAndCodeClientScript,
      schemaRenderingClientScript,
      endpointDetailsClientScript,
      initClientScript
    ].join('')}
    })();
`
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
  escapedMarkdown: string
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
    escapedMarkdown
  )}
${generateClientRuntimeScript()}`
}
