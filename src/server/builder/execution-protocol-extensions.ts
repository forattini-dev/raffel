import type { StopTask } from '../telemetry-bootstrap.js'
import type { ProtocolAdapterContext } from '../types.js'
import type {
  ServerRuntimePlan,
  ServerRuntimePostPortBindingStep,
} from '../runtime-plan.js'
import { setProtocolAddress } from './execution-addresses.js'
import { startManagedRuntimeResource } from './execution-runtime-resource.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

type ProtocolExtensionPostPortBindingStep = Extract<
  ServerRuntimePostPortBindingStep,
  { kind: 'protocol-extension' }
>

export function createExecutionProtocolExtensions(context: ServerLifecycleExecutionContext) {
  const { logger, state } = context
  const {
    protocolAdapters,
    resolvedProviders,
    registry,
    schemaRegistry,
    router,
  } = context.core
  const { basePath } = context.http

  function buildProtocolAdapterContext(runtimePlan: ServerRuntimePlan): ProtocolAdapterContext {
    return {
      router,
      registry,
      schemaRegistry,
      httpServer: state.httpServer.value,
      basePath,
      host: runtimePlan.effectiveHost,
      port: runtimePlan.effectivePort,
      providers: resolvedProviders,
    }
  }

  async function executePostPortBindingProtocolExtensionStep(
    runtimePlan: ServerRuntimePlan,
    step: ProtocolExtensionPostPortBindingStep,
    registerStopTask: (task: StopTask) => void
  ) {
    const extensionName = step.extension.name
    const adapter = await step.extension.factory(
      buildProtocolAdapterContext(runtimePlan),
      step.extension.options
    )
    protocolAdapters.set(extensionName, adapter)
    await startManagedRuntimeResource({
      resource: adapter,
      name: `protocol-extension:${extensionName}`,
      registerStopTask,
      start: (resource) => resource.start(),
      stop: (resource) => resource.stop(),
      afterStop: () => {
        protocolAdapters.delete(extensionName)
      },
    })

    if (adapter.address) {
      setProtocolAddress(state.addresses, extensionName, adapter.address)
    }

    logger.info({ name: extensionName }, 'Protocol adapter started')
  }

  return {
    executePostPortBindingProtocolExtensionStep,
  }
}
