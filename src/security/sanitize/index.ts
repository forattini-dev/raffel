/**
 * Trust-boundary sanitisers — pure, deep module.
 *
 * Each sink:
 *   - Takes `unknown` (so adapters can pass raw values)
 *   - Normalises with NFKC before validation (defeats Unicode confusables)
 *   - Returns the cleaned string OR throws `SanitisationError`
 *   - Has no I/O, no filesystem, no protocol coupling
 *   - Uses linear scans only (no regex backtracking)
 *
 * See PRD #103 / issue #104 for the threat model.
 */

export { SanitisationError, isSanitisationError } from './errors.js'
export type {
  SanitisationErrorKind,
  SanitisationErrorOptions,
  SanitisationSink,
} from './errors.js'

export { safeHeaderValue } from './header-value.js'
export type { SafeHeaderValueOptions, SanitiseMode } from './header-value.js'

export { safeChannelName } from './channel-name.js'
export type { SafeChannelNameOptions } from './channel-name.js'

export { safeRouteSegment } from './route-segment.js'
export type { SafeRouteSegmentOptions } from './route-segment.js'

export { safeStructuredKey } from './structured-key.js'
export type { SafeStructuredKeyOptions } from './structured-key.js'
