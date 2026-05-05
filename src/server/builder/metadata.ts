import type { z } from 'zod'

import {
  createEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
} from '../../middleware/interceptors/envelope.js'
import type { EnvelopeConfig } from '../../middleware/types.js'
import type { Interceptor } from '../../types/index.js'
import type { ContractPolicies } from '../../types/index.js'
import { mergeContractPolicies } from '../../types/policies.js'
import type { RuntimeInspectionSource } from '../../inspect/index.js'

export function policyMetadataFromRouteMeta(
  meta: {
    auth?: 'required' | 'optional' | 'none'
    roles?: string[]
    rateLimit?: { limit: number; window: number }
  } | undefined
): ContractPolicies | undefined {
  if (!meta) return undefined

  return mergeContractPolicies(
    meta.auth && meta.auth !== 'none'
      ? {
          auth: {
            mode: meta.auth,
            ...(meta.roles && meta.roles.length > 0 && { roles: meta.roles }),
          },
        }
      : undefined,
    meta.rateLimit
      ? {
          rateLimit: {
            maxRequests: meta.rateLimit.limit,
            windowMs: meta.rateLimit.window,
          },
        }
      : undefined
  )
}

export function createEnvelopeInterceptorFromOptions(
  config?: boolean | EnvelopeConfig
): Interceptor | undefined {
  if (!config) return undefined
  if (config === true) return createStandardEnvelopeInterceptor()
  return createEnvelopeInterceptor(config)
}

export function programmaticSource(
  kind: RuntimeInspectionSource['kind'] = 'programmatic'
): RuntimeInspectionSource {
  return { kind, location: '<programmatic>' }
}

export type ProcedureSchema = {
  inputSchema?: z.ZodType
  outputSchema?: z.ZodType
}
