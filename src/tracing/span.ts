/**
 * Span Implementation
 *
 * In-flight span that tracks timing, attributes, and logs.
 */

import type {
  Span,
  SpanContext,
  SpanData,
  SpanKind,
  SpanStatus,
  SpanAttributes,
  SpanLogEntry,
} from './types.js'

export interface SpanOptions {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: SpanKind
  isRecording: boolean
  attributes?: SpanAttributes
}

/**
 * Create a new Span instance
 */
export function createSpan(options: SpanOptions): Span {
  let name = options.name
  const startTime = performance.now() * 1000 // Convert to microseconds
  let endTime = 0
  let finished = false

  const attributes: SpanAttributes = { ...options.attributes }
  const logs: SpanLogEntry[] = []
  const status: SpanStatus = { code: 'unset' }

  const context: SpanContext = {
    traceId: options.traceId,
    spanId: options.spanId,
    traceFlags: options.isRecording ? 1 : 0,
  }

  const span: Span = {
    get context() {
      return context
    },

    get name() {
      return name
    },

    get isRecording() {
      return options.isRecording && !finished
    },

    setAttribute(key, value) {
      if (this.isRecording) {
        attributes[key] = value
      }
      return this
    },

    setAttributes(attrs) {
      if (this.isRecording) {
        Object.assign(attributes, attrs)
      }
      return this
    },

    log(message, fields) {
      if (this.isRecording) {
        logs.push({
          timestamp: performance.now() * 1000,
          message,
          fields,
        })
      }
      return this
    },

    setStatus(code, message) {
      if (this.isRecording) {
        status.code = code
        status.message = message
      }
      return this
    },

    recordError(error) {
      if (this.isRecording) {
        status.code = 'error'
        status.message = error.message

        attributes['error.type'] = error.name
        attributes['error.message'] = error.message
        if (error.stack) {
          attributes['error.stack'] = error.stack
        }

        logs.push({
          timestamp: performance.now() * 1000,
          message: 'Error',
          fields: {
            'error.type': error.name,
            'error.message': error.message,
            'error.stack': error.stack,
          },
        })
      }
      return this
    },

    updateName(newName) {
      if (this.isRecording) {
        name = newName
      }
      return this
    },

    finish() {
      if (!finished) {
        finished = true
        endTime = performance.now() * 1000
        if (status.code === 'unset') {
          status.code = 'ok'
        }
      }
    },

    toSpanData(): SpanData {
      const effectiveEndTime = finished ? endTime : performance.now() * 1000

      return {
        traceId: options.traceId,
        spanId: options.spanId,
        parentSpanId: options.parentSpanId,
        name,
        kind: options.kind,
        startTime,
        endTime: effectiveEndTime,
        duration: effectiveEndTime - startTime,
        status: { ...status },
        attributes: { ...attributes },
        logs: [...logs],
        context: { ...context },
      }
    },
  }

  return span
}

/**
 * Generate a random ID of specified length (hex string)
 */
export function generateId(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a 32-character trace ID
 */
export function generateTraceId(): string {
  return generateId(32)
}

/**
 * Generate a 16-character span ID
 */
export function generateSpanId(): string {
  return generateId(16)
}
