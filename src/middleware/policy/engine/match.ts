/**
 * Glob pattern matching for policy principals / actions / resources.
 *
 * Supports:
 *   - `*`     — any single segment, does NOT cross `.` or `:`
 *   - `**`    — globstar, crosses dots and colons
 *   - `?`     — exactly one character (excluding `.` and `:`)
 *   - `{a,b}` — alternation: matches literal `a` or `b`
 *   - `[abc]` — character class (also supports ranges: `[a-z]`)
 *
 * "Segment" boundaries are dots (`.`) and colons (`:`). Other characters
 * including hyphens are treated as literal.
 */

const SEGMENT_CHAR_CLASS = '[^.:]*'
const SEGMENT_SINGLE_CHAR = '[^.:]'
const ANY_CHAR_CLASS = '.*'

/**
 * Compile a glob pattern into a regex anchored at both ends.
 *
 * Walks the pattern char-by-char to handle nested constructs correctly:
 *   - `**` (globstar) recognised before `*` to avoid double substitution
 *   - `[...]` — char-class body copied verbatim (regex syntax compatible)
 *   - `{a,b,c}` — alternation expanded to `(?:a|b|c)` with inner glob escape
 */
export function compileGlob(pattern: string): RegExp {
  let out = ''
  let i = 0
  const n = pattern.length

  while (i < n) {
    const ch = pattern[i]!

    // Globstar
    if (ch === '*' && pattern[i + 1] === '*') {
      out += ANY_CHAR_CLASS
      i += 2
      continue
    }

    // Single star — segment-bounded
    if (ch === '*') {
      out += SEGMENT_CHAR_CLASS
      i++
      continue
    }

    // Single-char wildcard
    if (ch === '?') {
      out += SEGMENT_SINGLE_CHAR
      i++
      continue
    }

    // Character class — body copied verbatim (regex char-class syntax matches)
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        out += '\\['
        i++
        continue
      }
      out += pattern.slice(i, close + 1)
      i = close + 1
      continue
    }

    // Alternation { a, b, c } → (?:a|b|c)
    if (ch === '{') {
      const close = pattern.indexOf('}', i + 1)
      if (close === -1) {
        out += '\\{'
        i++
        continue
      }
      const inner = pattern.slice(i + 1, close)
      const alts = inner.split(',').map(escapeRegexLiteral)
      out += `(?:${alts.join('|')})`
      i = close + 1
      continue
    }

    // Regex special — escape
    if (/[.+?^${}()|\\]/.test(ch)) {
      out += `\\${ch}`
      i++
      continue
    }

    // Literal
    out += ch
    i++
  }

  return new RegExp(`^${out}$`)
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Test whether a single value matches any of the compiled patterns.
 */
export function matchAnyCompiled(value: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(value)) return true
  }
  return false
}

/**
 * Bidirectional match: a policy pattern is satisfied if ANY value in the set
 * matches it OR if a wildcard-bearing value matches the policy pattern.
 *
 * Used for principals — a principal carrying a broad scope (e.g. `lead.**`)
 * satisfies a narrower policy pattern (`scope:lead.read`).
 */
export function matchSetBidirectional(
  set: readonly string[],
  policyPatterns: readonly string[],
  compiledPolicyPatterns: readonly RegExp[],
): boolean {
  for (let i = 0; i < policyPatterns.length; i++) {
    const literal = policyPatterns[i]!
    const compiled = compiledPolicyPatterns[i]!

    for (const value of set) {
      if (compiled.test(value)) return true
      // Reverse: a value bearing wildcards (broad scope) matches the policy literal.
      if (/[*?{[]/.test(value)) {
        const reverseRe = compileGlob(value)
        if (reverseRe.test(literal)) return true
      }
    }
  }
  return false
}
