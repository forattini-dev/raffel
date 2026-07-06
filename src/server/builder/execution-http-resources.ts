import type { HttpMiddleware } from '../../adapters/http.js'
import {
  createHttpOverrideMiddleware,
  createRestMiddleware,
  logRestMiddlewareRegistered,
} from '../rest-middleware.js'
import type { ServerRuntimeHttpMiddlewareStep } from '../runtime-plan.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

type ResourceHttpMiddlewareStep = Extract<
  ServerRuntimeHttpMiddlewareStep,
  | { kind: 'override' }
  | { kind: 'rest' }
>

export function createExecutionHttpResources(context: ServerLifecycleExecutionContext) {
  const { registry, router } = context.core
  const { restResourceRegistry, basePath } = context.http
  const { telemetryState } = context.bootstrap

  function executeHttpResourceStep(
    step: ResourceHttpMiddlewareStep,
    httpMiddleware: HttpMiddleware[]
  ) {
    switch (step.kind) {
      case 'override': {
        httpMiddleware.push(
          createHttpOverrideMiddleware({
            router,
            registry,
            basePath,
            maxBodySize: step.feature.maxBodySize,
            contextFactory: step.feature.contextFactory,
            codecs: step.feature.codecs,
            trustedProxies: step.feature.trustedProxies,
            tracer: telemetryState.tracerInstance ?? undefined,
          })
        )
        return
      }

      case 'rest': {
        httpMiddleware.push(
          createRestMiddleware({
            restResources: restResourceRegistry,
            router,
            registry,
            basePath,
            maxBodySize: step.feature.maxBodySize,
            contextFactory: step.feature.contextFactory,
            codecs: step.feature.codecs,
            trustedProxies: step.feature.trustedProxies,
            tracer: telemetryState.tracerInstance ?? undefined,
          })
        )
        logRestMiddlewareRegistered(restResourceRegistry.length)
      }
    }
  }

  return {
    executeHttpResourceStep,
  }
}
