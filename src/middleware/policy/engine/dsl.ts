/**
 * Match DSL Compiler.
 *
 * Compiles a `MatchNode` (declarative JSON-friendly tree) into a predicate
 * function `(input: AuthzInput) => boolean`.
 *
 * Compilation runs once per policy at startup. Predicate is the hot path —
 * no parsing, no recursion through the original tree.
 *
 * Supported:
 *   Path forms:   `principal.id`, `principal.tenantId`, `principal.scopes`,
 *                 `principal.groups`, `principal.attrs.<key>`,
 *                 `resource.id`, `resource.type`, `resource.tenantId`,
 *                 `resource.attrs.<key>`, `resource.<key>` (shorthand for attrs),
 *                 `context.<key>`, `action`
 *   Literals:     string | number | boolean | null
 *   References:   `@principal.id`, `@resource.attrs.assignedTo`, etc.
 *   Negation:     `!literal`, `!@path` (string-prefix form)
 *   Operators:    `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `notIn`, `regex`,
 *                 `startsWith`, `endsWith`, `contains`, `exists`
 *   Composition:  `anyOf`, `allOf`, `not`
 */

import type {
  AuthzInput,
  MatchLiteral,
  MatchNode,
  MatchOperator,
  MatchValue,
} from '../types.js'

export type Predicate = (input: AuthzInput) => boolean

const COMPOSITION_KEYS = new Set(['anyOf', 'allOf', 'not'])

/**
 * Compile a MatchNode into a predicate. Throws on invalid shape — call once
 * at startup so errors are surfaced before serving traffic.
 */
export function compileMatch(node: MatchNode): Predicate {
  return compileNode(node)
}

function compileNode(node: MatchNode): Predicate {
  if (node == null || typeof node !== 'object') {
    throw new TypeError(`match: expected object, got ${typeof node}`)
  }

  if (Array.isArray(node)) {
    throw new TypeError('match: top-level array is not a valid node')
  }

  const keys = Object.keys(node)

  // Composition node: { anyOf } | { allOf } | { not }
  if (keys.length === 1 && COMPOSITION_KEYS.has(keys[0]!)) {
    const key = keys[0]!
    const value = (node as Record<string, unknown>)[key]
    if (key === 'anyOf') return compileAnyOf(value)
    if (key === 'allOf') return compileAllOf(value)
    return compileNot(value)
  }

  // Path map → implicit allOf of (path → value) predicates
  if (keys.some((k) => COMPOSITION_KEYS.has(k))) {
    throw new Error(
      `match: composition keys (${[...COMPOSITION_KEYS].join('/')}) cannot share a node with path keys`,
    )
  }

  const predicates = keys.map((path) => compilePathPredicate(path, (node as Record<string, MatchValue | MatchNode | MatchNode[]>)[path]!))
  return (input) => predicates.every((p) => p(input))
}

function compileAnyOf(value: unknown): Predicate {
  if (!Array.isArray(value)) throw new TypeError('match.anyOf: expected array')
  const preds = value.map((v) => compileNode(v as MatchNode))
  return (input) => preds.some((p) => p(input))
}

function compileAllOf(value: unknown): Predicate {
  if (!Array.isArray(value)) throw new TypeError('match.allOf: expected array')
  const preds = value.map((v) => compileNode(v as MatchNode))
  return (input) => preds.every((p) => p(input))
}

function compileNot(value: unknown): Predicate {
  if (value == null || typeof value !== 'object') {
    throw new TypeError('match.not: expected node')
  }
  const inner = compileNode(value as MatchNode)
  return (input) => !inner(input)
}

function compilePathPredicate(path: string, value: MatchValue | MatchNode | MatchNode[]): Predicate {
  // Nested object that's NOT an operator → treat as nested match? No — DSL
  // says path keys map to MatchValue (literal | operator). Nested matches
  // require explicit anyOf/allOf/not.
  if (isOperatorObject(value)) {
    return compileOperator(path, value as MatchOperator)
  }

  // Literal or reference / negation string
  return compileEquality(path, value as MatchLiteral)
}

function isOperatorObject(value: unknown): value is MatchOperator {
  if (value == null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  // Distinguish from literal `null` — already excluded above.
  // Operator object MUST have exactly the operator keys.
  const ops = new Set([
    '==', '!=', '<', '<=', '>', '>=',
    'in', 'notIn', 'regex',
    'startsWith', 'endsWith', 'contains', 'exists',
  ])
  const keys = Object.keys(value as object)
  if (keys.length === 0) return false
  return keys.every((k) => ops.has(k))
}

function compileEquality(path: string, value: MatchLiteral): Predicate {
  // Wildcard literal — always passes (documents intent)
  if (value === '*') return () => true

  // Negation: '!archived' or '!@principal.id'
  if (typeof value === 'string' && value.startsWith('!')) {
    const inner = compileEquality(path, value.slice(1))
    return (input) => !inner(input)
  }

  // Reference: '@principal.id', '@resource.attrs.allowedScopes', etc.
  if (typeof value === 'string' && value.startsWith('@')) {
    const refPath = value.slice(1)
    return (input) => valuesEqual(resolvePath(input, path), resolvePath(input, refPath))
  }

  // Literal equality (incl. null check)
  return (input) => {
    const actual = resolvePath(input, path)
    return strictEqual(actual, value)
  }
}

function compileOperator(path: string, op: MatchOperator): Predicate {
  const checks: Predicate[] = []

  if ('==' in op) {
    const expected = op['==']!
    checks.push((input) => {
      const a = resolvePath(input, path)
      if (typeof expected === 'string' && expected.startsWith('@')) {
        return valuesEqual(a, resolvePath(input, expected.slice(1)))
      }
      return strictEqual(a, expected)
    })
  }
  if ('!=' in op) {
    const expected = op['!=']!
    checks.push((input) => {
      const a = resolvePath(input, path)
      if (typeof expected === 'string' && expected.startsWith('@')) {
        return !valuesEqual(a, resolvePath(input, expected.slice(1)))
      }
      return !strictEqual(a, expected)
    })
  }
  if ('<' in op) checks.push(compareOp(path, op['<']!, (a, b) => a < b))
  if ('<=' in op) checks.push(compareOp(path, op['<=']!, (a, b) => a <= b))
  if ('>' in op) checks.push(compareOp(path, op['>']!, (a, b) => a > b))
  if ('>=' in op) checks.push(compareOp(path, op['>=']!, (a, b) => a >= b))

  if ('in' in op) {
    const arg = op.in!
    checks.push((input) => {
      const a = resolvePath(input, path)
      const list = resolveListArg(input, arg)
      return list.some((item) => valuesEqual(a, item))
    })
  }
  if ('notIn' in op) {
    const arg = op.notIn!
    checks.push((input) => {
      const a = resolvePath(input, path)
      const list = resolveListArg(input, arg)
      return !list.some((item) => valuesEqual(a, item))
    })
  }
  if ('regex' in op) {
    const re = new RegExp(op.regex!)
    checks.push((input) => {
      const a = resolvePath(input, path)
      return typeof a === 'string' && re.test(a)
    })
  }
  if ('startsWith' in op) {
    const prefix = op.startsWith!
    checks.push((input) => {
      const a = resolvePath(input, path)
      return typeof a === 'string' && a.startsWith(prefix)
    })
  }
  if ('endsWith' in op) {
    const suffix = op.endsWith!
    checks.push((input) => {
      const a = resolvePath(input, path)
      return typeof a === 'string' && a.endsWith(suffix)
    })
  }
  if ('contains' in op) {
    const needle = op.contains!
    checks.push((input) => {
      const a = resolvePath(input, path)
      if (Array.isArray(a)) return a.some((x) => valuesEqual(x, needle))
      if (typeof a === 'string' && typeof needle === 'string') return a.includes(needle)
      return false
    })
  }
  if ('exists' in op) {
    const want = op.exists!
    checks.push((input) => {
      const a = resolvePath(input, path)
      return want ? a !== undefined : a === undefined
    })
  }

  return (input) => checks.every((c) => c(input))
}

function compareOp(
  path: string,
  expected: number | string,
  cmp: (a: number | string, b: number | string) => boolean,
): Predicate {
  return (input) => {
    const a = resolvePath(input, path)
    if (typeof a !== 'number' && typeof a !== 'string') return false
    if (typeof expected !== 'number' && typeof expected !== 'string') return false
    if (typeof a !== typeof expected) return false
    return cmp(a as never, expected as never)
  }
}

function resolveListArg(input: AuthzInput, arg: readonly MatchLiteral[] | string): readonly unknown[] {
  if (typeof arg === 'string' && arg.startsWith('@')) {
    const resolved = resolvePath(input, arg.slice(1))
    return Array.isArray(resolved) ? resolved : []
  }
  return arg as readonly unknown[]
}

/**
 * Resolve a dot path against the input.
 *
 * Recognised prefixes:
 *   action                              → input.action
 *   principal.id|tenantId               → input.principal.<field>
 *   principal.scopes|groups             → input.principal.<field> (array)
 *   principal.attrs.<key>               → input.principal.attrs?.[key]
 *   resource.id|type|tenantId           → input.resource.<field>
 *   resource.attrs.<key>                → input.resource.attrs?.[key]
 *   resource.<other>                    → input.resource.attrs?.[other]  (shorthand)
 *   context.<key>                       → input.context?.[key]
 */
export function resolvePath(input: AuthzInput, path: string): unknown {
  if (path === 'action') return input.action

  const dot = path.indexOf('.')
  if (dot === -1) return undefined

  const head = path.slice(0, dot)
  const tail = path.slice(dot + 1)

  if (head === 'principal') return resolvePrincipal(input, tail)
  if (head === 'resource') return resolveResource(input, tail)
  if (head === 'context') return resolveContext(input, tail)

  return undefined
}

function resolvePrincipal(input: AuthzInput, tail: string): unknown {
  const p = input.principal
  if (tail === 'id') return p.id
  if (tail === 'tenantId') return p.tenantId
  if (tail === 'scopes') return p.scopes
  if (tail === 'groups') return p.groups
  if (tail.startsWith('attrs.')) return p.attrs?.[tail.slice('attrs.'.length)]
  return undefined
}

function resolveResource(input: AuthzInput, tail: string): unknown {
  const r = input.resource
  if (tail === 'id') return r.id
  if (tail === 'type') return r.type
  if (tail === 'tenantId') return r.tenantId
  if (tail.startsWith('attrs.')) return r.attrs?.[tail.slice('attrs.'.length)]
  // Shorthand: resource.foo → resource.attrs.foo
  return r.attrs?.[tail]
}

function resolveContext(input: AuthzInput, tail: string): unknown {
  return input.context?.[tail]
}

function strictEqual(a: unknown, b: unknown): boolean {
  return a === b
}

/**
 * Equality used by `@ref` and `in`. Smarter than `===`:
 *   - array vs scalar: scalar in array → match
 *   - array vs array:  any element common → match
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.some((x) => b.some((y) => x === y))
  }
  if (Array.isArray(a)) return a.includes(b)
  if (Array.isArray(b)) return b.includes(a)
  return false
}
