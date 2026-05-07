/**
 * USD Documentation UI Styles
 *
 * Generates CSS for the USD documentation UI.
 */

import { contentStyles } from './style-sections/content.js'
import { editLinkStyles } from './style-sections/edit-link.js'
import { layoutNavigationStyles } from './style-sections/layout-navigation.js'
import { schemaCodeStyles } from './style-sections/schema-code.js'
import { generateShellStyles } from './style-sections/shell.js'
import { tryItStyles } from './style-sections/try-it.js'
import { adjustColor } from './utils.js'

export interface StylesConfig {
  primaryColor: string
  heroBackgroundCSS: string
}

/**
 * Generate CSS styles for the USD documentation UI
 */
export function generateStyles(config: StylesConfig): string {
  const { primaryColor, heroBackgroundCSS } = config

  return [
    generateShellStyles(primaryColor, adjustColor(primaryColor, -15), heroBackgroundCSS),
    layoutNavigationStyles,
    contentStyles,
    editLinkStyles,
    schemaCodeStyles,
    tryItStyles,
  ].join('')
}
