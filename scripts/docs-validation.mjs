import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g
const EXTERNAL_TARGET = /^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i

async function markdownFiles(target) {
  const info = await stat(target)
  if (info.isFile()) return target.endsWith('.md') ? [target] : []

  const files = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const child = resolve(target, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(child))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(child)
  }
  return files
}

function editorialLines(markdown) {
  const lines = markdown.split(/\r?\n/)
  let fence

  return lines.map((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker[0]
      else if (marker[0] === fence) fence = undefined
      return { line: index + 1, text: '' }
    }
    if (fence) return { line: index + 1, text: '' }

    return {
      line: index + 1,
      text: line.replace(/`+[^`]*`+/g, ''),
    }
  })
}

async function targetExists(target) {
  const candidates = extname(target)
    ? [target]
    : [target, `${target}.md`, resolve(target, 'README.md')]

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return true
    } catch {
      // Keep trying canonical Markdown path variants.
    }
  }
  return false
}

export async function findBrokenMarkdownLinks({ projectRoot, roots }) {
  const root = projectRoot instanceof URL ? fileURLToPath(projectRoot) : resolve(projectRoot)
  const files = (await Promise.all(roots.map(item => markdownFiles(resolve(root, item)))))
    .flat()
    .sort()
  const broken = []

  for (const file of files) {
    const markdown = await readFile(file, 'utf8')
    for (const { line, text } of editorialLines(markdown)) {
      for (const match of text.matchAll(MARKDOWN_LINK)) {
        const rawTarget = match[1].replace(/^<|>$/g, '')
        if (!rawTarget || EXTERNAL_TARGET.test(rawTarget)) continue

        const pathTarget = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0])
        if (!pathTarget) continue
        const resolved = rawTarget.startsWith('/')
          ? resolve(root, 'docs', `.${pathTarget}`)
          : resolve(dirname(file), pathTarget)

        if (!await targetExists(resolved)) {
          broken.push({
            file: relative(root, file),
            line,
            target: rawTarget,
          })
        }
      }
    }
  }

  return broken
}

export function extractValidatedExamples(markdown) {
  const examples = new Map()
  const pattern = /<!--\s*validated-example:\s*([a-z\d-]+)\s*-->\s*```(?:ts|typescript)\s*\n([\s\S]*?)\n```/gi

  for (const match of markdown.matchAll(pattern)) {
    const [, name, source] = match
    if (examples.has(name)) throw new Error(`Duplicate validated example: ${name}`)
    examples.set(name, source)
  }

  return examples
}

export function compileDocumentedExamples(exampleRoot) {
  const root = exampleRoot instanceof URL ? fileURLToPath(exampleRoot) : resolve(exampleRoot)
  const projectRoot = resolve(root, '../../..')
  const rootNames = ts.sys.readDirectory(root, ['.ts'], undefined, undefined)
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    ignoreDeprecations: '6.0',
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    baseUrl: projectRoot,
    paths: {
      raffel: ['src/index.ts'],
      'raffel/*': ['src/*/index.ts', 'src/*.ts'],
    },
  }
  const program = ts.createProgram({ rootNames, options })

  return ts.getPreEmitDiagnostics(program)
    .filter(diagnostic => !diagnostic.file || diagnostic.file.fileName.startsWith(root))
    .map(diagnostic => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      if (!diagnostic.file || diagnostic.start === undefined) return message
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      return `${relative(projectRoot, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`
    })
}
