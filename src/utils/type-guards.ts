/**
 * Check if a value is an AsyncIterable.
 */
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof value === 'object' && Symbol.asyncIterator in value
}
