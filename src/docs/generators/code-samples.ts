/**
 * Code Sample Generator for USD
 *
 * Generates realistic code samples in 7 languages from operation context.
 * Compatible with Redoc x-codeSamples extension.
 */

import type { USDCodeSample, USDSchema, USDParameter } from '../../usd/index.js'
import { generateSchemaExample, type SchemaExampleOptions } from '../../utils/schema-examples.js'

// =============================================================================
// Types
// =============================================================================

export interface CodeSampleContext {
  /** HTTP method: 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', etc. */
  method: string
  /** OpenAPI path with {id} style params already substituted with example values */
  path: string
  /** Base URL from servers[0].url */
  baseUrl: string
  /** Request body schema (for POST/PUT/PATCH) */
  requestBodySchema?: USDSchema
  /** Query parameters */
  parameters?: USDParameter[]
  /** Whether auth header should be included */
  hasSecurity: boolean
  /** Content-Type override (default: 'application/json') */
  contentType?: string
}

// =============================================================================
// Example Value Generation (delegates to shared schema-examples)
// =============================================================================

const CODE_SAMPLE_DEFAULTS: SchemaExampleOptions = {
  maxOptionalProperties: 3,
  uniqueValues: false,
}

/**
 * Generate a realistic example value from a JSON Schema
 */
export function generateExampleFromSchema(schema: USDSchema | undefined): unknown {
  if (!schema) return {}
  return generateSchemaExample(schema as Record<string, unknown>, CODE_SAMPLE_DEFAULTS)
}

// =============================================================================
// URL Helpers
// =============================================================================

/**
 * Replace {param} placeholders in path with example values from parameters
 */
function substitutePath(path: string, parameters?: USDParameter[]): string {
  const pathParams = (parameters ?? []).filter(p => p.in === 'path')
  let result = path
  for (const param of pathParams) {
    const example = param.example ?? generateExampleFromSchema(param.schema)
    result = result.replace(`{${param.name}}`, String(example))
  }
  return result
}

/**
 * Build query string from query parameters
 */
function buildQueryString(parameters?: USDParameter[]): string {
  const queryParams = (parameters ?? []).filter(p => p.in === 'query')
  if (queryParams.length === 0) return ''
  const parts = queryParams.map(p => {
    const val = p.example ?? generateExampleFromSchema(p.schema)
    return `${encodeURIComponent(p.name)}=${encodeURIComponent(String(val))}`
  })
  return `?${parts.join('&')}`
}

/**
 * Build the full URL for a sample
 */
function buildUrl(ctx: CodeSampleContext): string {
  const base = ctx.baseUrl.replace(/\/$/, '')
  const path = substitutePath(ctx.path, ctx.parameters)
  const query = ['get', 'delete', 'head'].includes(ctx.method.toLowerCase())
    ? buildQueryString(ctx.parameters)
    : ''
  return `${base}${path}${query}`
}

// =============================================================================
// Language Generators
// =============================================================================

function genCurl(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toUpperCase()
  const lines: string[] = [`curl -X ${method} '${url}'`]

  lines.push(`  -H 'Accept: application/json'`)

  if (ctx.hasSecurity) {
    lines.push(`  -H 'Authorization: Bearer <token>'`)
  }

  if (body !== undefined) {
    lines.push(`  -H 'Content-Type: application/json'`)
    lines.push(`  -d '${JSON.stringify(body)}'`)
  }

  return {
    lang: 'curl',
    label: 'cURL',
    source: lines.join(' \\\n'),
  }
}

function genTypeScript(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toUpperCase()
  const hasBody = body !== undefined

  const headers: string[] = [`'Accept': 'application/json'`]
  if (ctx.hasSecurity) headers.push(`'Authorization': 'Bearer <token>'`)
  if (hasBody) headers.push(`'Content-Type': 'application/json'`)

  const headersStr = headers.map(h => `    ${h}`).join(',\n')

  let source = `const response = await fetch('${url}', {\n`
  source += `  method: '${method}',\n`
  source += `  headers: {\n${headersStr},\n  },\n`
  if (hasBody) {
    source += `  body: JSON.stringify(${JSON.stringify(body, null, 2).split('\n').join('\n  ')}),\n`
  }
  source += `})\n\n`
  source += `const data = await response.json()\n`
  source += `console.log(data)`

  return { lang: 'typescript', label: 'TypeScript', source }
}

function genJavaScript(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toUpperCase()
  const hasBody = body !== undefined

  const headers: string[] = [`'Accept': 'application/json'`]
  if (ctx.hasSecurity) headers.push(`'Authorization': 'Bearer <token>'`)
  if (hasBody) headers.push(`'Content-Type': 'application/json'`)

  const headersStr = headers.map(h => `    ${h}`).join(',\n')

  let source = `const response = await fetch('${url}', {\n`
  source += `  method: '${method}',\n`
  source += `  headers: {\n${headersStr},\n  },\n`
  if (hasBody) {
    source += `  body: JSON.stringify(${JSON.stringify(body, null, 2).split('\n').join('\n  ')}),\n`
  }
  source += `})\n\n`
  source += `const data = await response.json()\n`
  source += `console.log(data)`

  return { lang: 'javascript', label: 'JavaScript', source }
}

function genPython(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toLowerCase()
  const hasBody = body !== undefined

  const headers: string[] = [`"Accept": "application/json"`]
  if (ctx.hasSecurity) headers.push(`"Authorization": "Bearer <token>"`)
  if (hasBody) headers.push(`"Content-Type": "application/json"`)

  const headersStr = headers.map(h => `    ${h}`).join(',\n')

  let source = `import requests\n\n`
  source += `headers = {\n${headersStr},\n}\n\n`

  if (hasBody) {
    source += `payload = ${JSON.stringify(body, null, 2).replace(/null/g, 'None').replace(/true/g, 'True').replace(/false/g, 'False')}\n\n`
    source += `response = requests.${method}(\n    "${url}",\n    headers=headers,\n    json=payload,\n)\n`
  } else {
    source += `response = requests.${method}(\n    "${url}",\n    headers=headers,\n)\n`
  }

  source += `\nprint(response.json())`

  return { lang: 'python', label: 'Python', source }
}

function genGo(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toUpperCase()
  const hasBody = body !== undefined

  let source = `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n`
  if (hasBody) source += `\t"bytes"\n\t"encoding/json"\n`
  source += `)\n\nfunc main() {\n`

  if (hasBody) {
    source += `\tpayload := ${JSON.stringify(body, null, 2).split('\n').join('\n\t')}\n`
    source += `\tbody, _ := json.Marshal(payload)\n`
    source += `\treq, _ := http.NewRequest("${method}", "${url}", bytes.NewBuffer(body))\n`
  } else {
    source += `\treq, _ := http.NewRequest("${method}", "${url}", nil)\n`
  }

  source += `\treq.Header.Set("Accept", "application/json")\n`
  if (ctx.hasSecurity) {
    source += `\treq.Header.Set("Authorization", "Bearer <token>")\n`
  }
  if (hasBody) {
    source += `\treq.Header.Set("Content-Type", "application/json")\n`
  }

  source += `\n\tclient := &http.Client{}\n`
  source += `\tresp, err := client.Do(req)\n`
  source += `\tif err != nil {\n\t\tpanic(err)\n\t}\n`
  source += `\tdefer resp.Body.Close()\n`
  source += `\tfmt.Println(resp.Status)\n`
  source += `}`

  return { lang: 'go', label: 'Go', source }
}

function genPhp(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toUpperCase()
  const hasBody = body !== undefined

  let source = `<?php\n\n`
  source += `$client = new \\GuzzleHttp\\Client();\n\n`

  const optionsParts: string[] = []
  const headers: string[] = [`'Accept' => 'application/json'`]
  if (ctx.hasSecurity) headers.push(`'Authorization' => 'Bearer <token>'`)
  if (hasBody) headers.push(`'Content-Type' => 'application/json'`)

  optionsParts.push(`  'headers' => [\n${headers.map(h => `    ${h},`).join('\n')}\n  ]`)

  if (hasBody) {
    optionsParts.push(`  'json' => ${JSON.stringify(body, null, 2).split('\n').join('\n  ')}`)
  }

  source += `$response = $client->request('${method}', '${url}', [\n`
  source += optionsParts.map(p => `  ${p}`).join(',\n') + ',\n'
  source += `]);\n\n`
  source += `echo $response->getBody();`

  return { lang: 'php', label: 'PHP', source }
}

function genRust(ctx: CodeSampleContext, body: unknown): USDCodeSample {
  const url = buildUrl(ctx)
  const method = ctx.method.toUpperCase()
  const hasBody = body !== undefined

  let source = `use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};\n\n`
  source += `#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n`
  source += `    let client = reqwest::Client::new();\n\n`
  source += `    let mut headers = HeaderMap::new();\n`
  source += `    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));\n`

  if (ctx.hasSecurity) {
    source += `    headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer <token>"));\n`
  }
  if (hasBody) {
    source += `    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));\n`
  }

  source += `\n    let response = client\n`
  source += `        .${method.toLowerCase()}("${url}")\n`
  source += `        .headers(headers)\n`

  if (hasBody) {
    source += `        .json(&serde_json::json!(${JSON.stringify(body, null, 2).split('\n').join('\n        ')}))\n`
  }

  source += `        .send()\n        .await?;\n\n`
  source += `    println!("{}", response.text().await?);\n`
  source += `    Ok(())\n}`

  return { lang: 'rust', label: 'Rust', source }
}

// =============================================================================
// Main Export
// =============================================================================

const LANGUAGE_GENERATORS: Record<string, (ctx: CodeSampleContext, body: unknown) => USDCodeSample> = {
  curl: genCurl,
  typescript: genTypeScript,
  javascript: genJavaScript,
  python: genPython,
  go: genGo,
  php: genPhp,
  rust: genRust,
}

/**
 * Generate code samples for all requested languages
 */
export function generateCodeSamples(
  ctx: CodeSampleContext,
  languages: string[] = ['curl', 'typescript', 'python', 'go']
): USDCodeSample[] {
  const method = ctx.method.toLowerCase()
  const isBodyMethod = ['post', 'put', 'patch'].includes(method)
  const body = isBodyMethod ? generateExampleFromSchema(ctx.requestBodySchema) : undefined

  const samples: USDCodeSample[] = []
  for (const lang of languages) {
    const gen = LANGUAGE_GENERATORS[lang]
    if (gen) {
      samples.push(gen(ctx, body))
    }
  }
  return samples
}
