import type { Logger } from 'pino'
import type { StopTask } from '../telemetry-bootstrap.js'
import type { ProviderDefinition } from '../types.js'

interface ProviderDefinitionMap {
  get(name: string): ProviderDefinition | undefined
  [Symbol.iterator](): IterableIterator<[string, ProviderDefinition]>
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

