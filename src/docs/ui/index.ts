/**
 * USD Documentation UI
 *
 * Exports the main HTML builder for the documentation UI.
 */

export { generateUICSS, generateUIHTML, generateUIRuntimeJS } from './html-builder.js'
export { defaultEditLinkLabel, resolveEditLink } from './edit-link.js'
export type { DocsRepoConfig as EditLinkRepoConfig, ResolveEditLinkInput, ResolvedEditLink } from './edit-link.js'
export type * from './types.js'
