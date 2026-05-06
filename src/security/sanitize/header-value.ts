/**
 * `safeHeaderValue` — sanitises HTTP header values before they cross a trust
 * boundary (proxy → upstream, app → response, etc.).
 *
 * Rules (default):
 *   - Reject CR (0x0D), LF (0x0A), NUL (0x00) — header smuggling vectors.
 *   - Reject any C0 control (< 0x20) **except** HTAB (0x09).
 *   - Reject DEL (0x7F).
 *   - Trim trailing whitespace (spaces and tabs) — RFC 7230 §3.2.4 allows
 *     stripping of optional trailing whitespace.
 *   - Length cap: 4096 characters by default.
 *   - `mode: 'reject'` (default) throws on any forbidden byte; `mode: 'strip'`
 *     silently removes them and trims again.
 *
 * Pure: zero I/O, zero protocol coupling.
 *
 * Linear scanning — no backtracking, no regex.
 */

import { SanitisationError } from './errors.js'

export type SanitiseMode = 'reject' | 'strip'

export interface SafeHeaderValueOptions {
  /** Maximum length after trimming. Default: 4096. */
  maxLength?: number
  /** Reject (throw) or strip forbidden bytes. Default: 'reject'. */
  mode?: SanitiseMode
  /**
   * Whether to allow HTAB (0x09) inside the value. Default: true.
   * Set to false to enforce strict ASCII printable + space only.
   */
  allowTab?: boolean
}

const DEFAULT_MAX_LENGTH = 4096

function hex(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`
}

export function safeHeaderValue(
  input: unknown,
  options: SafeHeaderValueOptions = {},
): string {
  const { maxLength = DEFAULT_MAX_LENGTH, mode = 'reject', allowTab = true } = options

  if (typeof input !== 'string') {
    throw new SanitisationError('header value must be a string', {
      kind: 'invalid-char',
      sink: 'header-value',
    })
  }

  // NFKC normalisation collapses confusables before validation so that
  // attackers cannot smuggle control bytes via Unicode compatibility forms.
  let value = input.normalize('NFKC')

  // Trim ASCII whitespace from the trailing edge (RFC 7230 §3.2.4 OWS).
  value = stripTrailingWhitespace(value)

  if (value.length === 0) {
    if (input.length === 0) {
      // Empty string is allowed for header values (e.g. `X-Custom: `).
      return ''
    }
    // Was non-empty but became empty after trimming — still allowed.
    return ''
  }

  if (mode === 'reject') {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (isForbiddenHeaderByte(code, allowTab)) {
        throw new SanitisationError(
          `header value contains forbidden byte ${hex(code)} at position ${i + 1}`,
          {
            kind: 'invalid-char',
            sink: 'header-value',
            position: i + 1,
            charCode: hex(code),
          },
        )
      }
    }

    if (value.length > maxLength) {
      throw new SanitisationError(
        `header value length ${value.length} exceeds limit ${maxLength}`,
        {
          kind: 'too-long',
          sink: 'header-value',
          length: value.length,
          maxLength,
        },
      )
    }

    return value
  }

  // strip mode — single linear pass, append safe chars to a buffer.
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (!isForbiddenHeaderByte(code, allowTab)) {
      out += value[i]
    }
  }

  out = stripTrailingWhitespace(out)

  if (out.length > maxLength) {
    out = out.slice(0, maxLength)
    out = stripTrailingWhitespace(out)
  }

  return out
}

function isForbiddenHeaderByte(code: number, allowTab: boolean): boolean {
  // NUL
  if (code === 0x00) return true
  // C0 control < 0x20: forbidden except HTAB when allowed
  if (code < 0x20) {
    if (allowTab && code === 0x09) return false
    return true
  }
  // DEL
  if (code === 0x7f) return true
  return false
}

function stripTrailingWhitespace(input: string): string {
  let end = input.length
  while (end > 0) {
    const code = input.charCodeAt(end - 1)
    if (code === 0x20 || code === 0x09) {
      end--
      continue
    }
    break
  }
  return end === input.length ? input : input.slice(0, end)
}
