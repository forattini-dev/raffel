import { describe, expect, it } from 'vitest'
import { flattenReadingOrder, prevNext } from '../../src/docs/ui/page-nav.js'
import type { DocsSidebarItem } from '../../src/docs/ui/types.js'

describe('flattenReadingOrder', () => {
  const cases: Array<{ name: string; tree: DocsSidebarItem[]; expected: Array<{ title: string; path: string }> }> = [
    {
      name: 'linear order: list of pages preserved',
      tree: [
        { title: 'Intro', path: '/intro' },
        { title: 'Setup', path: '/setup' },
        { title: 'Deploy', path: '/deploy' },
      ],
      expected: [
        { title: 'Intro', path: '/intro' },
        { title: 'Setup', path: '/setup' },
        { title: 'Deploy', path: '/deploy' },
      ],
    },
    {
      name: 'nested groups: depth-first walk, group headings skipped',
      tree: [
        { title: 'Home', path: '/' },
        {
          title: 'Guides',
          children: [
            { title: 'Quickstart', path: '/guides/quickstart' },
            { title: 'Concepts', path: '/guides/concepts' },
          ],
        },
        {
          title: 'Reference',
          children: [
            { title: 'API', path: '/reference/api' },
            {
              title: 'Internals',
              children: [
                { title: 'Router', path: '/reference/internals/router' },
              ],
            },
          ],
        },
      ],
      expected: [
        { title: 'Home', path: '/' },
        { title: 'Quickstart', path: '/guides/quickstart' },
        { title: 'Concepts', path: '/guides/concepts' },
        { title: 'API', path: '/reference/api' },
        { title: 'Router', path: '/reference/internals/router' },
      ],
    },
    {
      name: 'external links: items with href but no path are skipped',
      tree: [
        { title: 'Home', path: '/' },
        { title: 'GitHub', href: 'https://github.com/forattini-dev/raffel' },
        { title: 'API', path: '/api' },
      ],
      expected: [
        { title: 'Home', path: '/' },
        { title: 'API', path: '/api' },
      ],
    },
    {
      name: 'mixed group with own path: group page included before children',
      tree: [
        {
          title: 'Guides',
          path: '/guides',
          children: [
            { title: 'Quickstart', path: '/guides/quickstart' },
          ],
        },
      ],
      expected: [
        { title: 'Guides', path: '/guides' },
        { title: 'Quickstart', path: '/guides/quickstart' },
      ],
    },
    {
      name: 'empty tree returns empty array',
      tree: [],
      expected: [],
    },
  ]

  for (const { name, tree, expected } of cases) {
    it(name, () => {
      expect(flattenReadingOrder(tree)).toEqual(expected)
    })
  }

  it('handles undefined input safely', () => {
    expect(flattenReadingOrder(undefined)).toEqual([])
  })
})

describe('prevNext', () => {
  const linear = [
    { title: 'Intro', path: '/intro' },
    { title: 'Setup', path: '/setup' },
    { title: 'Deploy', path: '/deploy' },
  ]

  it('first page: only next, no prev', () => {
    expect(prevNext('/intro', linear)).toEqual({ next: { title: 'Setup', path: '/setup' } })
  })

  it('middle page: both prev and next', () => {
    expect(prevNext('/setup', linear)).toEqual({
      prev: { title: 'Intro', path: '/intro' },
      next: { title: 'Deploy', path: '/deploy' },
    })
  })

  it('last page: only prev, no next', () => {
    expect(prevNext('/deploy', linear)).toEqual({ prev: { title: 'Setup', path: '/setup' } })
  })

  it('single-page sidebar: no neighbours', () => {
    expect(prevNext('/intro', [{ title: 'Intro', path: '/intro' }])).toEqual({})
  })

  it('unknown active path: no neighbours', () => {
    expect(prevNext('/missing', linear)).toEqual({})
  })

  it('opted-out pages are skipped over from both sides', () => {
    const order = [
      { title: 'A', path: '/a' },
      { title: 'B', path: '/b' },
      { title: 'C', path: '/c' },
      { title: 'D', path: '/d' },
    ]
    const optedOut = new Set(['/b'])
    expect(prevNext('/a', order, optedOut)).toEqual({ next: { title: 'C', path: '/c' } })
    expect(prevNext('/c', order, optedOut)).toEqual({
      prev: { title: 'A', path: '/a' },
      next: { title: 'D', path: '/d' },
    })
  })

  it('opted-out at the boundary: caller still has the right neighbour on the other side', () => {
    const order = [
      { title: 'A', path: '/a' },
      { title: 'B', path: '/b' },
      { title: 'C', path: '/c' },
    ]
    expect(prevNext('/b', order, new Set(['/a']))).toEqual({ next: { title: 'C', path: '/c' } })
    expect(prevNext('/b', order, new Set(['/c']))).toEqual({ prev: { title: 'A', path: '/a' } })
  })

  it('empty order returns empty result', () => {
    expect(prevNext('/intro', [])).toEqual({})
  })

  it('null/undefined active path returns empty result', () => {
    expect(prevNext(undefined, linear)).toEqual({})
    expect(prevNext(null, linear)).toEqual({})
  })
})
