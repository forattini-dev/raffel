/**
 * HTML helpers for Raffel templates and safe response rendering.
 */

export interface HtmlEscapedString {
  readonly __value: string
  toString(): string
  valueOf(): string
}

class EscapedHtml implements HtmlEscapedString {
  readonly __value: string

  constructor(value: string) {
    this.__value = value
  }

  toString(): string {
    return this.__value
  }

  valueOf(): string {
    return this.__value
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
}

function renderValue(value: unknown): string {
  if (value == null) return ''
  if (value instanceof EscapedHtml) return value.toString()

  const asString = typeof value === 'string' ? value : String(value)
  return escapeHtml(asString)
}

export function raw(value: unknown): HtmlEscapedString {
  const asString = value == null ? '' : typeof value === 'string' ? value : String(value)
  return new EscapedHtml(asString)
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlEscapedString {
  let result = strings[0] ?? ''

  for (let i = 0; i < values.length; i++) {
    result += renderValue(values[i])
    result += strings[i + 1] ?? ''
  }

  return new EscapedHtml(result)
}
