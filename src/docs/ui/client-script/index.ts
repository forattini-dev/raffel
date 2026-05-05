/**
 * Docs UI client script assembly.
 *
 * The generated string is embedded into the standalone documentation HTML.
 */

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
    const docsAssetBasePath = docsData.docsAssetBasePath || '';
    const footerMarkdown = docsData.footerMarkdown || null;
    const tocConfig = docsData.tocConfig || {};
    const markdownConfig = docsData.markdownConfig || {};
    const docsPlugins = [];
    function getDocsRuntimeState() {
      return { activePagePath, activeProtocol, searchQuery };
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
    escapedDocsAssetBasePath,
    escapedFooter,
    escapedToc,
    escapedMarkdown
  )}
${generateClientRuntimeScript()}`
}
