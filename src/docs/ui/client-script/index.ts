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
  escapedSearchIndex: string,
  escapedFooter: string,
  escapedToc: string
): string {
  return `
    window.__RAFFEL_DOCS__ = {
      spec: ${escapedSpec},
      tagGroups: ${escapedTagGroups},
      heroConfig: ${escapedHero},
      sidebarConfig: ${escapedSidebar},
      introductionMarkdown: ${escapedIntroduction},
      docsPages: ${escapedDocsPages},
      searchIndex: ${escapedSearchIndex},
      footerMarkdown: ${escapedFooter},
      tocConfig: ${escapedToc}
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
    const searchIndex = docsData.searchIndex || [];
    const footerMarkdown = docsData.footerMarkdown || null;
    const tocConfig = docsData.tocConfig || {};
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
  escapedSearchIndex: string,
  escapedFooter: string,
  escapedToc: string
): string {
  return `${generateClientDataScript(
    escapedSpec,
    escapedTagGroups,
    escapedHero,
    escapedSidebar,
    escapedIntroduction,
    escapedDocsPages,
    escapedSearchIndex,
    escapedFooter,
    escapedToc
  )}
${generateClientRuntimeScript()}`
}
