import type { IncomingHttpHeaders } from 'node:http'
import type { Context } from '../../types/index.js'
import type { BodyInit, HeadersInit } from '../../http/web-types.js'

type HttpFacadeOptions = {
  preferFacadeKeys?: boolean
}

type FetchRequestInit = ConstructorParameters<typeof Request>[1]
type FetchResponseBody = ConstructorParameters<typeof Response>[0]

const HTTP_FACADE_KEYS = new Set<PropertyKey>([
  'req',
  'res',
  'runtime',
  'input',
  'set',
  'get',
  'var',
  'header',
  'status',
  'json',
  'text',
  'html',
  'body',
  'redirect',
  'notFound',
  'newResponse',
])

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function normalizeHeaders(headers: Readonly<Record<string, string>> | IncomingHttpHeaders | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }

  return result
}

function normalizeQuery(query: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!query) return result

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    result[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }

  return result
}

function mergeResponseHeaders(base: Headers, headers?: HeadersInit): Headers {
  const merged = new Headers(headers)
  base.forEach((value, key) => {
    if (!merged.has(key)) {
      merged.set(key, value)
    }
  })
  return merged
}

function encodeBodyAsText(value: unknown, rawBody: Buffer | undefined): string {
  if (rawBody) return rawBody.toString('utf-8')
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

function encodeBodyAsArrayBuffer(value: unknown, rawBody: Buffer | undefined): ArrayBuffer {
  const buffer = rawBody ?? Buffer.from(encodeBodyAsText(value, undefined))
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return arrayBuffer
}

function toFetchResponseBody(data: BodyInit): FetchResponseBody {
  return data as unknown as FetchResponseBody
}

function createRawRequest(ctx: Context, headers: Record<string, string>, rawBody: Buffer | undefined): Request {
  const method = ctx.http?.method ?? 'GET'
  const init: FetchRequestInit = {
    method,
    headers,
  }
  if (rawBody && method !== 'GET' && method !== 'HEAD') {
    init.body = encodeBodyAsArrayBuffer('', rawBody)
  }
  return new Request(ctx.http?.url ?? 'http://localhost/', init)
}

function createHttpFacade(input: unknown, ctx: Context): Record<PropertyKey, unknown> {
  const params = { ...ctx.input.params, ...((ctx as { params?: Record<string, string> }).params ?? {}) }
  const query = {
    ...ctx.input.query,
    ...((ctx as { query?: Record<string, unknown> }).query ?? {}),
  }
  const headers = normalizeHeaders(ctx.http?.headers ?? ctx.http?.req?.headers)
  const responseHeaders = new Headers()
  let responseStatus = 200
  const variables: Record<string, unknown> = {}
  const rawBody = ctx.http?.rawBody
  const bodyInput = ctx.input.body ?? input

  const req = {
    raw: createRawRequest(ctx, headers, rawBody),
    method: ctx.http?.method ?? '',
    url: ctx.http?.url ?? '',
    path: ctx.http?.path ?? '',
    param(name?: string) {
      return name === undefined ? { ...params } : params[name]
    },
    query(name?: string) {
      const normalized = normalizeQuery(query)
      return name === undefined ? normalized : normalized[name]
    },
    header(name?: string) {
      return name === undefined ? { ...headers } : headers[name.toLowerCase()]
    },
    async json<T = unknown>(): Promise<T> {
      return bodyInput as T
    },
    async parseBody<T = Record<string, unknown>>(): Promise<T> {
      if (bodyInput && typeof bodyInput === 'object') return bodyInput as T
      if (bodyInput === undefined || bodyInput === null || bodyInput === '') return {} as T
      return { body: bodyInput } as T
    },
    async text(): Promise<string> {
      return encodeBodyAsText(bodyInput, rawBody)
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      return encodeBodyAsArrayBuffer(bodyInput, rawBody)
    },
    async blob(): Promise<Blob> {
      return new Blob([await this.arrayBuffer()])
    },
    async formData(): Promise<FormData> {
      const params = new URLSearchParams(await this.text())
      const form = new FormData()
      for (const [key, value] of params) {
        form.append(key, value)
      }
      return form
    },
    valid<T>(target: 'json'): T {
      if (target === 'json') return bodyInput as T
      throw new Error(`Unsupported validation target: ${target}`)
    },
  }

  const facade = {
    req,
    res: undefined as Response | undefined,
    runtime: ctx,
    input,
    set(key: string, value: unknown) {
      variables[key] = value
    },
    get(key: string) {
      return variables[key]
    },
    get var() {
      return variables
    },
    header(name: string, value: string) {
      responseHeaders.set(name, value)
    },
    status(code: number) {
      responseStatus = code
    },
    json(data: unknown, statusOrInit?: number | { status?: number; headers?: HeadersInit }, headers?: HeadersInit): Response {
      const status = typeof statusOrInit === 'number'
        ? statusOrInit
        : statusOrInit?.status ?? responseStatus
      const merged = mergeResponseHeaders(responseHeaders, typeof statusOrInit === 'object' ? statusOrInit.headers : headers)
      merged.set('Content-Type', 'application/json; charset=UTF-8')
      return new Response(JSON.stringify(data), { status, headers: merged })
    },
    text(data: string, status?: number, headers?: HeadersInit): Response {
      const merged = mergeResponseHeaders(responseHeaders, headers)
      merged.set('Content-Type', 'text/plain; charset=UTF-8')
      return new Response(data, { status: status ?? responseStatus, headers: merged })
    },
    html(data: string, status?: number, headers?: HeadersInit): Response {
      const merged = mergeResponseHeaders(responseHeaders, headers)
      merged.set('Content-Type', 'text/html; charset=UTF-8')
      return new Response(data, { status: status ?? responseStatus, headers: merged })
    },
    body(data: BodyInit, status?: number, headers?: HeadersInit): Response {
      return new Response(toFetchResponseBody(data), {
        status: status ?? responseStatus,
        headers: mergeResponseHeaders(responseHeaders, headers),
      })
    },
    redirect(location: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
      return Response.redirect(location, status)
    },
    notFound(): Response {
      return new Response('Not Found', { status: 404 })
    },
    newResponse(data: BodyInit, init?: ResponseInit): Response {
      return new Response(toFetchResponseBody(data), {
        ...init,
        headers: mergeResponseHeaders(responseHeaders, init?.headers as HeadersInit | undefined),
      })
    },
  }

  return facade
}

export function createHttpAwareInput(input: unknown, ctx: Context, options: HttpFacadeOptions = {}): unknown {
  if (!ctx.http) return input

  const facade = createHttpFacade(input, ctx)
  if (!isObjectLike(input)) return facade

  const target = input
  const preferFacadeKeys = options.preferFacadeKeys === true

  return new Proxy(target, {
    get(target, property, receiver) {
      if (preferFacadeKeys && HTTP_FACADE_KEYS.has(property) && property in facade) {
        return Reflect.get(facade, property)
      }
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver)
      }
      return Reflect.get(facade, property)
    },
    has(target, property) {
      return Reflect.has(target, property) || property in facade
    },
    set(target, property, value, receiver) {
      if (preferFacadeKeys && HTTP_FACADE_KEYS.has(property) && property in facade) {
        Reflect.set(facade, property, value)
        return true
      }
      return Reflect.set(target, property, value, receiver)
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      if (descriptor) return descriptor
      if (property in facade) {
        return {
          configurable: true,
          enumerable: false,
          writable: true,
          value: Reflect.get(facade, property),
        }
      }
      return undefined
    },
  })
}

function getAssignedResponse(input: unknown): Response | undefined {
  if (!isObjectLike(input)) return undefined
  const response = (input as { res?: unknown }).res
  return response instanceof Response ? response : undefined
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function')
}

export function createHttpAwareProcedureHandler<THandler extends (input: unknown, ctx: Context) => unknown>(
  handler: THandler
): THandler {
  const preferFacadeKeys = handler.length <= 1
  return ((input: unknown, ctx: Context) => {
    const httpInput = createHttpAwareInput(input, ctx, { preferFacadeKeys })
    const result = handler(httpInput, ctx)
    if (isPromiseLike(result)) {
      return result.then((resolved) => resolved ?? getAssignedResponse(httpInput))
    }
    return result ?? getAssignedResponse(httpInput)
  }) as THandler
}
