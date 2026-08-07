import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

import { enhanceCodeBlockToolbars } from '../../src/docs/ui/runtime/code-block-toolbar.js'

function setupDom(html: string): { dom: JSDOM; root: HTMLElement } {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${html}</main></body></html>`)
  const root = dom.window.document.querySelector('main') as HTMLElement
  return { dom, root }
}

describe('enhanceCodeBlockToolbars', () => {
  const fragment = `
    <pre class="md-code-block"><code class="language-ts">const a = 1;</code></pre>
    <pre class="md-code-block"><code class="language-ts">const b = 2;</code></pre>
  `

  it('injects exactly one toolbar per pre with the expected language label and copy button', () => {
    const { dom, root } = setupDom(fragment)
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })

    const pres = Array.from(root.querySelectorAll('pre'))
    expect(pres).toHaveLength(2)

    for (const pre of pres) {
      const toolbars = pre.querySelectorAll('.code-block-toolbar')
      expect(toolbars).toHaveLength(1)
      expect(pre.getAttribute('data-code-toolbar-enhanced')).toBe('true')

      const lang = toolbars[0].querySelector('.code-block-lang')
      expect(lang).not.toBeNull()
      expect(lang!.textContent).toBe('ts')
      expect(lang!.hasAttribute('hidden')).toBe(false)

      const copy = toolbars[0].querySelector('button.code-block-copy')
      expect(copy).not.toBeNull()
      expect(copy!.textContent).toBe('Copy')
    }
  })

  it('is idempotent — re-running on the same root does not add duplicate toolbars', () => {
    const { dom, root } = setupDom(fragment)
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })

    for (const pre of Array.from(root.querySelectorAll('pre'))) {
      expect(pre.querySelectorAll('.code-block-toolbar')).toHaveLength(1)
    }
  })

  it('hides the language label when the code block has no language hint', () => {
    const { dom, root } = setupDom('<pre><code class="language-">x</code></pre>')
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })
    const lang = root.querySelector('.code-block-lang')
    expect(lang).not.toBeNull()
    expect(lang!.hasAttribute('hidden')).toBe(true)
  })

  it('wires the copy button to navigator.clipboard.writeText with the unrendered code text', async () => {
    const { dom, root } = setupDom('<pre><code class="language-bash">echo hello</code></pre>')
    const writeText = vi.fn().mockResolvedValue(undefined)
    const fakeNav = { clipboard: { writeText } }
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: fakeNav })

    const button = root.querySelector('button.code-block-copy') as HTMLButtonElement
    expect(button).not.toBeNull()
    button.click()

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('echo hello')
    // Microtask flush so the resolved promise mark-copied callback runs.
    await Promise.resolve()
    expect(button.textContent).toBe('Copied')
  })

  it('hides the legacy .copy-code-btn when wrapping md-code-wrap is present', () => {
    const { dom, root } = setupDom(`
      <div class="md-code-wrap">
        <button type="button" class="copy-code-btn">Copy</button>
        <pre class="md-code-block"><code class="language-ts">value;</code></pre>
      </div>
    `)
    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })
    const legacy = root.querySelector('.md-code-wrap > .copy-code-btn') as HTMLButtonElement
    expect(legacy.hasAttribute('hidden')).toBe(true)
  })

  it('leaves generated reference samples with their own copy controls untouched', () => {
    const { dom, root } = setupDom(`
      <div class="http-code-samples">
        <button type="button" class="http-code-copy">Copy</button>
        <pre class="http-code-sample-pre" data-code-toolbar="managed">
          <code class="language-bash">curl https://example.test</code>
        </pre>
      </div>
      <div class="response-media-sample">
        <button type="button" class="sample-code-copy">Copy</button>
        <pre class="sample-code" data-code-toolbar="managed">
          <code class="language-json">{"ok":true}</code>
        </pre>
      </div>
    `)

    enhanceCodeBlockToolbars(root, { document: dom.window.document, navigator: dom.window.navigator })

    expect(root.querySelectorAll('.http-code-samples button')).toHaveLength(1)
    expect(root.querySelectorAll('.response-media-sample button')).toHaveLength(1)
    expect(root.querySelectorAll('.code-block-toolbar')).toHaveLength(0)
  })

  it('skips quietly when given a null root or a root without query support', () => {
    expect(() => enhanceCodeBlockToolbars(null)).not.toThrow()
    expect(() => enhanceCodeBlockToolbars({})).not.toThrow()
  })
})
