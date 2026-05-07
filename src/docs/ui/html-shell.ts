import type { USDDocumentation } from '../../usd/spec/types.js'
import type { HeroConfig, NavItem, UIConfig } from './types.js'
import { escapeHtml } from './utils.js'

/**
 * Merge USD documentation config with UI config. UI config takes precedence.
 */
export function mergeHeroConfig(
  usdDocumentation: USDDocumentation | undefined,
  uiHero: HeroConfig | undefined
): HeroConfig | undefined {
  const usdHero = usdDocumentation?.hero
  if (!usdHero && !uiHero) return undefined

  return {
    title: uiHero?.title ?? usdHero?.title,
    version: uiHero?.version ?? usdHero?.version,
    tagline: uiHero?.tagline ?? usdHero?.tagline,
    features: uiHero?.features ?? usdHero?.features,
    background: uiHero?.background ?? usdHero?.background,
    backgroundImage: uiHero?.backgroundImage ?? usdHero?.backgroundImage,
    backgroundColor: uiHero?.backgroundColor ?? usdHero?.backgroundColor,
    buttons: uiHero?.buttons ?? usdHero?.buttons,
    quickLinks: uiHero?.quickLinks ?? usdHero?.quickLinks,
    github: uiHero?.github ?? usdHero?.github,
  }
}

/**
 * Generate a skip navigation link.
 */
export function generateSkipLink(skipLink: UIConfig['skipLink']): string {
  if (skipLink === false) return ''
  const label = typeof skipLink === 'string' ? skipLink : 'Skip to main content'
  return `<a class="skip-link" href="#mainContent">${escapeHtml(label)}</a>`
}

/**
 * Generate introduction section HTML. Markdown is rendered by the client script.
 */
export function generateIntroductionSection(introduction: string | undefined): string {
  if (!introduction) return ''

  return `
  <section class="introduction" id="introduction">
    <div class="introduction-content" id="introductionContent">
      <!-- Markdown will be rendered by client-side script -->
    </div>
  </section>
  `
}

/**
 * Generate GitHub corner SVG (file-backed Markdown).
 */
function generateGitHubCorner(url: string): string {
  return `
    <a href="${escapeHtml(url)}" target="_blank" class="github-corner" aria-label="View source on GitHub">
      <svg viewBox="0 0 250 250" aria-hidden="true">
        <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
        <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path>
        <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path>
      </svg>
    </a>
  `
}

/**
 * Generate hero section HTML.
 */
export function generateHeroSection(
  hero: UIConfig['hero'],
  logo: string | undefined,
  title: string,
  version?: string,
  topNavHtml?: string
): string {
  if (!hero) return ''

  const versionHtml = hero.version || version
    ? `<span class="hero-version">${escapeHtml(hero.version || version || '')}</span>`
    : ''

  const featuresHtml = hero.features && hero.features.length > 0
    ? `<ul class="hero-features">
        ${hero.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}
      </ul>`
    : ''

  const buttonsHtml = hero.buttons && hero.buttons.length > 0
    ? `<div class="hero-buttons">
        ${hero.buttons.map(btn => `
          <a href="${escapeHtml(btn.href || '#docs')}" class="hero-btn ${btn.primary ? 'hero-btn-primary' : 'hero-btn-secondary'}">
            ${escapeHtml(btn.text)}
          </a>
        `).join('')}
      </div>`
    : ''

  const quickLinksHtml = hero.quickLinks && hero.quickLinks.length > 0
    ? `<div class="hero-quicklinks">
        ${hero.quickLinks.map(link => `
          <a href="${escapeHtml(link.href)}" class="hero-quicklink">
            ${link.icon ? `<div class="hero-quicklink-icon">${escapeHtml(link.icon)}</div>` : ''}
            <div class="hero-quicklink-title">${escapeHtml(link.title)}</div>
            ${link.description ? `<div class="hero-quicklink-desc">${escapeHtml(link.description)}</div>` : ''}
          </a>
        `).join('')}
      </div>`
    : ''

  const githubHtml = hero.github ? generateGitHubCorner(hero.github) : ''

  return `
  <header class="hero">
    ${githubHtml}
    ${topNavHtml ?? ''}
    <div class="hero-content">
      ${logo ? `<img class="hero-logo" src="${escapeHtml(logo)}" alt="Logo">` : ''}
      <h1 class="hero-title">${escapeHtml(hero.title || title)}${versionHtml}</h1>
      ${hero.tagline ? `<p class="hero-tagline">${escapeHtml(hero.tagline)}</p>` : ''}
      ${featuresHtml}
      ${buttonsHtml}
      ${quickLinksHtml}
    </div>
  </header>
  `
}

/**
 * Generate top navigation and runtime controls.
 */
export function generateTopNavigation(
  logo: string | undefined,
  title: string,
  navItems: NavItem[]
): string {
  const links = navItems.map(renderTopNavItem).join('')

  return `
  <nav class="top-nav" aria-label="Documentation navigation">
    <a class="top-nav-brand" href="#/">
      ${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}
      <span>${escapeHtml(title)}</span>
    </a>
    <div class="top-nav-links">${links}</div>
    <div class="top-nav-actions">
      <button type="button" class="icon-button" id="themeToggle" aria-label="Toggle theme">Theme</button>
    </div>
  </nav>
  `
}

function renderTopNavItem(item: NavItem): string {
  const children = item.children ?? []
  if (children.length > 0) {
    const childLinks = children.map(renderTopNavItem).join('')
    const fallbackHref = item.href ? ` data-href="${escapeHtml(item.href)}"` : ''
    return `<details class="top-nav-menu"${fallbackHref}><summary>${escapeHtml(item.title)}</summary><div class="top-nav-submenu">${childLinks}</div></details>`
  }

  const href = item.href ?? '#/'
  const target = item.external ? ' target="_blank" rel="noopener noreferrer"' : ''
  return `<a class="top-nav-link" href="${escapeHtml(href)}"${target}>${escapeHtml(item.title)}</a>`
}

/**
 * Generate app container HTML.
 */
export function generateAppContainer(
  logo: string | undefined,
  title: string,
  sidebar: UIConfig['sidebar'],
  footer: string | undefined
): string {
  const sidebarHidden = sidebar?.hide === true
  return `
  <div class="reading-progress" id="readingProgress"></div>
  <div class="app-container${sidebarHidden ? ' app-container-no-sidebar' : ''}" id="docs" data-sidebar-hidden="${sidebarHidden ? 'true' : 'false'}">
    <aside class="sidebar${sidebarHidden ? ' sidebar-hidden' : ''}"${sidebarHidden ? ' hidden' : ''}>
      <div class="sidebar-header">
        <div class="sidebar-logo">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="Logo">` : ''}
          <h1>${escapeHtml(title)}</h1>
        </div>
        ${sidebar?.search !== false ? `
        <div class="sidebar-search">
          <input type="text" id="searchInput" placeholder="Search endpoints...">
        </div>
        ` : ''}
      </div>
      <div class="protocol-tabs" id="protocolTabs"></div>
      <nav class="sidebar-nav" id="sidebarNav"></nav>
    </aside>
    <main class="main-shell">
      <div class="main" id="mainContent"></div>
      <aside class="toc" id="pageToc" aria-label="On this page"></aside>
    </main>
  </div>
  ${footer ? `<footer class="docs-footer" id="docsFooter"></footer>` : ''}
  <button type="button" class="back-to-top" id="backToTop" aria-label="Back to top">Top</button>
  `
}
