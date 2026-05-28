import type { HttpMiddleware } from '../../adapters/http.js'
import type { StopTask } from '../telemetry-bootstrap.js'
import type {
  ServerRuntimeHttpMiddlewareStep,
  ServerRuntimePlan,
  ServerRuntimePostPortBindingStep,
  ServerRuntimeShutdownPhase,
  ServerRuntimeStartupPhase,
} from '../runtime-plan.js'
import { createExecutionBootstrap } from './execution-bootstrap.js'
import { createExecutionEntrypoint } from './execution-entrypoint.js'
import { createExecutionHttpBase } from './execution-http-base.js'
import { createExecutionHttpDocs } from './execution-http-docs.js'
import { createExecutionHttpGraphQL } from './execution-http-graphql.js'
import { createExecutionHttpMcp } from './execution-http-mcp.js'
import { createExecutionHttpResources } from './execution-http-resources.js'
import { createExecutionProtocolExtensions } from './execution-protocol-extensions.js'
import { createExecutionRouteHandlers } from './execution-route-handlers.js'
import { createExecutionSocketProtocols } from './execution-socket-protocols.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'
import { createExecutionWebProtocols } from './execution-web-protocols.js'

export interface ServerLifecycleExecutor {
  resetRuntimeState: () => void
  startRuntimePlan: (
    runtimePlan: ServerRuntimePlan,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (phase: ServerRuntimeShutdownPhase, task: StopTask) => void
  ) => Promise<void>
}

export interface ServerLifecycleExecutionCompat extends ServerLifecycleExecutor {
  executeStartupPhase: (
    runtimePlan: ServerRuntimePlan,
    phase: ServerRuntimeStartupPhase,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (phase: ServerRuntimeShutdownPhase, task: StopTask) => void
  ) => Promise<void>
}

export function createServerLifecycleExecutor(
  context: ServerLifecycleExecutionContext
): ServerLifecycleExecutionCompat {
  const bootstrap = createExecutionBootstrap(context)
  const entrypoint = createExecutionEntrypoint(context)
  const httpBase = createExecutionHttpBase(context)
  const httpDocs = createExecutionHttpDocs(context)
  const httpGraphQL = createExecutionHttpGraphQL(context)
  const httpMcp = createExecutionHttpMcp(context)
  const httpResources = createExecutionHttpResources(context)
  const protocolExtensions = createExecutionProtocolExtensions(context)
  const routeHandlers = createExecutionRouteHandlers(context)
  const socketProtocols = createExecutionSocketProtocols(context)
  const webProtocols = createExecutionWebProtocols(context)

  async function executeHttpMiddlewareStep(
    runtimePlan: ServerRuntimePlan,
    step: ServerRuntimeHttpMiddlewareStep,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (task: StopTask) => void
  ) {
    switch (step.kind) {
      case 'front-door-decision':
      case 'custom':
      case 'jsonrpc': {
        httpBase.executeHttpBaseStep(step, httpMiddleware)
        return
      }

      case 'override':
      case 'rest': {
        httpResources.executeHttpResourceStep(step, httpMiddleware)
        return
      }

      case 'docs': {
        httpDocs.executeHttpDocsStep(runtimePlan, step, httpMiddleware)
        return
      }

      case 'graphql': {
        httpGraphQL.executeHttpGraphQLStep(runtimePlan, step, httpMiddleware)
        return
      }

      case 'mcp': {
        await httpMcp.executeHttpMcpStep(runtimePlan, step, httpMiddleware, registerStopTask)
      }
    }
  }

  async function executePostPortBindingStep(
    runtimePlan: ServerRuntimePlan,
    step: ServerRuntimePostPortBindingStep,
    registerStopTask: (task: StopTask) => void
  ) {
    switch (step.kind) {
      case 'tcp-handler':
      case 'udp-handler': {
        await routeHandlers.executePostPortBindingHandlerStep(runtimePlan, step, registerStopTask)
        return
      }

      case 'protocol-extension': {
        await protocolExtensions.executePostPortBindingProtocolExtensionStep(
          runtimePlan,
          step,
          registerStopTask
        )
        return
      }

      case 'tcp':
      case 'grpc': {
        await socketProtocols.executePostPortBindingSocketProtocolStep(
          runtimePlan,
          step,
          registerStopTask
        )
        return
      }

      case 'shared-graphql':
      case 'websocket':
      case 'jsonrpc':
      case 'graphql': {
        await webProtocols.executePostPortBindingWebProtocolStep(step, registerStopTask)
      }
    }
  }

  async function executeStartupPhase(
    runtimePlan: ServerRuntimePlan,
    phase: ServerRuntimeStartupPhase,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (phase: ServerRuntimeShutdownPhase, task: StopTask) => void
  ) {
    switch (phase) {
      case 'providers': {
        for (const step of runtimePlan.execution.providers) {
          await bootstrap.executeProviderStep(step)
        }
        return
      }

      case 'telemetry': {
        for (const step of runtimePlan.execution.telemetry) {
          await bootstrap.executeTelemetryStep(step, (task) => registerStopTask('telemetry', task))
        }
        return
      }

      case 'discovery': {
        for (const step of runtimePlan.execution.discovery) {
          await bootstrap.executeDiscoveryStep(step, (task) => registerStopTask('discovery', task))
        }
        return
      }

      case 'http-middleware': {
        for (const step of runtimePlan.execution.httpMiddleware) {
          await executeHttpMiddlewareStep(
            runtimePlan,
            step,
            httpMiddleware,
            (task) => registerStopTask('http-middleware', task)
          )
        }
        return
      }

      case 'pre-port-binding': {
        for (const step of runtimePlan.execution.prePortBinding) {
          await entrypoint.executePrePortBindingStep(
            step,
            (task) => registerStopTask('pre-port-binding', task)
          )
        }
        return
      }

      case 'entrypoint': {
        for (const step of runtimePlan.execution.entrypoint) {
          await entrypoint.executeEntrypointStep(
            step,
            httpMiddleware,
            (task) => registerStopTask('entrypoint', task)
          )
        }
        return
      }

      case 'post-port-binding': {
        for (const step of runtimePlan.execution.postPortBinding) {
          await executePostPortBindingStep(
            runtimePlan,
            step,
            (task) => registerStopTask('post-port-binding', task)
          )
        }
        // Lazy expansion of FS-discovered TCP/UDP handlers.
        // Discovery runs during the 'discovery' phase, AFTER the plan was
        // built — so iterating handlers at build time would miss them.
        // We invoke `plan.getTcpHandlers()` / `plan.getUdpHandlers()` here
        // to pick up whatever discovery registered. Single-port (multiplex)
        // TCP/gRPC takes a different code path (kind: 'tcp' / 'grpc') and
        // is unaffected by this lazy expansion.
        for (const handler of runtimePlan.getTcpHandlers?.() ?? []) {
          await executePostPortBindingStep(
            runtimePlan,
            { kind: 'tcp-handler', handler },
            (task) => registerStopTask('post-port-binding', task)
          )
        }
        for (const handler of runtimePlan.getUdpHandlers?.() ?? []) {
          await executePostPortBindingStep(
            runtimePlan,
            { kind: 'udp-handler', handler },
            (task) => registerStopTask('post-port-binding', task)
          )
        }
      }
    }
  }

  async function startRuntimePlan(
    runtimePlan: ServerRuntimePlan,
    httpMiddleware: HttpMiddleware[],
    registerStopTask: (phase: ServerRuntimeShutdownPhase, task: StopTask) => void
  ) {
    // RuntimePlanQuery is the plan-navigation integration point from #77/#78.
    // Keep the direct execution shape as a fallback while adjacent planner work lands.
    const startupOrder = runtimePlan.query?.getStartupOrder() ?? runtimePlan.execution.startup
    for (const phase of startupOrder) {
      await executeStartupPhase(runtimePlan, phase, httpMiddleware, registerStopTask)
    }
  }

  return {
    resetRuntimeState: bootstrap.resetRuntimeState,
    executeStartupPhase,
    startRuntimePlan,
  }
}
