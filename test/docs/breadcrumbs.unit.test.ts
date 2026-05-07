import { describe, expect, it } from 'vitest'
import { resolveBreadcrumbs, type BreadcrumbSidebarItem } from '../../src/docs/ui/breadcrumbs.js'

type Case = {
  name: string
  sidebar: BreadcrumbSidebarItem[]
  active: string | null | undefined
  expected: Array<{ title: string; path: string }>
}

const sidebar: BreadcrumbSidebarItem[] = [
  { title: 'Home', path: '/' },
  {
    title: 'Guides',
    children: [
      { title: 'Getting Started', path: '/guides/getting-started' },
      { title: 'Auth', path: '/guides/auth' },
      {
        title: 'Advanced',
        path: '/guides/advanced',
        children: [
          { title: 'Sessions', path: '/guides/advanced/sessions' },
          { title: 'Policies', path: '/guides/advanced/policies' },
        ],
      },
    ],
  },
  {
    title: 'Reference',
    children: [
      { title: 'External', href: 'https://example.com/external' },
      { title: 'API', path: '/reference/api' },
    ],
  },
]

const cases: Case[] = [
  {
    name: 'top-level page → empty (single segment, hidden)',
    sidebar,
    active: '/',
    expected: [],
  },
  {
    name: 'two-level linear path',
    sidebar,
    active: '/guides/auth',
    expected: [
      { title: 'Guides', path: '' },
      { title: 'Auth', path: '/guides/auth' },
    ],
  },
  {
    name: 'three-level nested groups',
    sidebar,
    active: '/guides/advanced/sessions',
    expected: [
      { title: 'Guides', path: '' },
      { title: 'Advanced', path: '/guides/advanced' },
      { title: 'Sessions', path: '/guides/advanced/sessions' },
    ],
  },
  {
    name: 'paths absent from sidebar collapse to empty',
    sidebar,
    active: '/does/not/exist',
    expected: [],
  },
  {
    name: 'external-link-only entries are skipped (cannot anchor a chain)',
    sidebar,
    active: '/reference/api',
    expected: [
      { title: 'Reference', path: '' },
      { title: 'API', path: '/reference/api' },
    ],
  },
  {
    name: 'empty sidebar → empty result',
    sidebar: [],
    active: '/anything',
    expected: [],
  },
  {
    name: 'undefined sidebar → empty result',
    sidebar: undefined as unknown as BreadcrumbSidebarItem[],
    active: '/anything',
    expected: [],
  },
  {
    name: 'empty active path → empty result',
    sidebar,
    active: '',
    expected: [],
  },
  {
    name: 'null active path → empty result',
    sidebar,
    active: null,
    expected: [],
  },
  {
    name: 'active path normalised (no leading slash)',
    sidebar,
    active: 'guides/auth',
    expected: [
      { title: 'Guides', path: '' },
      { title: 'Auth', path: '/guides/auth' },
    ],
  },
  {
    name: 'active path normalised (trailing slash stripped)',
    sidebar,
    active: '/guides/auth/',
    expected: [
      { title: 'Guides', path: '' },
      { title: 'Auth', path: '/guides/auth' },
    ],
  },
]

describe('resolveBreadcrumbs', () => {
  it.each(cases)('$name', ({ sidebar: tree, active, expected }) => {
    expect(resolveBreadcrumbs(tree, active)).toEqual(expected)
  })

  it('does not mutate the input sidebar', () => {
    const snapshot = JSON.stringify(sidebar)
    resolveBreadcrumbs(sidebar, '/guides/advanced/sessions')
    expect(JSON.stringify(sidebar)).toBe(snapshot)
  })

  it('handles a group whose own path matches (single visible segment → empty)', () => {
    // /guides/advanced is also a clickable page. When it is the active path
    // the chain is just [Guides, Advanced]: 2 entries — visible.
    const result = resolveBreadcrumbs(sidebar, '/guides/advanced')
    expect(result).toEqual([
      { title: 'Guides', path: '' },
      { title: 'Advanced', path: '/guides/advanced' },
    ])
  })
})
