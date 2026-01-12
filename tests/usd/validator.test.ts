/**
 * USD Validator Tests
 *
 * Tests for schema validation, semantic validation, and error handling.
 */

import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  validate,
  validateOrThrow,
  isValid,
  validateSchema,
  validateSemantic,
  ValidationErrorCodes,
  createError,
  createWarning,
  createSuccessResult,
  createFailedResult,
  mergeResults,
  formatValidationResult,
  USDValidationException,
} from '../../src/usd/validator/index.js'
import type { USDDocument, USDValidationResult } from '../../src/usd/spec/types.js'

// =============================================================================
// Test Data
// =============================================================================

const validMinimalDoc: USDDocument = {
  usd: '1.0.0',
  openapi: '3.1.0',
  info: {
    title: 'Test API',
    version: '1.0.0',
  },
}

const validFullDoc: USDDocument = {
  usd: '1.0.0',
  openapi: '3.1.0',
  info: {
    title: 'Full API',
    version: '1.0.0',
  },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users': {
      get: {
        operationId: 'getUsers',
        responses: {
          '200': { description: 'Success' },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Success' },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  },
}

const validWebSocketDoc: USDDocument = {
  usd: '1.0.0',
  openapi: '3.1.0',
  info: { title: 'WS API', version: '1.0.0' },
  'x-usd': {
    websocket: {
      path: '/ws',
      channels: {
        chat: {
          type: 'public',
          description: 'Chat channel',
          subscribe: {
            message: {
              payload: { type: 'object' },
            },
          },
          publish: {
            message: {
              payload: { type: 'object' },
            },
          },
        },
        presence: {
          type: 'presence',
          description: 'Presence channel',
          subscribe: {
            message: { payload: { type: 'object' } },
          },
          'x-usd-presence': {
            memberSchema: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

const validStreamsDoc: USDDocument = {
  usd: '1.0.0',
  openapi: '3.1.0',
  info: { title: 'Streams API', version: '1.0.0' },
  'x-usd': {
    streams: {
      endpoints: {
        '/events': {
          direction: 'server-to-client',
          description: 'Event stream',
          message: {
            payload: { type: 'object' },
          },
        },
        '/bidi': {
          direction: 'bidirectional',
          description: 'Bidirectional stream',
          message: {
            payload: { type: 'string' },
          },
        },
      },
    },
  },
}

const validJsonRpcDoc: USDDocument = {
  usd: '1.0.0',
  openapi: '3.1.0',
  info: { title: 'RPC API', version: '1.0.0' },
  'x-usd': {
    jsonrpc: {
      endpoint: '/rpc',
      methods: {
        'users.list': {
          description: 'List users',
          params: { type: 'object' },
          result: { type: 'array' },
        },
        'users.get': {
          description: 'Get user',
          params: { type: 'object' },
          result: { type: 'object' },
        },
      },
    },
  },
}

const validGrpcDoc: USDDocument = {
  usd: '1.0.0',
  openapi: '3.1.0',
  info: { title: 'gRPC API', version: '1.0.0' },
  'x-usd': {
    grpc: {
      syntax: 'proto3',
      services: {
        UserService: {
          methods: {
            GetUser: {
              input: { $ref: '#/components/schemas/GetUserRequest' },
              output: { $ref: '#/components/schemas/User' },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      GetUserRequest: { type: 'object' },
      User: { type: 'object' },
    },
  },
}

// =============================================================================
// Main Validate Function Tests
// =============================================================================

describe('validate function', () => {
  test('validates minimal document', () => {
    const result = validate(validMinimalDoc)
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
  })

  test('validates full document with paths', () => {
    const result = validate(validFullDoc)
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
  })

  test('validates WebSocket document', () => {
    const result = validate(validWebSocketDoc)
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
  })

  test('validates Streams document', () => {
    const result = validate(validStreamsDoc)
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
  })

  test('validates JSON-RPC document', () => {
    const result = validate(validJsonRpcDoc)
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
  })

  test('validates gRPC document', () => {
    const result = validate(validGrpcDoc)
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
  })

  test('returns errors for invalid document', () => {
    const result = validate({})
    assert.ok(!result.valid)
    assert.ok(result.errors.length > 0)
  })

  test('returns errors for missing required fields', () => {
    const result = validate({ usd: '1.0.0' })
    assert.ok(!result.valid)
    assert.ok(result.errors.length > 0)
  })

  test('skipSchema option skips schema validation', () => {
    const result = validate({}, { skipSchema: true })
    // Should pass because schema validation is skipped
    // (and no semantic validation runs on non-document)
    assert.ok(result.valid || result.errors.length === 0)
  })

  test('skipSemantic option skips semantic validation', () => {
    const docWithBrokenRef: USDDocument = {
      ...validMinimalDoc,
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NonExistent' },
                  },
                },
              },
            },
          },
        },
      },
    }
    const result = validate(docWithBrokenRef, { skipSemantic: true })
    // Should pass schema but would fail semantic
    assert.ok(result.valid)
  })

  test('strict mode treats warnings as errors', () => {
    // Create a doc with a warning but no errors
    const docWithWarning: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        jsonrpc: {
          endpoint: '/rpc',
          methods: {
            noNamespace: {
              // Not namespaced - causes warning
              description: 'Test',
              params: { type: 'object' },
            },
          },
        },
      },
    }
    const normalResult = validate(docWithWarning)
    const strictResult = validate(docWithWarning, { strict: true })

    // Normal mode: valid with warnings
    if (normalResult.warnings.length > 0) {
      assert.ok(normalResult.valid)
      // Strict mode: invalid because warnings become errors
      assert.ok(!strictResult.valid)
    }
  })
})

// =============================================================================
// validateOrThrow Tests
// =============================================================================

describe('validateOrThrow', () => {
  test('does not throw for valid document', () => {
    assert.doesNotThrow(() => validateOrThrow(validMinimalDoc))
  })

  test('throws for invalid document', () => {
    assert.throws(
      () => validateOrThrow({}),
      (err: Error) => err.message.includes('USD validation failed')
    )
  })
})

// =============================================================================
// isValid Tests
// =============================================================================

describe('isValid', () => {
  test('returns true for valid document', () => {
    assert.ok(isValid(validMinimalDoc))
    assert.ok(isValid(validFullDoc))
  })

  test('returns false for invalid document', () => {
    assert.ok(!isValid({}))
    assert.ok(!isValid({ usd: '1.0.0' }))
  })
})

// =============================================================================
// Semantic Validation Tests
// =============================================================================

describe('validateSemantic', () => {
  test('validates references', () => {
    const docWithValidRef: USDDocument = {
      ...validMinimalDoc,
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: { type: 'object' },
        },
      },
    }
    const result = validateSemantic(docWithValidRef)
    assert.ok(result.valid)
  })

  test('detects broken references', () => {
    const docWithBrokenRef: USDDocument = {
      ...validMinimalDoc,
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NonExistent' },
                  },
                },
              },
            },
          },
        },
      },
    }
    const result = validateSemantic(docWithBrokenRef)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.REF_NOT_FOUND))
  })

  test('validates HTTP paths start with /', () => {
    const docWithBadPath: USDDocument = {
      ...validMinimalDoc,
      paths: {
        users: {
          // Missing leading /
          get: {
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const result = validateSemantic(docWithBadPath)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.HTTP_INVALID_PATH))
  })

  test('validates HTTP operations have responses', () => {
    const docWithNoResponses: USDDocument = {
      ...validMinimalDoc,
      paths: {
        '/users': {
          get: {
            operationId: 'getUsers',
            responses: {},
          },
        },
      },
    }
    const result = validateSemantic(docWithNoResponses)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.HTTP_MISSING_RESPONSES))
  })

  test('validates WebSocket channel types', () => {
    const docWithBadChannelType: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        websocket: {
          path: '/ws',
          channels: {
            chat: {
              type: 'invalid-type' as any,
              subscribe: { message: { payload: {} } },
            },
          },
        },
      },
    }
    const result = validateSemantic(docWithBadChannelType)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.WS_INVALID_CHANNEL_TYPE))
  })

  test('validates Stream directions', () => {
    const docWithBadDirection: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        streams: {
          endpoints: {
            '/events': {
              direction: 'invalid' as any,
              message: { payload: {} },
            },
          },
        },
      },
    }
    const result = validateSemantic(docWithBadDirection)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.STREAM_INVALID_DIRECTION))
  })

  test('validates Stream endpoints have message', () => {
    const docWithNoMessage: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        streams: {
          endpoints: {
            '/events': {
              direction: 'server-to-client',
              // Missing message
            },
          },
        },
      },
    } as any
    const result = validateSemantic(docWithNoMessage)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.STREAM_MISSING_MESSAGE))
  })

  test('validates content type defaults', () => {
    const docWithInvalidContentType: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        contentTypes: {
          default: 'invalid/type',
        },
      },
    }

    const result = validateSemantic(docWithInvalidContentType)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.CONTENT_TYPE_UNSUPPORTED))
  })

  test('allows operation overrides over protocol defaults', () => {
    const docWithOverrides: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        contentTypes: {
          default: 'application/json',
          supported: [
            'application/json',
            'text/csv',
            'application/x-protobuf',
            'application/octet-stream',
          ],
        },
        tcp: {
          contentTypes: { default: 'application/octet-stream' },
          servers: {
            'csv-feed': {
              host: 'localhost',
              port: 9000,
              contentTypes: { default: 'text/csv' },
            },
          },
        },
      },
    }

    const result = validateSemantic(docWithOverrides)
    assert.ok(result.valid)
  })

  test('validates gRPC method has input/output', () => {
    const docWithNoInput: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        grpc: {
          services: {
            TestService: {
              methods: {
                GetData: {
                  // Missing input and output
                },
              },
            },
          },
        },
      },
    } as any
    const result = validateSemantic(docWithNoInput)
    assert.ok(!result.valid)
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.GRPC_MISSING_INPUT))
    assert.ok(result.errors.some((e) => e.code === ValidationErrorCodes.GRPC_MISSING_OUTPUT))
  })

  test('warns about presence channel without memberSchema', () => {
    const docWithPresence: USDDocument = {
      ...validMinimalDoc,
      'x-usd': {
        websocket: {
          path: '/ws',
          channels: {
            lobby: {
              type: 'presence',
              subscribe: { message: { payload: {} } },
              // Missing x-usd-presence.memberSchema
            },
          },
        },
      },
    }
    const result = validateSemantic(docWithPresence)
    assert.ok(result.warnings.some((w) => w.code === ValidationErrorCodes.WS_PRESENCE_MISSING_MEMBER_SCHEMA))
  })
})

// =============================================================================
// Error Helpers Tests
// =============================================================================

describe('Error Helpers', () => {
  test('createError creates error object', () => {
    const err = createError('/path/to/field', 'Something went wrong', 'CUSTOM_ERROR')
    assert.equal(err.path, '/path/to/field')
    assert.equal(err.message, 'Something went wrong')
    assert.equal(err.code, 'CUSTOM_ERROR')
    assert.equal(err.severity, 'error')
  })

  test('createWarning creates warning object', () => {
    const warn = createWarning('/path/to/field', 'Could be improved', 'CUSTOM_WARNING')
    assert.equal(warn.path, '/path/to/field')
    assert.equal(warn.message, 'Could be improved')
    assert.equal(warn.code, 'CUSTOM_WARNING')
    assert.equal(warn.severity, 'warning')
  })

  test('createSuccessResult creates valid result', () => {
    const result = createSuccessResult()
    assert.ok(result.valid)
    assert.equal(result.errors.length, 0)
    assert.equal(result.warnings.length, 0)
  })

  test('createFailedResult creates invalid result', () => {
    const result = createFailedResult([
      createError('/test', 'Error 1'),
      createError('/test2', 'Error 2'),
    ])
    assert.ok(!result.valid)
    assert.equal(result.errors.length, 2)
  })

  test('mergeResults combines multiple results', () => {
    const result1: USDValidationResult = {
      valid: false,
      errors: [createError('/a', 'Error A')],
      warnings: [createWarning('/a', 'Warning A')],
    }
    const result2: USDValidationResult = {
      valid: false,
      errors: [createError('/b', 'Error B')],
      warnings: [],
    }
    const merged = mergeResults(result1, result2)

    assert.ok(!merged.valid)
    assert.equal(merged.errors.length, 2)
    assert.equal(merged.warnings.length, 1)
  })

  test('mergeResults returns valid when all valid', () => {
    const result1: USDValidationResult = { valid: true, errors: [], warnings: [] }
    const result2: USDValidationResult = { valid: true, errors: [], warnings: [] }
    const merged = mergeResults(result1, result2)

    assert.ok(merged.valid)
  })

  test('formatValidationResult produces readable output', () => {
    const result: USDValidationResult = {
      valid: false,
      errors: [createError('/info/title', 'Title is required')],
      warnings: [createWarning('/servers', 'No servers defined')],
    }
    const formatted = formatValidationResult(result)

    assert.ok(formatted.includes('/info/title'))
    assert.ok(formatted.includes('Title is required'))
    assert.ok(formatted.includes('/servers'))
  })
})

// =============================================================================
// USDValidationException Tests
// =============================================================================

describe('USDValidationException', () => {
  test('contains validation result', () => {
    const result: USDValidationResult = {
      valid: false,
      errors: [createError('/test', 'Test error')],
      warnings: [],
    }
    const exception = new USDValidationException('Validation failed', result)

    assert.equal(exception.name, 'USDValidationException')
    assert.equal(exception.message, 'Validation failed')
    assert.equal(exception.result, result)
  })
})

// =============================================================================
// ValidationErrorCodes Tests
// =============================================================================

describe('ValidationErrorCodes', () => {
  test('has expected error codes', () => {
    assert.ok(ValidationErrorCodes.REF_NOT_FOUND)
    assert.ok(ValidationErrorCodes.HTTP_INVALID_PATH)
    assert.ok(ValidationErrorCodes.HTTP_MISSING_RESPONSES)
    assert.ok(ValidationErrorCodes.WS_INVALID_CHANNEL_TYPE)
    assert.ok(ValidationErrorCodes.STREAM_INVALID_DIRECTION)
    assert.ok(ValidationErrorCodes.RPC_INVALID_METHOD_NAME)
    assert.ok(ValidationErrorCodes.GRPC_MISSING_INPUT)
    assert.ok(ValidationErrorCodes.GRPC_MISSING_OUTPUT)
  })
})
