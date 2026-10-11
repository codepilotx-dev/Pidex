#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import postcss, {
  type AtRule,
  type ChildNode,
  type Container,
  type Declaration,
  type Rule,
} from 'postcss'
import selectorParser from 'postcss-selector-parser'
import valueParser from 'postcss-value-parser'
import { transform } from 'lightningcss'

type InventoryStatus = 'map' | 'adapt' | 'vendor' | 'document-only' | 'exclude'
type CssCategory = 'app-global' | 'app-component' | 'app-page' | 'font' | 'vendor'
type JsCategory =
  | 'runtime-theme'
  | 'shadow-dom-style'
  | 'code-highlight-theme'
  | 'third-party-style'
  | 'style-usage'
  | 'icon-noise'
  | 'grammar-noise'
  | 'locale'
  | 'unrelated'

type CliOptions = {
  assetsRoot: string
  markdownPath: string
  jsonPath: string
  check: boolean
  failOnParseError: boolean
}

type Specificity = [number, number, number]

type UrlOccurrence = {
  value: string
  offset: number
  property: string
}

type StyleEvidence = {
  kind: string
  offset: number
  form: string
  recoverable: boolean
  reason?: string
}

type ExtractedTheme = {
  slug: string
  name: string
  displayName?: string
  type?: string
  colorCount: number
  tokenColorCount: number
  normalizedHash: string
  offset: number
  recoverability: 'structured' | 'signature'
}

type StaticJsStylesheet = {
  binding: string | null
  literalOffset: number
  rawChars: number
  sinkKinds: string[]
  sinkOffsets: number[]
  wrapper?: string
  recoverability: 'exact' | 'partial-template'
  interpolations: Array<{
    expression: string
    resolved: boolean
  }>
  rawHash: string
  source: string
}

const SCRIPT_VERSION = 2
const defaultAssetsRoot = 'E:\\迅雷下载\\Codex\\app_asar_extracted\\webview\\assets'
const repositoryRoot = resolve(import.meta.dir, '../../../..')
const defaultMarkdownPath = join(repositoryRoot, 'docs/research/codex-webview-style-inventory.md')
const defaultJsonPath = join(repositoryRoot, 'docs/research/codex-webview-style-inventory.json')
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

function printHelp(): void {
  console.log(`Codex webview style inventory

Usage:
  bun run scripts/InventoryCodexStyles.ts [options]

Options:
  --assets-root <path>          Codex webview assets directory
  --markdown <path>             Markdown report output path
  --json <path>                 JSON inventory output path
  --check                       Verify outputs are current without writing files
  --fail-on-parse-error         Exit non-zero when either CSS parser reports an error
  --help                        Show this help

The scanner reads source assets only. Generated outputs contain relative asset names,
content hashes, and deterministic evidence; the absolute source directory is omitted.`)
}

function requireOptionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`)
  return value
}

function parseCli(args: string[]): CliOptions | null {
  const options: CliOptions = {
    assetsRoot: defaultAssetsRoot,
    markdownPath: defaultMarkdownPath,
    jsonPath: defaultJsonPath,
    check: false,
    failOnParseError: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      printHelp()
      return null
    }
    if (argument === '--assets-root') {
      options.assetsRoot = resolve(requireOptionValue(args, index, argument))
      index += 1
      continue
    }
    if (argument === '--markdown') {
      options.markdownPath = resolve(requireOptionValue(args, index, argument))
      index += 1
      continue
    }
    if (argument === '--json') {
      options.jsonPath = resolve(requireOptionValue(args, index, argument))
      index += 1
      continue
    }
    if (argument === '--check') {
      options.check = true
      continue
    }
    if (argument === '--fail-on-parse-error') {
      options.failOnParseError = true
      continue
    }
    throw new Error(`unknown option: ${argument}`)
  }
  return options
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function sourceOffset(node: ChildNode | AtRule | Declaration | Rule): number {
  return node.source?.start?.offset ?? 0
}

async function readUtf8(path: string): Promise<{ source: string; bytes: Buffer; hash: string }> {
  const bytes = await readFile(path)
  let source: string
  try {
    source = utf8Decoder.decode(bytes)
  } catch (error) {
    throw new Error(
      `invalid UTF-8 in ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return { source, bytes, hash: sha256(bytes) }
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path])
    }),
  )
  return nested
    .flat()
    .sort((left, right) =>
      normalizePath(relative(directory, left)).localeCompare(
        normalizePath(relative(directory, right)),
        'en',
      ),
    )
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en')
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText)
}

function increment(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount
}

function atRuleContext(node: ChildNode): string[] {
  const context: string[] = []
  let parent: Container | undefined = node.parent
  while (parent) {
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule
      context.push(`@${atRule.name}${atRule.params ? ` ${atRule.params}` : ''}`)
    }
    parent = parent.parent
  }
  return context.reverse()
}

function addSpecificity(left: Specificity, right: Specificity): Specificity {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function maxSpecificity(values: Specificity[]): Specificity {
  return values.reduce<Specificity>(
    (best, value) => {
      if (value[0] !== best[0]) return value[0] > best[0] ? value : best
      if (value[1] !== best[1]) return value[1] > best[1] ? value : best
      return value[2] > best[2] ? value : best
    },
    [0, 0, 0],
  )
}

function selectorNodeSpecificity(node: any): Specificity {
  if (node.type === 'id') return [1, 0, 0]
  if (node.type === 'class' || node.type === 'attribute') return [0, 1, 0]
  if (node.type === 'tag') return node.value === '*' ? [0, 0, 0] : [0, 0, 1]
  if (node.type === 'pseudo') {
    const value = String(node.value).toLowerCase()
    if (value.startsWith('::')) return [0, 0, 1]
    if (value === ':where') return [0, 0, 0]
    if (value === ':is' || value === ':not' || value === ':has') {
      return maxSpecificity((node.nodes ?? []).map((child: any) => selectorNodeSpecificity(child)))
    }
    if (value === ':nth-child' || value === ':nth-last-child') {
      return addSpecificity(
        [0, 1, 0],
        maxSpecificity((node.nodes ?? []).map((child: any) => selectorNodeSpecificity(child))),
      )
    }
    return [0, 1, 0]
  }
  if (node.nodes) {
    return node.nodes.reduce(
      (total: Specificity, child: any) => addSpecificity(total, selectorNodeSpecificity(child)),
      [0, 0, 0] as Specificity,
    )
  }
  return [0, 0, 0]
}

function parseSelectors(selector: string): Array<{
  value: string
  specificity: Specificity | null
  parseError?: string
}> {
  try {
    const root = selectorParser().astSync(selector)
    return root.nodes.map((node: any) => ({
      value: node.toString(),
      specificity: selectorNodeSpecificity(node),
    }))
  } catch (error) {
    return [
      {
        value: selector,
        specificity: null,
        parseError: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

function parseVariableReferences(value: string): Array<{
  name: string
  fallback: string | null
}> {
  const references: Array<{ name: string; fallback: string | null }> = []
  const parsed = valueParser(value)
  parsed.walk((node) => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return
    const inner = valueParser.stringify(node.nodes)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    if (!name.startsWith('--')) return
    references.push({
      name,
      fallback: comma < 0 ? null : inner.slice(comma + 1).trim() || null,
    })
  })
  return references
}

function parseUrls(value: string, declarationOffset: number, property: string): UrlOccurrence[] {
  const urls: UrlOccurrence[] = []
  const parsed = valueParser(value)
  parsed.walk((node) => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return
    const raw = valueParser.stringify(node.nodes).trim()
    const unquoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    urls.push({
      value: unquoted,
      offset: declarationOffset + (node.sourceIndex ?? 0),
      property,
    })
    return false
  })
  return urls
}

function classifyCss(
  path: string,
  source: string,
  ruleCount: number,
  fontFaceCount: number,
): { category: CssCategory; tags: string[]; status: InventoryStatus } {
  const lower = `${path}\n${source.slice(0, 100_000)}`.toLowerCase()
  const tagPatterns: Array<[string, RegExp]> = [
    ['Tailwind', /tailwindcss|--tw-/],
    ['KaTeX', /katex/],
    ['xterm', /xterm/],
    ['ProseMirror', /prosemirror/],
    ['Recharts', /recharts/],
    ['PDF.js', /pdfjs|pdf-preview|pdf_viewer/],
    ['CodeMirror', /codemirror|\.cm-editor|\.cm-content/],
    ['Mapbox', /mapbox/],
    ['Presentation', /presentation|popcornelectron/],
  ]
  const tags = tagPatterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(([tag]) => tag)
    .sort(compareText)
  const vendorTags = new Set(['KaTeX', 'xterm', 'ProseMirror', 'Recharts', 'PDF.js', 'Mapbox'])

  if (ruleCount === 0 && fontFaceCount > 0) {
    return { category: 'font', tags, status: 'adapt' }
  }
  if (tags.some((tag) => vendorTags.has(tag)) && !tags.includes('Tailwind')) {
    return { category: 'vendor', tags, status: 'vendor' }
  }
  if (/page|panel|settings|onboarding|window|profile|plugins/.test(path.toLowerCase())) {
    return { category: 'app-page', tags, status: 'adapt' }
  }
  if (tags.includes('Tailwind') || /^app-[^-]+\.css$/i.test(path)) {
    return { category: 'app-global', tags, status: 'map' }
  }
  return { category: 'app-component', tags, status: 'adapt' }
}

function extractJsReferences(source: string): string[] {
  const references: string[] = []
  for (const match of source.matchAll(/["'](\.\/[^"'?#]+\.(?:js|mjs|css))(?:[?#][^"']*)?["']/g)) {
    references.push(match[1].slice(2))
  }
  return uniqueSorted(references)
}

function evidenceExcerpt(source: string, offset: number, width = 180): string {
  return source
    .slice(Math.max(0, offset - 30), Math.min(source.length, offset + width))
    .replace(/\s+/g, ' ')
    .slice(0, width)
}

function collectStyleEvidence(source: string): StyleEvidence[] {
  const definitions: Array<{
    kind: string
    pattern: RegExp
    recoverable: boolean
    reason?: string
  }> = [
    {
      kind: 'theme-class',
      pattern: /\belectron-(?:dark|light)\b/g,
      recoverable: true,
    },
    {
      kind: 'root-custom-property',
      pattern:
        /(?:document\.documentElement|document\.querySelector\([^)]*\))[^;]{0,180}\.style\.setProperty\s*\(/g,
      recoverable: false,
      reason: 'The call is retained, but minified runtime expressions may not have a static value.',
    },
    {
      kind: 'custom-property-setter',
      pattern: /\.setProperty\s*\(\s*["'`](--[\w-]+)/g,
      recoverable: false,
      reason: 'The custom-property name is static; its runtime value may be dynamic.',
    },
    {
      kind: 'constructable-stylesheet',
      pattern: /\b(?:new\s+CSSStyleSheet|CSSStyleSheet\s*\()/g,
      recoverable: false,
      reason: 'Constructable stylesheet text can be assembled from runtime chunks.',
    },
    {
      kind: 'adopted-stylesheets',
      pattern: /\badoptedStyleSheets\b/g,
      recoverable: true,
    },
    {
      kind: 'shadow-root',
      pattern: /\b(?:attachShadow|shadowRoot)\b/g,
      recoverable: false,
      reason: 'Shadow DOM ownership is static, while injected styles can be dynamic.',
    },
    {
      kind: 'style-element',
      pattern: /\b(?:createElement\(\s*["'`]style["'`]|<style[\s>])/g,
      recoverable: false,
      reason: 'The fallback style element is identifiable; its text may be composed dynamically.',
    },
    {
      kind: 'inline-style-api',
      pattern: /\.style\.(?:setProperty|cssText|display|color|background|transform|opacity)\b/g,
      recoverable: false,
      reason: 'Inline style assignment is runtime behavior, not a reusable stylesheet rule.',
    },
    {
      kind: 'insert-rule',
      pattern: /\.insertRule\s*\(/g,
      recoverable: false,
      reason: 'The stylesheet rule is assembled or inserted at runtime.',
    },
    {
      kind: 'dynamic-font-face',
      pattern: /\b(?:new\s+FontFace|FontFace\s*\()/g,
      recoverable: false,
      reason: 'Font-face descriptors or sources are resolved at runtime.',
    },
  ]

  const evidence: StyleEvidence[] = []
  for (const definition of definitions) {
    definition.pattern.lastIndex = 0
    for (const match of source.matchAll(definition.pattern)) {
      const offset = match.index
      evidence.push({
        kind: definition.kind,
        offset,
        form: evidenceExcerpt(source, offset),
        recoverable: definition.recoverable,
        ...(definition.reason ? { reason: definition.reason } : {}),
      })
    }
  }
  return evidence
    .sort((left, right) => left.offset - right.offset || compareText(left.kind, right.kind))
    .filter(
      (item, index, all) =>
        index === 0 || item.kind !== all[index - 1].kind || item.offset !== all[index - 1].offset,
    )
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareText(left, right),
    )
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function themeSlug(path: string): string {
  return basename(path)
    .replace(/\.(?:js|mjs)$/i, '')
    .replace(/-[A-Za-z0-9_-]{8}$/, '')
}

function extractThemes(source: string, path: string): ExtractedTheme[] {
  const themes: ExtractedTheme[] = []
  const slug = themeSlug(path)
  for (const match of source.matchAll(/JSON\.parse\(\s*`([\s\S]*?)`\s*\)/g)) {
    if (!match[1].includes('"tokenColors"') && !match[1].includes('"colors"')) continue
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>
      const colors = parsed.colors
      const tokenColors = parsed.tokenColors
      if (
        !colors ||
        typeof colors !== 'object' ||
        (!Array.isArray(tokenColors) && !('type' in parsed))
      ) {
        continue
      }
      const normalized = canonicalJson(parsed)
      themes.push({
        slug,
        name:
          typeof parsed.name === 'string'
            ? parsed.name
            : typeof parsed.displayName === 'string'
              ? parsed.displayName
              : 'unnamed-theme',
        ...(typeof parsed.displayName === 'string' ? { displayName: parsed.displayName } : {}),
        ...(typeof parsed.type === 'string' ? { type: parsed.type } : {}),
        colorCount: Object.keys(colors).length,
        tokenColorCount: Array.isArray(tokenColors) ? tokenColors.length : 0,
        normalizedHash: sha256(normalized),
        offset: match.index,
        recoverability: 'structured',
      })
    } catch {
      // Malformed or dynamically escaped JSON remains represented by the JS evidence record.
    }
  }
  const defaultExport = source.match(
    /export\{[^}]*?\b([A-Za-z_$][\w$]*)\s+as\s+default\b[^}]*\}/,
  )?.[1]
  if (defaultExport && !themes.some((theme) => theme.offset >= 0)) {
    const defaultAssignment = findAssignedLiteral(source, defaultExport)
    if (
      defaultAssignment?.value.startsWith('{') &&
      defaultAssignment.value.includes('tokenColors:')
    ) {
      const fieldVariables = new Map<string, string>()
      for (const field of ['name', 'displayName', 'type', 'colors', 'tokenColors']) {
        const match = defaultAssignment.value.match(
          new RegExp(`(?:^|[,{}])${field}:([A-Za-z_$][\\w$]*)`),
        )
        if (match) fieldVariables.set(field, match[1])
      }
      const nameValue = fieldVariables.has('name')
        ? findAssignedLiteral(source, fieldVariables.get('name')!)?.value
        : undefined
      const displayNameValue = fieldVariables.has('displayName')
        ? findAssignedLiteral(source, fieldVariables.get('displayName')!)?.value
        : undefined
      const typeValue = fieldVariables.has('type')
        ? findAssignedLiteral(source, fieldVariables.get('type')!)?.value
        : undefined
      const colorsValue = fieldVariables.has('colors')
        ? findAssignedLiteral(source, fieldVariables.get('colors')!)?.value
        : undefined
      const tokenColorsValue = fieldVariables.has('tokenColors')
        ? findAssignedLiteral(source, fieldVariables.get('tokenColors')!)?.value
        : undefined
      if (colorsValue?.startsWith('{') && tokenColorsValue?.startsWith('[')) {
        const normalized = [
          unwrapStaticString(nameValue) ?? 'unnamed-theme',
          unwrapStaticString(typeValue) ?? '',
          colorsValue.replace(/\s+/g, ''),
          tokenColorsValue.replace(/\s+/g, ''),
        ].join('\0')
        themes.push({
          slug,
          name: unwrapStaticString(nameValue) ?? 'unnamed-theme',
          ...(unwrapStaticString(displayNameValue)
            ? { displayName: unwrapStaticString(displayNameValue) }
            : {}),
          ...(unwrapStaticString(typeValue) ? { type: unwrapStaticString(typeValue) } : {}),
          colorCount: countTopLevelEntries(colorsValue),
          tokenColorCount: countTopLevelEntries(tokenColorsValue),
          normalizedHash: sha256(normalized),
          offset: defaultAssignment.offset,
          recoverability: 'structured',
        })
      }
    }
  }
  if (themes.length === 0 && source.length < 100_000 && source.includes('editor.background')) {
    const colorCount = new Set(
      [
        ...source.matchAll(
          /["']([A-Za-z][\w.-]*\.(?:background|foreground|border|accent|color))["']\s*:/g,
        ),
      ].map((match) => match[1]),
    ).size
    const tokenColorCount = [...source.matchAll(/\bscope\s*:/g)].length
    themes.push({
      slug,
      name: slug,
      colorCount,
      tokenColorCount,
      normalizedHash: sha256(source.replace(/\s+/g, '')),
      offset: source.indexOf('editor.background'),
      recoverability: 'signature',
    })
  }
  return themes
}

function findAssignedLiteral(
  source: string,
  variable: string,
): { value: string; offset: number } | null {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const assignment = new RegExp(`(?:^|[,;({])${escaped}=`, 'g').exec(source)
  if (!assignment) return null
  const offset = assignment.index + assignment[0].length
  const opening = source[offset]
  if (opening === '`' || opening === '"' || opening === "'") {
    let escapedCharacter = false
    for (let index = offset + 1; index < source.length; index += 1) {
      const character = source[index]
      if (!escapedCharacter && character === opening) {
        return { value: source.slice(offset, index + 1), offset }
      }
      escapedCharacter = !escapedCharacter && character === '\\'
      if (character !== '\\') escapedCharacter = false
    }
    return null
  }
  if (opening !== '{' && opening !== '[') return null
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let quote = ''
  let escapedCharacter = false
  for (let index = offset; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (!escapedCharacter && character === quote) quote = ''
      escapedCharacter = !escapedCharacter && character === '\\'
      if (character !== '\\') escapedCharacter = false
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === opening) depth += 1
    if (character === closing) {
      depth -= 1
      if (depth === 0) return { value: source.slice(offset, index + 1), offset }
    }
  }
  return null
}

function unwrapStaticString(value: string | undefined): string | undefined {
  if (!value || !['"', "'", '`'].includes(value[0]) || value.at(-1) !== value[0]) {
    return undefined
  }
  return value.slice(1, -1)
}

function countTopLevelEntries(value: string): number {
  if (value.length <= 2) return 0
  const opening = value[0]
  const closing = opening === '{' ? '}' : ']'
  let objectDepth = 0
  let arrayDepth = 0
  let quote = ''
  let escapedCharacter = false
  let commas = 0
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]
    if (quote) {
      if (!escapedCharacter && character === quote) quote = ''
      escapedCharacter = !escapedCharacter && character === '\\'
      if (character !== '\\') escapedCharacter = false
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') objectDepth += 1
    if (character === '}') objectDepth -= 1
    if (character === '[') arrayDepth += 1
    if (character === ']') arrayDepth -= 1
    if (character === ',' && objectDepth === 0 && arrayDepth === 0) commas += 1
  }
  return value.slice(1, -1).trim() && value.at(-1) === closing ? commas + 1 : 0
}

type LiteralAssignment = {
  binding: string | null
  literal: string
  offset: number
  end: number
}

function readStringLiteralAt(source: string, offset: number): LiteralAssignment | null {
  const quote = source[offset]
  if (!['"', "'", '`'].includes(quote)) return null
  let escaped = false
  for (let index = offset + 1; index < source.length; index += 1) {
    const character = source[index]
    if (!escaped && character === quote) {
      return {
        binding: null,
        literal: source.slice(offset, index + 1),
        offset,
        end: index + 1,
      }
    }
    escaped = !escaped && character === '\\'
    if (character !== '\\') escaped = false
  }
  return null
}

function decodeExactLiteral(literal: string): string | null {
  if (literal[0] === '`' && literal.includes('${')) return null
  try {
    // The input is a single, already-delimited literal with no template interpolation.
    // Evaluating only that literal preserves JavaScript escape semantics without running
    // surrounding bundle code.
    return Function(`"use strict";return (${literal})`)()
  } catch {
    return null
  }
}

function collectLiteralAssignments(source: string): LiteralAssignment[] {
  const assignments: LiteralAssignment[] = []
  for (const match of source.matchAll(/(?:^|[,;({])([A-Za-z_$][\w$]*)=(["'`])/g)) {
    const openingOffset = match.index + match[0].length - 1
    const literal = readStringLiteralAt(source, openingOffset)
    if (!literal) continue
    assignments.push({ ...literal, binding: match[1] })
  }
  return assignments.sort((left, right) => left.offset - right.offset)
}

function resolvePartialTemplate(
  literal: LiteralAssignment,
  assignments: LiteralAssignment[],
): {
  source: string
  recoverability: 'exact' | 'partial-template'
  interpolations: Array<{ expression: string; resolved: boolean }>
} {
  const exact = decodeExactLiteral(literal.literal)
  if (exact !== null) {
    return { source: exact, recoverability: 'exact', interpolations: [] }
  }

  let source = literal.literal.slice(1, -1).replaceAll('\\`', '`')
  const interpolations: Array<{ expression: string; resolved: boolean }> = []
  let dynamicIndex = 0
  source = source.replace(/\$\{([^{}]+)\}/g, (_match, rawExpression: string) => {
    const expression = rawExpression.trim()
    const candidates = /^[A-Za-z_$][\w$]*$/.test(expression)
      ? assignments.filter(
          (assignment) => assignment.binding === expression && assignment.end <= literal.offset,
        )
      : []
    const resolved = candidates.length > 0 ? decodeExactLiteral(candidates.at(-1)!.literal) : null
    interpolations.push({ expression, resolved: resolved !== null })
    return resolved ?? `__DYNAMIC_${dynamicIndex++}__`
  })
  return { source, recoverability: 'partial-template', interpolations }
}

function isCssLike(source: string): boolean {
  if (source.length < 64 || !source.includes('{') || !source.includes('}')) return false
  if (!/[\w-]+\s*:/.test(source)) return false
  return /@(?:layer|keyframes|font-face|property)\b|(?:^|[}\s,])(?:[:.#*\[]|[A-Za-z][\w-]*)(?:[^{}]|\{[^{}]*\})*\{/s.test(
    source,
  )
}

function extractJsStylesheets(source: string): StaticJsStylesheet[] {
  const assignments = collectLiteralAssignments(source)
  const sinks: Array<{
    kind: string
    offset: number
    expressionOffset: number
  }> = []
  const sinkPatterns: Array<[string, RegExp]> = [
    ['replaceSync', /\.replaceSync\(\s*/g],
    ['textContent', /\.textContent\s*=\s*/g],
    ['innerHTML', /\.innerHTML\s*=\s*/g],
    ['textContent-property', /(?:^|[,({])textContent\s*:\s*/g],
  ]
  for (const [kind, pattern] of sinkPatterns) {
    for (const match of source.matchAll(pattern)) {
      sinks.push({
        kind,
        offset: match.index,
        expressionOffset: match.index + match[0].length,
      })
    }
  }

  const extracted = new Map<number, StaticJsStylesheet>()
  for (const sink of sinks.sort((left, right) => left.offset - right.offset)) {
    const expression = source.slice(sink.expressionOffset, sink.expressionOffset + 160)
    let binding: string | null = null
    let wrapper: string | undefined
    let literal: LiteralAssignment | null = null

    const directQuote = source[sink.expressionOffset]
    if (['"', "'", '`'].includes(directQuote)) {
      literal = readStringLiteralAt(source, sink.expressionOffset)
    } else {
      const wrapped = expression.match(/^([A-Za-z_$][\w$]*)\(\s*([A-Za-z_$][\w$]*)\s*\)/)
      const direct = expression.match(/^([A-Za-z_$][\w$]*)/)
      if (wrapped) {
        wrapper = wrapped[1]
        binding = wrapped[2]
      } else if (direct) {
        binding = direct[1]
      }
      if (binding) {
        literal =
          assignments
            .filter((assignment) => {
              if (assignment.binding !== binding) return false
              const distance =
                assignment.end <= sink.offset
                  ? sink.offset - assignment.end
                  : assignment.offset - sink.offset
              return distance >= 0 && distance <= 65_536
            })
            .sort((left, right) => {
              const leftDistance =
                left.end <= sink.offset ? sink.offset - left.end : left.offset - sink.offset
              const rightDistance =
                right.end <= sink.offset ? sink.offset - right.end : right.offset - sink.offset
              return (
                leftDistance - rightDistance ||
                Number(right.end <= sink.offset) - Number(left.end <= sink.offset)
              )
            })[0] ?? null
      }
    }
    if (!literal) continue

    const resolved = resolvePartialTemplate(literal, assignments)
    if (!isCssLike(resolved.source)) continue
    const current = extracted.get(literal.offset)
    if (current) {
      current.sinkKinds = uniqueSorted([...current.sinkKinds, sink.kind])
      current.sinkOffsets = [...current.sinkOffsets, sink.offset].sort((a, b) => a - b)
      if (!current.wrapper && wrapper) current.wrapper = wrapper
      continue
    }
    extracted.set(literal.offset, {
      binding: literal.binding ?? binding,
      literalOffset: literal.offset,
      rawChars: Math.max(0, literal.literal.length - 2),
      sinkKinds: [sink.kind],
      sinkOffsets: [sink.offset],
      ...(wrapper ? { wrapper } : {}),
      recoverability: resolved.recoverability,
      interpolations: resolved.interpolations,
      rawHash: sha256(resolved.source),
      source: resolved.source,
    })
  }
  return [...extracted.values()].sort((left, right) => left.literalOffset - right.literalOffset)
}

function extractCustomPropertyWrites(source: string): Array<{
  name: string
  valueExpression: string
  offset: number
}> {
  return [...source.matchAll(/\.setProperty\(\s*["'`](--[\w-]+)["'`]\s*,/g)]
    .map((match) => ({
      name: match[1],
      valueExpression: source
        .slice(match.index + match[0].length, match.index + match[0].length + 180)
        .split(/[);]/, 1)[0]
        .replace(/\s+/g, ' ')
        .trim(),
      offset: match.index,
    }))
    .sort((left, right) => left.offset - right.offset || compareText(left.name, right.name))
}

function classifyJs(
  path: string,
  source: string,
  themes: ExtractedTheme[],
  evidence: StyleEvidence[],
): { category: JsCategory; status: InventoryStatus; tags: string[]; reason: string } {
  const lowerPath = path.toLowerCase()
  const tags = new Set<string>()
  if (/mapbox/.test(lowerPath)) tags.add('Mapbox')
  if (/mermaid/.test(lowerPath)) tags.add('Mermaid')
  if (/pdf|presentation|workbook|notebook/.test(lowerPath)) tags.add('document-preview')
  if (/codemirror|diff|file-tree/.test(lowerPath)) tags.add('editor')

  if (themes.length > 0) {
    return {
      category: 'code-highlight-theme',
      status: 'document-only',
      tags: [...tags].sort(compareText),
      reason: 'Contains a statically recoverable Shiki/VS Code theme object.',
    }
  }
  if (
    source.includes('"scopeName"') &&
    (source.includes('"patterns"') || source.includes('"repository"'))
  ) {
    return {
      category: 'grammar-noise',
      status: 'exclude',
      tags: [...tags].sort(compareText),
      reason: 'TextMate/Shiki grammar data is syntax metadata, not application CSS.',
    }
  }
  if (/^[a-z]{2}(?:-[A-Z]{2})?-[A-Za-z0-9_-]{8,}\.js$/.test(path)) {
    return {
      category: 'locale',
      status: 'exclude',
      tags: [...tags].sort(compareText),
      reason: 'Locale chunk naming identifies translated message data.',
    }
  }
  if (
    source.includes('createLucideIcon-') ||
    /(?:^|~)(?:icon|icons)(?:-|~)/i.test(path) ||
    /\blucide\b/i.test(source.slice(0, 2_000))
  ) {
    return {
      category: 'icon-noise',
      status: 'exclude',
      tags: [...tags].sort(compareText),
      reason: 'Lucide icon geometry/component chunk; no reusable style definitions.',
    }
  }
  if (
    /\belectron-(?:dark|light)\b/.test(source) ||
    /(?:document\.documentElement|:root)[\s\S]{0,300}setProperty\s*\(/.test(source)
  ) {
    return {
      category: 'runtime-theme',
      status: 'map',
      tags: [...tags].sort(compareText),
      reason: 'Applies theme classes or custom properties at runtime.',
    }
  }
  if (
    evidence.some((item) =>
      ['constructable-stylesheet', 'adopted-stylesheets', 'shadow-root'].includes(item.kind),
    )
  ) {
    return {
      category: 'shadow-dom-style',
      status: 'adapt',
      tags: [...tags].sort(compareText),
      reason: 'Owns or injects styles inside a Shadow DOM boundary.',
    }
  }
  if (
    tags.size > 0 &&
    evidence.some((item) =>
      ['style-element', 'inline-style-api', 'constructable-stylesheet'].includes(item.kind),
    )
  ) {
    return {
      category: 'third-party-style',
      status: 'vendor',
      tags: [...tags].sort(compareText),
      reason: 'Preview/vendor code includes its own runtime styling behavior.',
    }
  }
  if (
    evidence.length > 0 ||
    /\b(?:className|classList|style\s*:|cssText)\b/.test(source) ||
    /["']\.\/[^"']+\.css["']/.test(source)
  ) {
    return {
      category: 'style-usage',
      status: 'document-only',
      tags: [...tags].sort(compareText),
      reason: 'Consumes classes, CSS chunks, or inline style APIs without defining a theme.',
    }
  }
  return {
    category: 'unrelated',
    status: 'exclude',
    tags: [...tags].sort(compareText),
    reason: 'No statically observable style ownership or style mutation.',
  }
}

function classifyAssetReference(
  value: string,
): 'file' | 'data' | 'fragment' | 'remote' | 'invalid' {
  if (!value) return 'invalid'
  if (value.startsWith('data:')) return 'data'
  if (value.startsWith('#')) return 'fragment'
  if (/^(?:https?:|blob:|file:|\/\/)/i.test(value)) return 'remote'
  return 'file'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function analyzeStyleSource(options: {
  source: string
  sourceFile: string
  offsetBase?: number
  resolutionBase?: string
  requireLightning?: boolean
}): any {
  const {
    source,
    sourceFile,
    offsetBase = 0,
    resolutionBase = '.',
    requireLightning = true,
  } = options
  const bytes = Buffer.from(source, 'utf8')
  const postcssErrors: string[] = []
  const lightningcssErrors: string[] = []
  let root: ReturnType<typeof postcss.parse> | null = null
  try {
    root = postcss.parse(source, { from: sourceFile })
  } catch (error) {
    postcssErrors.push(error instanceof Error ? error.message : String(error))
  }
  if (requireLightning) {
    try {
      transform({
        filename: sourceFile,
        code: bytes,
        minify: false,
        sourceMap: false,
        analyzeDependencies: false,
      })
    } catch (error) {
      lightningcssErrors.push(error instanceof Error ? error.message : String(error))
    }
  }

  const rules: any[] = []
  const atRules: any[] = []
  const customPropertyDefinitions = new Set<string>()
  const customPropertyReferences = new Set<string>()
  const customPropertyRecords: any[] = []
  const keyframes: any[] = []
  const fontFaces: any[] = []
  const properties: any[] = []
  const urlOccurrences: Array<UrlOccurrence & { sourceFile: string; resolutionBase: string }> = []
  let ruleDeclarationCount = 0
  let atRuleDeclarationCount = 0
  let selectorItemCount = 0
  const absoluteOffset = (node: ChildNode | AtRule | Declaration | Rule): number =>
    offsetBase + sourceOffset(node)

  if (root) {
    root.walkRules((rule) => {
      const selectors = parseSelectors(rule.selector)
      selectorItemCount += selectors.length
      const declarations = (rule.nodes ?? [])
        .filter((node): node is Declaration => node.type === 'decl')
        .map((declaration) => {
          ruleDeclarationCount += 1
          if (declaration.prop.startsWith('--')) {
            customPropertyDefinitions.add(declaration.prop)
            customPropertyRecords.push({
              name: declaration.prop,
              value: declaration.value,
              selector: rule.selector,
              context: atRuleContext(rule),
              sourceFile,
              offset: absoluteOffset(declaration),
              important: declaration.important,
            })
          }
          const references = parseVariableReferences(declaration.value)
          for (const reference of references) customPropertyReferences.add(reference.name)
          const urls = parseUrls(declaration.value, absoluteOffset(declaration), declaration.prop)
          urlOccurrences.push(
            ...urls.map((url) => ({
              ...url,
              sourceFile,
              resolutionBase,
            })),
          )
          return {
            property: declaration.prop,
            value: declaration.value,
            important: declaration.important,
            offset: absoluteOffset(declaration),
            variableReferences: references,
            urls: urls.map((url) => url.value),
          }
        })
      rules.push({
        selector: rule.selector,
        selectors,
        offset: absoluteOffset(rule),
        context: atRuleContext(rule),
        declarations,
      })
    })
    root.walkAtRules((atRule) => {
      const declarations = (atRule.nodes ?? [])
        .filter((node): node is Declaration => node.type === 'decl')
        .map((declaration) => {
          atRuleDeclarationCount += 1
          if (declaration.prop.startsWith('--')) {
            customPropertyDefinitions.add(declaration.prop)
            customPropertyRecords.push({
              name: declaration.prop,
              value: declaration.value,
              selector: null,
              context: atRuleContext(atRule),
              sourceFile,
              offset: absoluteOffset(declaration),
              important: declaration.important,
            })
          }
          const references = parseVariableReferences(declaration.value)
          for (const reference of references) customPropertyReferences.add(reference.name)
          const urls = parseUrls(declaration.value, absoluteOffset(declaration), declaration.prop)
          urlOccurrences.push(
            ...urls.map((url) => ({
              ...url,
              sourceFile,
              resolutionBase,
            })),
          )
          return {
            property: declaration.prop,
            value: declaration.value,
            important: declaration.important,
            offset: absoluteOffset(declaration),
            variableReferences: references,
            urls: urls.map((url) => url.value),
          }
        })
      const record: any = {
        name: atRule.name,
        params: atRule.params,
        offset: absoluteOffset(atRule),
        context: atRuleContext(atRule),
        declarations,
      }
      atRules.push(record)
      const name = atRule.name.toLowerCase()
      if (name.endsWith('keyframes')) {
        keyframes.push({
          ...record,
          keyframeName: atRule.params.trim(),
          steps: (atRule.nodes ?? [])
            .filter((node): node is Rule => node.type === 'rule')
            .map((rule) => rule.selector),
        })
      }
      if (name === 'font-face') fontFaces.push(record)
      if (name === 'property') properties.push(record)
      const urls = parseUrls(atRule.params, absoluteOffset(atRule), `@${atRule.name}`)
      urlOccurrences.push(
        ...urls.map((url) => ({
          ...url,
          sourceFile,
          resolutionBase,
        })),
      )
    })
  }

  return {
    parse: {
      postcss: { ok: postcssErrors.length === 0, errors: postcssErrors },
      lightningcss: {
        ok: !requireLightning || lightningcssErrors.length === 0,
        skipped: !requireLightning,
        errors: lightningcssErrors,
      },
    },
    counts: {
      rules: rules.length,
      declarations: ruleDeclarationCount,
      atRuleDeclarations: atRuleDeclarationCount,
      totalDeclarations: ruleDeclarationCount + atRuleDeclarationCount,
      selectorItems: selectorItemCount,
      parsedTopLevelSelectors: rules.reduce((total, rule) => total + rule.selectors.length, 0),
      atRules: atRules.length,
      mediaQueries: atRules.filter((item) => item.name.toLowerCase() === 'media').length,
      containerQueries: atRules.filter((item) => item.name.toLowerCase() === 'container').length,
      supportsQueries: atRules.filter((item) => item.name.toLowerCase() === 'supports').length,
      layers: atRules.filter((item) => item.name.toLowerCase() === 'layer').length,
      customPropertyDefinitions: customPropertyDefinitions.size,
      customPropertyReferences: customPropertyReferences.size,
      keyframes: keyframes.length,
      fontFaces: fontFaces.length,
      properties: properties.length,
    },
    customProperties: {
      definitions: [...customPropertyDefinitions].sort(compareText),
      references: [...customPropertyReferences].sort(compareText),
      records: customPropertyRecords.sort(
        (left, right) =>
          compareText(left.name, right.name) ||
          compareText(left.sourceFile, right.sourceFile) ||
          left.offset - right.offset,
      ),
    },
    rules,
    atRules,
    keyframes,
    fontFaces,
    properties,
    urlOccurrences,
  }
}

function tokenGroup(name: string): string {
  if (name.startsWith('--tw-')) return 'tailwind-internal'
  if (name.startsWith('--vscode-')) return 'vscode-compat'
  if (/^--(?:color-|gray-|red-|orange-|yellow-|green-|blue-|purple-|alpha-)/.test(name)) {
    return 'color'
  }
  if (/^--(?:font-|text-|leading-|tracking-)/.test(name)) return 'typography'
  if (/^--(?:spacing(?:-|$)|padding-|margin-|gap-|inset-)/.test(name)) {
    return 'spacing'
  }
  if (/(?:radius|corner-shape)/.test(name)) return 'radius'
  if (/(?:shadow|elevation)/.test(name)) return 'shadow'
  if (/(?:animate|animation|transition|duration|easing|ease)/.test(name)) {
    return 'motion'
  }
  return 'layout-component-other'
}

function summarizeValues(
  declarations: any[],
  predicate: (property: string, value: string) => boolean,
): any[] {
  const values = new Map<string, any>()
  for (const declaration of declarations) {
    if (!predicate(declaration.property, declaration.value)) continue
    const key = `${declaration.property}\0${declaration.value}`
    const current = values.get(key) ?? {
      property: declaration.property,
      value: declaration.value,
      count: 0,
      files: new Set<string>(),
    }
    current.count += 1
    current.files.add(declaration.sourceFile)
    values.set(key, current)
  }
  return [...values.values()]
    .map((value) => ({ ...value, files: [...value.files].sort(compareText) }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        compareText(left.property, right.property) ||
        compareText(left.value, right.value),
    )
}

function summarizeAtRules(styleSources: any[], name: string): any[] {
  const queries = new Map<string, any>()
  for (const styleSource of styleSources) {
    for (const atRule of styleSource.analysis.atRules.filter(
      (item: any) => item.name.toLowerCase() === name,
    )) {
      const params = atRule.params.trim().replace(/\s+/g, ' ')
      const current = queries.get(params) ?? {
        params,
        count: 0,
        files: new Set<string>(),
      }
      current.count += 1
      current.files.add(styleSource.sourceFile)
      queries.set(params, current)
    }
  }
  return [...queries.values()]
    .map((query) => ({ ...query, files: [...query.files].sort(compareText) }))
    .sort((left, right) => right.count - left.count || compareText(left.params, right.params))
}

function buildDesignSystem(styleSources: any[]): any {
  const declarations = styleSources.flatMap((styleSource) =>
    styleSource.analysis.rules.flatMap((rule: any) =>
      rule.declarations
        .filter(
          () => !rule.context.some((context: string) => /@(?:-\w+-)?keyframes\b/i.test(context)),
        )
        .map((declaration: any) => ({
          ...declaration,
          sourceFile: styleSource.sourceFile,
          selector: rule.selector,
          context: rule.context,
        })),
    ),
  )
  const tokenDefinitions = styleSources
    .flatMap((styleSource) => styleSource.analysis.customProperties.records)
    .filter(
      (definition: any) =>
        !definition.context.some((context: string) => /@(?:-\w+-)?keyframes\b/i.test(context)),
    )
    .map((definition: any) => ({
      ...definition,
      group: tokenGroup(definition.name),
    }))
    .sort(
      (left: any, right: any) =>
        compareText(left.name, right.name) ||
        compareText(left.sourceFile, right.sourceFile) ||
        left.offset - right.offset,
    )
  const tokenNames = uniqueSorted(tokenDefinitions.map((definition: any) => definition.name))
  const externalTokenNames = uniqueSorted(
    tokenDefinitions
      .filter((definition: any) => !definition.sourceFile.includes('#static-css@'))
      .map((definition: any) => definition.name),
  )
  const groups: Record<string, number> = {}
  for (const name of tokenNames) increment(groups, tokenGroup(name))

  const primitivePattern = /^--(?:gray|red|orange|yellow|green|blue|purple)-\d+$/
  const tailwindPalettePattern =
    /^--color-(?:red|orange|amber|yellow|green|blue|purple|slate|gray|black|white)-?\d*$/
  const semanticPattern =
    /^--color-(?:background|text|icon|accent|border|decoration|editor|simple|token-)/
  const colorFormats: Record<string, number> = {}
  for (const declaration of declarations) {
    const value = declaration.value
    const patterns: Array<[string, RegExp]> = [
      ['hex', /#[0-9a-f]{3,8}\b/gi],
      ['color-mix', /color-mix\(/gi],
      ['oklch', /oklch\(/gi],
      ['rgb', /\brgba?\(/gi],
      ['hsl', /\bhsla?\(/gi],
      ['linear-gradient', /linear-gradient\(/gi],
      ['radial-gradient', /radial-gradient\(/gi],
      ['conic-gradient', /conic-gradient\(/gi],
    ]
    for (const [format, pattern] of patterns) {
      const count = [...value.matchAll(pattern)].length
      if (count > 0) increment(colorFormats, format, count)
    }
  }

  const fontFaceMap = new Map<string, any>()
  for (const styleSource of styleSources) {
    for (const fontFace of styleSource.analysis.fontFaces) {
      const values = Object.fromEntries(
        fontFace.declarations.map((declaration: any) => [declaration.property, declaration.value]),
      )
      const key = [
        values['font-family'] ?? '',
        values['font-style'] ?? '',
        values['font-weight'] ?? '',
        values.src ?? '',
      ].join('\0')
      const current = fontFaceMap.get(key) ?? {
        family: values['font-family'] ?? 'unknown',
        style: values['font-style'] ?? 'normal',
        weight: values['font-weight'] ?? 'normal',
        display: values['font-display'] ?? null,
        src: values.src ?? null,
        unicodeRange: values['unicode-range'] ?? null,
        count: 0,
        files: new Set<string>(),
      }
      current.count += 1
      current.files.add(styleSource.sourceFile)
      fontFaceMap.set(key, current)
    }
  }
  const fontFaces = [...fontFaceMap.values()]
    .map((fontFace) => ({
      ...fontFace,
      files: [...fontFace.files].sort(compareText),
    }))
    .sort(
      (left, right) =>
        compareText(left.family, right.family) ||
        compareText(left.weight, right.weight) ||
        compareText(left.style, right.style),
    )

  const keyframes = styleSources
    .flatMap((styleSource) =>
      styleSource.analysis.keyframes.map((keyframe: any) => ({
        name: keyframe.keyframeName,
        file: styleSource.sourceFile,
        offset: keyframe.offset,
        steps: keyframe.steps,
      })),
    )
    .sort(
      (left, right) =>
        compareText(left.name, right.name) ||
        compareText(left.file, right.file) ||
        left.offset - right.offset,
    )

  return {
    tokens: { names: tokenNames, definitions: tokenDefinitions, groups },
    colors: {
      primitiveTokens: externalTokenNames.filter((name) => primitivePattern.test(name)),
      tailwindPaletteTokens: tokenNames.filter((name) => tailwindPalettePattern.test(name)),
      productTokens: tokenNames.filter((name) => name.startsWith('--color-token-')),
      semanticTokens: tokenNames.filter((name) => semanticPattern.test(name)),
      vscodeTokens: tokenNames.filter((name) => name.startsWith('--vscode-')),
      componentTokens: tokenNames.filter(
        (name) =>
          !primitivePattern.test(name) &&
          !tailwindPalettePattern.test(name) &&
          !semanticPattern.test(name) &&
          !name.startsWith('--vscode-') &&
          /color|foreground|background|surface|border|scrim|accent|status/.test(name),
      ),
      formats: colorFormats,
      themeVariants: tokenDefinitions.filter(
        (definition: any) =>
          /(?:^|[^\w-])\.(?:electron-)?(?:light|dark)(?![\w-])/.test(definition.selector ?? '') ||
          definition.context.some((context: string) => /prefers-color-scheme/.test(context)),
      ),
    },
    typography: {
      tokens: tokenNames.filter((name) => /^--(?:font-|text-|leading-|tracking-)/.test(name)),
      fontFaces,
      properties: summarizeValues(declarations, (property) =>
        /^(?:font|font-family|font-size|font-style|font-weight|font-feature-settings|line-height|letter-spacing|text-transform)$/.test(
          property,
        ),
      ),
    },
    spacing: {
      tokens: tokenNames.filter((name) =>
        /^--(?:spacing(?:-|$)|padding-|margin-|gap-|inset-)/.test(name),
      ),
      properties: summarizeValues(declarations, (property) =>
        /^(?:margin|padding|gap|row-gap|column-gap|scroll-margin|scroll-padding)/.test(property),
      ),
    },
    radii: {
      tokens: tokenNames.filter((name) => /radius|corner-shape/.test(name)),
      properties: summarizeValues(declarations, (property) =>
        /^(?:border-radius|border-.+-radius|corner-shape)$/.test(property),
      ),
    },
    shadows: {
      tokens: tokenNames.filter((name) => /shadow|elevation/.test(name)),
      properties: summarizeValues(
        declarations,
        (property, value) =>
          /^(?:box-shadow|text-shadow)$/.test(property) ||
          (/^(?:filter|backdrop-filter)$/.test(property) && value.includes('drop-shadow(')),
      ),
    },
    motion: {
      tokens: tokenNames.filter((name) =>
        /animate|animation|transition|duration|easing|ease/.test(name),
      ),
      keyframes,
      properties: summarizeValues(declarations, (property) =>
        /^(?:animation|transition|scroll-timeline|view-transition-name)/.test(property),
      ),
    },
  }
}

function buildBehavior(styleSources: any[]): any {
  const rules = styleSources.flatMap((styleSource) =>
    styleSource.analysis.rules.map((rule: any) => ({
      ...rule,
      sourceFile: styleSource.sourceFile,
    })),
  )
  const evidenceMap = (
    pattern: RegExp,
    selectorValue: (match: RegExpMatchArray) => string,
  ): any[] => {
    const values = new Map<string, any>()
    for (const rule of rules) {
      pattern.lastIndex = 0
      for (const match of rule.selector.matchAll(pattern)) {
        const value = selectorValue(match)
        const current = values.get(value) ?? {
          value,
          count: 0,
          files: new Set<string>(),
        }
        current.count += 1
        current.files.add(rule.sourceFile)
        values.set(value, current)
      }
    }
    return [...values.values()]
      .map((value) => ({ ...value, files: [...value.files].sort(compareText) }))
      .sort((left, right) => right.count - left.count || compareText(left.value, right.value))
  }
  const media = summarizeAtRules(styleSources, 'media')
  const container = summarizeAtRules(styleSources, 'container')
  const supports = summarizeAtRules(styleSources, 'supports')
  const countRules = (pattern: RegExp): number =>
    rules.filter((rule) => pattern.test(rule.selector)).length
  return {
    queries: { media, container, supports },
    platform: {
      windowTypes: evidenceMap(
        /\[data-codex-window-type\s*=\s*["']?([^\]"']+)/g,
        (match) => match[1],
      ),
      operatingSystems: evidenceMap(/\[data-codex-os\s*=\s*["']?([^\]"']+)/g, (match) => match[1]),
      themeSelectors: evidenceMap(
        /(?:^|[^\w\\-])\.(electron-(?:light|dark)|light|dark)(?![\w-])/g,
        (match) => match[1],
      ),
      windowChrome: evidenceMap(
        /\[data-codex-window-chrome\s*=\s*["']?([^\]"']+)/g,
        (match) => match[1],
      ),
    },
    states: {
      hoverRules: countRules(/:hover/),
      activeRules: countRules(/:active/),
      focusVisibleRules: countRules(/:focus-visible/),
      disabledRules: countRules(/:disabled|\[disabled\]/),
      ariaRules: countRules(/\[aria-/),
      dataStateRules: countRules(/\[data-state/),
    },
    accessibility: {
      reducedMotion: media.filter((query) => /prefers-reduced-motion/.test(query.params)),
      reducedTransparency: media.filter((query) =>
        /prefers-reduced-transparency/.test(query.params),
      ),
      forcedColors: media.filter((query) => /forced-colors/.test(query.params)),
      highContrast: media.filter((query) =>
        /-ms-high-contrast|prefers-contrast/.test(query.params),
      ),
      focusVisibleRules: countRules(/:focus-visible/),
      ariaSelectorRules: countRules(/\[aria-/),
      srOnlyRules: countRules(/(?:^|[^\w-])\.sr-only(?![\w-])/),
      reducedMotionDataRules: countRules(/\[data-reduced-motion=true\]/),
      forcedColorAdjustDeclarations: rules.reduce(
        (total, rule) =>
          total +
          rule.declarations.filter(
            (declaration: any) => declaration.property === 'forced-color-adjust',
          ).length,
        0,
      ),
    },
  }
}

function markdownEscape(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\s+/g, ' ')
}

function cssResponsibility(file: any): string {
  const path = file.path.toLowerCase()
  if (/^app-[^-]+\.css$/.test(path)) return '全局设计系统、Tailwind、主题、Shell、KaTeX'
  if (file.bytes > 60_000) return 'Markdown、Composer、编辑器、菜单与共享组件'
  if (file.bytes > 40_000) return 'Mapbox、Recharts、ChatGPT 加载与图表'
  if (path.includes('power-slider')) return '模型 Power Slider、Fast/Max 与粒子动效'
  if (path.includes('presentation')) return '演示文稿编辑器与响应式布局'
  if (path.includes('pdf-preview')) return 'PDF.js 文本层与批注层'
  if (path.includes('remote-text-edit')) return 'Carlito 多语种字体切片'
  if (path.includes('dictation')) return '全局听写表面与录音 Orb'
  if (path.includes('avatar')) return 'Avatar 容器、玻璃胶囊与缩放命中区'
  if (path.includes('navigation-rail')) return '用户消息导航轨和 scrub 状态'
  if (path.includes('profile')) return '资料页骨架与头像编辑'
  if (path.includes('plugins')) return '插件页容器查询网格'
  if (path.includes('onboarding')) return 'Onboarding、UAC、结果 shimmer'
  if (path.includes('page-u')) return '页面切换、Toast、滚动遮罩、Highlight.js'
  if (path.includes('bps-')) return 'Recharts 图表、图例与提示框'
  return '页面或组件拆分样式'
}

function renderMarkdown(inventory: any): string {
  const summary = inventory.summary
  const design = inventory.designSystem
  const behavior = inventory.behavior
  const cssRows = inventory.cssFiles
    .map(
      (file: any) =>
        `| \`${markdownEscape(file.path)}\` | ${file.bytes} | ${file.counts.rules} | ${file.counts.declarations} | ${file.counts.atRuleDeclarations} | ${file.counts.keyframes} | ${file.counts.mediaQueries} | ${file.counts.containerQueries} | ${cssResponsibility(file)} |`,
    )
    .join('\n')
  const htmlRows = inventory.htmlFiles
    .flatMap((file: any) => [
      ...file.styleBlocks.map(
        (block: any) =>
          `| \`${file.path}#style[${block.block}]\` | style block | ${block.chars} | ${block.analysis.counts.rules} | ${block.analysis.counts.declarations} | ${block.analysis.counts.keyframes} | ${file.path === 'index.html' ? '启动 Loader、层顺序、主题 shimmer、reduced-motion' : '透明满屏 Avatar composition surface'} |`,
      ),
      ...file.styleAttributes.map(
        (attribute: any) =>
          `| \`${file.path}#style-attribute[${attribute.attribute}]\` | style attribute | ${attribute.chars} | 0 | ${attribute.counts.declarations} | 0 | body outline |`,
      ),
    ])
    .join('\n')
  const jsCategoryRows = Object.entries(summary.jsCategories)
    .sort(([left], [right]) => compareText(left, right))
    .map(([category, count]) => `| ${category} | ${count} |`)
    .join('\n')
  const tokenGroupRows = Object.entries(design.tokens.groups)
    .sort(([left], [right]) => compareText(left, right))
    .map(([group, count]) => `| ${group} | ${count} |`)
    .join('\n')
  const colorFormatRows = Object.entries(design.colors.formats)
    .sort(([left], [right]) => compareText(left, right))
    .map(([format, count]) => `| ${format} | ${count} |`)
    .join('\n')
  const condensedFonts = new Map<string, any>()
  for (const font of design.typography.fontFaces) {
    const key = `${font.family}\0${font.style}\0${font.weight}`
    const current = condensedFonts.get(key) ?? {
      family: font.family,
      style: font.style,
      weight: font.weight,
      count: 0,
      files: new Set<string>(),
    }
    current.count += font.count
    for (const file of font.files) current.files.add(file)
    condensedFonts.set(key, current)
  }
  const fontRows = [...condensedFonts.values()]
    .sort(
      (left, right) =>
        compareText(left.family, right.family) ||
        compareText(left.weight, right.weight) ||
        compareText(left.style, right.style),
    )
    .map(
      (font: any) =>
        `| \`${markdownEscape(font.family)}\` | ${font.style} | ${font.weight} | ${font.count} | ${[...font.files].map((file: any) => `\`${markdownEscape(file)}\``).join(', ')} |`,
    )
    .join('\n')
  const valueRows = (values: any[], limit = 20): string =>
    values
      .slice(0, limit)
      .map(
        (value) =>
          `| \`${value.property}\` | \`${markdownEscape(value.value)}\` | ${value.count} |`,
      )
      .join('\n')
  const keyframeRows = design.motion.keyframes
    .map(
      (keyframe: any) =>
        `| \`${markdownEscape(keyframe.name)}\` | \`${markdownEscape(keyframe.file)}\` | ${keyframe.steps.join(', ')} |`,
    )
    .join('\n')
  const queryRows = (queries: any[]): string =>
    queries
      .map(
        (query) =>
          `| \`${markdownEscape(query.params)}\` | ${query.count} | ${query.files.map((file: string) => `\`${markdownEscape(file)}\``).join(', ')} |`,
      )
      .join('\n')
  const platformRows = [
    ...behavior.platform.windowTypes.map((item: any) => ['window-type', item]),
    ...behavior.platform.operatingSystems.map((item: any) => ['os', item]),
    ...behavior.platform.themeSelectors.map((item: any) => ['theme', item]),
    ...behavior.platform.windowChrome.map((item: any) => ['window-chrome', item]),
  ]
    .map(
      ([kind, item]: any) =>
        `| ${kind} | \`${item.value}\` | ${item.count} | ${item.files.map((file: string) => `\`${markdownEscape(file)}\``).join(', ')} |`,
    )
    .join('\n')
  const staticCssRows = inventory.runtimeStyles.staticCss
    .map(
      (stylesheet: any) =>
        `| \`${markdownEscape(stylesheet.sourceFile)}\` | \`${stylesheet.binding ?? 'direct-literal'}\` | ${stylesheet.rawChars} | ${stylesheet.recoverability} | ${stylesheet.sinkKinds.join(', ')}${stylesheet.wrapper ? ` / wrapper: ${stylesheet.wrapper}` : ''} |`,
    )
    .join('\n')
  const logicalThemeRows = inventory.highlightThemes.logicalThemes
    .map(
      (theme: any) =>
        `| \`${theme.slug}\` | ${theme.type ?? 'unknown'} | ${theme.physicalFiles.length} | ${theme.colorCount} | ${theme.tokenColorCount} | ${theme.recoverability} |`,
    )
    .join('\n')
  const mappingRows = inventory.mappings
    .map(
      (mapping: any) =>
        `| ${mapping.area} | ${mapping.status} | \`${mapping.target}\` | ${mapping.recommendation} |`,
    )
    .join('\n')
  const parseErrors = inventory.parseWarnings

  return `# Codex Webview 全量样式清单

> 本文由 \`InventoryCodexStyles.ts\` 从构建产物确定性生成。扫描源保持只读，报告不记录本机绝对路径。构建产物没有 source map；定位统一使用文件名、selector/binding 与 byte offset。

## 快照、范围与完整性

- 快照指纹：\`${inventory.snapshot.fingerprint}\`
- 资源：${summary.assetFiles} 个 assets，外加 ${summary.htmlFiles} 个相邻 HTML。
- 声明源：CSS ${summary.cssFiles}、HTML style block ${summary.htmlStyleBlocks}、HTML style attribute ${summary.htmlStyleAttributes}、脚本 ${summary.scriptFiles}（JS ${summary.jsFiles}、MJS ${summary.mjsFiles}）。
- 外部 CSS：${summary.cssBytes} bytes、${summary.cssRules} 条规则、${summary.cssDeclarations} 条普通规则声明；另有 ${summary.cssAtRuleDeclarations} 条 at-rule 直属声明，总计 ${summary.cssTotalDeclarations}。
- HTML 内联：${summary.htmlRules} 条规则、${summary.htmlDeclarations} 条声明。
- JS 静态 CSS：${summary.staticJsStylesheets} 个 payload、${summary.staticJsCssChars} 字符；动态生成器和变量写入单独登记。
- CSS 能力：${summary.customProperties} 个基线自定义属性、${summary.keyframes} 个外部 CSS keyframes、${summary.mediaQueries} 个媒体查询、${summary.containerQueries} 个容器查询、${summary.fontFaces} 个字体面。
- 解析：外部 CSS PostCSS ${summary.postcssParsed}/${summary.cssFiles}、LightningCSS ${summary.lightningcssParsed}/${summary.cssFiles}。
- 高亮主题：${summary.physicalThemeFiles} 个物理模块、${summary.logicalThemes} 个逻辑主题；使用 Shiki 与 CodeMirror，未发现 Monaco。
- 完整 selector、specificity、声明、变量 fallback、at-rule、URL、HTML/JS owner 和 offset 位于配套 JSON。

“全部样式”包括可静态恢复的 CSS/HTML/JS 定义和无法静态求值的运行时样式边界。Lucide 几何、TextMate grammar、locale 与单纯 class 消费点不重复计为样式定义。

## CSS 文件与职责

| 文件 | bytes | rules | rule declarations | at-rule declarations | keyframes | media | container | 职责 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${cssRows}

主 CSS 的层顺序为 properties/theme/base/components/utilities。第三方边界包括 KaTeX、ProseMirror、xterm、Recharts、Mapbox GL、PDF.js、Highlight.js 和 Carlito。

## HTML 内联样式

| 来源 | 类型 | chars | rules | declarations | keyframes | 职责 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
${htmlRows}

相邻 HTML 的链接、脚本和内联 CSS 均进入快照指纹与审计；入口依赖图和样式定义统计保持分口径。
入口可达 assets ${summary.entryReachableAssets} 个；未能从静态 HTML/JS 引用图恢复的 ${summary.entryUnreachableAssets} 个资源仍逐文件完成分类审计。完整入口 roots 位于 JSON 的 \`snapshot.loadGraph\`。

## 设计系统总览

### 令牌分层

| 令牌组 | 唯一名称数 |
| --- | ---: |
${tokenGroupRows}

- 应用颜色原语：${design.colors.primitiveTokens.length}。
- Tailwind 调色板 token：${design.colors.tailwindPaletteTokens.length}。
- 产品 \`--color-token-*\`：${design.colors.productTokens.length}。
- 广义语义颜色：${design.colors.semanticTokens.length}。
- VS Code 兼容 token：${design.colors.vscodeTokens.length}。
- 组件与状态颜色：${design.colors.componentTokens.length}。
- Tailwind \`--tw-*\` 是内部运行变量，只登记，不建议迁移。
- 间距以 \`--spacing: .25rem\`（4px）为基准；完整 light/dark、window type 和 selector 级覆盖位于 JSON 的 \`designSystem.tokens.definitions\`。

### 颜色格式与主题

| 格式 | 出现次数 |
| --- | ---: |
${colorFormatRows}

Electron light/dark、浏览器窗口、扩展窗口和 VS Code 兼容层通过 selector/context 保留全部覆盖值，不做错误的 latest-wins 合并。

### 字体与排版

| family | style | weight | faces | 来源 |
| --- | --- | --- | ---: | --- |
${fontRows}

系统 sans、编辑器 mono、OpenAI Sans、KaTeX 和 Carlito 均保留；完整 font-face src、unicode-range、字号、行高和字重位于 JSON。

高频排版值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
${valueRows(design.typography.properties)}

### 间距、圆角与阴影

高频间距值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
${valueRows(design.spacing.properties)}

高频圆角值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
${valueRows(design.radii.properties)}

高频阴影值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
${valueRows(design.shadows.properties)}

### 动效

| keyframes | 来源 | steps |
| --- | --- | --- |
${keyframeRows}

高频 animation/transition 值：

| 属性 | 值 | 次数 |
| --- | --- | ---: |
${valueRows(design.motion.properties)}

## 响应式、平台与无障碍样式证据

| 类型 | 值 | 次数 | 来源 |
| --- | --- | ---: | --- |
${platformRows}

- focus-visible 规则：${behavior.accessibility.focusVisibleRules}
- ARIA selector 规则：${behavior.accessibility.ariaSelectorRules}
- sr-only 规则：${behavior.accessibility.srOnlyRules}
- \`data-reduced-motion=true\` 规则：${behavior.accessibility.reducedMotionDataRules}
- \`forced-color-adjust\` 声明：${behavior.accessibility.forcedColorAdjustDeclarations}
- reduced-motion 查询：${behavior.accessibility.reducedMotion.reduce((total: number, item: any) => total + item.count, 0)}
- reduced-transparency 查询：${behavior.accessibility.reducedTransparency.reduce((total: number, item: any) => total + item.count, 0)}
- forced-colors 查询：${behavior.accessibility.forcedColors.reduce((total: number, item: any) => total + item.count, 0)}
- high-contrast 查询：${behavior.accessibility.highContrast.reduce((total: number, item: any) => total + item.count, 0)}

<details>
<summary>全部媒体查询</summary>

| 参数 | 次数 | 来源 |
| --- | ---: | --- |
${queryRows(behavior.queries.media)}

</details>

<details>
<summary>全部容器查询</summary>

| 参数 | 次数 | 来源 |
| --- | ---: | --- |
${queryRows(behavior.queries.container)}

</details>

<details>
<summary>全部 supports 查询</summary>

| 参数 | 次数 | 来源 |
| --- | ---: | --- |
${queryRows(behavior.queries.supports)}

</details>

## JS/MJS 运行时样式

### 可静态恢复的 CSS payload

| 脚本 | binding | chars | 恢复度 | sink |
| --- | --- | ---: | --- | --- |
${staticCssRows || '| — | — | 0 | — | — |'}

其中 \`exact\` 可直接双解析；\`partial-template\` 会保留 unresolved interpolation 占位符，不能声称等同最终运行时 CSS。Shadow DOM、\`insertRule\`、Mermaid/Cytoscape、PDF 动态字体和 Motion 注入证据位于 JSON 的 \`runtimeStyles\`。

className 消费点 ${inventory.runtimeStyles.styleUsage.classNameOccurrences} 次，inline style 消费点 ${inventory.runtimeStyles.styleUsage.inlineStyleOccurrences} 次；它们只用于定位组件消费关系，不重复成为 CSS 声明。

### 脚本分类

| 分类 | 文件数 |
| --- | ---: |
${jsCategoryRows}

## Shiki / VS Code 高亮主题

| 主题 slug | 类型 | 物理副本 | colors | tokenColors/settings | 恢复方式 |
| --- | --- | ---: | ---: | ---: | --- |
${logicalThemeRows || '| — | — | 0 | 0 | 0 | — |'}

逻辑主题按稳定 slug 合并，结构化可恢复内容另以规范化哈希校验；每个物理模块仍保留来源文件。

## Pidex 逐域映射

| Codex 样式域 | 状态 | Pidex 落点 | 策略 |
| --- | --- | --- | --- |
${mappingRows}

Pidex 继续使用 \`theme → vendor → reset → tokens → primitives → shell → features → utilities → overrides\` 九层结构。CSS Modules 哈希类只作为构建证据，不直接复制为公共接口。

## 限制与解析告警

- 构建产物没有 source map，不能还原原始组件文件和源码行号。
- 压缩变量可能复用；JS 静态 CSS 只接受与明确 style sink 联通的最近字面量。
- 动态表达式、运行时主题输入和第三方生成器只记录可证明的边界，不伪造最终 CSS。

${parseErrors.length > 0 ? parseErrors.map((error: string) => `- ${error}`).join('\n') : '- 无解析告警；外部 CSS、HTML 内联和 exact JS CSS 均通过对应解析。'}
`
}

async function scan(options: CliOptions): Promise<{
  inventory: any
  jsonText: string
  markdownText: string
  parseErrorCount: number
}> {
  const assetsRoot = resolve(options.assetsRoot)
  if (!(await stat(assetsRoot)).isDirectory()) {
    throw new Error(`assets root is not a directory: ${assetsRoot}`)
  }

  const allFiles = await listFiles(assetsRoot)
  const relativeFiles = allFiles.map((path) => normalizePath(relative(assetsRoot, path)))
  const fileSet = new Set(relativeFiles)
  const cssPaths = allFiles.filter((path) => extname(path).toLowerCase() === '.css')
  const jsPaths = allFiles.filter((path) => ['.js', '.mjs'].includes(extname(path).toLowerCase()))
  const fileHashes = new Map<string, string>()
  const cssFiles: any[] = []
  const cssUrlOccurrences: Array<UrlOccurrence & { sourceFile: string; resolutionBase: string }> =
    []
  const parseErrors: string[] = []
  const observedCustomProperties = new Set<string>()

  for (const cssPath of cssPaths) {
    const path = normalizePath(relative(assetsRoot, cssPath))
    const { source, bytes, hash } = await readUtf8(cssPath)
    for (const match of source.matchAll(/--[\w-]+/g)) observedCustomProperties.add(match[0])
    fileHashes.set(path, hash)
    const analysis = analyzeStyleSource({
      source,
      sourceFile: path,
      resolutionBase: '.',
    })
    parseErrors.push(
      ...analysis.parse.postcss.errors.map((error: string) => `${path} / PostCSS: ${error}`),
      ...analysis.parse.lightningcss.errors.map(
        (error: string) => `${path} / LightningCSS: ${error}`,
      ),
    )
    cssUrlOccurrences.push(...analysis.urlOccurrences)
    const classification = classifyCss(
      path,
      source,
      analysis.counts.rules,
      analysis.counts.fontFaces,
    )
    cssFiles.push({
      path,
      bytes: bytes.byteLength,
      sha256: hash,
      category: classification.category,
      tags: classification.tags,
      status: classification.status,
      parse: analysis.parse,
      counts: analysis.counts,
      customProperties: analysis.customProperties,
      rules: analysis.rules,
      atRules: analysis.atRules,
      keyframes: analysis.keyframes,
      fontFaces: analysis.fontFaces,
      properties: analysis.properties,
      loadedBy: [] as string[],
      entryReachable: false,
    })
  }

  const jsFiles: any[] = []
  const jsImports = new Map<string, string[]>()
  const themeInstances: Array<ExtractedTheme & { sourceFile: string }> = []
  for (const jsPath of jsPaths) {
    const path = normalizePath(relative(assetsRoot, jsPath))
    const { source, bytes, hash } = await readUtf8(jsPath)
    fileHashes.set(path, hash)
    const imports = extractJsReferences(source)
    jsImports.set(path, imports)
    const evidence = collectStyleEvidence(source)
    const customPropertyWrites = extractCustomPropertyWrites(source)
    const themes = extractThemes(source, path)
    const staticStylesheets = extractJsStylesheets(source).map((stylesheet) => {
      for (const match of stylesheet.source.matchAll(/--[\w-]+/g)) {
        observedCustomProperties.add(match[0])
      }
      const analysis = analyzeStyleSource({
        source: stylesheet.source,
        sourceFile: `${path}#static-css@${stylesheet.literalOffset}`,
        offsetBase: stylesheet.literalOffset,
        resolutionBase: '.',
        requireLightning: stylesheet.recoverability === 'exact',
      })
      const fatalErrors = [
        ...analysis.parse.postcss.errors,
        ...(stylesheet.recoverability === 'exact' ? analysis.parse.lightningcss.errors : []),
      ]
      parseErrors.push(
        ...fatalErrors.map(
          (error: string) => `${path} / static CSS @ ${stylesheet.literalOffset}: ${error}`,
        ),
      )
      cssUrlOccurrences.push(...analysis.urlOccurrences)
      const { source: _source, ...metadata } = stylesheet
      return { ...metadata, analysis }
    })
    const classification = classifyJs(path, source, themes, evidence)
    themeInstances.push(...themes.map((theme) => ({ ...theme, sourceFile: path })))
    jsFiles.push({
      path,
      bytes: bytes.byteLength,
      sha256: hash,
      category: classification.category,
      tags: classification.tags,
      status: classification.status,
      reason: classification.reason,
      imports,
      cssImports: imports.filter((reference) => reference.endsWith('.css')),
      runtimeStyleEvidence: evidence,
      customPropertyWrites,
      styleUsage: {
        classNameOccurrences: [...source.matchAll(/\bclassName\b/g)].length,
        inlineStyleOccurrences: [...source.matchAll(/\bstyle\s*:/g)].length,
      },
      staticStylesheets,
      themes,
      entryReachable: false,
    })
  }

  for (const path of allFiles) {
    const relativePath = normalizePath(relative(assetsRoot, path))
    if (fileHashes.has(relativePath)) continue
    fileHashes.set(relativePath, sha256(await readFile(path)))
  }

  const htmlPaths = (await readdir(dirname(assetsRoot), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.html')
    .map((entry) => join(dirname(assetsRoot), entry.name))
    .sort(compareText)
  const htmlEntries: Array<{ path: string; assets: string[] }> = []
  const htmlFiles: any[] = []
  const htmlHashes = new Map<string, string>()
  const entryRoots = new Set<string>()
  for (const htmlPath of htmlPaths) {
    const { source, bytes, hash } = await readUtf8(htmlPath)
    const htmlName = basename(htmlPath)
    htmlHashes.set(htmlName, hash)
    const assets = uniqueSorted(
      [
        ...source.matchAll(
          /(?:src|href)\s*=\s*["'](?:\.\/|\/)?assets\/([^"'?#]+)(?:[?#][^"']*)?["']/g,
        ),
      ]
        .map((match) => match[1])
        .filter((path) => fileSet.has(path)),
    )
    for (const asset of assets) entryRoots.add(asset)
    htmlEntries.push({ path: htmlName, assets })

    const styleBlocks: any[] = []
    for (const [block, match] of [
      ...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi),
    ].entries()) {
      const cssSource = match[1]
      const contentOffset = match.index + match[0].indexOf(cssSource)
      const sourceFile = `../${htmlName}#style[${block}]`
      const analysis = analyzeStyleSource({
        source: cssSource,
        sourceFile,
        offsetBase: contentOffset,
        resolutionBase: '..',
      })
      parseErrors.push(
        ...analysis.parse.postcss.errors.map(
          (error: string) => `${sourceFile} / PostCSS: ${error}`,
        ),
        ...analysis.parse.lightningcss.errors.map(
          (error: string) => `${sourceFile} / LightningCSS: ${error}`,
        ),
      )
      cssUrlOccurrences.push(...analysis.urlOccurrences)
      for (const property of analysis.customProperties.definitions) {
        observedCustomProperties.add(property)
      }
      styleBlocks.push({
        block,
        offset: contentOffset,
        chars: cssSource.length,
        sha256: sha256(cssSource),
        analysis,
      })
    }

    const styleAttributes: any[] = []
    for (const [attribute, match] of [
      ...source.matchAll(/\sstyle\s*=\s*(["'])(.*?)\1/gis),
    ].entries()) {
      const cssSource = match[2]
      const contentOffset = match.index + match[0].indexOf(cssSource)
      const wrapperPrefix = ':where([data-codex-inline-style]){'
      const wrapped = `${wrapperPrefix}${cssSource}}`
      const sourceFile = `../${htmlName}#style-attribute[${attribute}]`
      const analysis = analyzeStyleSource({
        source: wrapped,
        sourceFile,
        offsetBase: contentOffset - wrapperPrefix.length,
        resolutionBase: '..',
      })
      parseErrors.push(
        ...analysis.parse.postcss.errors.map(
          (error: string) => `${sourceFile} / PostCSS: ${error}`,
        ),
        ...analysis.parse.lightningcss.errors.map(
          (error: string) => `${sourceFile} / LightningCSS: ${error}`,
        ),
      )
      const declarations = analysis.rules[0]?.declarations ?? []
      styleAttributes.push({
        attribute,
        offset: contentOffset,
        chars: cssSource.length,
        sha256: sha256(cssSource),
        declarations,
        parse: analysis.parse,
        counts: { declarations: declarations.length },
      })
    }
    htmlFiles.push({
      path: htmlName,
      bytes: bytes.byteLength,
      sha256: hash,
      assets,
      styleBlocks,
      styleAttributes,
    })
  }

  const reachable = new Set<string>()
  const queue = [...entryRoots].sort(compareText)
  while (queue.length > 0) {
    const current = queue.shift()!
    if (reachable.has(current)) continue
    reachable.add(current)
    for (const dependency of jsImports.get(current) ?? []) {
      if (fileSet.has(dependency) && !reachable.has(dependency)) queue.push(dependency)
    }
    queue.sort(compareText)
  }

  const cssImporters = new Map<string, string[]>()
  for (const [importer, imports] of jsImports) {
    for (const imported of imports.filter((path) => path.endsWith('.css'))) {
      const values = cssImporters.get(imported) ?? []
      values.push(importer)
      cssImporters.set(imported, values)
    }
  }
  for (const file of cssFiles) {
    file.loadedBy = uniqueSorted([
      ...(cssImporters.get(file.path) ?? []),
      ...htmlEntries.filter((entry) => entry.assets.includes(file.path)).map((entry) => entry.path),
    ])
    file.entryReachable = reachable.has(file.path)
  }
  for (const file of jsFiles) file.entryReachable = reachable.has(file.path)

  const assetReferences: any[] = []
  for (const occurrence of cssUrlOccurrences.sort(
    (left, right) =>
      compareText(left.sourceFile, right.sourceFile) ||
      left.offset - right.offset ||
      compareText(left.value, right.value),
  )) {
    const kind = classifyAssetReference(occurrence.value)
    let target: string | null = null
    let exists: boolean | null = null
    let targetHash: string | null = null
    if (kind === 'file') {
      const cleanValue = occurrence.value.split(/[?#]/, 1)[0].replaceAll('\\', '/')
      const normalizedTarget = normalizePath(
        relative(assetsRoot, resolve(assetsRoot, occurrence.resolutionBase, cleanValue)),
      )
      target = normalizedTarget
      const targetPath = resolve(assetsRoot, normalizedTarget)
      exists =
        !normalizedTarget.startsWith('../') &&
        normalizedTarget !== '..' &&
        (await fileExists(targetPath))
      targetHash = exists
        ? (fileHashes.get(normalizedTarget) ?? sha256(await readFile(targetPath)))
        : null
    }
    assetReferences.push({
      sourceFile: occurrence.sourceFile,
      resolutionBase: occurrence.resolutionBase,
      property: occurrence.property,
      offset: occurrence.offset,
      value: occurrence.value,
      kind,
      target,
      exists,
      sha256: targetHash,
      status: 'document-only' as InventoryStatus,
    })
  }

  const logicalThemeMap = new Map<string, any>()
  for (const theme of themeInstances) {
    const logicalKey = theme.slug
    const current = logicalThemeMap.get(logicalKey) ?? {
      slug: theme.slug,
      name: theme.name,
      ...(theme.displayName ? { displayName: theme.displayName } : {}),
      ...(theme.type ? { type: theme.type } : {}),
      normalizedHash: theme.normalizedHash,
      colorCount: theme.colorCount,
      tokenColorCount: theme.tokenColorCount,
      recoverability: theme.recoverability,
      physicalFiles: [] as string[],
      status: 'document-only' as InventoryStatus,
    }
    current.physicalFiles.push(theme.sourceFile)
    if (current.recoverability !== 'structured' && theme.recoverability === 'structured') {
      current.name = theme.name
      current.displayName = theme.displayName
      current.type = theme.type
      current.normalizedHash = theme.normalizedHash
      current.colorCount = theme.colorCount
      current.tokenColorCount = theme.tokenColorCount
      current.recoverability = theme.recoverability
    }
    logicalThemeMap.set(logicalKey, current)
  }
  const logicalThemes = [...logicalThemeMap.values()]
    .map((theme) => ({ ...theme, physicalFiles: uniqueSorted(theme.physicalFiles) }))
    .sort(
      (left, right) =>
        compareText(left.slug, right.slug) ||
        compareText(left.normalizedHash, right.normalizedHash),
    )

  const jsCategories: Record<string, number> = {}
  for (const file of jsFiles) increment(jsCategories, file.category)
  const cssCategories: Record<string, number> = {}
  for (const file of cssFiles) increment(cssCategories, file.category)
  const definedCustomProperties = new Set<string>(
    cssFiles.flatMap((file) => file.customProperties.definitions),
  )
  const baselineCustomProperties = [...definedCustomProperties].filter((property) =>
    /^--[\w-]+$/.test(property),
  )
  const tailwindCustomProperties = baselineCustomProperties.filter((property) =>
    property.startsWith('--tw-'),
  )
  const styleSources = [
    ...cssFiles.map((file) => ({
      kind: 'css-file',
      sourceFile: file.path,
      analysis: {
        rules: file.rules,
        atRules: file.atRules,
        keyframes: file.keyframes,
        fontFaces: file.fontFaces,
        customProperties: file.customProperties,
      },
    })),
    ...htmlFiles.flatMap((file) =>
      file.styleBlocks.map((block: any) => ({
        kind: 'html-style',
        sourceFile: `../${file.path}#style[${block.block}]`,
        analysis: block.analysis,
      })),
    ),
    ...jsFiles.flatMap((file) =>
      file.staticStylesheets.map((stylesheet: any) => ({
        kind: 'js-static-css',
        sourceFile: `${file.path}#static-css@${stylesheet.literalOffset}`,
        analysis: stylesheet.analysis,
      })),
    ),
  ]
  const designSystem = buildDesignSystem(styleSources)
  const behavior = buildBehavior(styleSources)
  const runtimeStyles = {
    staticCss: jsFiles.flatMap((file) =>
      file.staticStylesheets.map((stylesheet: any) => ({
        sourceFile: file.path,
        binding: stylesheet.binding,
        literalOffset: stylesheet.literalOffset,
        rawChars: stylesheet.rawChars,
        sinkKinds: stylesheet.sinkKinds,
        sinkOffsets: stylesheet.sinkOffsets,
        ...(stylesheet.wrapper ? { wrapper: stylesheet.wrapper } : {}),
        recoverability: stylesheet.recoverability,
        interpolations: stylesheet.interpolations,
        rawHash: stylesheet.rawHash,
      })),
    ),
    customPropertyWrites: jsFiles.flatMap((file) =>
      file.customPropertyWrites.map((write: any) => ({
        sourceFile: file.path,
        ...write,
      })),
    ),
    generators: jsFiles.flatMap((file) =>
      file.runtimeStyleEvidence
        .filter((evidence: any) =>
          [
            'insert-rule',
            'dynamic-font-face',
            'style-element',
            'constructable-stylesheet',
          ].includes(evidence.kind),
        )
        .map((evidence: any) => ({ sourceFile: file.path, ...evidence })),
    ),
    shadowDom: jsFiles.flatMap((file) =>
      file.runtimeStyleEvidence
        .filter((evidence: any) => ['shadow-root', 'adopted-stylesheets'].includes(evidence.kind))
        .map((evidence: any) => ({ sourceFile: file.path, ...evidence })),
    ),
    styleUsage: {
      classNameOccurrences: jsFiles.reduce(
        (total, file) => total + file.styleUsage.classNameOccurrences,
        0,
      ),
      inlineStyleOccurrences: jsFiles.reduce(
        (total, file) => total + file.styleUsage.inlineStyleOccurrences,
        0,
      ),
    },
  }

  const fingerprintInput = relativeFiles
    .map((path) => `${path}\0${fileHashes.get(path)}`)
    .concat(
      [...htmlHashes.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([path, hash]) => `../${path}\0${hash}`),
    )
    .join('\n')
  const summary = {
    assetFiles: relativeFiles.length,
    cssFiles: cssFiles.length,
    htmlFiles: htmlFiles.length,
    htmlStyleBlocks: htmlFiles.reduce((total, file) => total + file.styleBlocks.length, 0),
    htmlStyleAttributes: htmlFiles.reduce((total, file) => total + file.styleAttributes.length, 0),
    scriptFiles: jsFiles.length,
    jsFiles: jsFiles.filter((file) => file.path.endsWith('.js')).length,
    mjsFiles: jsFiles.filter((file) => file.path.endsWith('.mjs')).length,
    cssBytes: cssFiles.reduce((total, file) => total + file.bytes, 0),
    cssRules: cssFiles.reduce((total, file) => total + file.counts.rules, 0),
    cssDeclarations: cssFiles.reduce((total, file) => total + file.counts.declarations, 0),
    cssAtRuleDeclarations: cssFiles.reduce(
      (total, file) => total + file.counts.atRuleDeclarations,
      0,
    ),
    cssTotalDeclarations: cssFiles.reduce(
      (total, file) => total + file.counts.totalDeclarations,
      0,
    ),
    htmlRules: htmlFiles.reduce(
      (total, file) =>
        total +
        file.styleBlocks.reduce(
          (blockTotal: number, block: any) => blockTotal + block.analysis.counts.rules,
          0,
        ),
      0,
    ),
    htmlDeclarations: htmlFiles.reduce(
      (total, file) =>
        total +
        file.styleBlocks.reduce(
          (blockTotal: number, block: any) => blockTotal + block.analysis.counts.declarations,
          0,
        ) +
        file.styleAttributes.reduce(
          (attributeTotal: number, attribute: any) =>
            attributeTotal + attribute.counts.declarations,
          0,
        ),
      0,
    ),
    staticJsStylesheets: runtimeStyles.staticCss.length,
    staticJsCssChars: runtimeStyles.staticCss.reduce(
      (total, stylesheet) => total + stylesheet.rawChars,
      0,
    ),
    selectorItems: cssFiles.reduce((total, file) => total + file.counts.selectorItems, 0),
    parsedTopLevelSelectors: cssFiles.reduce(
      (total, file) => total + file.counts.parsedTopLevelSelectors,
      0,
    ),
    customProperties: baselineCustomProperties.length,
    tailwindCustomProperties: tailwindCustomProperties.length,
    allDefinedCustomProperties: definedCustomProperties.size,
    allObservedCustomProperties: observedCustomProperties.size,
    keyframes: cssFiles.reduce((total, file) => total + file.counts.keyframes, 0),
    mediaQueries: cssFiles.reduce((total, file) => total + file.counts.mediaQueries, 0),
    containerQueries: cssFiles.reduce((total, file) => total + file.counts.containerQueries, 0),
    fontFaces: cssFiles.reduce((total, file) => total + file.counts.fontFaces, 0),
    postcssParsed: cssFiles.filter((file) => file.parse.postcss.ok).length,
    lightningcssParsed: cssFiles.filter((file) => file.parse.lightningcss.ok).length,
    cssCategories,
    jsCategories,
    physicalThemeFiles: new Set(themeInstances.map((theme) => theme.sourceFile)).size,
    logicalThemes: logicalThemes.length,
    fileAssetReferences: assetReferences.filter((reference) => reference.kind === 'file').length,
    missingAssetReferences: assetReferences.filter(
      (reference) => reference.kind === 'file' && reference.exists === false,
    ).length,
    dataAssetReferences: assetReferences.filter((reference) => reference.kind === 'data').length,
    fragmentAssetReferences: assetReferences.filter((reference) => reference.kind === 'fragment')
      .length,
    remoteAssetReferences: assetReferences.filter((reference) => reference.kind === 'remote')
      .length,
    entryReachableAssets: reachable.size,
    entryUnreachableAssets: relativeFiles.length - reachable.size,
  }

  const exclusions = Object.entries(jsCategories)
    .filter(([category]) =>
      ['icon-noise', 'grammar-noise', 'locale', 'unrelated'].includes(category),
    )
    .sort(([left], [right]) => compareText(left, right))
    .map(([category, count]) => ({
      category,
      count,
      files: jsFiles
        .filter((file) => file.category === category)
        .map((file) => file.path)
        .sort(compareText),
      status: 'exclude' as InventoryStatus,
    }))

  const mappings = [
    {
      area: 'properties/theme 与设计令牌',
      status: 'map' as InventoryStatus,
      target: 'src/styles/design-system/tokens.css',
      recommendation:
        '映射到 Pidex 的 theme/tokens 层；保留颜色、surface、字体、间距、圆角、阴影、层级与动效语义，--tw-* 仅登记。',
    },
    {
      area: 'base/reset',
      status: 'adapt' as InventoryStatus,
      target: 'src/styles/base.css',
      recommendation:
        '把 Codex base 层的元素默认值适配到现有 reset/base，不复制构建后的全局选择器。',
    },
    {
      area: 'runtime theme',
      status: 'map' as InventoryStatus,
      target: 'src/features/theme/ThemeVariables.ts',
      recommendation: '对照 Electron 明暗类和根节点 setProperty 证据，动态值不固化为 SCSS 默认值。',
    },
    {
      area: 'UI primitives',
      status: 'adapt' as InventoryStatus,
      target: 'src/styles/components',
      recommendation:
        '复用既有 button、input、chip、switch、menu、scroll-area；不迁移 CSS Modules 哈希类名。',
    },
    {
      area: 'shell/layout',
      status: 'adapt' as InventoryStatus,
      target: 'src/features/layout/shell/*.tsx and src/styles/primitives/chrome.css',
      recommendation:
        '窗口、侧栏、工作台、面板映射现有 shell/layout 层，并保留 Windows/Electron 边界。',
    },
    {
      area: 'session/composer/settings/search/review',
      status: 'adapt' as InventoryStatus,
      target: 'src/styles/features',
      recommendation: '按现有 feature partial 分域适配，不把 CSS Modules 哈希类作为公共接口。',
    },
    {
      area: 'vendor styles',
      status: 'vendor' as InventoryStatus,
      target: 'src/styles/lazy/*.scss (vendor entrypoints)',
      recommendation:
        'KaTeX、ProseMirror、xterm、Recharts、Mapbox、PDF.js 等外部 DOM 规则留在 vendor 边界。',
    },
    {
      area: 'platform/vendor overrides',
      status: 'adapt' as InventoryStatus,
      target: 'src/styles/tailwind.css overrides layer',
      recommendation:
        '只有平台差异和无法在 vendor 源层处理的第三方修正进入 overrides，保持现有九层级联顺序。',
    },
  ]

  const inventory = {
    schemaVersion: 2,
    snapshot: {
      scannerVersion: SCRIPT_VERSION,
      source: {
        kind: 'external-codex-webview-assets',
        directoryName: basename(assetsRoot),
      },
      fingerprint: sha256(fingerprintInput),
      fileCount: relativeFiles.length,
      htmlFileCount: htmlFiles.length,
      loadGraph: {
        htmlEntries,
        entryRoots: [...entryRoots].sort(compareText),
      },
    },
    summary,
    cssFiles: cssFiles.sort((left, right) => compareText(left.path, right.path)),
    htmlFiles: htmlFiles.sort((left, right) => compareText(left.path, right.path)),
    scriptFiles: jsFiles.sort((left, right) => compareText(left.path, right.path)),
    designSystem,
    behavior,
    runtimeStyles,
    highlightThemes: {
      physicalFiles: uniqueSorted(themeInstances.map((theme) => theme.sourceFile)),
      logicalThemes,
    },
    logicalThemes,
    assetReferences,
    mappings,
    exclusions,
    parseWarnings: parseErrors,
  }
  const jsonText = `${JSON.stringify(inventory, null, 2)}\n`
  const markdownText = renderMarkdown(inventory)
  return { inventory, jsonText, markdownText, parseErrorCount: parseErrors.length }
}

async function checkOutput(path: string, expected: string): Promise<string | null> {
  try {
    const current = utf8Decoder.decode(await readFile(path))
    return current === expected ? null : `${path} is stale`
  } catch (error) {
    return `${path} cannot be checked: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2))
  if (!options) return

  console.log('[codex-style-inventory] scanning source assets (read-only)')
  const result = await scan(options)
  if ((options.failOnParseError || options.check) && result.parseErrorCount > 0) {
    throw new Error(`${result.parseErrorCount} CSS parser error(s) detected`)
  }

  if (options.check) {
    const errors = (
      await Promise.all([
        checkOutput(options.jsonPath, result.jsonText),
        checkOutput(options.markdownPath, result.markdownText),
      ])
    ).filter((error): error is string => error !== null)
    if (errors.length > 0) {
      for (const error of errors) console.error(`[codex-style-inventory] ${error}`)
      process.exitCode = 1
      return
    }
    console.log('[codex-style-inventory] outputs are current')
  } else {
    await mkdir(dirname(options.jsonPath), { recursive: true })
    await mkdir(dirname(options.markdownPath), { recursive: true })
    await writeFile(options.jsonPath, result.jsonText, 'utf8')
    await writeFile(options.markdownPath, result.markdownText, 'utf8')
    console.log(
      `[codex-style-inventory] wrote ${normalizePath(relative(repositoryRoot, options.jsonPath))}`,
    )
    console.log(
      `[codex-style-inventory] wrote ${normalizePath(relative(repositoryRoot, options.markdownPath))}`,
    )
  }

  const summary = result.inventory.summary
  console.log(
    `[codex-style-inventory] ${summary.cssFiles} CSS / ${summary.htmlFiles} HTML / ${summary.cssRules} rules / ${summary.cssDeclarations} declarations / ${summary.scriptFiles} scripts / ${summary.logicalThemes} logical themes`,
  )
}

await main().catch((error) => {
  console.error(
    `[codex-style-inventory] failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
