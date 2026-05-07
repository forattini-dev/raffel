// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { JSDOM } from 'jsdom'
import { generateUIHTML } from '../../src/docs/ui/html-builder.js'

function buildDocs(): string {
  return generateUIHTML({
    basePath: '/docs',
    doc: {
      info: { title: 'Search Modal Demo', version: '1.0.0' },
      paths: {},
      'x-usd': {
        documentation: {
          pages: [
            {
              path: '/getting-started',
              title: 'Getting Started',
              section: 'Guides',
              markdown: '# Getting Started\n\nLearn how to install and configure raffel quickly.\n\n## Install\n\nUse pnpm to install.\n\n## Configure\n\nProvide a config object.',
            },
            {
              path: '/auth',
              title: 'Authentication',
              section: 'Guides',
              markdown: '# Authentication\n\nProtect your routes using sessions or JWT.\n\n## Sessions\n\nSession-based auth.',
            },
            {
              path: '/reference/http',
              title: 'HTTP Reference',
              section: 'Reference',
              markdown: '# HTTP Reference\n\nDetails about the HTTP adapter.\n\n## Routing\n\nDeclare routes with `procedure`.',
            },
          ],
        },
      },
    },
    tagGroups: [],
    ui: { sidebar: { search: true } },
  })
}

function setupDom(htmlOverride?: string): { dom: JSDOM; win: any; doc: Document } {
  const html = htmlOverride ?? buildDocs()
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://docs.example.com/',
  })
  const win = dom.window as any
  // jsdom does not implement HTMLDialogElement.showModal; provide a shim.
  if (typeof win.HTMLDialogElement !== 'undefined') {
    const proto = win.HTMLDialogElement.prototype
    if (typeof proto.showModal !== 'function') {
      proto.showModal = function showModal(this: any) {
        this.setAttribute('open', '')
      }
    }
    if (typeof proto.close !== 'function') {
      proto.close = function close(this: any) {
        this.removeAttribute('open')
        this.dispatchEvent(new win.Event('close'))
      }
    }
  }
  // jsdom does not execute <script type="module">. Re-evaluate the inline
  // runtime script body manually so the IIFE inside runs and binds the modal.
  const runtimeScript = win.document.querySelector('script[data-raffel-runtime="inline"]')
  if (runtimeScript && runtimeScript.textContent) {
    win.eval(runtimeScript.textContent)
  }
  return { dom, win, doc: dom.window.document }
}

function dispatchKey(target: any, win: any, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new win.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

describe('docs search modal (cmd+K)', () => {
  let dom: JSDOM
  let win: any
  let doc: Document

  beforeEach(() => {
    const ctx = setupDom()
    dom = ctx.dom
    win = ctx.win
    doc = ctx.doc
  })

  afterEach(() => {
    dom.window.close()
  })

  it('mounts a single dialog.search-modal element on init', () => {
    const dialogs = doc.querySelectorAll('dialog.search-modal')
    expect(dialogs.length).toBe(1)
    const dialog = dialogs[0] as HTMLDialogElement
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(dialog.querySelector('.search-modal-input')).toBeTruthy()
    expect(dialog.querySelector('.search-modal-results')).toBeTruthy()
  })

  it('opens on cmd+K and closes on esc, restoring focus', async () => {
    const trigger = doc.createElement('button')
    trigger.id = 'opener'
    doc.body.appendChild(trigger)
    trigger.focus()
    expect(doc.activeElement).toBe(trigger)

    dispatchKey(doc.body, win, 'k', { metaKey: true })
    const dialog = doc.querySelector('dialog.search-modal') as HTMLDialogElement
    expect(dialog.hasAttribute('open')).toBe(true)

    // Wait for the queued setTimeout focus.
    await new Promise(resolve => setTimeout(resolve, 5))
    const input = dialog.querySelector('.search-modal-input') as HTMLInputElement
    expect(doc.activeElement).toBe(input)

    dispatchKey(doc.body, win, 'Escape')
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(doc.activeElement).toBe(trigger)
  })

  it('opens on ctrl+K too', () => {
    dispatchKey(doc.body, win, 'k', { ctrlKey: true })
    const dialog = doc.querySelector('dialog.search-modal') as HTMLDialogElement
    expect(dialog.hasAttribute('open')).toBe(true)
  })

  it('does not open from cmd+K while typing in another input', () => {
    const otherInput = doc.createElement('input')
    otherInput.type = 'text'
    doc.body.appendChild(otherInput)
    otherInput.focus()

    dispatchKey(otherInput, win, 'k', { metaKey: true })
    const dialog = doc.querySelector('dialog.search-modal') as HTMLDialogElement
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('renders grouped results from the search index when the user types', () => {
    dispatchKey(doc.body, win, 'k', { metaKey: true })
    const dialog = doc.querySelector('dialog.search-modal') as HTMLDialogElement
    const input = dialog.querySelector('.search-modal-input') as HTMLInputElement
    input.value = 'install'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    const groupHeadings = Array.from(dialog.querySelectorAll('.search-modal-group-heading')).map(el => el.textContent?.trim())
    expect(groupHeadings.length).toBeGreaterThan(0)
    const results = dialog.querySelectorAll('.search-modal-result')
    expect(results.length).toBeGreaterThan(0)
  })

  it('arrow keys move highlight and Enter follows', () => {
    dispatchKey(doc.body, win, 'k', { metaKey: true })
    const dialog = doc.querySelector('dialog.search-modal') as HTMLDialogElement
    const input = dialog.querySelector('.search-modal-input') as HTMLInputElement
    input.value = 'auth'
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    dispatchKey(doc.body, win, 'ArrowDown')
    const highlighted = dialog.querySelector('.search-modal-result.is-highlighted')
    expect(highlighted).toBeTruthy()

    dispatchKey(doc.body, win, 'Enter')
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(win.location.hash.length).toBeGreaterThan(0)
  })
})

describe('docs search modal disabled', () => {
  it('does not mount the modal when sidebar.search is false', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: { info: { title: 'No search', version: '1.0.0' }, paths: {} },
      tagGroups: [],
      ui: { sidebar: { search: false } },
    })
    const ctx = setupDom(html)
    try {
      const dialogs = ctx.doc.querySelectorAll('dialog.search-modal')
      expect(dialogs.length).toBe(0)
      const event = new ctx.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
      ctx.doc.body.dispatchEvent(event)
      expect(ctx.doc.querySelectorAll('dialog.search-modal').length).toBe(0)
    } finally {
      ctx.dom.window.close()
    }
  })
})
