/**
 * applyResourceMap()
 *
 * Per-operation resource registration logic extracted from
 * server/builder.ts to collapse the cognitive complexity of the
 * builder's `resources()` method (was 50).
 *
 * Each REST operation (list / get / create / update / patch / delete /
 * actions / itemActions) becomes its own narrow helper, and the entry
 * point loops over them once per resource.
 *
 * Behaviour-preserving extraction.
 */

import type { z } from 'zod'
import type { HttpMethod } from '../../types/index.js'
import type {
  ProcedureHandler,
} from '../../types/index.js'
import type {
  AddProcedureInput,
  ResourceDef,
  ResourceMap,
} from '../types.js'
import type { ContractPolicies, Interceptor } from '../../types/index.js'
import type { RuntimeInspectionOperationRegistration } from '../../inspect/index.js'

interface ResourceLogger {
  debug(obj: object | string, msg?: string): void
}

interface RegisterProcedureInput {
  name: string
  handler: ProcedureHandler
  inputSchema?: z.ZodType
  outputSchema?: z.ZodType
  summary?: string
  description?: string
  tags?: string[]
  graphql?: AddProcedureInput['graphql']
  httpPath?: AddProcedureInput['httpPath']
  httpMethod?: AddProcedureInput['httpMethod']
  jsonrpc?: AddProcedureInput['jsonrpc']
  grpc?: AddProcedureInput['grpc']
  policies?: ContractPolicies
  interceptors?: Interceptor[]
  registration?: RuntimeInspectionOperationRegistration
}

export interface ApplyResourceMapContext {
  registerProcedureOperation: (input: RegisterProcedureInput) => void
  logger: ResourceLogger
}

function makeOpRegistrar(name: string, def: ResourceDef, ctx: ApplyResourceMapContext) {
  const tags = def.tags ?? [name]
  return (
    opName: string,
    handler: Function,
    method: HttpMethod,
    path: string,
    inputSchema?: z.ZodType,
  ) => {
    ctx.registerProcedureOperation({
      name: `${name}.${opName}`,
      handler: handler as ProcedureHandler,
      inputSchema,
      outputSchema: def.schema,
      tags,
      httpPath: path,
      httpMethod: method,
      summary: `${opName.charAt(0).toUpperCase() + opName.slice(1)} ${name}`,
      interceptors: def.use ?? [],
    })
  }
}

function applyListOp(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.list) return
  const listDef = def.list
  if (typeof listDef === 'function') {
    registerOp('list', listDef, 'GET', basePath, undefined)
  } else {
    registerOp('list', listDef.handler, 'GET', basePath, listDef.input)
  }
}

function applyGetOp(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.get) return
  registerOp(
    'get',
    async (input: { id: string }, ctx: any) => def.get!(input.id, ctx),
    'GET',
    `${basePath}/:id`,
  )
}

function applyCreateOp(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.create) return
  const createDef = def.create
  if (typeof createDef === 'function') {
    registerOp('create', createDef, 'POST', basePath, undefined)
  } else {
    registerOp('create', createDef.handler, 'POST', basePath, createDef.input)
  }
}

function applyUpdateOp(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.update) return
  const updateDef = def.update
  if (typeof updateDef === 'function') {
    const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
      updateDef(input.id, input, ctx)
    registerOp('update', handler, 'PUT', `${basePath}/:id`, undefined)
  } else {
    const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
      updateDef.handler(input.id, input, ctx)
    registerOp('update', handler, 'PUT', `${basePath}/:id`, updateDef.input)
  }
}

function applyPatchOp(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.patch) return
  const patchDef = def.patch
  if (typeof patchDef === 'function') {
    const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
      patchDef(input.id, input, ctx)
    registerOp('patch', handler, 'PATCH', `${basePath}/:id`, undefined)
  } else {
    const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
      patchDef.handler(input.id, input, ctx)
    registerOp('patch', handler, 'PATCH', `${basePath}/:id`, patchDef.input)
  }
}

function applyDeleteOp(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.delete) return
  registerOp(
    'delete',
    async (input: { id: string }, ctx: any) => def.delete!(input.id, ctx),
    'DELETE',
    `${basePath}/:id`,
  )
}

function applyCollectionActions(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.actions) return
  for (const [actionName, action] of Object.entries(def.actions)) {
    registerOp(actionName, action.handler, 'POST', `${basePath}/${actionName}`, action.input)
  }
}

function applyItemActions(registerOp: ReturnType<typeof makeOpRegistrar>, def: ResourceDef, basePath: string): void {
  if (!def.itemActions) return
  for (const [actionName, action] of Object.entries(def.itemActions)) {
    const isObj = typeof action === 'object' && 'handler' in action
    const handler = isObj
      ? async (input: { id: string } & Record<string, unknown>, ctx: any) =>
          action.handler(input.id, input, ctx)
      : async (input: { id: string }, ctx: any) => (action as Function)(input.id, ctx)
    const inputSchema = isObj ? action.input : undefined
    registerOp(actionName, handler, 'POST', `${basePath}/:id/${actionName}`, inputSchema)
  }
}

/**
 * Apply a `ResourceMap` to the server registry. Mirrors the previous
 * inline `resources()` body — for each named resource def, registers
 * every declared operation (list/get/create/update/patch/delete) plus
 * any custom collection or item actions.
 */
export function applyResourceMap(map: ResourceMap, ctx: ApplyResourceMapContext): void {
  for (const [name, def] of Object.entries(map)) {
    const basePath = def.basePath ?? `/${name}`
    const registerOp = makeOpRegistrar(name, def, ctx)

    applyListOp(registerOp, def, basePath)
    applyGetOp(registerOp, def, basePath)
    applyCreateOp(registerOp, def, basePath)
    applyUpdateOp(registerOp, def, basePath)
    applyPatchOp(registerOp, def, basePath)
    applyDeleteOp(registerOp, def, basePath)
    applyCollectionActions(registerOp, def, basePath)
    applyItemActions(registerOp, def, basePath)

    ctx.logger.debug({ name, basePath, operations: Object.keys(def).length }, 'Added resource from map')
  }
}
