/**
 * OpenAPI Module
 *
 * Generates OpenAPI 3.0 specification from Raffel Registry and SchemaRegistry.
 */

export {
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
} from './generator.js'
