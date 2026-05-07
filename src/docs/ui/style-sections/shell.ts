export function generateShellStyles(
  primaryColor: string,
  primaryHover: string,
  heroBackgroundCSS: string
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

      /* Type scale (#111 #3) — body 16 / small 14 / xs 12, headings descending */
      --font-size-body: 16px;
      --font-size-small: 14px;
      --font-size-xs: 12px;
      --font-size-h1: 36px;
      --font-size-h2: 28px;
      --font-size-h3: 22px;
      --font-size-h4: 18px;
      --font-size-h5: 16px;
      --font-size-h6: 14px;
      --line-height-body: 1.6;
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

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--bg-color);
      color: var(--text-color);
      line-height: 1.6;
    }

    /* ========== TOP NAVIGATION ========== */
    .top-nav {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 24px;
      min-height: 56px;
      padding: 0 24px;
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
      font-size: 14px;
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
      font-size: 11px;
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
    .introduction {
      background: var(--bg-color);
      padding: 80px 40px;
      max-width: 100%;
    }

    .introduction-content {
      max-width: 900px;
      margin: 0 auto;
      font-size: 1.1em;
      line-height: 1.8;
    }

    .introduction-content h1 {
      font-size: 2.5em;
      margin-bottom: 24px;
      color: var(--text-color);
      font-weight: 700;
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 16px;
    }

    .introduction-content h2 {
      font-size: 1.8em;
      margin: 48px 0 16px;
      color: var(--text-color);
      font-weight: 600;
    }

    .introduction-content h3 {
      font-size: 1.4em;
      margin: 32px 0 12px;
      color: var(--text-color);
      font-weight: 600;
    }

    .introduction-content p {
      margin-bottom: 16px;
      color: var(--text-muted);
    }

    .introduction-content ul,
    .introduction-content ol {
      margin: 16px 0;
      padding-left: 24px;
    }

    .introduction-content li {
      margin-bottom: 8px;
      color: var(--text-muted);
    }

    .introduction-content pre {
      background: var(--code-bg);
      border-radius: 8px;
      padding: 20px;
      overflow-x: auto;
      margin: 24px 0;
    }

    .introduction-content code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.9em;
    }

    .introduction-content p code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .introduction-content blockquote {
      border-left: 4px solid var(--primary-color);
      padding: 16px 24px;
      margin: 24px 0;
      background: var(--hover-bg);
      border-radius: 0 8px 8px 0;
    }

    .introduction-content blockquote p {
      margin: 0;
    }

    .introduction-content a {
      color: var(--primary-color);
      text-decoration: none;
    }

    .introduction-content a:hover {
      text-decoration: underline;
    }

    .introduction-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
    }

    .introduction-content th,
    .introduction-content td {
      border: 1px solid var(--border-color);
      padding: 12px 16px;
      text-align: left;
    }

    .introduction-content th {
      background: var(--code-bg);
      font-weight: 600;
    }

    .introduction-content hr {
      border: none;
      border-top: 1px solid var(--border-color);
      margin: 48px 0;
    }

`
}
