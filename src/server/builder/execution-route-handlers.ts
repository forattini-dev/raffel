import type { StopTask } from '../telemetry-bootstrap.js'
import type {
  ServerRuntimePlan,
  ServerRuntimePostPortBindingStep,
} from '../runtime-plan.js'
import { setUdpAddressIfMissing } from './execution-addresses.js'
import { startManagedRuntimeResource } from './execution-runtime-resource.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

export function createExecutionRouteHandlers(context: ServerLifecycleExecutionContext) {
  const { logger, state } = context
  const { tcpServers, udpServers } = context.http

  async function executePostPortBindingHandlerStep(
    runtimePlan: ServerRuntimePlan,
    step: Extract<ServerRuntimePostPortBindingStep, { kind: 'tcp-handler' } | { kind: 'udp-handler' }>,
    registerStopTask: (task: StopTask) => void
  ) {
    switch (step.kind) {
      case 'tcp-handler': {
        const { createTcpServer } = await import('../fs-routes/tcp/index.js')
        const tcpServer = createTcpServer(step.handler)
        await startManagedRuntimeResource({
          resource: tcpServer,
          name: `tcp-handler:${step.handler.name}`,
          registerStopTask,
          start: (resource) => resource.start(),
          stop: (resource) => resource.stop(),
        })
        tcpServers.push(tcpServer)
        logger.info({ name: step.handler.name, port: step.handler.config.port }, 'TCP handler started')
        return
      }

      case 'udp-handler': {
        const { createUdpServer } = await import('../fs-routes/udp/index.js')
        const udpServer = createUdpServer(step.handler)
        await startManagedRuntimeResource({
          resource: udpServer,
          name: `udp-handler:${step.handler.name}`,
          registerStopTask,
          start: (resource) => resource.start(),
          stop: (resource) => resource.stop(),
        })
        udpServers.push(udpServer)

        setUdpAddressIfMissing(
          state.addresses,
          runtimePlan.describeUdpAddress({
            handler: step.handler,
            host: udpServer.host,
            port: udpServer.port,
          })
        )

        logger.info({ name: step.handler.name, port: step.handler.config.port }, 'UDP handler started')
      }
    }
  }

  return {
    executePostPortBindingHandlerStep,
  }
}
