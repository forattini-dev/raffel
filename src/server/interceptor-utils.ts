import type { Interceptor } from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import {
  createValidationInterceptor,
  isOutputValidationInterceptor,
  splitValidationInterceptor,
} from '../validation/index.js'

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

/** Put cache after input/auth interceptors but before output validation. */
export function insertCacheInterceptor(
  interceptors: Interceptor[],
  cacheInterceptor: Interceptor,
): Interceptor[] {
  const outputIndex = interceptors.findIndex(isOutputValidationInterceptor)
  if (outputIndex !== -1) {
    return [
      ...interceptors.slice(0, outputIndex),
      cacheInterceptor,
      ...interceptors.slice(outputIndex),
    ]
  }

  for (let index = 0; index < interceptors.length; index++) {
    const split = splitValidationInterceptor(interceptors[index]!)
    if (!split) continue
    return [
      ...interceptors.slice(0, index),
      ...(split.input ? [split.input] : []),
      ...interceptors.slice(index + 1),
      cacheInterceptor,
      ...(split.output ? [split.output] : []),
    ]
  }
  return [...interceptors, cacheInterceptor]
}
