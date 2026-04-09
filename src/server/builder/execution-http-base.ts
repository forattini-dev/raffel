import type { HttpMiddleware } from '../../adapters/http.js'
import { createJsonRpcMiddleware } from '../../adapters/jsonrpc.js'
import type { ServerRuntimeHttpMiddlewareStep } from '../runtime-plan.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

type BaseHttpMiddlewareStep = Extract<
  ServerRuntimeHttpMiddlewareStep,
  | { kind: 'front-door-decision' }
  | { kind: 'custom' }
  | { kind: 'jsonrpc' }
>

export function createExecutionHttpBase(context: ServerLifecycleExecutionContext) {
  const { router } = context.core
  const { httpOptions } = context.http
  const { createFrontDoorDecisionMiddleware } = context.routing

  function executeHttpBaseStep(
    step: BaseHttpMiddlewareStep,
    httpMiddleware: HttpMiddleware[]
  ) {
    switch (step.kind) {
      case 'front-door-decision': {
        const frontDoorDecisionMiddleware = createFrontDoorDecisionMiddleware()
        if (frontDoorDecisionMiddleware) {
          httpMiddleware.push(frontDoorDecisionMiddleware)
        }
        return
      }

      case 'custom': {
        if (httpOptions?.middleware?.length) {
          httpMiddleware.push(...httpOptions.middleware)
        }
        return
      }

      case 'jsonrpc': {
        const rpcOpts = step.feature.options
        httpMiddleware.push(createJsonRpcMiddleware(router, {
          path: step.feature.path,
          timeout: rpcOpts.timeout,
          maxBodySize: rpcOpts.maxBodySize,
          cors: false,
          codecs: rpcOpts.codecs,
        }))
      }
    }
  }

  return {
    executeHttpBaseStep,
  }
}
