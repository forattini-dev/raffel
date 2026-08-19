import type { UIThemeConfig, UIThemePalette } from '../types.js'
import { sanitizeCssTokenValue } from '../utils.js'

function paletteDeclarations(palette: UIThemePalette | undefined): string {
  if (!palette) return ''
  const colors = palette.colors ?? {}
  const typography = palette.typography ?? {}
  const values: Array<[string, string | undefined]> = [
    ['--primary-color', colors.primary], ['--primary-hover', colors.primaryHover],
    ['--bg-color', colors.background], ['--bg-primary', colors.backgroundPrimary ?? colors.background],
    ['--bg-secondary', colors.backgroundSecondary], ['--bg-tertiary', colors.backgroundTertiary],
    ['--surface-color', colors.surface], ['--text-color', colors.text],
    ['--text-primary', colors.textPrimary ?? colors.text], ['--text-secondary', colors.textSecondary],
    ['--text-muted', colors.textMuted], ['--border-color', colors.border], ['--border', colors.border],
    ['--accent', colors.accent], ['--code-bg', colors.codeBackground],
    ['--sidebar-bg', colors.sidebarBackground], ['--hover-bg', colors.hoverBackground],
    ['--code-panel-bg', colors.codePanelBackground], ['--code-panel-text', colors.codePanelText],
    ['--code-panel-header', colors.codePanelHeader], ['--method-get-color', colors.methodGet],
    ['--method-post-color', colors.methodPost], ['--method-put-color', colors.methodPut],
    ['--method-patch-color', colors.methodPatch], ['--method-delete-color', colors.methodDelete],
    ['--font-family', typography.fontFamily], ['--font-size-body', typography.bodySize],
    ['--font-size-small', typography.smallSize], ['--font-size-xs', typography.extraSmallSize],
    ['--font-size-h1', typography.h1Size], ['--font-size-h2', typography.h2Size],
    ['--font-size-h3', typography.h3Size], ['--font-size-h4', typography.h4Size],
    ['--font-size-h5', typography.h5Size], ['--font-size-h6', typography.h6Size],
    ['--font-size-code', typography.codeSize], ['--line-height-body', typography.lineHeight],
    ['--line-height-tight', typography.tightLineHeight],
  ]
  return values
    .map(([name, value]) => [name, sanitizeCssTokenValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .map(([name, value]) => `      ${name}: ${value};`)
    .join('\n')
}

function customThemeOverrides(theme: UIThemeConfig | undefined): string {
  if (!theme) return ''
  const light = paletteDeclarations(theme.light)
  const dark = paletteDeclarations(theme.dark)
  return `
    ${light ? `:root, [data-theme="light"] {\n${light}\n    }` : ''}
    ${dark ? `[data-theme="dark"] {\n${dark}\n    }\n    @media (prefers-color-scheme: dark) {\n      [data-theme="auto"] {\n${dark}\n      }\n    }` : ''}
  `
}

export function generateShellStyles(
  primaryColor: string,
  primaryHover: string,
  heroBackgroundCSS: string,
  theme?: UIThemeConfig,
): string {
  return `
    :root {
      --primary-color: ${primaryColor};
      --primary-hover: ${primaryHover};
      --bg-color: #ffffff;
      --bg-primary: #ffffff;
      --bg-secondary: #f8fafc;
      --bg-tertiary: #f1f5f9;
      --surface-color: #f8fafc;
      --text-color: #1f2937;
      --text-primary: #1f2937;
      --text-secondary: #475569;
      --text-muted: #6b7280;
      --border-color: #d4d8df;
      --border: #d4d8df;
      --accent: ${primaryColor};
      --code-bg: #f3f4f6;
      --sidebar-bg: #f9fafb;
      --hover-bg: rgba(99, 102, 241, 0.08);
      --code-panel-bg: #263238;
      --code-panel-text: #cfd8dc;
      --code-panel-header: #37474f;
      --method-get-color: #10b981;
      --method-post-color: #3b82f6;
      --method-put-color: #f59e0b;
      --method-patch-color: #8b5cf6;
      --method-delete-color: #ef4444;
      --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;

      /* Dense documentation type scale. Component styles inherit these
         tokens so large references keep more context inside the viewport. */
      --font-size-body: 12px;
      --font-size-small: 11px;
      --font-size-xs: 9px;
      --font-size-h1: 24px;
      --font-size-h2: 19px;
      --font-size-h3: 16px;
      --font-size-h4: 14px;
      --font-size-h5: 12px;
      --font-size-h6: 11px;
      --font-size-code: 10px;
      --line-height-body: 1.45;
      --line-height-tight: 1.25;
    }

    [data-theme="dark"] {
      --bg-color: #0f172a;
      --bg-primary: #0f172a;
      --bg-secondary: #111c33;
      --bg-tertiary: #1e293b;
      --surface-color: #111c33;
      --text-color: #f1f5f9;
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #94a3b8;
      --border-color: #475569;
      --border: #475569;
      --accent: #a5b4fc;
      --code-bg: #1e293b;
      --sidebar-bg: #1e293b;
      --hover-bg: rgba(99, 102, 241, 0.15);
    }

    /*
     * theme: 'custom' — user-controlled palette via the --raffel-* token set.
     *
     * Fallbacks here are the LIGHT defaults. They only kick in when the user
     * sets theme: 'custom' and does NOT define the corresponding --raffel-*
     * token in their customCss. The matching prefers-color-scheme: dark
     * block below mirrors theme: 'auto' so a dark-mode visitor never lands
     * on a half-styled light surface; together they make 'custom' default
     * to system preference until the consumer takes full control.
     */
    [data-theme="custom"] {
      --primary-color: var(--raffel-primary-color, ${primaryColor});
      --primary-hover: var(--raffel-primary-hover, ${primaryHover});
      --bg-color: var(--raffel-bg-color, #ffffff);
      --bg-primary: var(--raffel-bg-primary, var(--raffel-bg-color, #ffffff));
      --bg-secondary: var(--raffel-bg-secondary, #f8fafc);
      --bg-tertiary: var(--raffel-bg-tertiary, #f1f5f9);
      --surface-color: var(--raffel-surface-color, #f8fafc);
      --text-color: var(--raffel-text-color, #1f2937);
      --text-primary: var(--raffel-text-primary, var(--raffel-text-color, #1f2937));
      --text-secondary: var(--raffel-text-secondary, #475569);
      --text-muted: var(--raffel-text-muted, #6b7280);
      --border-color: var(--raffel-border-color, #e5e7eb);
      --border: var(--raffel-border, var(--raffel-border-color, #e5e7eb));
      --accent: var(--raffel-accent, var(--raffel-primary-color, ${primaryColor}));
      --code-bg: var(--raffel-code-bg, #f3f4f6);
      --sidebar-bg: var(--raffel-sidebar-bg, #f9fafb);
      --hover-bg: var(--raffel-hover-bg, rgba(99, 102, 241, 0.08));
      --code-panel-bg: var(--raffel-code-panel-bg, #263238);
      --code-panel-text: var(--raffel-code-panel-text, #cfd8dc);
      --code-panel-header: var(--raffel-code-panel-header, #37474f);
    }

    @media (prefers-color-scheme: dark) {
      [data-theme="custom"] {
        --bg-color: var(--raffel-bg-color, #0f172a);
        --bg-primary: var(--raffel-bg-primary, var(--raffel-bg-color, #0f172a));
        --bg-secondary: var(--raffel-bg-secondary, #111c33);
        --bg-tertiary: var(--raffel-bg-tertiary, #1e293b);
        --surface-color: var(--raffel-surface-color, #111c33);
        --text-color: var(--raffel-text-color, #f1f5f9);
        --text-primary: var(--raffel-text-primary, var(--raffel-text-color, #f1f5f9));
        --text-secondary: var(--raffel-text-secondary, #cbd5e1);
        --text-muted: var(--raffel-text-muted, #94a3b8);
        --border-color: var(--raffel-border-color, #475569);
        --border: var(--raffel-border, var(--raffel-border-color, #475569));
        --accent: var(--raffel-accent, var(--raffel-primary-color, ${primaryColor}));
        --code-bg: var(--raffel-code-bg, #1e293b);
        --sidebar-bg: var(--raffel-sidebar-bg, #1e293b);
        --hover-bg: var(--raffel-hover-bg, rgba(99, 102, 241, 0.15));
      }
    }

    @media (prefers-color-scheme: dark) {
      [data-theme="auto"] {
        --bg-color: #0f172a;
        --bg-primary: #0f172a;
        --bg-secondary: #111c33;
        --bg-tertiary: #1e293b;
        --surface-color: #111c33;
        --text-color: #f1f5f9;
        --text-primary: #f8fafc;
        --text-secondary: #cbd5e1;
        --text-muted: #94a3b8;
        --border-color: #475569;
        --border: #475569;
        --accent: #a5b4fc;
        --code-bg: #1e293b;
        --sidebar-bg: #1e293b;
        --hover-bg: rgba(99, 102, 241, 0.15);
      }
    }

    ${customThemeOverrides(theme)}

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-family);
      background: var(--bg-color);
      color: var(--text-color);
      font-size: var(--font-size-body);
      line-height: var(--line-height-body);
    }

    code,
    pre {
      font-size: var(--font-size-code);
    }

    /* ========== TOP NAVIGATION ========== */
    .top-nav {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 20px;
      min-height: 48px;
      padding: 0 20px;
      border-bottom: 1px solid var(--border-color);
      background: color-mix(in srgb, var(--bg-color) 92%, transparent);
      backdrop-filter: blur(10px);
    }

    /* When the navbar lives INSIDE the hero, float it top-right. No
       chrome — the hero is the surface, the nav rides on top of it. */
    .hero .top-nav {
      position: absolute;
      top: 16px;
      right: 24px;
      left: auto;
      width: auto;
      min-height: 0;
      padding: 0;
      gap: 18px;
      background: transparent;
      border: 0;
      backdrop-filter: none;
      z-index: 5;
    }

    .hero .top-nav-brand {
      display: none;
    }

    .top-nav-brand,
    .top-nav-link,
    .top-nav-menu summary {
      color: var(--text-color);
      text-decoration: none;
      font-size: var(--font-size-body);
      font-weight: 500;
      white-space: nowrap;
    }

    .top-nav-brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-right: auto;
      font-weight: 650;
    }

    .top-nav-brand img {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }

    .top-nav-links {
      display: flex;
      align-items: center;
      gap: 18px;
    }

    .top-nav-link:hover,
    .top-nav-menu summary:hover {
      color: var(--primary-color);
    }

    .top-nav-menu {
      position: relative;
    }

    .top-nav-menu summary {
      list-style: none;
      cursor: pointer;
    }

    .top-nav-menu summary::-webkit-details-marker {
      display: none;
    }

    .top-nav-menu summary::after {
      content: '▾';
      margin-left: 6px;
      color: var(--text-muted);
      font-size: 10px;
    }

    .top-nav-submenu {
      position: absolute;
      top: calc(100% + 12px);
      right: 0;
      min-width: 180px;
      display: grid;
      gap: 4px;
      padding: 8px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-color);
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
    }

    .top-nav-submenu .top-nav-link,
    .top-nav-submenu .top-nav-menu summary {
      display: block;
      padding: 8px 10px;
      border-radius: 6px;
    }

    .top-nav-submenu .top-nav-link:hover,
    .top-nav-submenu .top-nav-menu summary:hover {
      background: var(--hover-bg);
    }

    .top-nav-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .docs-state-summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: min(44vw, 420px);
      overflow: hidden;
    }

    .docs-state-summary[hidden] {
      display: none;
    }

    .docs-state-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      height: 22px;
      padding: 0 6px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: color-mix(in srgb, var(--surface-color) 84%, transparent);
      color: var(--text-secondary);
      font-size: var(--font-size-xs);
      font-weight: 600;
      line-height: 1;
      white-space: nowrap;
    }

    .docs-state-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--text-muted);
      flex: 0 0 auto;
    }

    .docs-state-pill[data-state="fresh"] .docs-state-dot {
      background: var(--primary-color);
    }

    .docs-state-pill[data-state="stale"] .docs-state-dot {
      background: #b45309;
    }

    .docs-state-pill[data-state="off"] .docs-state-dot,
    .docs-state-pill[data-state="unknown"] .docs-state-dot {
      background: var(--text-muted);
    }

    .docs-state-label {
      color: var(--text-primary);
    }

    .docs-state-meta {
      max-width: 92px;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--text-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 500;
    }

    .docs-state-pill[data-updated="true"] {
      border-color: var(--primary-color);
      color: var(--text-primary);
    }

    @media (max-width: 760px) {
      .docs-state-summary {
        max-width: 38vw;
      }

      .docs-state-pill {
        padding: 0 6px;
      }

      .docs-state-meta {
        display: none;
      }
    }

    /* ========== HERO SECTION — editorial-technical ========== */
    /* Distilled (#111 #3): no gradient default, no pill buttons, no shadow
       stacking, no glassmorphism, no checkmark bullets. Full-viewport
       height kept (a hero should occupy the viewport) but content is
       left-flush + vertically centred — editorial, not centered-marketing. */
    .hero {
      ${heroBackgroundCSS}
      min-height: 100vh;
      display: flex;
      align-items: center;
      padding: 64px 40px;
      border-bottom: 1px solid var(--border-color);
      position: relative;
    }

    .hero-content {
      max-width: 960px;
      width: 100%;
      margin: 0;
      padding: 0 0 0 40px;
    }

    .hero-logo {
      height: 32px;
      margin-bottom: 24px;
      display: block;
    }

    .hero-title {
      font-size: var(--font-size-h1);
      font-weight: 700;
      margin: 0 0 8px;
      letter-spacing: -0.01em;
      color: var(--text-primary);
      line-height: var(--line-height-tight);
    }

    .hero-version {
      display: inline-block;
      font-size: var(--font-size-small);
      font-weight: 500;
      color: var(--text-muted);
      margin-left: 12px;
      vertical-align: middle;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .hero-tagline {
      font-size: var(--font-size-h4);
      color: var(--text-secondary);
      margin: 0 0 24px;
      max-width: 60ch;
      line-height: 1.45;
      font-weight: 400;
    }

    .hero-features {
      list-style: none;
      padding: 0;
      margin: 0 0 28px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      max-width: 70ch;
      font-size: var(--font-size-small);
      color: var(--text-secondary);
    }

    .hero-features li {
      display: inline;
    }

    .hero-features li:not(:last-child)::after {
      content: ' \\00b7';
      margin-left: 10px;
      color: var(--text-muted);
    }

    .hero-buttons {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      margin: 0 0 0;
      font-size: var(--font-size-body);
    }

    .hero-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      border: 0;
      background: transparent;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      color: var(--text-secondary);
      border-bottom: 1px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }

    .hero-btn::after {
      content: '\\2192';
      font-weight: 400;
    }

    .hero-btn-primary {
      color: var(--primary-color);
    }

    .hero-btn:hover {
      color: var(--text-primary);
      border-color: currentColor;
    }

    .hero-btn-primary:hover {
      color: var(--primary-hover);
    }

    .hero-quicklinks {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0;
      max-width: 960px;
      margin: 32px 0 0;
      border-top: 1px solid var(--border-color);
    }

    .hero-quicklink {
      padding: 20px 24px 20px 0;
      text-decoration: none;
      color: var(--text-secondary);
      border-right: 1px solid var(--border-color);
      transition: color 0.15s;
    }

    .hero-quicklink:last-child {
      border-right: 0;
    }

    .hero-quicklink:hover {
      color: var(--text-primary);
    }

    .hero-quicklink-icon {
      font-size: var(--font-size-h4);
      margin-bottom: 8px;
      display: block;
      color: var(--primary-color);
    }

    .hero-quicklink-title {
      font-size: var(--font-size-body);
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text-primary);
    }

    .hero-quicklink-desc {
      font-size: var(--font-size-small);
      color: var(--text-muted);
      line-height: 1.4;
    }

    /* GitHub Corner */
    .github-corner {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 10;
    }
    .github-corner svg {
      fill: white;
      color: var(--primary-color);
      width: 80px;
      height: 80px;
    }
    .github-corner:hover .octo-arm {
      animation: octocat-wave 560ms ease-in-out;
    }
    @keyframes octocat-wave {
      0%, 100% { transform: rotate(0); }
      20%, 60% { transform: rotate(-25deg); }
      40%, 80% { transform: rotate(10deg); }
    }

    /* ========== INTRODUCTION SECTION ========== */
    /* Rendered inside #mainContent on the root view, right after the overview
       and before authentication/endpoints. Typography comes from
       .markdown-content; only the surrounding spacing is set here. */
    .docs-introduction {
      margin: 32px 0;
    }

`
}
