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
      --border-color: #e5e7eb;
      --border: #e5e7eb;
      --accent: ${primaryColor};
      --code-bg: #f3f4f6;
      --sidebar-bg: #f9fafb;
      --hover-bg: rgba(99, 102, 241, 0.08);
      --code-panel-bg: #263238;
      --code-panel-text: #cfd8dc;
      --code-panel-header: #37474f;
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
      --border-color: #334155;
      --border: #334155;
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
        --border-color: #334155;
        --border: #334155;
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

    /* ========== HERO SECTION (built-in) ========== */
    .hero {
      ${heroBackgroundCSS}
      color: white;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 60px 40px;
      text-align: center;
      position: relative;
    }

    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.15) 100%);
      pointer-events: none;
    }

    .hero-content {
      max-width: 800px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .hero-logo {
      height: 120px;
      margin-bottom: 32px;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.15));
    }

    .hero-title {
      font-size: 56px;
      font-weight: 700;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.15);
      letter-spacing: -0.02em;
    }

    .hero-version {
      display: inline-block;
      font-size: 14px;
      font-weight: 500;
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 100px;
      margin-left: 12px;
      vertical-align: middle;
      backdrop-filter: blur(4px);
    }

    .hero-tagline {
      font-size: 22px;
      opacity: 0.95;
      margin-bottom: 28px;
      max-width: 600px;
      margin-left: auto;
      margin-right: auto;
      line-height: 1.5;
      font-weight: 300;
    }

    .hero-features {
      list-style: none;
      padding: 0;
      margin: 0 auto 36px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
      justify-content: center;
      max-width: 600px;
    }

    .hero-features li {
      font-size: 16px;
      opacity: 0.9;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .hero-features li::before {
      content: '✓';
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      background: rgba(255,255,255,0.2);
      border-radius: 50%;
      font-size: 12px;
      font-weight: bold;
    }

    .hero-buttons {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 48px;
    }

    .hero-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 32px;
      border-radius: 100px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 2px solid rgba(255,255,255,0.8);
    }

    .hero-btn-primary {
      background: white;
      color: var(--primary-color);
      border-color: white;
      box-shadow: 0 4px 14px rgba(0,0,0,0.15);
    }

    .hero-btn-primary:hover {
      background: rgba(255,255,255,0.95);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    }

    .hero-btn-secondary {
      background: transparent;
      color: white;
    }

    .hero-btn-secondary:hover {
      background: rgba(255,255,255,0.15);
      transform: translateY(-2px);
    }

    .hero-quicklinks {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      max-width: 900px;
      margin: 0 auto;
    }

    .hero-quicklink {
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 24px;
      text-decoration: none;
      color: white;
      text-align: left;
      transition: all 0.25s ease;
      border: 1px solid rgba(255,255,255,0.15);
    }

    .hero-quicklink:hover {
      background: rgba(255,255,255,0.2);
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }

    .hero-quicklink-icon {
      font-size: 28px;
      margin-bottom: 12px;
    }

    .hero-quicklink-title {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .hero-quicklink-desc {
      font-size: 14px;
      opacity: 0.8;
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
