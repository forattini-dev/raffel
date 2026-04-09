import type { Logger } from 'pino'
import type { StopTask } from '../telemetry-bootstrap.js'
import type { ProviderDefinition } from '../types.js'
import type { ServerRuntimeShutdownPhase } from '../runtime-plan.js'

interface ProviderDefinitionMap {
  get(name: string): ProviderDefinition | undefined
  [Symbol.iterator](): IterableIterator<[string, ProviderDefinition]>
}

export type ShutdownTaskBuckets = Partial<Record<ServerRuntimeShutdownPhase, StopTask[]>>

export interface ActiveShutdownPlan {
  phases: ServerRuntimeShutdownPhase[]
  tasksByPhase: ShutdownTaskBuckets
}

export interface RuntimeTaskRegistry {
  register: (phase: ServerRuntimeShutdownPhase, task: StopTask) => void
  snapshot: (phases: ServerRuntimeShutdownPhase[]) => ActiveShutdownPlan
  rollback: (logger: Logger, phase?: string) => Promise<void>
}

export async function runStopTasks(tasks: StopTask[], phase: string, logger: Logger): Promise<void> {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i]
    try {
      await task.stop()
    } catch (err) {
      logger.error(
        {
          err,
          component: task.name,
          phase,
        },
        `Failed to stop "${task.name}" during ${phase}`
      )
    }
  }
}

export function createRuntimeTaskRegistry(): RuntimeTaskRegistry {
  const startupStopTasks: StopTask[] = []
  const shutdownTasksByPhase: ShutdownTaskBuckets = {}

  return {
    register(phase, task) {
      startupStopTasks.push(task)
      if (!shutdownTasksByPhase[phase]) {
        shutdownTasksByPhase[phase] = []
      }
      shutdownTasksByPhase[phase]!.push(task)
    },

    snapshot(phases) {
      return {
        phases: [...phases],
        tasksByPhase: Object.fromEntries(
          Object.entries(shutdownTasksByPhase).map(([phase, tasks]) => [phase, [...tasks]])
        ) as ShutdownTaskBuckets,
      }
    },

    async rollback(logger, phase = 'startup') {
      await runStopTasks(startupStopTasks, phase, logger)
    },
  }
}

export async function runActiveShutdownPlan(
  plan: ActiveShutdownPlan,
  logger: Logger,
  phaseHandlers: Partial<Record<ServerRuntimeShutdownPhase, () => Promise<void>>> = {}
): Promise<void> {
  for (const phase of plan.phases) {
    const phaseHandler = phaseHandlers[phase]
    if (phaseHandler) {
      try {
        await phaseHandler()
      } catch (err) {
        logger.error({ err, phase }, `Failed to complete shutdown phase "${phase}"`)
      }
      continue
    }

    await runStopTasks(plan.tasksByPhase[phase] ?? [], `shutdown:${phase}`, logger)
  }
}

export async function cleanupResolvedProviders(
  resolvedProviders: Record<string, unknown>,
  providerDefinitions: ProviderDefinitionMap,
  phase: string,
  logger: Logger
): Promise<void> {
  for (const [name, definition] of providerDefinitions) {
    if (definition.onShutdown && resolvedProviders[name]) {
      try {
        await definition.onShutdown(resolvedProviders[name])
        logger.debug({ name, phase }, `Provider shut down`)
      } catch (err) {
        logger.error({ err, name, phase }, 'Error shutting down provider')
      }
    }
  }

  for (const key of Object.keys(resolvedProviders)) {
    delete resolvedProviders[key]
  }
}
