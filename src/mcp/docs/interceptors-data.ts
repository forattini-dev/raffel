import { interceptors } from './interceptors-core-data.js'
import { addExtendedInterceptors } from './interceptors-extended-data.js'

addExtendedInterceptors(interceptors)

export { interceptors }

export const interceptorsByCategory = {
  auth: interceptors.filter((i) => i.category === 'auth'),
  resilience: interceptors.filter((i) => i.category === 'resilience'),
  observability: interceptors.filter((i) => i.category === 'observability'),
  validation: interceptors.filter((i) => i.category === 'validation'),
  caching: interceptors.filter((i) => i.category === 'caching'),
  composition: interceptors.filter((i) => i.category === 'composition'),
}
