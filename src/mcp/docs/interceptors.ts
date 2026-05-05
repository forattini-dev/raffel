/**
 * Raffel MCP - Interceptor Documentation
 *
 * Built-in interceptors with options, examples, and use cases.
 */

import type { InterceptorDoc } from '../types.js'
import { interceptors } from './interceptors-data.js'
export { interceptors, interceptorsByCategory } from './interceptors-data.js'

export function getInterceptor(name: string): InterceptorDoc | undefined {
  return interceptors.find((i) => i.name === name)
}

export function listInterceptors(category?: string): InterceptorDoc[] {
  if (category) {
    return interceptors.filter((i) => i.category === category)
  }
  return interceptors
}
