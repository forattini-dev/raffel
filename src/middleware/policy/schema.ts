/**
 * JSON Schema (draft-07) describing a single policy entry.
 *
 * `schema.json` and `schema.ts` are kept in sync — both express the same
 * contract. The JSON file remains the declarative source for external
 * tooling (editor JSON Schema completion, meta-schema validators, docs).
 * This TypeScript module is what the loader actually imports at runtime,
 * because:
 *   1. `tsc` ships it into `dist/` automatically (no asset-copy step needed);
 *   2. it does not depend on `fs.readFileSync` or ESM JSON import assertions;
 *   3. an `as const` literal gives downstream code real types if needed.
 *
 * A unit test (`test/middleware/policy/schema-sync.unit.test.ts`) asserts
 * `policySchema` deep-equals `JSON.parse(readFileSync(schema.json))` so any
 * drift between the two files is caught at CI.
 */

export const policySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://raffel.dev/schemas/json-policy.json',
  title: 'JsonPolicy',
  description:
    'Authorization policy loadable from JSON. Either `match` or `customCondition` may be present, not both.',
  type: 'object',
  required: ['id', 'effect', 'principals', 'actions', 'resources'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    effect: { enum: ['allow', 'deny', 'audit'] },
    principals: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'string' } },
    resources: { type: 'array', items: { type: 'string' } },
    match: { $ref: '#/definitions/MatchNode' },
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: {
        routes: { type: 'array', items: { type: 'string' } },
        channels: { type: 'array', items: { type: 'string' } },
        protocols: { type: 'array', items: { type: 'string' } },
      },
    },
    customCondition: { type: 'string', minLength: 1 },
    _source: { type: 'string' },
    _index: { type: 'integer' },
  },
  not: {
    required: ['match', 'customCondition'],
  },
  definitions: {
    MatchNode: {
      oneOf: [
        {
          type: 'object',
          properties: {
            anyOf: { type: 'array', items: { $ref: '#/definitions/MatchNode' } },
          },
          required: ['anyOf'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            allOf: { type: 'array', items: { $ref: '#/definitions/MatchNode' } },
          },
          required: ['allOf'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            not: { $ref: '#/definitions/MatchNode' },
          },
          required: ['not'],
          additionalProperties: false,
        },
        {
          type: 'object',
          additionalProperties: { $ref: '#/definitions/MatchValue' },
        },
      ],
    },
    MatchValue: {
      oneOf: [
        { type: ['string', 'number', 'boolean', 'null'] },
        { $ref: '#/definitions/MatchOperator' },
      ],
    },
    MatchOperator: {
      type: 'object',
      additionalProperties: false,
      properties: {
        '==': {},
        '!=': {},
        '<': { type: ['number', 'string'] },
        '<=': { type: ['number', 'string'] },
        '>': { type: ['number', 'string'] },
        '>=': { type: ['number', 'string'] },
        in: { oneOf: [{ type: 'array' }, { type: 'string' }] },
        notIn: { oneOf: [{ type: 'array' }, { type: 'string' }] },
        regex: { type: 'string' },
        startsWith: { type: 'string' },
        endsWith: { type: 'string' },
        contains: {},
        exists: { type: 'boolean' },
      },
      minProperties: 1,
    },
  },
} as const
