/**
 * cmd+K / ctrl+K search modal for the docs UI.
 *
 * Wraps the existing in-memory search index (the same one the sidebar
 * search input filters through) inside a centred <dialog> overlay.
 * - cmd+K (Mac) / ctrl+K (others) opens the modal from anywhere on the page.
 * - An optional alternative shortcut (default disabled) is supported via
 *   the `altShortcut` option; pass `'/'` to enable a slash-to-open binding.
 * - Arrow keys move the highlighted result, Enter follows it, Esc closes.
 * - Focus is trapped inside the modal (browser default for <dialog>) and
 *   restored to the previously focused element on close.
 */

type SearchModalEntry = {
  kind?: 'page' | 'heading'
  title?: string
  path?: string
  section?: string
  headingId?: string
  excerpt?: string
  text?: string
  rank?: number
}

type SearchModalDeps = {
  doc: any
  win: any
  enabled: boolean
  altShortcut?: string
  getEntries: () => SearchModalEntry[]
  scoreEntry: (entry: SearchModalEntry, terms: string[]) => number
  getSearchTerms: (query: string) => string[]
  esc: (value: unknown) => string
  setDocsPage: (path: unknown, headingId?: string) => void
  normalizeDocsPath: (path: unknown) => string
}

type SearchModalHandle = {
  open: () => void
  close: () => void
  isOpen: () => boolean
  dispose: () => void
  dialog: any
  input: any
  results: any
}

export function createDocsSearchModal(deps: SearchModalDeps): SearchModalHandle | null {
  if (!deps.enabled) return null
  if (!deps.doc || !deps.doc.body) return null

  const doc = deps.doc

  const dialog = doc.createElement('dialog')
  dialog.className = 'search-modal'
  dialog.setAttribute('aria-label', 'Search documentation')

  const wrap = doc.createElement('div')
  wrap.className = 'search-modal-inner'

  const inputRow = doc.createElement('div')
  inputRow.className = 'search-modal-input-row'

  const input = doc.createElement('input')
  input.type = 'text'
  input.className = 'search-modal-input'
  input.setAttribute('placeholder', 'Search documentation...')
  input.setAttribute('aria-label', 'Search documentation')
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('spellcheck', 'false')

  const closeBtn = doc.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'search-modal-close'
  closeBtn.setAttribute('aria-label', 'Close search')
  closeBtn.textContent = 'Esc'

  inputRow.appendChild(input)
  inputRow.appendChild(closeBtn)

  const results = doc.createElement('div')
  results.className = 'search-modal-results'
  results.setAttribute('role', 'listbox')

  const empty = doc.createElement('div')
  empty.className = 'search-modal-empty'
  empty.textContent = 'Type to search the docs.'

  wrap.appendChild(inputRow)
  wrap.appendChild(results)
  wrap.appendChild(empty)
  dialog.appendChild(wrap)
  doc.body.appendChild(dialog)

  let highlighted = 0
  let currentResults: Array<{ entry: SearchModalEntry; flatIndex: number }> = []
  let previouslyFocused: any = null

  function buildGroupedResults(query: string): { groups: Array<{ section: string; items: SearchModalEntry[] }>; total: number } {
    const trimmed = String(query ?? '').trim()
    if (!trimmed) return { groups: [], total: 0 }
    const terms = deps.getSearchTerms(trimmed)
    const all = deps.getEntries()
      .map(entry => ({ entry, score: deps.scoreEntry(entry, terms) }))
      .filter(r => r.score > 0 && r.entry.title && r.entry.path)
      .sort((a, b) => b.score - a.score || (a.entry.rank ?? 0) - (b.entry.rank ?? 0))
      .slice(0, 24)
      .map(r => r.entry)

    const order: string[] = []
    const buckets: Record<string, SearchModalEntry[]> = {}
    for (const entry of all) {
      const section = String(entry.section ?? 'Docs')
      if (!buckets[section]) {
        buckets[section] = []
        order.push(section)
      }
      buckets[section].push(entry)
    }
    return {
      groups: order.map(section => ({ section, items: buckets[section] })),
      total: all.length,
    }
  }

  function renderResults(): void {
    const query = String(input.value ?? '')
    const { groups, total } = buildGroupedResults(query)
    results.innerHTML = ''
    currentResults = []

    if (!query.trim()) {
      empty.textContent = 'Type to search the docs.'
      empty.style.display = 'block'
      return
    }
    if (total === 0) {
      empty.textContent = `No results for "${query}".`
      empty.style.display = 'block'
      return
    }
    empty.style.display = 'none'

    let flatIndex = 0
    for (const group of groups) {
      const groupEl = doc.createElement('div')
      groupEl.className = 'search-modal-group'
      const heading = doc.createElement('div')
      heading.className = 'search-modal-group-heading'
      heading.textContent = group.section
      groupEl.appendChild(heading)

      for (const entry of group.items) {
        const item = doc.createElement('button')
        item.type = 'button'
        item.className = 'search-modal-result'
        item.setAttribute('role', 'option')
        item.setAttribute('data-search-modal-index', String(flatIndex))
        const titleEl = doc.createElement('span')
        titleEl.className = 'search-modal-result-title'
        titleEl.textContent = String(entry.title ?? '')
        item.appendChild(titleEl)
        if (entry.excerpt) {
          const descEl = doc.createElement('span')
          descEl.className = 'search-modal-result-desc'
          descEl.textContent = String(entry.excerpt)
          item.appendChild(descEl)
        }
        const idx = flatIndex
        item.addEventListener('click', () => {
          highlighted = idx
          followHighlighted()
        })
        item.addEventListener('mouseover', () => {
          highlighted = idx
          paintHighlight()
        })
        groupEl.appendChild(item)
        currentResults.push({ entry, flatIndex })
        flatIndex++
      }
      results.appendChild(groupEl)
    }
    if (highlighted >= currentResults.length) highlighted = 0
    paintHighlight()
  }

  function paintHighlight(): void {
    const items = results.querySelectorAll('.search-modal-result')
    items.forEach((el: any) => el.classList?.remove('is-highlighted'))
    const target = results.querySelector(`.search-modal-result[data-search-modal-index="${highlighted}"]`)
    if (target) {
      target.classList?.add('is-highlighted')
      target.setAttribute?.('aria-selected', 'true')
      target.scrollIntoView?.({ block: 'nearest' })
    }
  }

  function followHighlighted(): void {
    const current = currentResults[highlighted]
    if (!current) return
    const path = deps.normalizeDocsPath(current.entry.path)
    const headingId = current.entry.headingId ?? ''
    close()
    deps.setDocsPage(path, headingId)
  }

  function open(): void {
    if (isOpen()) return
    previouslyFocused = doc.activeElement
    input.value = ''
    highlighted = 0
    renderResults()
    if (typeof dialog.showModal === 'function') {
      try { dialog.showModal() } catch { dialog.setAttribute('open', '') }
    } else {
      dialog.setAttribute('open', '')
    }
    setTimeout(() => input.focus?.(), 0)
  }

  function close(): void {
    if (!isOpen()) return
    if (typeof dialog.close === 'function') {
      try { dialog.close() } catch { dialog.removeAttribute('open') }
    } else {
      dialog.removeAttribute('open')
    }
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus() } catch { /* noop */ }
    }
    previouslyFocused = null
  }

  function isOpen(): boolean {
    return dialog.hasAttribute('open') || dialog.open === true
  }

  function shouldIgnoreShortcut(target: any): boolean {
    if (!target || typeof target.tagName !== 'string') return false
    const tag = String(target.tagName).toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    if (target.isContentEditable === true) return true
    if (typeof target.getAttribute === 'function' && target.getAttribute('contenteditable') === 'true') return true
    return false
  }

  function onKeydown(event: any): void {
    const key = String(event.key ?? '')
    const lower = key.toLowerCase()
    const isCommandSearch = lower === 'k' && (event.ctrlKey || event.metaKey)
    const altShortcut = deps.altShortcut ? deps.altShortcut.toLowerCase() : ''
    const isAltShortcut = !!altShortcut
      && key === deps.altShortcut
      && !event.ctrlKey && !event.metaKey && !event.altKey
    if (isCommandSearch || isAltShortcut) {
      if (shouldIgnoreShortcut(event.target) && !isOpen()) return
      event.preventDefault?.()
      if (isOpen()) close(); else open()
      return
    }
    if (!isOpen()) return
    if (key === 'Escape') {
      // <dialog> handles esc natively, but normalise behaviour for jsdom.
      event.preventDefault?.()
      close()
      return
    }
    if (key === 'ArrowDown') {
      event.preventDefault?.()
      if (currentResults.length > 0) {
        highlighted = (highlighted + 1) % currentResults.length
        paintHighlight()
      }
      return
    }
    if (key === 'ArrowUp') {
      event.preventDefault?.()
      if (currentResults.length > 0) {
        highlighted = (highlighted - 1 + currentResults.length) % currentResults.length
        paintHighlight()
      }
      return
    }
    if (key === 'Enter') {
      event.preventDefault?.()
      followHighlighted()
    }
  }

  input.addEventListener('input', renderResults)
  closeBtn.addEventListener('click', () => close())
  // Click on the dialog itself (backdrop area) closes the modal.
  dialog.addEventListener('click', (event: any) => {
    if (event.target === dialog) close()
  })
  dialog.addEventListener('close', () => {
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus() } catch { /* noop */ }
    }
    previouslyFocused = null
  })

  doc.addEventListener('keydown', onKeydown)

  function dispose(): void {
    doc.removeEventListener('keydown', onKeydown)
    dialog.remove?.()
  }

  return { open, close, isOpen, dispose, dialog, input, results }
}
