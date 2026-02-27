import type { Interceptor } from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import { createValidationInterceptor } from '../validation/index.js'

export interface InterceptorNormalizationOptions {
  envelopeInterceptor?: Interceptor
  schema?: HandlerSchema
}

export function normalizeInterceptors(
  interceptors: Interceptor[],
  options: InterceptorNormalizationOptions = {}
): Interceptor[] {
  const { envelopeInterceptor, schema } = options

  const hasSchema = Boolean(schema && (schema.input || schema.output))

  let normalized = hasSchema
    ? [createValidationInterceptor(schema as HandlerSchema), ...interceptors]
    : interceptors

  if (!envelopeInterceptor) {
    return normalized
  }

  const envelopeIndex = normalized.indexOf(envelopeInterceptor)
  if (envelopeIndex === -1) {
    return [envelopeInterceptor, ...normalized]
  }

  if (envelopeIndex > 0) {
    const withEnvelope = [...normalized]
    withEnvelope.splice(envelopeIndex, 1)
    withEnvelope.unshift(envelopeInterceptor)
    return withEnvelope
  }

  return normalized
}

