/**
 * HTTP Inbound Adapter
 *
 * Translates HTTP requests into Envelope format for the core Router.
 * @see ../http.ts for the implementation.
 */
export { createHttpAdapter } from '../http.js'
export type { HttpAdapter, HttpAdapterOptions, HttpMiddleware } from '../http.js'
