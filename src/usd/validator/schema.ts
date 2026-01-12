/**
 * JSON Schema validation for USD documents
 */

import { createRequire } from 'node:module'

import type { USDDocument, USDValidationResult, USDValidationError } from '../spec/types.js'
import { ValidationErrorCodes, createError, createWarning, type ValidationErrorCode } from './errors.js'

/**
 * Minimal Ajv interfaces (avoids complex typing issues)
 */
interface AjvError {
  instancePath: string
  message?: string
  keyword: string
  params: Record<string, unknown>
}

interface AjvValidateFunction {
  (data: unknown): boolean
  errors?: AjvError[] | null
}

interface AjvInstance {
  compile: (schema: Record<string, unknown>) => AjvValidateFunction
}

const CONTENT_TYPES_SCHEMA = {
  type: 'object',
  properties: {
    default: { type: 'string' },
    supported: { type: 'array', items: { type: 'string' } },
  },
} as const

/**
 * USD JSON Schema for validation
 *
 * This schema validates the structure of USD documents while allowing
 * OpenAPI-standard fields to pass through.
 */
const USD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://raffel.dev/schemas/usd/1.0.0',
  title: 'USD Document',
  description: 'Universal Service Documentation (USD) specification',
  type: 'object',
  required: ['usd', 'openapi', 'info'],
  properties: {
    usd: {
      type: 'string',
      const: '1.0.0',
      description: 'USD specification version',
    },
    openapi: {
      type: 'string',
      const: '3.1.0',
      description: 'OpenAPI specification version',
    },
    info: {
      type: 'object',
      required: ['title', 'version'],
      properties: {
        title: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        termsOfService: { type: 'string', format: 'uri' },
        contact: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            email: { type: 'string', format: 'email' },
          },
        },
        license: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            identifier: { type: 'string' },
          },
        },
        summary: { type: 'string' },
        'x-usd-protocols': {
          type: 'array',
          items: {
            type: 'string',
            enum: ['http', 'websocket', 'streams', 'jsonrpc', 'grpc', 'tcp', 'udp'],
          },
        },
      },
    },
    servers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          description: { type: 'string' },
          variables: { type: 'object' },
          'x-usd-protocol': {
            type: 'string',
            enum: ['http', 'websocket', 'streams', 'jsonrpc', 'grpc', 'tcp', 'udp'],
          },
        },
      },
    },
    paths: { type: 'object' },
    components: {
      type: 'object',
      properties: {
        schemas: { type: 'object' },
        responses: { type: 'object' },
        parameters: { type: 'object' },
        examples: { type: 'object' },
        requestBodies: { type: 'object' },
        headers: { type: 'object' },
        securitySchemes: { type: 'object' },
        links: { type: 'object' },
        callbacks: { type: 'object' },
        pathItems: { type: 'object' },
        'x-usd-messages': { type: 'object' },
      },
    },
    security: { type: 'array' },
    tags: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          externalDocs: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', format: 'uri' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
    externalDocs: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri' },
        description: { type: 'string' },
      },
    },
    'x-usd': {
      type: 'object',
      properties: {
        protocols: { $ref: '#/properties/info/properties/x-usd-protocols' },
        servers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['url', 'protocol'],
            properties: {
              url: { type: 'string' },
              protocol: {
                type: 'string',
                enum: ['http', 'websocket', 'streams', 'jsonrpc', 'grpc', 'tcp', 'udp'],
              },
              description: { type: 'string' },
              variables: { type: 'object' },
            },
          },
        },
        contentTypes: CONTENT_TYPES_SCHEMA,
        messages: { $ref: '#/properties/components/properties/x-usd-messages' },
        websocket: { $ref: '#/properties/x-usd-websocket' },
        streams: { $ref: '#/properties/x-usd-streams' },
        jsonrpc: { $ref: '#/properties/x-usd-jsonrpc' },
        grpc: { $ref: '#/properties/x-usd-grpc' },
        tcp: { $ref: '#/properties/x-usd-tcp' },
        udp: { $ref: '#/properties/x-usd-udp' },
        errors: { $ref: '#/properties/x-usd-errors' },
      },
    },
    'x-usd-websocket': {
      type: 'object',
      properties: {
        path: { type: 'string' },
        contentTypes: CONTENT_TYPES_SCHEMA,
        channels: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['public', 'private', 'presence'] },
              description: { type: 'string' },
              parameters: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    description: { type: 'string' },
                    required: { type: 'boolean' },
                    schema: { type: 'object' },
                    example: {},
                  },
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              subscribe: { type: 'object' },
              publish: { type: 'object' },
              'x-usd-presence': {
                type: 'object',
                properties: {
                  memberSchema: { type: 'object' },
                  events: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['member_added', 'member_removed', 'member_updated'],
                    },
                  },
                },
              },
            },
          },
        },
        authentication: {
          type: 'object',
          required: ['in', 'name'],
          properties: {
            in: { type: 'string', enum: ['query', 'header', 'cookie'] },
            name: { type: 'string' },
            description: { type: 'string' },
          },
        },
        events: { type: 'object' },
      },
    },
    'x-usd-streams': {
      type: 'object',
      properties: {
        contentTypes: CONTENT_TYPES_SCHEMA,
        endpoints: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['direction', 'message'],
            properties: {
              description: { type: 'string' },
              direction: {
                type: 'string',
                enum: ['server-to-client', 'client-to-server', 'bidirectional'],
              },
              contentTypes: CONTENT_TYPES_SCHEMA,
              message: { type: 'object' },
              tags: { type: 'array', items: { type: 'string' } },
              security: { type: 'array' },
              'x-usd-backpressure': { type: 'boolean' },
            },
          },
        },
      },
    },
    'x-usd-jsonrpc': {
      type: 'object',
      properties: {
        endpoint: { type: 'string' },
        version: { type: 'string', const: '2.0' },
        contentTypes: CONTENT_TYPES_SCHEMA,
        methods: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              contentTypes: CONTENT_TYPES_SCHEMA,
              params: { type: 'object' },
              result: { type: 'object' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'integer' },
                    message: { type: 'string' },
                    description: { type: 'string' },
                    data: { type: 'object' },
                  },
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              security: { type: 'array' },
              'x-usd-streaming': { type: 'boolean' },
              'x-usd-notification': { type: 'boolean' },
            },
          },
        },
        batch: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            maxSize: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    'x-usd-grpc': {
      type: 'object',
      properties: {
        package: { type: 'string' },
        syntax: { type: 'string', enum: ['proto3', 'proto2'] },
        contentTypes: CONTENT_TYPES_SCHEMA,
        services: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              methods: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  required: ['input', 'output'],
                  properties: {
                    description: { type: 'string' },
                    contentTypes: CONTENT_TYPES_SCHEMA,
                    input: { type: 'object' },
                    output: { type: 'object' },
                    tags: { type: 'array', items: { type: 'string' } },
                    'x-usd-client-streaming': { type: 'boolean' },
                    'x-usd-server-streaming': { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
        options: { type: 'object' },
      },
    },
    'x-usd-tcp': {
      type: 'object',
      properties: {
        contentTypes: CONTENT_TYPES_SCHEMA,
        servers: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['host', 'port'],
            properties: {
              description: { type: 'string' },
              contentTypes: CONTENT_TYPES_SCHEMA,
              host: { type: 'string' },
              port: { type: 'integer', minimum: 1 },
              tls: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  cert: { type: 'string' },
                  key: { type: 'string' },
                  ca: { type: 'string' },
                  clientAuth: { type: 'boolean' },
                },
              },
              framing: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['length-prefixed', 'delimiter', 'fixed', 'none'],
                  },
                  lengthBytes: { type: 'integer', enum: [1, 2, 4, 8] },
                  byteOrder: { type: 'string', enum: ['big-endian', 'little-endian'] },
                  delimiter: { type: 'string' },
                  fixedSize: { type: 'integer', minimum: 1 },
                },
              },
              messages: {
                type: 'object',
                properties: {
                  inbound: { type: 'object' },
                  outbound: { type: 'object' },
                },
              },
              lifecycle: {
                type: 'object',
                properties: {
                  onConnect: { type: 'string' },
                  onDisconnect: { type: 'string' },
                  keepAlive: {
                    type: 'object',
                    properties: {
                      enabled: { type: 'boolean' },
                      intervalMs: { type: 'integer', minimum: 0 },
                    },
                  },
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              security: { type: 'array' },
            },
          },
        },
      },
    },
    'x-usd-udp': {
      type: 'object',
      properties: {
        contentTypes: CONTENT_TYPES_SCHEMA,
        endpoints: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['host', 'port'],
            properties: {
              description: { type: 'string' },
              contentTypes: CONTENT_TYPES_SCHEMA,
              host: { type: 'string' },
              port: { type: 'integer', minimum: 1 },
              multicast: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  group: { type: 'string' },
                  ttl: { type: 'integer', minimum: 0 },
                },
              },
              maxPacketSize: { type: 'integer', minimum: 1 },
              messages: {
                type: 'object',
                properties: {
                  inbound: { type: 'object' },
                  outbound: { type: 'object' },
                },
              },
              message: { type: 'object' },
              reliability: {
                type: 'object',
                properties: {
                  checksumValidation: { type: 'boolean' },
                  duplicateDetection: { type: 'boolean' },
                },
              },
              tags: { type: 'array', items: { type: 'string' } },
              security: { type: 'array' },
            },
          },
        },
      },
    },
    'x-usd-errors': {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['message'],
        properties: {
          status: { type: 'integer' },
          code: { type: 'integer' },
          grpcCode: { type: 'integer' },
          message: { type: 'string' },
          description: { type: 'string' },
          data: { type: 'object' },
        },
      },
    },
  },
  additionalProperties: true, // Allow other x- extensions
} as const

// Create and configure Ajv instance (lazy loaded)
const require = createRequire(import.meta.url)
let ajvInstance: AjvInstance | null = null

function loadAjvModules(): { Ajv: new (options: Record<string, unknown>) => AjvInstance; addFormats: (ajv: AjvInstance) => void } {
  const candidates = ['ajv/dist/2020', 'ajv']
  let ajvModule: unknown

  for (const candidate of candidates) {
    try {
      ajvModule = require(candidate)
      break
    } catch {
      continue
    }
  }

  if (!ajvModule) {
    throw new Error('Ajv is required for USD schema validation. Install `ajv` to enable validation.')
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const formatsModule = require('ajv-formats')

  const Ajv = (ajvModule as { default?: new (options: Record<string, unknown>) => AjvInstance }).default ?? ajvModule
  const addFormats = (formatsModule as { default?: (ajv: AjvInstance) => void }).default ?? formatsModule

  return {
    Ajv: Ajv as new (options: Record<string, unknown>) => AjvInstance,
    addFormats,
  }
}

function getAjv(): AjvInstance {
  if (!ajvInstance) {
    const { Ajv, addFormats } = loadAjvModules()
    const instance = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
      strictSchema: false,
      allowUnionTypes: true,
      validateSchema: false, // Don't validate the schema itself (we know it's valid)
    })

    addFormats(instance)
    ajvInstance = instance as AjvInstance
  }
  return ajvInstance
}

/**
 * Validate USD document against JSON Schema
 */
export function validateSchema(doc: unknown): USDValidationResult {
  const ajv = getAjv()
  const validate = ajv.compile(USD_SCHEMA as Record<string, unknown>)
  const valid = validate(doc)

  if (valid) {
    return { valid: true, errors: [], warnings: [] }
  }

  const errors: USDValidationError[] = (validate.errors || []).map((err: AjvError) => {
    const path = err.instancePath || '/'
    let message = err.message || 'Validation error'
    let code: ValidationErrorCode = ValidationErrorCodes.SCHEMA_INVALID

    // Enhance error messages
    if (err.keyword === 'required') {
      const missing = (err.params as { missingProperty?: string }).missingProperty
      message = `Missing required property: ${missing}`
      code = ValidationErrorCodes.SCHEMA_REQUIRED_MISSING
    } else if (err.keyword === 'type') {
      const expected = (err.params as { type?: string }).type
      message = `Expected type: ${expected}`
      code = ValidationErrorCodes.SCHEMA_TYPE_MISMATCH
    } else if (err.keyword === 'enum') {
      const allowed = (err.params as { allowedValues?: unknown[] }).allowedValues
      message = `Must be one of: ${allowed?.join(', ')}`
      code = ValidationErrorCodes.SCHEMA_ENUM_MISMATCH
    } else if (err.keyword === 'const') {
      const expected = (err.params as { allowedValue?: unknown }).allowedValue
      message = `Must be: ${expected}`
      code = ValidationErrorCodes.SCHEMA_ENUM_MISMATCH
    }

    return createError(path, message, code)
  })

  return { valid: false, errors, warnings: [] }
}

/**
 * Get the USD JSON Schema
 */
export function getSchema(): typeof USD_SCHEMA {
  return USD_SCHEMA
}
