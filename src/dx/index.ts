/**
 * Developer Experience (DX) Module
 *
 * Production-ready utilities for API development and operations:
 * - Health Check System: Kubernetes-style liveness and readiness probes
 * - HTTP Request Logging: Apache/Nginx-style request logging
 * - USD Documentation: Universal Service Documentation with multi-protocol support
 */

// === Health Check System ===
export {
  createHealthCheckProcedures,
  CommonProbes,
  type HealthCheckConfig,
  type HealthProbe,
  type HealthProbeGroupConfig,
  type ProbeResult,
  type HealthResponse,
  type HealthCheckState,
  type HealthCheckProcedure,
  type HealthCheckProcedures,
} from './health/index.js'

// === HTTP Request Logging ===
export {
  createHttpLoggingMiddleware,
  createDevLoggingMiddleware,
  createTinyLoggingMiddleware,
  createProductionHttpLoggingMiddleware,
  withHttpLogging,
  LOG_FORMATS,
  type HttpLoggingMiddleware,
  type HttpLoggingConfig,
  type LogFormat,
  type LogContext,
} from './logging/index.js'

// === Documentation (USD) ===
export {
  createUSDHandlers,
  type USDMiddlewareConfig,
  type USDHandlers,
  type USDMiddlewareContext,
  generateOpenAPI,
  generateOpenAPIJson,
  generateOpenAPIYaml,
  type OpenAPIDocument,
  type OpenAPIInfo,
  type OpenAPIServer,
  type OpenAPIPathItem,
  type OpenAPIOperation,
  type OpenAPIResponse,
  type OpenAPISecurityScheme,
  type OpenAPITag,
  type GeneratorOptions,
} from '../docs/index.js'
