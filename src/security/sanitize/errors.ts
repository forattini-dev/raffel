/**
 * Tagged error class for trust-boundary sanitiser failures.
 *
 * Each sink throws a `SanitisationError` with a `kind` discriminator and
 * a `sink` label so callers can branch on the failure mode without
 * pattern-matching on message strings.
 */

export type SanitisationErrorKind = 'invalid-char' | 'too-long' | 'empty'

export type SanitisationSink =
  | 'header-value'
  | 'channel-name'
  | 'route-segment'
  | 'structured-key'

export interface SanitisationErrorOptions {
  kind: SanitisationErrorKind
  sink: SanitisationSink
  /** 1-based index into the input where the offending character lives, when applicable. */
  position?: number
  /** Hex code-point of the offending character, when applicable. */
  charCode?: string
  /** Length observed when `kind === 'too-long'`. */
  length?: number
  /** Configured maximum length when `kind === 'too-long'`. */
  maxLength?: number
}

export class SanitisationError extends Error {
  readonly name = 'SanitisationError'
  readonly kind: SanitisationErrorKind
  readonly sink: SanitisationSink
  readonly position?: number
  readonly charCode?: string
  readonly length?: number
  readonly maxLength?: number

  constructor(message: string, options: SanitisationErrorOptions) {
    super(message)
    this.kind = options.kind
    this.sink = options.sink
    this.position = options.position
    this.charCode = options.charCode
    this.length = options.length
    this.maxLength = options.maxLength
  }
}

export function isSanitisationError(value: unknown): value is SanitisationError {
  return value instanceof SanitisationError
}
