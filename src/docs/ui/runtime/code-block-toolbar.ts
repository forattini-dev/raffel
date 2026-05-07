/**
 * Code-block toolbar enhancer.
 *
 * Walks a rendered Markdown root, finds every `pre > code[class*="language-"]`,
 * and injects a `.code-block-toolbar` containing a `.code-block-lang` label and
 * a `.code-block-copy` button. Idempotent — re-running on the same root never
 * duplicates toolbars.
 *
 * The copy button writes the unrendered source to the clipboard (preserved by
 * Prism in the token tree's `textContent`) and shows "Copied" for ~1s.
 */

const ENHANCED_ATTR = 'data-code-toolbar-enhanced'
const LANG_CLASS_PREFIX = 'language-'
const COPY_LABEL = 'Copy'
const COPIED_LABEL = 'Copied'
const COPIED_DURATION_MS = 1000

type AnyDoc = {
  createElement?: (tag: string) => any
}

type AnyNav = {
  clipboard?: { writeText?: (text: string) => Promise<void> | void }
}

export function enhanceCodeBlockToolbars(
  root: any,
  options: { document?: AnyDoc; navigator?: AnyNav } = {}
): void {
  if (!root || typeof root.querySelectorAll !== 'function') return
  const doc: AnyDoc | undefined = options.document
    ?? (typeof globalThis !== 'undefined' ? (globalThis as any).document : undefined)
  const nav: AnyNav | undefined = options.navigator
    ?? (typeof globalThis !== 'undefined' ? (globalThis as any).navigator : undefined)
  if (!doc?.createElement) return

  const codes = root.querySelectorAll(`pre > code[class*="${LANG_CLASS_PREFIX}"]`)
  for (const code of Array.from(codes) as any[]) {
    const pre = code.parentElement
    if (!pre || pre.getAttribute?.(ENHANCED_ATTR) === 'true') continue
    pre.setAttribute(ENHANCED_ATTR, 'true')
    if (pre.style && !pre.style.position) pre.style.position = 'relative'
    const lang = extractLanguage(code.className)
    const toolbar = buildToolbar(doc, code, lang, nav)
    pre.insertBefore(toolbar, pre.firstChild)
    hideLegacyCopyButton(pre)
  }
}

function extractLanguage(className: unknown): string {
  const match = String(className ?? '').match(/(?:^|\s)language-([\w+#.-]+)/)
  return match ? match[1].toLowerCase() : ''
}

function buildToolbar(doc: AnyDoc, code: any, lang: string, nav: AnyNav | undefined): any {
  const toolbar = doc.createElement!('div')
  toolbar.className = 'code-block-toolbar'
  const langEl = doc.createElement!('span')
  langEl.className = 'code-block-lang'
  langEl.textContent = lang
  if (!lang) langEl.setAttribute('hidden', 'hidden')
  toolbar.appendChild(langEl)
  const button = doc.createElement!('button')
  button.setAttribute('type', 'button')
  button.className = 'code-block-copy'
  button.textContent = COPY_LABEL
  button.addEventListener?.('click', () => copyCodeText(button, code, nav))
  toolbar.appendChild(button)
  return toolbar
}

function copyCodeText(button: any, code: any, nav: AnyNav | undefined): void {
  const text = String(code?.textContent ?? '')
  const writer = nav?.clipboard?.writeText
  let result: Promise<void> | void
  try {
    result = writer ? writer.call(nav!.clipboard, text) : undefined
  } catch {
    result = undefined
  }
  if (result && typeof (result as Promise<void>).then === 'function') {
    (result as Promise<void>).then(() => markCopied(button)).catch(() => markCopied(button))
  } else {
    markCopied(button)
  }
}

function markCopied(button: any): void {
  if (!button) return
  button.textContent = COPIED_LABEL
  setTimeout(() => { if (button.textContent === COPIED_LABEL) button.textContent = COPY_LABEL }, COPIED_DURATION_MS)
}

function hideLegacyCopyButton(pre: any): void {
  const wrap = pre?.parentElement
  if (!wrap?.classList?.contains?.('md-code-wrap')) return
  const legacy = wrap.querySelector?.(':scope > .copy-code-btn')
  if (legacy) legacy.setAttribute?.('hidden', 'hidden')
}
