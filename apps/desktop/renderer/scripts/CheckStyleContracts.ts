import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import ts from 'typescript'
import { selectorBlock, transitionProperties } from './StyleAnimationContracts.js'

type FeatureTokenException = {
  file: string
  property: string
  value?: string
  localProperty?: string
  reason: string
}

type FeatureTokenContract = {
  roots: string[]
  scriptRoots: string[]
  componentGeometryExceptions: FeatureTokenException[]
  inlineStyleExceptions: FeatureTokenException[]
  tailwindArbitraryExceptions: FeatureTokenException[]
  tailwindTypographyExceptions: FeatureTokenException[]
  literalTypographyExceptions: FeatureTokenException[]
  literalRadiusExceptions: FeatureTokenException[]
  literalMotionExceptions: FeatureTokenException[]
  literalShadowExceptions: FeatureTokenException[]
  literalZIndexExceptions: FeatureTokenException[]
  literalSpacingExceptions: FeatureTokenException[]
}

type FeatureTokenCategory =
  | 'componentGeometry'
  | 'inlineStyle'
  | 'tailwindArbitrary'
  | 'tailwindTypography'
  | 'literalTypography'
  | 'literalRadius'
  | 'literalMotion'
  | 'literalShadow'
  | 'literalZIndex'
  | 'literalSpacing'

type FeatureTokenRegistryEntry = {
  reason: string
  used: boolean
}

type StyleContractManifest = {
  styleEntrypoint: string
  styleEntrypointImporter: string
  /**
   * SCSS entrypoints that are still loaded directly while surfaces migrate to
   * the Tailwind entrypoint. Their graph joins the single-entry graph and they
   * may declare the shared cascade order. Drop an entry once it stops importing
   * SCSS.
   */
  legacyScssEntrypoints?: string[]
  cascadeLayerOrder: string[]
  directStyleImportAllowlist: string[]
  lazyStyleEntrypoints: Record<string, 'vendor' | 'features'>
  customPropertyReferenceAllowlist: string[]
  forbiddenCustomPropertyPatterns: string[]
  importantDeclarationAllowlist: Record<string, number>
  dataThemeSelectorAllowlist: Record<string, number>
  literalLineHeightAllowlist: Record<string, number>
  tailwindLeadingAllowlist: Record<string, number>
  featureColorContract: {
    roots: string[]
    componentTokenExceptions: Array<{ file: string; token: string; reason: string }>
    literalColorExceptions: Array<{ file: string; value: string; reason: string }>
    colorMixExceptions: Array<{ file: string; localProperty: string; reason: string }>
  }
  featureTokenContract: FeatureTokenContract
  interactionContract: {
    interactiveRowAllowedFiles: string[]
  }
}

const workspaceRoot = resolve(import.meta.dir, '..')
const sourceRoot = join(workspaceRoot, 'src')
const manifestPath = join(workspaceRoot, 'style-contracts.json')
const styleExtensions = new Set(['.css', '.scss'])
const scriptExtensions = new Set(['.ts', '.tsx'])

function workspacePath(path: string): string {
  return relative(workspaceRoot, path).replaceAll('\\', '/')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path])
    }),
  )
  return files.flat()
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function resolveStyleReference(fromFile: string, reference: string): Promise<string | null> {
  const base = resolve(dirname(fromFile), reference)
  const extension = extname(base)
  const candidates = extension
    ? [base]
    : [
        `${base}.scss`,
        `${base}.css`,
        join(dirname(base), `_${base.split(/[\\/]/).at(-1)}.scss`),
        join(base, 'index.scss'),
        join(base, '_index.scss'),
      ]

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }
  return null
}

async function collectEntryGraph(entrypoint: string): Promise<Set<string>> {
  const visited = new Set<string>()

  async function visit(file: string): Promise<void> {
    if (visited.has(file)) return
    visited.add(file)
    const source = await readFile(file, 'utf8')
    const referencePatterns = [
      /@(use|forward)\s+['"]([^'"]+)['"]/g,
      /meta\.load-css\(\s*['"]([^'"]+)['"]/g,
      // Native CSS imports, including the layer()/prefix() forms used by Tailwind.
      /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g,
    ]
    for (const pattern of referencePatterns) {
      for (const match of source.matchAll(pattern)) {
        const reference = match[2] ?? match[1]
        const resolved = await resolveStyleReference(file, reference)
        if (resolved) await visit(resolved)
      }
    }
  }

  await visit(entrypoint)
  return visited
}

function collectCustomPropertyDefinitions(source: string, isStyle: boolean): Set<string> {
  const definitions = new Set<string>()
  const patterns = isStyle
    ? [/(--[\w-]+)\s*:/g]
    : [
        /setProperty\(\s*['"](--[\w-]+)['"]/g,
        /['"](--[\w-]+)['"]\s*\??\s*:/g,
        /\[\s*['"](--[\w-]+)['"]\s*\]\s*=/g,
      ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) definitions.add(match[1])
  }
  return definitions
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as StyleContractManifest
const allFiles = await listFiles(sourceRoot)
const styleFiles = allFiles.filter((file) => styleExtensions.has(extname(file)))
const scriptFiles = allFiles.filter((file) => scriptExtensions.has(extname(file)))
const errors: string[] = []

function requireReason(reason: string, descriptor: string): void {
  if (reason.trim().length < 16)
    errors.push(`feature color exception needs a concrete reason: ${descriptor}`)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

const featureColorFiles = new Set<string>()
for (const root of manifest.featureColorContract.roots) {
  const absoluteRoot = resolve(workspaceRoot, root)
  if (!absoluteRoot.startsWith(sourceRoot) || !(await isDirectory(absoluteRoot))) {
    errors.push(`feature color root must be an existing source directory: ${root}`)
    continue
  }
  for (const file of styleFiles) {
    if (file.startsWith(`${absoluteRoot}\\`) || file.startsWith(`${absoluteRoot}/`)) {
      featureColorFiles.add(file)
    }
  }
}

const componentExceptions = new Map<string, { reason: string; used: boolean }>()
for (const exception of manifest.featureColorContract.componentTokenExceptions) {
  const key = `${exception.file} -> ${exception.token}`
  requireReason(exception.reason, key)
  if (componentExceptions.has(key))
    errors.push(`duplicate feature component-token exception: ${key}`)
  componentExceptions.set(key, { reason: exception.reason, used: false })
}
const literalExceptions = new Map<string, { reason: string; used: boolean }>()
for (const exception of manifest.featureColorContract.literalColorExceptions) {
  const key = `${exception.file} -> ${exception.value.toLowerCase()}`
  requireReason(exception.reason, key)
  if (literalExceptions.has(key)) errors.push(`duplicate feature literal-color exception: ${key}`)
  literalExceptions.set(key, { reason: exception.reason, used: false })
}
const mixExceptions = new Map<string, { reason: string; used: boolean }>()
for (const exception of manifest.featureColorContract.colorMixExceptions) {
  const key = `${exception.file} -> ${exception.localProperty}`
  requireReason(exception.reason, key)
  if (!exception.localProperty.startsWith('--'))
    errors.push(`color-mix exception must name a local custom property: ${key}`)
  if (mixExceptions.has(key)) errors.push(`duplicate feature color-mix exception: ${key}`)
  mixExceptions.set(key, { reason: exception.reason, used: false })
}

const colorComponentToken =
  /--cpx-comp-[\w-]*(?:bg|fg|fill|color|border|edge|scrim|shadow)(?:-[\w-]+)?\b/g
const literalColor = /(?<![\w-])#[\da-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\([^;{}]+?\)/g
for (const file of featureColorFiles) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  for (const match of source.matchAll(colorComponentToken)) {
    const key = `${path} -> ${match[0]}`
    const exception = componentExceptions.get(key)
    if (exception) exception.used = true
    else
      errors.push(
        `feature styles must use system semantic colors, not ${match[0]}: ${path}:${lineNumberAt(source, match.index)}`,
      )
  }
  for (const match of source.matchAll(literalColor)) {
    const value = match[0].toLowerCase()
    const key = `${path} -> ${value}`
    const exception = literalExceptions.get(key)
    if (exception) exception.used = true
    else
      errors.push(
        `feature styles must not use literal color ${match[0]}: ${path}:${lineNumberAt(source, match.index)}`,
      )
  }
  for (const call of collectFunctionCalls(source, 'color-mix')) {
    const systemTokens = [...call.value.matchAll(/--cpx-sys-color-[\w-]+/g)].map(
      (match) => match[0],
    )
    const localTokens = [...call.value.matchAll(/--(?!cpx-(?:sys|comp)-)[\w-]+/g)].map(
      (match) => match[0],
    )
    if (new Set(systemTokens).size < 2 && localTokens.length === 0) continue
    const matchingException = localTokens
      .map((token) => mixExceptions.get(`${path} -> ${token}`))
      .find(Boolean)
    if (matchingException) matchingException.used = true
    else
      errors.push(
        `feature color-mix must not combine multiple semantic/local colors: ${path}:${lineNumberAt(source, call.offset)}`,
      )
  }
}
for (const [key, exception] of componentExceptions) {
  if (!exception.used) errors.push(`stale feature component-token exception: ${key}`)
}
for (const [key, exception] of literalExceptions) {
  if (!exception.used) errors.push(`stale feature literal-color exception: ${key}`)
}
for (const [key, exception] of mixExceptions) {
  if (!exception.used) errors.push(`stale feature color-mix exception: ${key}`)
}

/*
 * Non-color feature token exceptions. Each category's registry is built from
 * the manifest and validated once; scan rules consume exact identities through
 * markFeatureTokenUsed so only a full category/file/property(/value/localProperty)
 * match counts as used. Unconsumed entries are reported before the final error
 * judgment below.
 */
const featureTokenCategoryPairs: ReadonlyArray<
  readonly [FeatureTokenCategory, FeatureTokenException[]]
> = [
  ['componentGeometry', manifest.featureTokenContract.componentGeometryExceptions],
  ['inlineStyle', manifest.featureTokenContract.inlineStyleExceptions],
  ['tailwindArbitrary', manifest.featureTokenContract.tailwindArbitraryExceptions],
  ['tailwindTypography', manifest.featureTokenContract.tailwindTypographyExceptions],
  ['literalTypography', manifest.featureTokenContract.literalTypographyExceptions],
  ['literalRadius', manifest.featureTokenContract.literalRadiusExceptions],
  ['literalMotion', manifest.featureTokenContract.literalMotionExceptions],
  ['literalShadow', manifest.featureTokenContract.literalShadowExceptions],
  ['literalZIndex', manifest.featureTokenContract.literalZIndexExceptions],
  ['literalSpacing', manifest.featureTokenContract.literalSpacingExceptions],
]

function normalizeFeatureTokenFile(file: string): string {
  return file
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function featureTokenKey(
  category: FeatureTokenCategory,
  file: string,
  property: string,
  value?: string,
  localProperty?: string,
): string {
  const parts = [category, normalizeFeatureTokenFile(file), property]
  if (value !== undefined) parts.push(`value=${value}`)
  if (localProperty !== undefined) parts.push(`localProperty=${localProperty}`)
  return parts.join(' -> ')
}

function requireFeatureTokenReason(reason: string, descriptor: string): void {
  if (reason.trim().length < 16) {
    errors.push(`feature token exception needs a concrete reason: ${descriptor}`)
  }
}

const featureTokenRegistry = new Map<FeatureTokenCategory, Map<string, FeatureTokenRegistryEntry>>()
for (const [category, exceptions] of featureTokenCategoryPairs) {
  const categoryRegistry = new Map<string, FeatureTokenRegistryEntry>()
  for (const exception of exceptions) {
    const file = normalizeFeatureTokenFile(exception.file)
    const property = exception.property.trim()
    const value = exception.value?.trim()
    const localProperty = exception.localProperty?.trim()
    const key = featureTokenKey(category, file, property, value, localProperty)
    requireFeatureTokenReason(exception.reason, key)
    if (file.length === 0) errors.push(`feature token exception file must not be empty: ${key}`)
    if (property.length === 0)
      errors.push(`feature token exception property must not be empty: ${key}`)
    if (value !== undefined && value.length === 0) {
      errors.push(`feature token exception value must not be empty: ${key}`)
    }
    if (localProperty !== undefined && localProperty.length === 0) {
      errors.push(`feature token exception localProperty must not be empty: ${key}`)
    }
    if (categoryRegistry.has(key)) errors.push(`duplicate feature token exception: ${key}`)
    categoryRegistry.set(key, { reason: exception.reason, used: false })
  }
  featureTokenRegistry.set(category, categoryRegistry)
}

function markFeatureTokenUsed(
  category: FeatureTokenCategory,
  file: string,
  property: string,
  value?: string,
  localProperty?: string,
): boolean {
  const key = featureTokenKey(category, file, property, value, localProperty)
  const entry = featureTokenRegistry.get(category)?.get(key)
  if (entry) entry.used = true
  return entry !== undefined
}

/*
 * Non-color feature token scan input. The collected file sets and the reusable
 * source/block/script helpers below only establish data and machinery for the
 * upcoming rules; nothing here emits a new violation, so the existing failure
 * set stays unchanged.
 */
function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

const featureTokenStyleFiles = new Set<string>()
for (const root of manifest.featureTokenContract.roots) {
  const absoluteRoot = resolve(workspaceRoot, root)
  if (!isPathInside(sourceRoot, absoluteRoot) || !(await isDirectory(absoluteRoot))) {
    errors.push(`feature token root must be an existing source directory: ${root}`)
    continue
  }
  for (const file of styleFiles) {
    if (isPathInside(absoluteRoot, file)) featureTokenStyleFiles.add(file)
  }
}

const featureTokenScriptFiles = new Set<string>()
for (const root of manifest.featureTokenContract.scriptRoots) {
  const absoluteRoot = resolve(workspaceRoot, root)
  if (!isPathInside(sourceRoot, absoluteRoot) || !(await isDirectory(absoluteRoot))) {
    errors.push(`feature token script root must be an existing source directory: ${root}`)
    continue
  }
  for (const file of scriptFiles) {
    if (isPathInside(absoluteRoot, file)) featureTokenScriptFiles.add(file)
  }
}

/*
 * Interaction ownership: action buttons, compact rows and feature-owned
 * clickable surfaces must not share each other's visual contracts.
 */
const interactiveRowAllowedFiles = new Set(
  manifest.interactionContract.interactiveRowAllowedFiles.map(normalizeFeatureTokenFile),
)
for (const file of [...styleFiles, ...scriptFiles]) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  if (/interactive-row--(?:adaptive|composer|toolbar)\b/.test(source)) {
    errors.push(`legacy interactive-row escape modifier is forbidden: ${path}`)
  }
}
for (const file of featureTokenStyleFiles) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  if (/\.ui-button\b/.test(source)) {
    errors.push(`feature styles must not target .ui-button: ${path}`)
  }
}
for (const file of featureTokenScriptFiles) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  const usesInteractiveRow = /\binteractive-row(?:--[\w-]+)?\b/.test(source)
  if (usesInteractiveRow && !interactiveRowAllowedFiles.has(path)) {
    errors.push(
      `interactive-row is not allowed outside the reviewed menu/nav/summary files: ${path}`,
    )
  }
  if (/<Button\b(?![^>]*\bisIconOnly)[^>]*\baria-(?:pressed|selected)\s*=/s.test(source)) {
    errors.push(`Button must not represent persistent pressed/selected state: ${path}`)
  }
  if (
    /PopoverRadioGroup/.test(source) &&
    /trigger=\{?\s*<Button\b(?![^>]*\bisIconOnly)/s.test(source)
  ) {
    errors.push(`Popover radio-group trigger must not use Button: ${path}`)
  }
}
for (const file of interactiveRowAllowedFiles) {
  const absoluteFile = resolve(workspaceRoot, file)
  const source = (await isFile(absoluteFile)) ? await readFile(absoluteFile, 'utf8') : undefined
  if (source === undefined || !/\binteractive-row(?:--[\w-]+)?\b/.test(source)) {
    errors.push(`stale interactive-row allowed file: ${file}`)
  }
}

type CssDeclaration = {
  property: string
  value: string
  offset: number
}

function maskComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment: string) => ' '.repeat(comment.length))
    .replace(
      /(^|[ \t;{}])\/\/[^\r\n]*/gm,
      (match: string, prefix: string) => `${prefix}${' '.repeat(match.length - prefix.length)}`,
    )
}

function splitDeclarationSegments(body: string): Array<{ segment: string; offset: number }> {
  const parts: Array<{ segment: string; offset: number }> = []
  let start = 0
  let braceDepth = 0
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (quote !== null) {
      if (character === quote && body[index - 1] !== '\\') quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '{') braceDepth += 1
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    else if (character === ';' && braceDepth === 0 && depth === 0) {
      parts.push({ segment: body.slice(start, index), offset: start })
      start = index + 1
    }
  }
  parts.push({ segment: body.slice(start), offset: start })
  return parts
}

function extractDeclaration(
  masked: string,
  start: number,
  end: number,
  declarations: CssDeclaration[],
): void {
  const segment = masked.slice(start, end)
  const propertyMatch = segment.match(/^\s*((-{1,2}|[a-z_])[-a-z0-9_]*)\s*:/)
  if (!propertyMatch) return
  declarations.push({
    property: propertyMatch[1],
    value: segment.slice(propertyMatch[0].length).trim(),
    offset: start + propertyMatch[0].indexOf(propertyMatch[1]),
  })
}

function collectDeclarationsFromBody(
  masked: string,
  bodyStart: number,
  bodyEnd: number,
  declarations: CssDeclaration[],
): void {
  let segmentStart = bodyStart
  let braceDepth = 0
  let depth = 0
  let quote: string | null = null
  let inNestedBlock = false
  for (let index = bodyStart; index < bodyEnd; index += 1) {
    const character = masked[index]
    if (quote !== null) {
      if (character === quote && masked[index - 1] !== '\\') quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    else if (character === '{' && depth === 0) {
      if (braceDepth === 0) inNestedBlock = true
      braceDepth += 1
    } else if (character === '}' && depth === 0) {
      braceDepth = Math.max(0, braceDepth - 1)
      if (inNestedBlock && braceDepth === 0) {
        segmentStart = index + 1
        inNestedBlock = false
      }
    } else if (character === ';' && braceDepth === 0 && depth === 0) {
      extractDeclaration(masked, segmentStart, index, declarations)
      segmentStart = index + 1
    }
  }
  extractDeclaration(masked, segmentStart, bodyEnd, declarations)
}

function extractCssDeclarations(source: string): CssDeclaration[] {
  const masked = maskComments(source)
  const declarations: CssDeclaration[] = []
  const blockStarts: number[] = []
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index]
    if (character === '"' || character === "'") {
      const quote = character
      index += 1
      while (index < masked.length) {
        if (masked[index] === quote && masked[index - 1] !== '\\') break
        index += 1
      }
      continue
    }
    if (character === '{') blockStarts.push(index + 1)
    else if (character === '}' && blockStarts.length > 0) {
      const bodyStart = blockStarts.pop()
      if (bodyStart === undefined) continue
      collectDeclarationsFromBody(masked, bodyStart, index, declarations)
    }
  }
  return declarations.sort((a, b) => a.offset - b.offset)
}

type RuleBlock = {
  selector: string
  start: number
  bodyStart: number
  bodyEnd: number
  depth: number
}

function collectRuleBlocks(source: string): RuleBlock[] {
  const masked = maskComments(source)
  const blocks: RuleBlock[] = []
  const stack: Array<{ selector: string; start: number; bodyStart: number; depth: number }> = []
  let regionStart = 0
  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index]
    if (character === '"' || character === "'") {
      const quote = character
      index += 1
      while (index < masked.length) {
        if (masked[index] === quote && masked[index - 1] !== '\\') break
        index += 1
      }
      continue
    }
    if (character === '{') {
      const chunks = splitDeclarationSegments(masked.slice(regionStart, index))
      const lastChunk = chunks[chunks.length - 1]
      stack.push({
        selector: lastChunk.segment.trim(),
        start: regionStart + lastChunk.offset,
        bodyStart: index + 1,
        depth: stack.length,
      })
      regionStart = index + 1
    } else if (character === '}') {
      const open = stack.pop()
      if (open) {
        blocks.push({ ...open, bodyEnd: index })
        regionStart = index + 1
      }
    }
  }
  return blocks
}

function nearestRuleBlock(source: string, offset: number): RuleBlock | null {
  let nearest: RuleBlock | null = null
  for (const block of collectRuleBlocks(source)) {
    if (offset < block.bodyStart || offset >= block.bodyEnd) continue
    if (nearest === null || block.bodyEnd - block.bodyStart < nearest.bodyEnd - nearest.bodyStart) {
      nearest = block
    }
  }
  return nearest
}

function groupDeclarationsByBlock(
  blocks: RuleBlock[],
  declarations: CssDeclaration[],
): Map<number, CssDeclaration[]> {
  const byBlock = new Map<number, CssDeclaration[]>()
  for (const declaration of declarations) {
    let nearest: RuleBlock | null = null
    for (const block of blocks) {
      if (declaration.offset < block.bodyStart || declaration.offset >= block.bodyEnd) continue
      if (
        nearest === null ||
        block.bodyEnd - block.bodyStart < nearest.bodyEnd - nearest.bodyStart
      ) {
        nearest = block
      }
    }
    if (nearest === null) continue
    const list = byBlock.get(nearest.bodyStart)
    if (list) list.push(declaration)
    else byBlock.set(nearest.bodyStart, [declaration])
  }
  return byBlock
}

function isInsideKeyframes(source: string, offset: number): boolean {
  for (const block of collectRuleBlocks(source)) {
    if (
      offset >= block.bodyStart &&
      offset < block.bodyEnd &&
      /^@(?:-\w+-)?keyframes\b/i.test(block.selector.trim())
    ) {
      return true
    }
  }
  return false
}

function ruleBlockEstablishesStackingContext(
  source: string,
  declarations: CssDeclaration[],
  block: RuleBlock,
): boolean {
  for (const declaration of declarations) {
    const nearest = nearestRuleBlock(source, declaration.offset)
    if (nearest === null || nearest.bodyStart !== block.bodyStart) continue
    const value = declaration.value.trim()
    if (declaration.property === 'isolation' && /^isolate$/i.test(value)) return true
    if (declaration.property === 'position' && /^(?:relative|absolute|fixed|sticky)$/i.test(value))
      return true
    if (
      (declaration.property === 'transform' ||
        declaration.property === 'filter' ||
        declaration.property === 'backdrop-filter') &&
      !/^none$/i.test(value)
    ) {
      return true
    }
    if (declaration.property === 'opacity' && /^-?\d*\.?\d+$/.test(value)) {
      const opacity = Number(value)
      if (opacity >= 0 && opacity < 1) return true
    }
    if (declaration.property === 'contain') {
      const parts = value.split(/[\s,]+/).filter(Boolean)
      if (parts.some((part) => /^(?:paint|layout)$/i.test(part))) return true
    }
    if (declaration.property === 'will-change') {
      const parts = value.split(/[\s,]+/).filter(Boolean)
      if (parts.some((part) => /^(?:transform|opacity|filter)$/i.test(part))) return true
    }
  }
  return false
}

function createLineIndex(source: string): (offset: number) => number {
  const lineStarts: number[] = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1)
  }
  return (offset) => {
    let low = 0
    let high = lineStarts.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (lineStarts[mid] <= offset) low = mid + 1
      else high = mid
    }
    return low
  }
}

type ScriptSource = {
  source: string
  path: string
  lineNumberAt: (offset: number) => number
}

async function readScriptSource(file: string): Promise<ScriptSource> {
  const source = await readFile(file, 'utf8')
  return { source, path: workspacePath(file), lineNumberAt: createLineIndex(source) }
}

const featureTokenStyleDeclarations = new Map<string, CssDeclaration[]>()
for (const file of featureTokenStyleFiles) {
  featureTokenStyleDeclarations.set(file, extractCssDeclarations(await readFile(file, 'utf8')))
}

/*
 * Non-color feature token scan rules. Each rule walks declaration values and
 * consumes exact exceptions through markFeatureTokenUsed so only the precise
 * category/file/property/(value or localProperty) identity counts as used.
 * Component color/visual tokens (bg/fg/fill/color/border/edge/scrim/shadow)
 * are governed by the color contract and never count as geometry.
 */
const colorComponentTokenName =
  /--cpx-comp-[\w-]*(?:bg|fg|fill|color|border|edge|scrim|shadow|ansi)(?:-[\w-]+)?/
const componentGeometryToken = /--cpx-comp-[\w-]+/g
const bareTypographyLength = /(?<![\w-])-?\d+(?:\.\d+)?(?:px|rem|em|%)/
const bareUnitlessLineHeight = /(?<![\w-])-?\d+(?:\.\d+)?(?![\w.%])/
const radiusBareLength = /(?<![\w-])-?(?:\d*[1-9]\d*(?:\.\d+)?|\d+\.\d+)(?:px|rem|em|%)/
const radiusProperties = new Set([
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
])
const motionProperties = new Set([
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  'animation-duration',
  'animation-timing-function',
])
const motionBareTime = /(?<![\w-])-?\d*\.?\d+(ms|s)\b/g
const motionTimingFunction = /(?<![\w-])(?:cubic-bezier|steps)\(/
const motionEasingKeyword = /(?<![\w-])(?:ease-in-out|ease-in|ease-out|ease|linear)(?![\w-])/
const motionVarReference = /var\(\s*--cpx-sys-(?:motion|ease)-[\w-]+\s*(?:,\s*[^()]*)?\)/g
const shadowResetKeyword = /^(?:none|inherit|initial|unset|revert)$/i
const systemShadowVarReference =
  /^var\(\s*--cpx-sys-(?:shadow-[\w-]+|focus-ring(?:-[\w-]+)?)\s*(?:,\s*[^()]*)?\)$/i
const systemZIndexVarReference = /^var\(\s*--cpx-sys-z-[\w-]+\s*(?:,\s*[^()]*)?\)$/i
const zIndexKeyword = /^(?:inherit|initial|unset|revert|auto)$/i

const spacingProperties = new Set([
  'padding',
  'padding-block',
  'padding-block-start',
  'padding-block-end',
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-block',
  'margin-block-start',
  'margin-block-end',
  'margin-inline',
  'margin-inline-start',
  'margin-inline-end',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
])
const systemSpacingVarReference = /^--cpx-sys-(?:space|layout)-[\w-]+$/
const spacingBareLength =
  /(?<![\w-])(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em|%|vw|vh|vmin|vmax|ch|ex)\b/g
const localCustomPropertyName = /^--[\w-]+$/

function analyzeSpacingValue(value: string): {
  hasBareLength: boolean
  localVarReferences: string[]
} {
  const masked = value.split('')
  const localVarReferences: string[] = []
  for (const call of collectFunctionCalls(value, 'var')) {
    const name = call.value.match(/^\s*var\s*\(\s*(--[\w-]+)/)?.[1]
    if (name === undefined) continue
    if (!systemSpacingVarReference.test(name)) localVarReferences.push(name)
    for (let index = call.offset; index < call.offset + call.value.length; index += 1)
      masked[index] = ' '
  }
  for (const call of collectFunctionCalls(value, 'env')) {
    for (let index = call.offset; index < call.offset + call.value.length; index += 1)
      masked[index] = ' '
  }
  let hasBareLength = false
  for (const match of masked.join('').matchAll(spacingBareLength)) {
    if (Number(match[1]) !== 0) {
      hasBareLength = true
      break
    }
  }
  return { hasBareLength, localVarReferences: [...new Set(localVarReferences)] }
}

function splitTopLevelList(value: string, delimiter: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote !== null) {
      if (character === quote && value[index - 1] !== '\\') quote = null
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1)
    else if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

for (const [file, declarations] of featureTokenStyleDeclarations) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  const fileBlocks = collectRuleBlocks(source)
  const fileBlockDeclarations = groupDeclarationsByBlock(fileBlocks, declarations)
  const fileLocalCustomProperties = new Set(
    declarations
      .filter((candidate) => localCustomPropertyName.test(candidate.property))
      .map((candidate) => candidate.property),
  )
  for (const declaration of declarations) {
    for (const token of declaration.value.matchAll(componentGeometryToken)) {
      if (colorComponentTokenName.test(token[0])) continue
      const used = markFeatureTokenUsed(
        'componentGeometry',
        path,
        declaration.property,
        undefined,
        token[0],
      )
      if (!used) {
        errors.push(
          `feature styles must not use component geometry ${token[0]}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
    if (declaration.property === 'font-size' || declaration.property === 'line-height') {
      const hasBareLength = bareTypographyLength.test(declaration.value)
      const hasBareLineHeight =
        declaration.property === 'line-height' && bareUnitlessLineHeight.test(declaration.value)
      if (!hasBareLength && !hasBareLineHeight) continue
      const used = markFeatureTokenUsed(
        'literalTypography',
        path,
        declaration.property,
        declaration.value,
      )
      if (!used) {
        errors.push(
          `feature styles must not use literal typography ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
    if (radiusProperties.has(declaration.property) && radiusBareLength.test(declaration.value)) {
      const used = markFeatureTokenUsed(
        'literalRadius',
        path,
        declaration.property,
        declaration.value,
      )
      if (!used) {
        errors.push(
          `feature styles must not use literal radius ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
    if (motionProperties.has(declaration.property)) {
      const maskedMotion = declaration.value.replace(motionVarReference, '')
      let hasLiteralMotion = false
      for (const time of maskedMotion.matchAll(motionBareTime)) {
        if (Number(time[1]) !== 0) {
          hasLiteralMotion = true
          break
        }
      }
      if (!hasLiteralMotion) hasLiteralMotion = motionTimingFunction.test(maskedMotion)
      if (!hasLiteralMotion) hasLiteralMotion = motionEasingKeyword.test(maskedMotion)
      if (hasLiteralMotion) {
        const used = markFeatureTokenUsed(
          'literalMotion',
          path,
          declaration.property,
          declaration.value,
        )
        if (!used) {
          errors.push(
            `feature styles must not use literal motion ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
          )
        }
      }
    }
    if (declaration.property === 'box-shadow' || declaration.property === 'text-shadow') {
      if (shadowResetKeyword.test(declaration.value.trim())) continue
      const layers = splitTopLevelList(declaration.value, ',')
      const usesGovernedShadow = layers.every((layer) => {
        const value = layer.trim()
        if (systemShadowVarReference.test(value)) return true
        const localName = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*[^()]*)?\)$/)?.[1]
        return localName !== undefined && fileLocalCustomProperties.has(localName)
      })
      if (usesGovernedShadow) continue
      const used = markFeatureTokenUsed(
        'literalShadow',
        path,
        declaration.property,
        declaration.value,
      )
      if (!used) {
        errors.push(
          `feature styles must not use literal shadow ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
    if (
      (declaration.property === 'filter' || declaration.property === 'backdrop-filter') &&
      /drop-shadow\s*\(/i.test(declaration.value)
    ) {
      if (shadowResetKeyword.test(declaration.value.trim())) continue
      const dropShadows = collectFunctionCalls(declaration.value, 'drop-shadow')
      const hasLiteralDropShadow = dropShadows.some((call) => {
        const argument = call.value.slice('drop-shadow'.length + 1, -1).trim()
        if (shadowResetKeyword.test(argument)) return false
        return !systemShadowVarReference.test(argument)
      })
      if (!hasLiteralDropShadow) continue
      const used = markFeatureTokenUsed(
        'literalShadow',
        path,
        declaration.property,
        declaration.value,
      )
      if (!used) {
        errors.push(
          `feature styles must not use literal shadow ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
    if (declaration.property === 'z-index') {
      const value = declaration.value.trim()
      if (systemZIndexVarReference.test(value) || zIndexKeyword.test(value)) continue
      const isBareIntegerInRange =
        /^-?\d+$/.test(value) && Number(value) >= -1 && Number(value) <= 5
      let hasStackingContext = false
      if (isBareIntegerInRange) {
        const block = nearestRuleBlock(source, declaration.offset)
        hasStackingContext =
          block !== null &&
          !block.selector.trim().startsWith('@') &&
          !isInsideKeyframes(source, declaration.offset) &&
          ruleBlockEstablishesStackingContext(source, declarations, block)
      }
      if (hasStackingContext) continue
      const used = markFeatureTokenUsed(
        'literalZIndex',
        path,
        declaration.property,
        declaration.value,
      )
      if (!used) {
        errors.push(
          `feature styles must not use literal z-index ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
    if (spacingProperties.has(declaration.property)) {
      const analysis = analyzeSpacingValue(declaration.value)
      const scope = new Set<string>()
      for (const block of fileBlocks) {
        if (declaration.offset < block.bodyStart || declaration.offset >= block.bodyEnd) continue
        if (block.selector.trim().startsWith('@')) continue
        for (const scopedDeclaration of fileBlockDeclarations.get(block.bodyStart) ?? []) {
          if (localCustomPropertyName.test(scopedDeclaration.property)) {
            scope.add(scopedDeclaration.property)
          }
        }
      }
      const hasUnscopedLocalVar = analysis.localVarReferences.some(
        (name) => !scope.has(name) && !fileLocalCustomProperties.has(name),
      )
      if (!analysis.hasBareLength && !hasUnscopedLocalVar) continue
      const used = markFeatureTokenUsed(
        'literalSpacing',
        path,
        declaration.property,
        declaration.value,
      )
      if (!used) {
        errors.push(
          `feature styles must not use literal spacing ${declaration.value}: ${path}:${lineNumberAt(source, declaration.offset)}`,
        )
      }
    }
  }
}

const featureTokenScriptSources = new Map<string, ScriptSource>()
for (const file of featureTokenScriptFiles) {
  featureTokenScriptSources.set(file, await readScriptSource(file))
}

function lineNumberAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length
}

function collectFunctionCalls(
  source: string,
  name: string,
): Array<{ value: string; offset: number }> {
  const calls: Array<{ value: string; offset: number }> = []
  const startPattern = new RegExp(`${escapeRegExp(name)}\\(`, 'g')
  for (const start of source.matchAll(startPattern)) {
    let depth = 0
    let end = start.index
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1
      if (source[end] === ')') {
        depth -= 1
        if (depth === 0) {
          end += 1
          break
        }
      }
    }
    if (depth === 0) calls.push({ value: source.slice(start.index, end), offset: start.index })
  }
  return calls
}

/*
 * Inline style rule: TSX feature/components must not carry literal non-color
 * values through JSX style objects. Direct object literals, same-file variable
 * references, object spreads and conditional branches are followed when their
 * values are statically resolvable.
 * Semantic var(--cpx-sys-*) references, zero lengths and reset keywords are
 * allowed; any other focused literal must be pinned by an exact
 * inlineStyle file+property+value exception.
 */
const inlineStyleFocusProperties = new Set([
  'fontSize',
  'lineHeight',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'transition',
  'transitionDuration',
  'transitionTimingFunction',
  'animation',
  'animationDuration',
  'animationTimingFunction',
  'boxShadow',
  'textShadow',
  'filter',
  'backdropFilter',
  'zIndex',
  'padding',
  'paddingBlock',
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInline',
  'paddingInlineStart',
  'paddingInlineEnd',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'gap',
  'rowGap',
  'columnGap',
])

function isAllowedInlineStyleValue(value: string): boolean {
  if (/var\(\s*--cpx-sys-/i.test(value)) return true
  if (/^0(?:\.0+)?(?:px|rem|em|ms|s|%)?$/i.test(value)) return true
  return /^(?:none|auto|inherit|initial|unset|revert)$/i.test(value)
}

function unwrapInlineStyleExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function inlineStylePropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function inlineStyleStaticValue(expression: ts.Expression): string | undefined {
  const current = unwrapInlineStyleExpression(expression)
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text.trim()
  }
  if (ts.isNumericLiteral(current)) return current.text
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(current.operand)
  ) {
    return `-${current.operand.text}`
  }
  return undefined
}

for (const file of featureTokenScriptFiles) {
  const script = featureTokenScriptSources.get(file)
  if (!script) continue
  const { source, path } = script
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(path).toLowerCase() === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const variableInitializers = new Map<string, ts.Expression>()
  const collectVariables = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variableInitializers.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collectVariables)
  }
  collectVariables(sourceFile)

  const scanStyleExpression = (expression: ts.Expression, visited: Set<ts.Node>): void => {
    const current = unwrapInlineStyleExpression(expression)
    if (visited.has(current)) return
    visited.add(current)

    if (ts.isIdentifier(current)) {
      const initializer = variableInitializers.get(current.text)
      if (initializer) scanStyleExpression(initializer, visited)
      return
    }
    if (ts.isConditionalExpression(current)) {
      scanStyleExpression(current.whenTrue, visited)
      scanStyleExpression(current.whenFalse, visited)
      return
    }
    if (!ts.isObjectLiteralExpression(current)) return

    for (const member of current.properties) {
      if (ts.isSpreadAssignment(member)) {
        scanStyleExpression(member.expression, visited)
        continue
      }
      if (!ts.isPropertyAssignment(member)) continue
      const property = inlineStylePropertyName(member.name)
      if (!property || !inlineStyleFocusProperties.has(property)) continue
      const value = inlineStyleStaticValue(member.initializer)
      if (value === undefined || isAllowedInlineStyleValue(value)) continue
      const used = markFeatureTokenUsed('inlineStyle', path, property, value)
      if (!used) {
        const line = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1
        errors.push(
          `feature TSX must not use literal inline style ${property}: ${value}: ${path}:${line}`,
        )
      }
    }
  }

  const visitJsxStyles = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.text === 'style' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      scanStyleExpression(node.initializer.expression, new Set())
    }
    ts.forEachChild(node, visitJsxStyles)
  }
  visitJsxStyles(sourceFile)
}

/*
 * Prefix rule: every utility class must carry the `tw:` prefix. Tailwind is
 * configured with `prefix(tw)`, so an unprefixed utility is not an error to
 * Tailwind — it is simply never generated, and the style silently disappears.
 * Only variant/utility-shaped tokens on a class-list line are reported, which
 * keeps JSX attributes (xlink:href) and object literals (files:parent) out.
 */
const unprefixedUtilityPattern =
  /(?:^|[\s"'`(])((?:hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|indeterminate|selected|open|closed|data-|aria-|has-|group-|peer-|not-|placeholder|file|first|last|odd|even|motion-reduce|motion-safe|sm|md|lg|xl|max-|min-)[\w-]*(?:\[[^\]\n]*\])?:[\w[\]-]+)/gm
const allowedUnprefixedUtility = /^(?:https?:|data:|file:|xlink:|xml:|urn:|aria-[a-z]+:)/
function isClassListLine(line: string): boolean {
  return /className|tw:|cx\(|joinClassNames/.test(line)
}
for (const file of scriptFiles) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  if (!source.includes('tw:')) continue
  for (const match of source.matchAll(unprefixedUtilityPattern)) {
    const token = match[1]
    const index = (match.index ?? 0) + match[0].length - token.length
    if (source.slice(Math.max(0, index - 3), index) === 'tw:') continue
    if (allowedUnprefixedUtility.test(token)) continue
    const lineStart = source.lastIndexOf('\n', index) + 1
    const lineEnd = source.indexOf('\n', index)
    if (!isClassListLine(source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd)))
      continue
    errors.push(
      `Tailwind utility is missing the tw: prefix: ${path}:${lineNumberAt(source, index)} (${token})`,
    )
  }
}

/*
 * Typography role rule: a `type-*` role declares the whole `font:` shorthand and
 * Tailwind emits `type-weight-*` before the roles, so combining them in one
 * class list silently drops the weight. Elements either use a role that already
 * carries the weight, a bare weight utility, or `styles/role-weight.css`.
 */
const roleWithWeightPattern =
  /tw:type-(?!weight-)[a-z-]+[\s\S]{0,200}?tw:type-weight-|tw:type-weight-[a-z-]+[\s\S]{0,200}?tw:type-(?!weight-)[a-z-]+/g
for (const file of scriptFiles) {
  const source = await readFile(file, 'utf8')
  const path = workspacePath(file)
  for (const match of source.matchAll(roleWithWeightPattern)) {
    // Only one class list: a newline usually separates different attributes.
    if (match[0].includes('\n')) continue
    errors.push(
      `tw:type-* cannot be combined with tw:type-weight-* (the role font shorthand wins): ${path}:${lineNumberAt(source, match.index)}`,
    )
  }
}

/*
 * Tailwind arbitrary non-color rule: feature TSX must not carry literal
 * non-color values through Tailwind arbitrary classes (typography, radius,
 * motion, shadow, z-index, spacing), including optional variant prefixes
 * such as hover:p-[6px]. Semantic var(--cpx-sys-*) references inside the
 * bracket are allowed; any other matched class must be pinned by an exact
 * tailwindArbitrary file+className+complete-class exception.
 */
const tailwindArbitraryPattern =
  /((?:[\w-]+:)*?)((?:text|leading|rounded(?:-[a-z]{1,2})?|duration|ease|shadow|z|px|py|pt|pr|pb|pl|ps|pe|p|mx|my|mt|mr|mb|ml|ms|me|m|gap-x|gap-y|gap)-\[[^\]]+\])/g
for (const file of featureTokenScriptFiles) {
  const script = featureTokenScriptSources.get(file)
  if (!script) continue
  const { source, path, lineNumberAt } = script
  for (const match of source.matchAll(tailwindArbitraryPattern)) {
    const fullClass = `${match[1]}${match[2]}`
    const bracketContent = match[2].slice(match[2].indexOf('[') + 1, -1)
    if (/var\(\s*--cpx-sys-/.test(bracketContent)) continue
    const used = markFeatureTokenUsed('tailwindArbitrary', path, 'className', fullClass)
    if (!used) {
      errors.push(
        `feature TSX must not use literal Tailwind arbitrary ${fullClass}: ${path}:${lineNumberAt(match.index)}`,
      )
    }
  }
}

/*
 * Typography responsibility rule: feature TSX uses semantic `tw:type-*` roles
 * instead of generic Tailwind size/weight utilities that can override feature
 * styles independently of the component's content role.
 */
const tailwindTypographyPattern =
  /tw:(?:text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)|font-(?:normal|medium|semibold|bold)|font-\[[^\]]+\])/g
for (const file of featureTokenScriptFiles) {
  const script = featureTokenScriptSources.get(file)
  if (!script) continue
  const { source, path, lineNumberAt } = script
  for (const match of source.matchAll(tailwindTypographyPattern)) {
    const className = match[0]
    const used = markFeatureTokenUsed('tailwindTypography', path, 'className', className)
    if (!used) {
      errors.push(
        `feature TSX must use a semantic typography role instead of ${className}: ${path}:${lineNumberAt(match.index)}`,
      )
    }
  }
}

const entrypoint = resolve(workspaceRoot, manifest.styleEntrypoint)
if (!(await isFile(entrypoint)) || !styleExtensions.has(extname(entrypoint))) {
  errors.push(
    `styleEntrypoint must point to one existing CSS/SCSS file: ${manifest.styleEntrypoint}`,
  )
}

const entrypointSource = await readFile(entrypoint, 'utf8')
const declaredLayerOrder = entrypointSource
  .match(/@layer\s+([^;]+);/)?.[1]
  .split(',')
  .map((layer) => layer.trim())
if (
  !declaredLayerOrder ||
  declaredLayerOrder.length !== manifest.cascadeLayerOrder.length ||
  declaredLayerOrder.some((layer, index) => layer !== manifest.cascadeLayerOrder[index])
) {
  errors.push(`cascade layer order must be: ${manifest.cascadeLayerOrder.join(', ')}`)
}

const legacyScssEntrypoints = (manifest.legacyScssEntrypoints ?? []).map((path) =>
  resolve(workspaceRoot, path),
)

/*
 * A layer counts as loaded when it is either a `@layer name { }` block or an
 * `@import ... layer(name)` modifier. The Tailwind entrypoint loads the theme
 * and utility layers through imports, so both forms must be recognised across
 * the entrypoint and any legacy SCSS entrypoint that shares the cascade order.
 */
const loadedLayers = new Set<string>()
/*
 * Layer blocks live in the imported stylesheets (the entrypoint only declares
 * the order) plus `layer()` modifiers on the imports, so the scan walks the
 * whole entry graph instead of reading the entrypoint alone.
 */
const layerSources = new Set<string>([entrypoint, ...legacyScssEntrypoints])
for (const graphFile of await collectEntryGraph(entrypoint)) layerSources.add(graphFile)
// Lazy entrypoints are imported by their feature, not by the main entry, and the
// vendor layer is only loaded from one of them.
for (const lazyPath of Object.keys(manifest.lazyStyleEntrypoints)) {
  const lazyFile = resolve(workspaceRoot, lazyPath)
  if (await isFile(lazyFile)) layerSources.add(lazyFile)
}
for (const styleFile of layerSources) {
  const source = await readFile(styleFile, 'utf8')
  for (const match of source.matchAll(/@layer\s+([\w-]+)\s*\{/g)) loadedLayers.add(match[1])
  for (const match of source.matchAll(/@import\s+[^;]*\blayer\(\s*([\w-]+)\s*\)/g))
    loadedLayers.add(match[1])
}
for (const layer of manifest.cascadeLayerOrder) {
  if (!loadedLayers.has(layer)) errors.push(`cascade layer has no explicit block: ${layer}`)
}

const entryGraph = await collectEntryGraph(entrypoint)
const allowedDirectImports = new Set(manifest.directStyleImportAllowlist)
const observedDirectImports = new Set<string>()
const directStyleTargets = new Set<string>()
const observedEntrypointImporters = new Set<string>()

for (const scriptFile of scriptFiles) {
  const source = await readFile(scriptFile, 'utf8')
  for (const match of source.matchAll(
    /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+\.(?:css|scss))['"]/g,
  )) {
    const target = await resolveStyleReference(scriptFile, match[1])
    if (!target) {
      errors.push(`${workspacePath(scriptFile)} imports a missing style file: ${match[1]}`)
      continue
    }
    if (target === entrypoint) {
      observedEntrypointImporters.add(workspacePath(scriptFile))
      continue
    }

    const descriptor = `${workspacePath(scriptFile)} -> ${workspacePath(target)}`
    observedDirectImports.add(descriptor)
    directStyleTargets.add(target)
    if (!allowedDirectImports.has(descriptor)) {
      errors.push(`direct style import is not allowlisted: ${descriptor}`)
    }
  }
}

if (
  observedEntrypointImporters.size !== 1 ||
  !observedEntrypointImporters.has(manifest.styleEntrypointImporter)
) {
  errors.push(
    `style entrypoint must be imported only by ${manifest.styleEntrypointImporter}; observed: ${[...observedEntrypointImporters].sort().join(', ') || 'none'}`,
  )
}

for (const descriptor of allowedDirectImports) {
  if (!observedDirectImports.has(descriptor)) {
    errors.push(`stale directStyleImportAllowlist entry: ${descriptor}`)
  }
}

const lazyStyleEntrypoints = new Map(
  Object.entries(manifest.lazyStyleEntrypoints).map(([path, layer]) => [
    resolve(workspaceRoot, path),
    layer,
  ]),
)
const legacyEntrypointSet = new Set(legacyScssEntrypoints)
for (const [lazyEntrypoint, expectedLayer] of lazyStyleEntrypoints) {
  if (!directStyleTargets.has(lazyEntrypoint)) {
    errors.push(`lazy style entrypoint must be directly imported: ${workspacePath(lazyEntrypoint)}`)
    continue
  }
  const source = await readFile(lazyEntrypoint, 'utf8')
  const layers = [
    ...new Set(
      [
        ...source.matchAll(/@layer\s+([\w-]+)\s*\{/g),
        ...source.matchAll(/@import\s+[^;]*\blayer\(\s*([\w-]+)\s*\)/g),
      ].map((match) => match[1]),
    ),
  ]
  if (layers.length !== 1 || layers[0] !== expectedLayer) {
    errors.push(
      `lazy style entrypoint ${workspacePath(lazyEntrypoint)} must declare only @layer ${expectedLayer}`,
    )
  }
}
for (const directStyleTarget of directStyleTargets) {
  if (
    directStyleTarget === entrypoint ||
    lazyStyleEntrypoints.has(directStyleTarget) ||
    legacyEntrypointSet.has(directStyleTarget)
  ) {
    continue
  }
  errors.push(
    `direct style target must be a declared lazy or legacy entrypoint: ${workspacePath(directStyleTarget)}`,
  )
}
for (const legacyEntrypoint of legacyScssEntrypoints) {
  if (!directStyleTargets.has(legacyEntrypoint)) {
    errors.push(
      `legacy SCSS entrypoint must be directly imported: ${workspacePath(legacyEntrypoint)}`,
    )
  }
}

const completeStyleGraph = new Set(entryGraph)
for (const lazyEntrypoint of lazyStyleEntrypoints.keys()) {
  for (const styleFile of await collectEntryGraph(lazyEntrypoint)) {
    completeStyleGraph.add(styleFile)
  }
}
for (const legacyEntrypoint of legacyScssEntrypoints) {
  for (const styleFile of await collectEntryGraph(legacyEntrypoint)) {
    completeStyleGraph.add(styleFile)
  }
}

for (const styleFile of styleFiles) {
  if (!completeStyleGraph.has(styleFile) && !directStyleTargets.has(styleFile)) {
    errors.push(`style file is outside the single-entry graph: ${workspacePath(styleFile)}`)
  }
}

const customPropertyReferences = new Set<string>()
const customPropertyDefinitions = new Set<string>()
for (const file of [...styleFiles, ...scriptFiles]) {
  const source = await readFile(file, 'utf8')
  const isStyle = styleExtensions.has(extname(file))
  for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
    customPropertyReferences.add(match[1])
  }
  for (const definition of collectCustomPropertyDefinitions(source, isStyle)) {
    customPropertyDefinitions.add(definition)
  }
}

const allowedCustomPropertyReferences = new Set(manifest.customPropertyReferenceAllowlist)
const forbiddenCustomPropertyPatterns = manifest.forbiddenCustomPropertyPatterns.map(
  (pattern) => new RegExp(pattern),
)
for (const definition of customPropertyDefinitions) {
  if (forbiddenCustomPropertyPatterns.some((pattern) => pattern.test(definition))) {
    errors.push(`forbidden legacy custom property definition: ${definition}`)
  }
}
for (const reference of customPropertyReferences) {
  if (
    !customPropertyDefinitions.has(reference) &&
    !allowedCustomPropertyReferences.has(reference)
  ) {
    errors.push(`undefined custom property reference: ${reference}`)
  }
}
for (const reference of allowedCustomPropertyReferences) {
  if (customPropertyDefinitions.has(reference) || !customPropertyReferences.has(reference)) {
    errors.push(`stale customPropertyReferenceAllowlist entry: ${reference}`)
  }
}

const observedDataThemeSelectors: Record<string, number> = {}
const observedImportantDeclarations: Record<string, number> = {}
for (const styleFile of styleFiles) {
  const source = await readFile(styleFile, 'utf8')
  const importantCount = [...source.matchAll(/!important\b/g)].length
  if (importantCount > 0) observedImportantDeclarations[workspacePath(styleFile)] = importantCount
  const count = [...source.matchAll(/\[data-theme(?=[\s=\]])/g)].length
  if (count > 0) observedDataThemeSelectors[workspacePath(styleFile)] = count
}

const importantFiles = new Set([
  ...Object.keys(manifest.importantDeclarationAllowlist),
  ...Object.keys(observedImportantDeclarations),
])
for (const file of importantFiles) {
  const expected = manifest.importantDeclarationAllowlist[file] ?? 0
  const observed = observedImportantDeclarations[file] ?? 0
  if (expected !== observed) {
    errors.push(
      `!important declaration count changed in ${file}: expected ${expected}, observed ${observed}`,
    )
  }
}

const dataThemeFiles = new Set([
  ...Object.keys(manifest.dataThemeSelectorAllowlist),
  ...Object.keys(observedDataThemeSelectors),
])
for (const file of dataThemeFiles) {
  const expected = manifest.dataThemeSelectorAllowlist[file] ?? 0
  const observed = observedDataThemeSelectors[file] ?? 0
  if (expected !== observed) {
    errors.push(
      `data-theme selector count changed in ${file}: expected ${expected}, observed ${observed}`,
    )
  }
}

/*
 * Line-height governance: content roles must use the semantic --type-line-*
 * tokens (or var/calc/max/min/clamp), while fixed desktop chrome (buttons,
 * badges, review diff, control profiles) keeps its geometry through the
 * per-file literal allowlist. TSX must not add ad-hoc tw:leading-* values;
 * new typography roles belong in the Tailwind theme instead.
 */
const semanticLineHeightValue = /^(?:var\(|calc\(|max\(|min\(|clamp\(|inherit)/
const observedLiteralLineHeights: Record<string, number> = {}
const literalLineHeightValues: Record<string, Set<string>> = {}
for (const styleFile of styleFiles) {
  const source = await readFile(styleFile, 'utf8')
  const declarations = [
    ...source.matchAll(/(?<!-)line-height\s*:\s*([^;{}]+);/g).map((match) => match[1]),
    ...source.matchAll(/--[\w-]+-line-height\s*:\s*([^;{}]+);/g).map((match) => match[1]),
  ].map((value) => value.trim())
  const literals = declarations.filter((value) => !semanticLineHeightValue.test(value))
  if (literals.length === 0) continue
  const filePath = workspacePath(styleFile)
  observedLiteralLineHeights[filePath] = literals.length
  literalLineHeightValues[filePath] = new Set(literals)
}

const literalLineHeightFiles = new Set([
  ...Object.keys(manifest.literalLineHeightAllowlist),
  ...Object.keys(observedLiteralLineHeights),
])
for (const file of literalLineHeightFiles) {
  const expected = manifest.literalLineHeightAllowlist[file] ?? 0
  const observed = observedLiteralLineHeights[file] ?? 0
  if (expected !== observed) {
    const values = [...(literalLineHeightValues[file] ?? [])].sort().join(', ')
    errors.push(
      `literal line-height count changed in ${file}: expected ${expected}, observed ${observed}${values ? ` (${values})` : ''}`,
    )
  }
}

const observedTailwindLeading: Record<string, number> = {}
for (const scriptFile of scriptFiles) {
  const source = await readFile(scriptFile, 'utf8')
  const count = [...source.matchAll(/tw:leading-/g)].length
  if (count > 0) observedTailwindLeading[workspacePath(scriptFile)] = count
}
const tailwindLeadingFiles = new Set([
  ...Object.keys(manifest.tailwindLeadingAllowlist),
  ...Object.keys(observedTailwindLeading),
])
for (const file of tailwindLeadingFiles) {
  const expected = manifest.tailwindLeadingAllowlist[file] ?? 0
  const observed = observedTailwindLeading[file] ?? 0
  if (expected !== observed) {
    errors.push(`tw:leading-* count changed in ${file}: expected ${expected}, observed ${observed}`)
  }
}

/*
 * Font shorthand must not smuggle a line-height through the `/` segment; use
 * semantic line-height tokens instead. `font: inherit` resets stay valid.
 */
for (const styleFile of styleFiles) {
  const source = await readFile(styleFile, 'utf8')
  for (const match of source.matchAll(/font\s*:\s*[^;{}]*\/[^;{}]*;/g)) {
    errors.push(
      `font shorthand with '/' line-height in ${workspacePath(styleFile)}: declare font-family, font-size and line-height separately`,
    )
  }
}

/*
 * Animation implementation contracts: continuous animations must stay on the
 * compositor/transform path. Guards the progress bars and the scroll edge-fade
 * frames against regressing to per-frame repaints (background-position sweeps),
 * layout-thrash transitions (width), persistent will-change promotion, scroll
 * timelines or dynamic mask keyframes. Sweep keyframes are scanned wherever
 * they live, so moving a shimmer into a utility or a component file keeps the
 * same guarantee.
 */
/** Yield every `@keyframes <name> { ... }` body found in one stylesheet. */
function* keyframeBodies(source: string): Generator<string> {
  for (const match of source.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
    let depth = 0
    let end = match.index ?? 0
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    yield source.slice(match.index, end + 1)
  }
}

for (const styleFile of styleFiles) {
  const source = await readFile(styleFile, 'utf8')
  const path = workspacePath(styleFile)
  if (/background-attachment\s*:\s*fixed/.test(source)) {
    errors.push(`shimmer must not use background-attachment: fixed repaint sweeps: ${path}`)
  }
  for (const block of keyframeBodies(source)) {
    if (/background-position/.test(block)) {
      errors.push(
        `keyframes must not animate background-position; use a transform translateX sweep: ${path}`,
      )
      break
    }
  }
}

/*
 * Compositor contracts are checked wherever the selector now lives — a feature
 * stylesheet, a primitives residue file, or a Tailwind class list in TSX — so
 * moving a rule during the migration cannot quietly retire its guarantee.
 */
const allSources: Array<{ path: string; text: string }> = []
for (const styleFile of styleFiles) {
  allSources.push({ path: workspacePath(styleFile), text: await readFile(styleFile, 'utf8') })
}
for (const [scriptFile, script] of featureTokenScriptSources) {
  allSources.push({ path: workspacePath(scriptFile), text: script.source })
}

/** Selector occurrences with a window around them, for declaration queries. */
function selectorWindows(selector: string): Array<{ path: string; window: string }> {
  const hits: Array<{ path: string; window: string }> = []
  for (const { path, text } of allSources) {
    let index = text.indexOf(selector)
    while (index !== -1) {
      hits.push({ path, window: text.slice(Math.max(0, index - 40), index + 240) })
      index = text.indexOf(selector, index + selector.length)
    }
  }
  return hits
}

for (const [selector, label] of [
  ['.sidebar-session-list-extra', 'sidebar session list'],
  ['.canonical-turn-activity__content', 'canonical activity content'],
] as const) {
  const sites = selectorWindows(selector)
  if (sites.length === 0) {
    errors.push(`animation contract selector is gone from every source: ${selector}`)
    continue
  }
  for (const site of sites) {
    if (/will-change\s*[:=]/.test(site.window) || /will-change-/.test(site.window)) {
      errors.push(`${label} must not carry persistent will-change: ${selector} (${site.path})`)
    }
  }
}

for (const site of selectorWindows('.composer-status-bar-fill')) {
  if (!site.path.endsWith('.scss') && !site.path.endsWith('.css')) continue
  const block = selectorBlock(site.window, '.composer-status-bar-fill')
  if (!block) continue
  const properties = transitionProperties(block)
  if (properties.length === 0 || properties.some((property) => property !== 'transform')) {
    errors.push(`${'.composer-status-bar-fill'} must transition only transform (compositor)`)
  }
}

/*
 * Scroll fade masks and scroll-driven animation timelines are banned everywhere
 * rather than in one named file: the same rules may live in a stylesheet, a
 * primitives residue file or a Tailwind utility, and moving them must not quietly
 * drop the guarantee.
 */
const allStyleAndFeatureSources: Array<{ path: string; text: string }> = []
for (const styleFile of styleFiles) {
  allStyleAndFeatureSources.push({
    path: workspacePath(styleFile),
    text: await readFile(styleFile, 'utf8'),
  })
}
for (const [scriptFile, script] of featureTokenScriptSources) {
  allStyleAndFeatureSources.push({ path: workspacePath(scriptFile), text: script.source })
}

for (const { path, text } of allStyleAndFeatureSources) {
  if (/animation-timeline/.test(text)) {
    errors.push(`${path} must not use animation-timeline scroll masks`)
  }
  if (/@property\s+--(?:canonical-process|execution-plan)/.test(text)) {
    errors.push(`${path} must not re-add scroll fade @property variables`)
  }
  if (/@keyframes\s+(?:canonical-process-edge-fade|execution-plan-edge-fade)\b/.test(text)) {
    errors.push(`${path} must not re-add scroll fade mask keyframes`)
  }
}

for (const [category, registry] of featureTokenRegistry) {
  for (const [key, entry] of registry) {
    if (!entry.used) errors.push(`stale feature token exception: ${key}`)
  }
}

if (errors.length > 0) {
  console.error('[style-contracts] failed')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(
  `[style-contracts] ok: ${styleFiles.length} style files, ${customPropertyReferences.size} custom property references, ${Object.values(observedImportantDeclarations).reduce((sum, count) => sum + count, 0)} allowlisted !important declarations, ${Object.values(observedDataThemeSelectors).reduce((sum, count) => sum + count, 0)} data-theme selectors, ${Object.values(observedLiteralLineHeights).reduce((sum, count) => sum + count, 0)} allowlisted literal line-heights, ${Object.values(observedTailwindLeading).reduce((sum, count) => sum + count, 0)} allowlisted tw:leading-*, ${featureTokenStyleDeclarations.size} feature style files scanned, ${featureTokenScriptSources.size} feature script files scanned`,
)
