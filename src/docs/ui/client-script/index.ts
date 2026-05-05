/**
 * Docs UI client script assembly.
 *
 * The generated string is embedded into the standalone documentation HTML.
 */

import { markdownClientScript } from './markdown.js'
import { protocolClientScript } from './protocols.js'
import { navigationClientScript } from './navigation.js'
import { contentClientScript } from './content.js'
import { tryItClientScript } from './try-it.js'
import { cardsAndCodeClientScript } from './cards-and-code.js'
import { schemaRenderingClientScript } from './schema-rendering.js'
import { endpointDetailsClientScript } from './endpoint-details.js'
import { initClientScript } from './init.js'

/**
 * Generate client-side JavaScript.
 */
export function generateClientScript(
  escapedSpec: string,
  escapedTagGroups: string,
  escapedHero: string,
  escapedSidebar: string,
  escapedIntroduction: string,
  escapedDocsPages: string,
  escapedFooter: string,
  escapedToc: string
): string {
  return `
    // Trusted data from server
    const spec = ${escapedSpec};
    const tagGroups = ${escapedTagGroups};
    const heroConfig = ${escapedHero};
    const sidebarConfig = ${escapedSidebar};
    const introductionMarkdown = ${escapedIntroduction};
    const docsPages = ${escapedDocsPages};
    const footerMarkdown = ${escapedFooter};
    const tocConfig = ${escapedToc};
${[
      markdownClientScript,
      protocolClientScript,
      navigationClientScript,
      contentClientScript,
      tryItClientScript,
      cardsAndCodeClientScript,
      schemaRenderingClientScript,
      endpointDetailsClientScript,
      initClientScript
    ].join('')}`
}
