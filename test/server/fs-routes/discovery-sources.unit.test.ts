/**
 * Discovery source resolution — the `explicit` flag.
 *
 * The flag is what lets the loader distinguish a *configured* directory that
 * does not exist (warn — likely the ESM relative-path footgun) from a default
 * convention directory that legitimately may not exist (silent).
 */

import { describe, it, expect } from 'vitest'
import { resolveDiscoverySources } from '../../../src/server/fs-routes/discovery-sources.js'

const BASE = '/app'

describe('resolveDiscoverySources — explicit flag', () => {
  it('marks the default-convention dir (true) as non-explicit', () => {
    const [src] = resolveDiscoverySources(BASE, true, './src/http')
    expect(src.explicit).toBe(false)
  })

  it('marks a string path as explicit', () => {
    const [src] = resolveDiscoverySources(BASE, './http', './src/http')
    expect(src.explicit).toBe(true)
  })

  it('marks a single entry object as explicit and normalises its prefix', () => {
    const [src] = resolveDiscoverySources(
      BASE,
      { dir: './domains/leads/http', prefix: '/leads/' },
      './src/http',
    )
    expect(src.explicit).toBe(true)
    expect(src.prefix).toBe('leads')
  })

  it('marks every array element as explicit', () => {
    const sources = resolveDiscoverySources(
      BASE,
      ['./a', { dir: './b', prefix: 'b' }],
      './src/http',
    )
    expect(sources).toHaveLength(2)
    expect(sources.every((s) => s.explicit)).toBe(true)
  })

  it('returns nothing for disabled slots', () => {
    expect(resolveDiscoverySources(BASE, false, './src/http')).toEqual([])
    expect(resolveDiscoverySources(BASE, undefined, './src/http')).toEqual([])
  })
})
