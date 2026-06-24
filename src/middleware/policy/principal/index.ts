/**
 * Principal extraction adapters.
 *
 * Sources:
 *   - 'session' — reads `ctx.session.data.user`
 *   - 'oauth2'  — reads `ctx.auth` (set by `src/middleware/auth/oauth2.ts`)
 *   - 'oidc'    — reads `ctx.auth` with OIDC-standard claim names
 *   - 'custom'  — caller supplies `map(raw, ctx) → Principal`
 *
 * All return a `PrincipalResolver`. Override the default mapping per source
 * by passing `map` on `PrincipalConfig`.
 */

import type { Context } from '../../../types/context.js'
import type { Principal, PrincipalConfig, PrincipalSource } from '../types.js'
import { createOAuth2PrincipalResolver } from './oauth2.js'
import { createOidcPrincipalResolver } from './oidc.js'
import { createSessionPrincipalResolver } from './session.js'

export type PrincipalResolver = (ctx: Context) => Principal | Promise<Principal>

const ADAPTERS: Record<PrincipalSource, (config: PrincipalConfig) => PrincipalResolver> = {
  custom: (config) => {
    if (!config.map) {
      throw new Error("policy.principal.from === 'custom' requires `map`")
    }
    const map = config.map
    return async (ctx) => map(undefined, ctx)
  },
  session: createSessionPrincipalResolver,
  oauth2: createOAuth2PrincipalResolver,
  oidc: createOidcPrincipalResolver,
}

export function createPrincipalResolver(config: PrincipalConfig): PrincipalResolver {
  const factory = ADAPTERS[config.from]
  if (!factory) {
    throw new Error(`policy.principal.from === '${config.from}' is not a valid source`)
  }
  return factory(config)
}

export { createSessionPrincipalResolver } from './session.js'
export { createOAuth2PrincipalResolver } from './oauth2.js'
export { createOidcPrincipalResolver } from './oidc.js'
export { ANONYMOUS_PRINCIPAL, isAnonymousPrincipal } from './anonymous.js'
