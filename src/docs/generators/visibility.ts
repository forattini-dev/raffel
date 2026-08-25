import type { HandlerMeta } from '../../types/index.js'

/** True when a runtime handler must be omitted from generated contracts/docs. */
export function isHiddenFromDocumentation(meta: Pick<HandlerMeta, 'docs'>): boolean {
  return meta.docs?.hidden === true
}
