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
import { projectionDiagnosticStyles } from './style-sections/projection-diagnostics.js'
import { adjustColor } from './utils.js'
import type { UIThemeConfig } from './types.js'

export interface StylesConfig {
  primaryColor: string
  heroBackgroundCSS: string
  theme?: UIThemeConfig
}

/**
 * Generate CSS styles for the USD documentation UI
 */
export function generateStyles(config: StylesConfig): string {
  const { primaryColor, heroBackgroundCSS, theme } = config

  return [
    generateShellStyles(primaryColor, adjustColor(primaryColor, -15), heroBackgroundCSS, theme),
    layoutNavigationStyles,
    contentStyles,
    editLinkStyles,
    schemaCodeStyles,
    tryItStyles,
    projectionDiagnosticStyles,
  ].join('')
}
