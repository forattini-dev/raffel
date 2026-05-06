import type { ServerLifecycleExecutionContext } from './execution-types.js'
import { createServerLifecycleExecutor } from './lifecycle-executor.js'

export function createServerLifecycleExecution(context: ServerLifecycleExecutionContext) {
  return createServerLifecycleExecutor(context)
}

export { createServerLifecycleExecutor } from './lifecycle-executor.js'
export type {
  ServerLifecycleExecutionCompat,
  ServerLifecycleExecutor,
} from './lifecycle-executor.js'
