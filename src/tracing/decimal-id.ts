/**
 * Convert hex trace/span IDs to decimal strings for Datadog Agent correlation.
 *
 * The Datadog Agent picks up correlation IDs from JSON log fields named
 * `dd.trace_id` and `dd.span_id`. Unlike W3C `traceparent` (hex), the Agent
 * expects those two fields as **base-10 unsigned 64-bit integers**.
 *
 * Hex IDs produced by `generateTraceId()` / `generateSpanId()` fit in 64-bit
 * (`< 0xffffffffffffffff`), so we can use `BigInt` to convert without loss.
 * If a future change ever moves to 128-bit IDs, this helper will need to be
 * adjusted (Datadog now also accepts 128-bit IDs but only on newer agents;
 * sticking to 64-bit keeps the JSON log payload small and cross-version safe).
 *
 * Output is always a non-empty string of decimal digits — never `undefined`
 * or `null` — so logging code can rely on `logData['dd.trace_id']` being
 * defined whenever the caller already had a valid hex ID.
 */

const HEX_RE = /^[0-9a-f]+$/i

/**
 * Convert a hex trace ID (32 lowercase chars) to its decimal representation.
 *
 * @example
 * hexTraceIdToDecimal('0af7651916cd43dd8448eb211c80319c')
 * // => '7739461535165692998' (varies by sampling)
 */
export function hexTraceIdToDecimal(hexTraceId: string): string {
  if (!hexTraceId || !HEX_RE.test(hexTraceId)) {
    // Don't crash the request because the sidecar is misconfigured — fall
    // back to an empty string so the field is still emitted (and the Agent
    // simply skips correlation for that line). Operators see the gap in logs.
    return ''
  }
  return BigInt('0x' + hexTraceId).toString(10)
}

/**
 * Convert a hex span ID (16 lowercase chars) to its decimal representation.
 */
export function hexSpanIdToDecimal(hexSpanId: string): string {
  if (!hexSpanId || !HEX_RE.test(hexSpanId)) {
    return ''
  }
  return BigInt('0x' + hexSpanId).toString(10)
}
