import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('package metadata is present', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
    name?: string
    version?: string
  }

  assert.equal(pkg.name, 'raffel')
  assert.ok(pkg.version)
})
