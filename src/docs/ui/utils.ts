/**
 * UI Utilities
 *
 * Helper functions for the USD documentation UI.
 */

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Escape JSON for embedding in script tag (prevents XSS)
 */
export function escapeJsonForScript(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

/**
 * Adjust color brightness
 * @param color - Hex color string (e.g., '#6366f1')
 * @param amount - Positive to lighten, negative to darken
 */
export function adjustColor(color: string, amount: number): string {
  const hex = color.replace('#', '')
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount))
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount))
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Generate hero background CSS based on configuration
 */
export function generateHeroBackgroundCSS(
  primaryColor: string,
  background?: 'gradient' | 'solid' | 'pattern' | 'image',
  backgroundImage?: string
): string {
  switch (background) {
    case 'gradient':
      return `background: linear-gradient(135deg, ${primaryColor} 0%, ${adjustColor(primaryColor, -30)} 100%);`
    case 'pattern':
      return `background: ${primaryColor}; background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");`
    case 'image':
      return backgroundImage
        ? `background: url("${backgroundImage}") center/cover no-repeat;`
        : `background: ${primaryColor};`
    default:
      return `background: ${primaryColor};`
  }
}
