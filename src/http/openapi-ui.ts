/**
 * OpenAPI Documentation UI Middleware
 *
 * Provides generic middleware helpers for serving OpenAPI documentation UIs:
 * - serveRedoc()    — serves ReDoc (https://redocly.com/redoc/)
 * - serveSwaggerUI() — serves Swagger UI (https://swagger.io/tools/swagger-ui/)
 * - mountOpenApiDocs() — convenience helper to mount both /openapi.json and /docs
 *
 * Completely framework-agnostic: works with any OpenAPI spec generator.
 * No external runtime dependencies (UIs loaded via CDN).
 *
 * @example
 * ```typescript
 * import { HttpApp } from 'raffel/http'
 * import { serveRedoc, serveSwaggerUI, mountOpenApiDocs } from 'raffel/http'
 *
 * const app = new HttpApp()
 *
 * // Option A: Mount both JSON spec + ReDoc UI in one call
 * mountOpenApiDocs(app, {
 *   spec: () => generateOpenApiSpec(),
 *   title: 'My API',
 * })
 *
 * // Option B: Individual middleware
 * app.get('/openapi.json', (c) => c.json(generateOpenApiSpec()))
 * app.get('/docs', serveRedoc({ specUrl: '/openapi.json', title: 'My API' }))
 * ```
 */

import type { HttpHandler, HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RedocOptions {
  /**
   * URL of the OpenAPI spec JSON.
   * Can be absolute or relative to the current origin.
   * @default '/openapi.json'
   */
  specUrl?: string

  /**
   * Page title shown in the browser tab.
   * @default 'API Documentation'
   */
  title?: string

  /**
   * Custom Content-Security-Policy header value.
   * If not provided, a permissive policy for CDN-hosted ReDoc is applied.
   */
  csp?: string | null

  /**
   * ReDoc CDN version to load.
   * @default 'latest'
   */
  version?: string

  /**
   * Additional HTML to inject into the <head> element.
   * Useful for custom fonts, analytics, etc.
   */
  head?: string

  /**
   * ReDoc configuration options passed as `redoc-config` JSON.
   * See https://redocly.com/docs/redoc/config/
   */
  config?: Record<string, unknown>
}

export interface SwaggerUIOptions {
  /**
   * URL of the OpenAPI spec JSON.
   * @default '/openapi.json'
   */
  specUrl?: string

  /**
   * Page title shown in the browser tab.
   * @default 'API Documentation'
   */
  title?: string

  /**
   * Custom Content-Security-Policy header value.
   * If not provided, a permissive policy for CDN-hosted Swagger UI is applied.
   */
  csp?: string | null

  /**
   * Swagger UI CDN version to load.
   * @default 'latest'
   */
  version?: string

  /**
   * OAuth2 redirect URL for Swagger UI.
   * @default '/docs/oauth2-redirect'
   */
  oauth2RedirectUrl?: string
}

export type DocsUI = 'redoc' | 'swagger'

export interface MountOpenApiDocsOptions {
  /**
   * Function that returns the OpenAPI spec object.
   * Called on every request to /openapi.json (consider caching in the function).
   */
  spec: () => Record<string, unknown>

  /**
   * Path where the OpenAPI JSON spec will be served.
   * @default '/openapi.json'
   */
  specPath?: string

  /**
   * Path where the documentation UI will be served.
   * @default '/docs'
   */
  docsPath?: string

  /**
   * Documentation UI to use.
   * @default 'redoc'
   */
  ui?: DocsUI

  /**
   * Page title for the docs UI.
   * @default 'API Documentation'
   */
  title?: string

  /**
   * Custom CSP header for the docs page.
   */
  csp?: string | null

  /**
   * ReDoc-specific options (when ui = 'redoc').
   */
  redoc?: Omit<RedocOptions, 'specUrl' | 'title' | 'csp'>

  /**
   * Swagger UI-specific options (when ui = 'swagger').
   */
  swagger?: Omit<SwaggerUIOptions, 'specUrl' | 'title' | 'csp'>
}

export interface HttpAppWithRoutes {
  get(path: string, handler: HttpHandler): unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// ReDoc
// ─────────────────────────────────────────────────────────────────────────────

const REDOC_CDN_BASE = 'https://cdn.redoc.ly'
const FONTS_CSS_CDN = 'https://fonts.googleapis.com'
const FONTS_GSTATIC_CDN = 'https://fonts.gstatic.com'

function buildRedocCsp(custom: string | null | undefined): string | null {
  if (custom !== undefined) return custom
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${REDOC_CDN_BASE}`,
    `script-src-elem 'self' 'unsafe-inline' ${REDOC_CDN_BASE}`,
    `style-src 'self' 'unsafe-inline' ${REDOC_CDN_BASE} ${FONTS_CSS_CDN}`,
    "img-src 'self' data: https:",
    `font-src 'self' ${FONTS_GSTATIC_CDN}`,
    "connect-src 'self'",
  ].join('; ')
}

function buildRedocHtml(options: RedocOptions): string {
  const {
    specUrl = '/openapi.json',
    title = 'API Documentation',
    version = 'latest',
    head = '',
    config,
  } = options

  const configAttr = config
    ? ` redoc-config='${JSON.stringify(config)}'`
    : ''

  const cdnUrl =
    version === 'latest'
      ? `${REDOC_CDN_BASE}/redoc/latest/bundles/redoc.standalone.js`
      : `${REDOC_CDN_BASE}/redoc/v${version}/bundles/redoc.standalone.js`

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${title}</title>`,
    '  <style>body { margin: 0; padding: 0; }</style>',
    head,
    '</head>',
    '<body>',
    `  <redoc spec-url="${specUrl}"${configAttr}></redoc>`,
    `  <script src="${cdnUrl}"></script>`,
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Create a handler that serves ReDoc documentation UI.
 *
 * @example
 * ```typescript
 * app.get('/docs', serveRedoc({ specUrl: '/openapi.json', title: 'My API' }))
 * ```
 */
export function serveRedoc(options: RedocOptions = {}): HttpHandler {
  const html = buildRedocHtml(options)
  const csp = buildRedocCsp(options.csp)

  return (c) => {
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=UTF-8',
    }
    if (csp) {
      headers['Content-Security-Policy'] = csp
    }
    return new Response(html, { status: 200, headers })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Swagger UI
// ─────────────────────────────────────────────────────────────────────────────

const SWAGGER_CDN_BASE = 'https://unpkg.com/swagger-ui-dist'

function buildSwaggerCsp(custom: string | null | undefined): string | null {
  if (custom !== undefined) return custom
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${SWAGGER_CDN_BASE}`,
    `script-src-elem 'self' 'unsafe-inline' ${SWAGGER_CDN_BASE}`,
    `style-src 'self' 'unsafe-inline' ${SWAGGER_CDN_BASE}`,
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join('; ')
}

function buildSwaggerHtml(options: SwaggerUIOptions): string {
  const {
    specUrl = '/openapi.json',
    title = 'API Documentation',
    version = 'latest',
    oauth2RedirectUrl,
  } = options

  const cdnBase = version === 'latest' ? SWAGGER_CDN_BASE : `https://unpkg.com/swagger-ui-dist@${version}`
  const oauth2Attr = oauth2RedirectUrl
    ? `\n          oauth2RedirectUrl: '${oauth2RedirectUrl}',`
    : ''

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `  <title>${title}</title>`,
    `  <link rel="stylesheet" href="${cdnBase}/swagger-ui.css">`,
    '  <style>body { margin: 0; padding: 0; }</style>',
    '</head>',
    '<body>',
    '  <div id="swagger-ui"></div>',
    `  <script src="${cdnBase}/swagger-ui-bundle.js"></script>`,
    `  <script src="${cdnBase}/swagger-ui-standalone-preset.js"></script>`,
    '  <script>',
    '    window.onload = function() {',
    '      window.ui = SwaggerUIBundle({',
    `        url: '${specUrl}',${oauth2Attr}`,
    "        dom_id: '#swagger-ui',",
    '        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],',
    "        layout: 'StandaloneLayout',",
    '        deepLinking: true,',
    '      })',
    '    }',
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n')
}

/**
 * Create a handler that serves Swagger UI documentation.
 *
 * @example
 * ```typescript
 * app.get('/docs', serveSwaggerUI({ specUrl: '/openapi.json', title: 'My API' }))
 * ```
 */
export function serveSwaggerUI(options: SwaggerUIOptions = {}): HttpHandler {
  const html = buildSwaggerHtml(options)
  const csp = buildSwaggerCsp(options.csp)

  return (c) => {
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=UTF-8',
    }
    if (csp) {
      headers['Content-Security-Policy'] = csp
    }
    return new Response(html, { status: 200, headers })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mountOpenApiDocs — convenience helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount OpenAPI documentation routes on an HttpApp (or any app with `.get()`).
 *
 * Registers two routes:
 * - `specPath` (default: `/openapi.json`) — returns the OpenAPI spec as JSON
 * - `docsPath` (default: `/docs`) — serves the documentation UI (ReDoc or Swagger UI)
 *
 * @example
 * ```typescript
 * import { HttpApp, mountOpenApiDocs } from 'raffel/http'
 *
 * const app = new HttpApp()
 *
 * mountOpenApiDocs(app, {
 *   spec: () => generateOpenApiSpec(),
 *   title: 'My API',
 *   ui: 'redoc',
 * })
 * ```
 */
export function mountOpenApiDocs(
  app: HttpAppWithRoutes,
  options: MountOpenApiDocsOptions
): void {
  const {
    spec,
    specPath = '/openapi.json',
    docsPath = '/docs',
    ui = 'redoc',
    title = 'API Documentation',
    csp,
    redoc: redocOpts = {},
    swagger: swaggerOpts = {},
  } = options

  // Register OpenAPI JSON spec endpoint
  app.get(specPath, (c) => {
    const specObj = spec()
    return new Response(JSON.stringify(specObj), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    })
  })

  // Register docs UI endpoint
  if (ui === 'swagger') {
    app.get(
      docsPath,
      serveSwaggerUI({
        specUrl: specPath,
        title,
        csp,
        ...swaggerOpts,
      })
    )
  } else {
    app.get(
      docsPath,
      serveRedoc({
        specUrl: specPath,
        title,
        csp,
        ...redocOpts,
      })
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export HttpMiddleware for convenience
// ─────────────────────────────────────────────────────────────────────────────

export type { HttpHandler, HttpMiddleware }
