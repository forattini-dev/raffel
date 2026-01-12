/**
 * Template Rendering System
 *
 * Provides pluggable template engine support with caching, layouts,
 * and context helpers for server-side rendering.
 *
 * @example
 * import { createTemplateEngine, renderMiddleware } from 'raffel/http/templates'
 *
 * // Create with built-in simple engine
 * const templates = createTemplateEngine({
 *   templatesDir: './views',
 *   extension: '.html',
 *   cache: true,
 * })
 *
 * // Use with middleware
 * app.use('*', renderMiddleware(templates))
 *
 * // Render in handler
 * app.get('/', (c) => {
 *   return c.render('home', { title: 'Welcome' })
 * })
 *
 * // Or use custom engine (EJS, Pug, etc.)
 * import ejs from 'ejs'
 * const templates = createTemplateEngine({
 *   templatesDir: './views',
 *   engine: {
 *     name: 'ejs',
 *     render: (template, data) => ejs.render(template, data),
 *     renderFile: (path, data) => ejs.renderFile(path, data),
 *   },
 * })
 */

import * as fs from 'fs'
import * as path from 'path'
import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Template data passed to render
 */
export type TemplateData = Record<string, unknown>

/**
 * Template engine interface
 */
export interface TemplateEngineAdapter {
  /** Engine name */
  readonly name: string

  /**
   * Render a template string with data
   */
  render(template: string, data: TemplateData): string | Promise<string>

  /**
   * Render a template file (optional, falls back to reading file + render)
   */
  renderFile?(filePath: string, data: TemplateData): string | Promise<string>

  /**
   * Compile a template for caching (optional)
   */
  compile?(template: string): CompiledTemplate
}

/**
 * Compiled template function
 */
export type CompiledTemplate = (data: TemplateData) => string | Promise<string>

/**
 * Template engine configuration
 */
export interface TemplateEngineOptions {
  /**
   * Directory containing templates
   * @default './views'
   */
  templatesDir?: string

  /**
   * File extension for templates
   * @default '.html'
   */
  extension?: string

  /**
   * Custom template engine adapter
   * @default Built-in simple engine
   */
  engine?: TemplateEngineAdapter

  /**
   * Enable template caching (recommended for production)
   * @default true in production, false in development
   */
  cache?: boolean

  /**
   * Default layout template name
   */
  layout?: string

  /**
   * Layout directory (defaults to templatesDir)
   */
  layoutsDir?: string

  /**
   * Partials directory
   */
  partialsDir?: string

  /**
   * Global data available in all templates
   */
  globals?: TemplateData

  /**
   * Custom helpers/functions available in templates
   */
  helpers?: Record<string, (...args: unknown[]) => unknown>
}

/**
 * Template manager interface
 */
export interface TemplateManager {
  /**
   * Render a template by name
   */
  render(name: string, data?: TemplateData): Promise<string>

  /**
   * Render a template string directly
   */
  renderString(template: string, data?: TemplateData): Promise<string>

  /**
   * Render with a specific layout
   */
  renderWithLayout(name: string, data?: TemplateData, layout?: string): Promise<string>

  /**
   * Clear template cache
   */
  clearCache(): void

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number; misses: number }

  /**
   * Register a partial template
   */
  registerPartial(name: string, template: string): void

  /**
   * Register a helper function
   */
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void
}

/**
 * Render middleware options
 */
export interface RenderMiddlewareOptions {
  /**
   * Key to store render function in context
   * @default 'render'
   */
  contextKey?: string

  /**
   * Content-Type header for rendered responses
   * @default 'text/html; charset=utf-8'
   */
  contentType?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Simple Template Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple template engine with basic variable substitution
 *
 * Supports:
 * - {{ variable }} - Output escaped value
 * - {{{ variable }}} - Output raw value (unescaped)
 * - {{# if condition }}...{{/ if }} - Conditional
 * - {{# each array }}...{{/ each }} - Loop
 * - {{> partial }} - Include partial
 */
class SimpleTemplateEngine implements TemplateEngineAdapter {
  readonly name = 'simple'

  private helpers: Record<string, (...args: unknown[]) => unknown> = {}
  private partials: Record<string, string> = {}

  constructor(
    helpers?: Record<string, (...args: unknown[]) => unknown>,
    partials?: Record<string, string>
  ) {
    this.helpers = helpers || {}
    this.partials = partials || {}

    // Built-in helpers
    this.helpers.json = (value: unknown) => JSON.stringify(value)
    this.helpers.upper = (value: unknown) => String(value).toUpperCase()
    this.helpers.lower = (value: unknown) => String(value).toLowerCase()
    this.helpers.capitalize = (value: unknown) => {
      const str = String(value)
      return str.charAt(0).toUpperCase() + str.slice(1)
    }
    this.helpers.date = (value: unknown, format?: unknown) => {
      const date = value instanceof Date ? value : new Date(String(value))
      if (format === 'iso') return date.toISOString()
      if (format === 'locale') return date.toLocaleString()
      return date.toDateString()
    }
  }

  render(template: string, data: TemplateData): string {
    let result = template

    // Process partials {{> partialName }}
    result = result.replace(/\{\{>\s*(\w+)\s*\}\}/g, (_match, partialName) => {
      const partial = this.partials[partialName]
      if (partial) {
        return this.render(partial, data)
      }
      return `<!-- Partial "${partialName}" not found -->`
    })

    // Process conditionals {{# if condition }}...{{/ if }}
    result = this.processConditionals(result, data)

    // Process loops {{# each array }}...{{/ each }}
    result = this.processLoops(result, data)

    // Process raw output {{{ variable }}}
    result = result.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_match, key) => {
      const value = this.getValue(data, key)
      return value !== undefined ? String(value) : ''
    })

    // Process helpers {{ helper arg1 arg2 }}
    result = result.replace(/\{\{\s*(\w+)\s+([^}]+)\s*\}\}/g, (_match, helperName, argsStr) => {
      const helper = this.helpers[helperName]
      if (helper) {
        const args = argsStr.split(/\s+/).map((arg: string) => {
          // Check if it's a data reference
          if (arg.startsWith('"') || arg.startsWith("'")) {
            return arg.slice(1, -1)
          }
          return this.getValue(data, arg)
        })
        return String(helper(...args))
      }
      // Not a helper, treat as variable
      return this.escapeHtml(String(this.getValue(data, helperName) ?? ''))
    })

    // Process escaped output {{ variable }}
    result = result.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
      const value = this.getValue(data, key)
      return value !== undefined ? this.escapeHtml(String(value)) : ''
    })

    return result
  }

  compile(template: string): CompiledTemplate {
    // For simple engine, just return a function that calls render
    return (data: TemplateData) => this.render(template, data)
  }

  addHelper(name: string, fn: (...args: unknown[]) => unknown): void {
    this.helpers[name] = fn
  }

  addPartial(name: string, template: string): void {
    this.partials[name] = template
  }

  private processConditionals(template: string, data: TemplateData): string {
    // Match {{# if condition }}...{{/ if }} or {{# if condition }}...{{# else }}...{{/ if }}
    const ifRegex = /\{\{#\s*if\s+([\w.!]+)\s*\}\}([\s\S]*?)\{\{\/\s*if\s*\}\}/g

    return template.replace(ifRegex, (_match, condition, content) => {
      // Check for else clause
      const elseParts = content.split(/\{\{#\s*else\s*\}\}/)
      const ifContent = elseParts[0]
      const elseContent = elseParts[1] || ''

      // Evaluate condition
      let conditionValue: unknown
      if (condition.startsWith('!')) {
        conditionValue = !this.getValue(data, condition.slice(1))
      } else {
        conditionValue = this.getValue(data, condition)
      }

      if (conditionValue) {
        return this.render(ifContent, data)
      } else {
        return this.render(elseContent, data)
      }
    })
  }

  private processLoops(template: string, data: TemplateData): string {
    // Match {{# each array }}...{{/ each }}
    const eachRegex = /\{\{#\s*each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*each\s*\}\}/g

    return template.replace(eachRegex, (_match, arrayKey, content) => {
      const array = this.getValue(data, arrayKey)

      if (!Array.isArray(array)) {
        return ''
      }

      return array
        .map((item, index) => {
          const itemData = {
            ...data,
            this: item,
            '@index': index,
            '@first': index === 0,
            '@last': index === array.length - 1,
          }

          // If item is an object, spread its properties
          if (typeof item === 'object' && item !== null) {
            Object.assign(itemData, item)
          }

          return this.render(content, itemData)
        })
        .join('')
    })
  }

  private getValue(data: TemplateData, key: string): unknown {
    const parts = key.split('.')
    let value: unknown = data

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined
      }
      value = (value as Record<string, unknown>)[part]
    }

    return value
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a template engine manager
 *
 * @param options - Template engine configuration
 * @returns Template manager instance
 *
 * @example
 * const templates = createTemplateEngine({
 *   templatesDir: './views',
 *   cache: process.env.NODE_ENV === 'production',
 *   layout: 'main',
 *   globals: { appName: 'My App' },
 * })
 */
export function createTemplateEngine(options: TemplateEngineOptions = {}): TemplateManager {
  const {
    templatesDir = './views',
    extension = '.html',
    engine: customEngine,
    cache = process.env.NODE_ENV === 'production',
    layout: defaultLayout,
    layoutsDir = templatesDir,
    partialsDir,
    globals = {},
    helpers = {},
  } = options

  // Create engine
  const simpleEngine = new SimpleTemplateEngine(helpers)
  const engine = customEngine || simpleEngine

  // Template cache
  const templateCache = new Map<string, CompiledTemplate>()
  let cacheHits = 0
  let cacheMisses = 0

  // Load partials if directory specified
  if (partialsDir && fs.existsSync(partialsDir)) {
    const files = fs.readdirSync(partialsDir)
    for (const file of files) {
      if (file.endsWith(extension)) {
        const name = file.slice(0, -extension.length)
        const content = fs.readFileSync(path.join(partialsDir, file), 'utf-8')
        if (simpleEngine) {
          simpleEngine.addPartial(name, content)
        }
      }
    }
  }

  /**
   * Get template file path
   */
  function getTemplatePath(name: string, dir = templatesDir): string {
    const fileName = name.includes('.') ? name : `${name}${extension}`
    return path.resolve(dir, fileName)
  }

  /**
   * Load and optionally cache a template
   */
  async function loadTemplate(name: string, dir = templatesDir): Promise<CompiledTemplate> {
    const filePath = getTemplatePath(name, dir)
    const cacheKey = filePath

    // Check cache
    if (cache && templateCache.has(cacheKey)) {
      cacheHits++
      return templateCache.get(cacheKey)!
    }

    cacheMisses++

    // Load file
    const content = await fs.promises.readFile(filePath, 'utf-8')

    // Compile if engine supports it
    let compiled: CompiledTemplate
    if (engine.compile) {
      compiled = engine.compile(content)
    } else {
      compiled = (data: TemplateData) => engine.render(content, data)
    }

    // Cache
    if (cache) {
      templateCache.set(cacheKey, compiled)
    }

    return compiled
  }

  return {
    async render(name: string, data: TemplateData = {}): Promise<string> {
      const compiled = await loadTemplate(name)
      const mergedData = { ...globals, ...data }
      return compiled(mergedData)
    },

    async renderString(template: string, data: TemplateData = {}): Promise<string> {
      const mergedData = { ...globals, ...data }
      return engine.render(template, mergedData)
    },

    async renderWithLayout(
      name: string,
      data: TemplateData = {},
      layout = defaultLayout
    ): Promise<string> {
      // Render the main template
      const content = await this.render(name, data)

      if (!layout) {
        return content
      }

      // Render the layout with content
      const layoutCompiled = await loadTemplate(layout, layoutsDir)
      const layoutData = {
        ...globals,
        ...data,
        body: content,
        content, // Alias
      }

      return layoutCompiled(layoutData)
    },

    clearCache(): void {
      templateCache.clear()
      cacheHits = 0
      cacheMisses = 0
    },

    getCacheStats() {
      return {
        size: templateCache.size,
        hits: cacheHits,
        misses: cacheMisses,
      }
    },

    registerPartial(name: string, template: string): void {
      if (simpleEngine) {
        simpleEngine.addPartial(name, template)
      }
    },

    registerHelper(name: string, fn: (...args: unknown[]) => unknown): void {
      if (simpleEngine) {
        simpleEngine.addHelper(name, fn)
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create render middleware that adds render function to context
 *
 * @param templates - Template manager instance
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * const templates = createTemplateEngine({ templatesDir: './views' })
 * app.use('*', renderMiddleware(templates))
 *
 * app.get('/', async (c) => {
 *   const render = c.get('render')
 *   return render('home', { title: 'Welcome' })
 * })
 */
export function renderMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  templates: TemplateManager,
  options: RenderMiddlewareOptions = {}
): HttpMiddleware<E> {
  const { contextKey = 'render', contentType = 'text/html; charset=utf-8' } = options

  return async (c, next) => {
    // Add render function to context
    const render = async (name: string, data?: TemplateData, layout?: string): Promise<Response> => {
      const html = layout !== undefined
        ? await templates.renderWithLayout(name, data, layout)
        : await templates.render(name, data)

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': contentType,
        },
      })
    }

    // Store render function
    ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, render)

    await next()
  }
}

/**
 * Render a template directly and return Response
 *
 * @param templates - Template manager
 * @param name - Template name
 * @param data - Template data
 * @param options - Render options
 * @returns Response with rendered HTML
 *
 * @example
 * app.get('/', (c) => {
 *   return renderTemplate(templates, 'home', { title: 'Welcome' })
 * })
 */
export async function renderTemplate(
  templates: TemplateManager,
  name: string,
  data?: TemplateData,
  options: { layout?: string; contentType?: string } = {}
): Promise<Response> {
  const { layout, contentType = 'text/html; charset=utf-8' } = options

  const html = layout !== undefined
    ? await templates.renderWithLayout(name, data, layout)
    : await templates.render(name, data)

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': contentType,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine Adapters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an EJS adapter (requires ejs package)
 *
 * @example
 * import ejs from 'ejs'
 * const templates = createTemplateEngine({
 *   engine: createEjsAdapter(ejs),
 * })
 */
export function createEjsAdapter(ejs: {
  render: (template: string, data: object) => string
  renderFile: (path: string, data: object) => Promise<string>
  compile: (template: string) => (data: object) => string
}): TemplateEngineAdapter {
  return {
    name: 'ejs',
    render: (template, data) => ejs.render(template, data),
    renderFile: (filePath, data) => ejs.renderFile(filePath, data),
    compile: (template) => ejs.compile(template),
  }
}

/**
 * Create a Pug adapter (requires pug package)
 *
 * @example
 * import pug from 'pug'
 * const templates = createTemplateEngine({
 *   engine: createPugAdapter(pug),
 *   extension: '.pug',
 * })
 */
export function createPugAdapter(pug: {
  render: (template: string, data: object) => string
  renderFile: (path: string, data: object) => string
  compile: (template: string) => (data: object) => string
}): TemplateEngineAdapter {
  return {
    name: 'pug',
    render: (template, data) => pug.render(template, data),
    renderFile: (filePath, data) => pug.renderFile(filePath, data),
    compile: (template) => pug.compile(template),
  }
}

/**
 * Create a Handlebars adapter (requires handlebars package)
 *
 * @example
 * import Handlebars from 'handlebars'
 * const templates = createTemplateEngine({
 *   engine: createHandlebarsAdapter(Handlebars),
 *   extension: '.hbs',
 * })
 */
export function createHandlebarsAdapter(handlebars: {
  compile: (template: string) => (data: object) => string
}): TemplateEngineAdapter {
  return {
    name: 'handlebars',
    render: (template, data) => {
      const compiled = handlebars.compile(template)
      return compiled(data)
    },
    compile: (template) => {
      const compiled = handlebars.compile(template)
      return (data: TemplateData) => compiled(data)
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createTemplateEngine,
  renderMiddleware,
  renderTemplate,
  createEjsAdapter,
  createPugAdapter,
  createHandlebarsAdapter,
}
