import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type ThemeVariant = 'light' | 'dark' | 'unknown'

type InventoryTheme = {
  slug: string
  name: string
  displayName?: string
  type?: string
  normalizedHash: string
  colorCount: number
  tokenColorCount: number
  recoverability: 'structured' | 'signature'
  physicalFiles: string[]
}

type Inventory = {
  scriptFiles?: Array<{ path: string; sha256: string }>
  highlightThemes?: {
    physicalFiles?: string[]
    logicalThemes?: InventoryTheme[]
  }
}

type ThemeRegistration = Record<string, unknown> & {
  name?: string
  displayName?: string
  type?: string
  colors?: Record<string, string>
  tokenColors?: unknown[]
  settings?: unknown[]
}

const DEFAULT_ASSETS_ROOT = 'E:\\迅雷下载\\Codex\\app_asar_extracted\\webview\\assets'
const DEFAULT_INVENTORY = resolve(
  import.meta.dir,
  '../../../../docs/research/codex-webview-style-inventory.json',
)
const OUTPUT_ROOT = resolve(import.meta.dir, '../shared/themes')
const SHARDS_ROOT = resolve(OUTPUT_ROOT, 'shards')
const EXPECTED_LOGICAL_THEMES = 91
const EXPECTED_PHYSICAL_THEMES = 151
const THEME_SHARD_COUNT = 16

type ThemeFamilyRegistration = {
  id: string
  label: string
  light?: string
  dark?: string
}

// Exact product selector registry recovered from Codex qtn/Jtn. The extracted
// assets contain more Shiki resources, but only these families are user-facing.
const THEME_FAMILIES: readonly ThemeFamilyRegistration[] = [
  { id: 'ayu', label: 'Ayu', dark: 'ayu-dark' },
  { id: 'catppuccin', label: 'Catppuccin', dark: 'catppuccin-mocha', light: 'catppuccin-latte' },
  { id: 'absolutely', label: 'Absolutely', dark: 'absolutely-dark', light: 'absolutely-light' },
  { id: 'codex', label: 'Codex', dark: 'codex-dark', light: 'codex-light' },
  { id: 'dracula', label: 'Dracula', dark: 'dracula' },
  { id: 'everforest', label: 'Everforest', dark: 'everforest-dark', light: 'everforest-light' },
  { id: 'github', label: 'GitHub', dark: 'github-dark-default', light: 'github-light-default' },
  { id: 'gruvbox', label: 'Gruvbox', dark: 'gruvbox-dark-medium', light: 'gruvbox-light-medium' },
  { id: 'linear', label: 'Linear', dark: 'linear-dark', light: 'linear-light' },
  { id: 'lobster', label: 'Lobster', dark: 'lobster-dark' },
  { id: 'material', label: 'Material', dark: 'material-theme-darker' },
  { id: 'matrix', label: 'Matrix', dark: 'matrix-dark' },
  { id: 'monokai', label: 'Monokai', dark: 'monokai' },
  { id: 'night-owl', label: 'Night Owl', dark: 'night-owl' },
  { id: 'nord', label: 'Nord', dark: 'nord' },
  { id: 'notion', label: 'Notion', dark: 'notion-dark', light: 'notion-light' },
  { id: 'oscurange', label: 'Oscurange', dark: 'oscurange' },
  { id: 'one', label: 'One', dark: 'one-dark-pro', light: 'one-light' },
  { id: 'proof', label: 'Proof', light: 'proof-light' },
  { id: 'raycast', label: 'Raycast', dark: 'raycast-dark', light: 'raycast-light' },
  { id: 'rose-pine', label: 'Rose Pine', dark: 'rose-pine-moon', light: 'rose-pine-dawn' },
  { id: 'sentry', label: 'Sentry', dark: 'sentry-dark' },
  { id: 'solarized', label: 'Solarized', dark: 'solarized-dark', light: 'solarized-light' },
  { id: 'tokyo-night', label: 'Tokyo Night', dark: 'tokyo-night' },
  { id: 'temple', label: 'Temple', dark: 'temple-dark' },
  { id: 'vercel', label: 'Vercel', dark: 'vercel-dark', light: 'vercel-light' },
  { id: 'vscode-plus', label: 'VS Code Plus', dark: 'dark-plus', light: 'light-plus' },
  { id: 'xcode', label: 'Xcode', dark: 'xcode-dark', light: 'xcode-light' },
] as const

const args = parseArgs(process.argv.slice(2))
const assetsRoot = resolve(args['assets-root'] ?? DEFAULT_ASSETS_ROOT)
const inventoryPath = resolve(args.inventory ?? DEFAULT_INVENTORY)
const checkOnly = args.check === true

const inventory = JSON.parse(await readUtf8(inventoryPath)) as Inventory
const logicalThemes = inventory.highlightThemes?.logicalThemes
const physicalFiles = inventory.highlightThemes?.physicalFiles
const inventoryHashes = new Map(
  inventory.scriptFiles?.map((file) => [file.path, file.sha256]) ?? [],
)

if (!logicalThemes || !physicalFiles) {
  throw new Error('The inventory does not contain highlight theme evidence.')
}
if (logicalThemes.length !== EXPECTED_LOGICAL_THEMES) {
  throw new Error(
    `Expected ${EXPECTED_LOGICAL_THEMES} logical themes, found ${logicalThemes.length}.`,
  )
}
if (physicalFiles.length !== EXPECTED_PHYSICAL_THEMES) {
  throw new Error(
    `Expected ${EXPECTED_PHYSICAL_THEMES} physical themes, found ${physicalFiles.length}.`,
  )
}

const sortedThemes = [...logicalThemes].sort((left, right) =>
  left.slug.localeCompare(right.slug, 'en'),
)
const slugs = sortedThemes.map((theme) => theme.slug)
if (new Set(slugs).size !== slugs.length) {
  throw new Error('The logical theme inventory contains duplicate slugs.')
}
for (const required of ['codex-light', 'codex-dark']) {
  if (!slugs.includes(required)) {
    throw new Error(`Required theme "${required}" is missing.`)
  }
}

const expectedFiles = new Map<string, string>()
const generatedThemes = new Map<
  string,
  {
    theme: ThemeRegistration
    physicalFiles: Array<{ path: string; sha256: string }>
  }
>()
const metadata: Array<{
  slug: string
  label: string
  variant: ThemeVariant
  normalizedHash: string
  contentHash: string
  recoverability: 'structured' | 'signature'
  physicalFiles: Array<{ path: string; sha256: string }>
}> = []

for (const inventoryTheme of sortedThemes) {
  const sourceFiles = [...inventoryTheme.physicalFiles].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  const primaryPath = resolve(assetsRoot, sourceFiles[0]!)
  const sourceHashes: Array<{ path: string; sha256: string }> = []
  let primarySource = ''
  for (const path of sourceFiles) {
    const bytes = await readFile(resolve(assetsRoot, path))
    const source = decodeUtf8(bytes, path)
    if (path === sourceFiles[0]) primarySource = source
    sourceHashes.push({ path, sha256: inventoryHashes.get(path) ?? sha256(bytes) })
  }

  const importedTheme = await importThemeRegistration(
    primaryPath,
    primarySource,
    sourceHashes[0]!.sha256,
  )
  if (!importedTheme || typeof importedTheme !== 'object') {
    throw new Error(`${sourceFiles[0]} does not export a theme object.`)
  }

  const original = JSON.parse(JSON.stringify(importedTheme)) as ThemeRegistration
  const theme = normalizeTheme(original, inventoryTheme.slug, inventoryTheme.type)
  const variant = normalizeVariant(theme.type)
  const label =
    normalizeLabel(original.displayName) ??
    normalizeLabel(original.name) ??
    normalizeLabel(inventoryTheme.displayName) ??
    normalizeLabel(inventoryTheme.name) ??
    inventoryTheme.slug
  const contentHash = sha256(canonicalJson(theme))
  generatedThemes.set(inventoryTheme.slug, {
    theme,
    physicalFiles: sourceHashes,
  })
  metadata.push({
    slug: inventoryTheme.slug,
    label,
    variant,
    normalizedHash: inventoryTheme.normalizedHash,
    contentHash,
    recoverability: inventoryTheme.recoverability,
    physicalFiles: sourceHashes,
  })
}

const metadataBySlug = new Map(metadata.map((theme) => [theme.slug, theme]))
for (const family of THEME_FAMILIES) {
  for (const variant of ['light', 'dark'] as const) {
    const slug = family[variant]
    if (!slug) continue
    const theme = metadataBySlug.get(slug)
    if (!theme) {
      throw new Error(`Codex selector family "${family.id}" references missing theme "${slug}".`)
    }
    if (theme.variant !== variant) {
      throw new Error(
        `Codex selector family "${family.id}" maps ${variant} to ${theme.variant} theme "${slug}".`,
      )
    }
  }
}

const selectableSlugs = [
  ...new Set(
    THEME_FAMILIES.flatMap((family) =>
      [family.light, family.dark].filter((slug): slug is string => typeof slug === 'string'),
    ),
  ),
].sort((left, right) => left.localeCompare(right, 'en'))
const themeShards = Array.from(
  { length: THEME_SHARD_COUNT },
  () =>
    [] as Array<{
      slug: string
      theme: ThemeRegistration
      physicalFiles: Array<{ path: string; sha256: string }>
    }>,
)
for (const slug of selectableSlugs) {
  const generatedTheme = generatedThemes.get(slug)
  if (!generatedTheme) throw new Error(`Missing selectable theme "${slug}".`)
  themeShards[themeShard(slug)]!.push({ slug, ...generatedTheme })
}
for (const [index, themes] of themeShards.entries()) {
  expectedFiles.set(`shards/Shard${index.toString(16).toUpperCase()}.ts`, renderThemeShard(themes))
}

expectedFiles.set('Manifest.ts', renderManifest(metadata, THEME_FAMILIES))
await synchronizeGeneratedFiles(expectedFiles, checkOnly)

console.log(
  checkOnly
    ? `Codex theme catalog is current: ${THEME_FAMILIES.length} families / ${countSelectableThemes(THEME_FAMILIES)} selectable / ${metadata.length} logical resources / ${physicalFiles.length} physical.`
    : `Generated ${THEME_FAMILIES.length} Codex theme families (${countSelectableThemes(THEME_FAMILIES)} selectable variants) from ${metadata.length} logical / ${physicalFiles.length} physical resources.`,
)

function normalizeTheme(
  original: ThemeRegistration,
  slug: string,
  inventoryType?: string,
): ThemeRegistration {
  const theme = { ...original }
  if (!Array.isArray(theme.tokenColors) && Array.isArray(theme.settings)) {
    theme.tokenColors = theme.settings
  }
  delete theme.settings
  delete theme.displayName
  theme.name = slug

  if (!theme.colors || typeof theme.colors !== 'object') {
    throw new Error(`${slug} does not contain a colors object.`)
  }
  if (!Array.isArray(theme.tokenColors)) {
    throw new Error(`${slug} does not contain tokenColors/settings.`)
  }
  const variant =
    normalizeVariant(theme.type) !== 'unknown'
      ? normalizeVariant(theme.type)
      : normalizeVariant(inventoryType) !== 'unknown'
        ? normalizeVariant(inventoryType)
        : slug.endsWith('-light')
          ? 'light'
          : slug.endsWith('-dark')
            ? 'dark'
            : 'unknown'
  if (variant === 'unknown') {
    throw new Error(`${slug} does not declare a light/dark type.`)
  }
  theme.type = variant
  return sortObject(theme) as ThemeRegistration
}

function renderThemeShard(
  themes: ReadonlyArray<{
    slug: string
    theme: ThemeRegistration
    physicalFiles: Array<{ path: string; sha256: string }>
  }>,
): string {
  const sources = themes
    .flatMap((theme) => theme.physicalFiles.map((source) => source.path))
    .join(', ')
  const rows = themes
    .map(
      ({ slug, theme }) =>
        `  ${JSON.stringify(slug)}: ${JSON.stringify(theme, null, 2).split('\n').join('\n  ')},`,
    )
    .join('\n')
  return `// Generated by scripts/GenerateThemes.ts from ${sources}.
// Do not edit this file manually.
import type { ThemeRegistration } from 'shiki'

export const themes = {
${rows}
} as unknown as Readonly<Record<string, ThemeRegistration>>
`
}

async function importThemeRegistration(
  path: string,
  source: string,
  sourceHash: string,
): Promise<ThemeRegistration | undefined> {
  const generatedMatch = source.match(
    /const theme = ([\s\S]*?) as unknown as ThemeRegistration\s+export default theme/,
  )
  if (generatedMatch?.[1]) {
    return JSON.parse(generatedMatch[1]) as ThemeRegistration
  }
  const imported = (await import(
    `${pathToFileURL(path).href}?codex-theme-generator=${sourceHash}`
  )) as { default?: ThemeRegistration }
  return imported.default
}

function renderManifest(
  themes: ReadonlyArray<(typeof metadata)[number]>,
  families: typeof THEME_FAMILIES,
): string {
  const themesBySlug = new Map(themes.map((theme) => [theme.slug, theme]))
  const selectableThemes = families.flatMap((family) =>
    (['light', 'dark'] as const).flatMap((variant) => {
      const slug = family[variant]
      if (!slug) return []
      const theme = themesBySlug.get(slug)
      if (!theme) throw new Error(`Missing selectable theme "${slug}".`)
      return [{ ...theme, familyId: family.id, label: family.label }]
    }),
  )
  const rows = selectableThemes
    .map(
      (theme) => `  {
    slug: ${JSON.stringify(theme.slug)},
    label: ${JSON.stringify(theme.label)},
    familyId: ${JSON.stringify(theme.familyId)},
    variant: ${JSON.stringify(theme.variant)},
    normalizedHash: ${JSON.stringify(theme.normalizedHash)},
    contentHash: ${JSON.stringify(theme.contentHash)},
    recoverability: ${JSON.stringify(theme.recoverability)},
    physicalFiles: ${JSON.stringify(theme.physicalFiles)},
  },`,
    )
    .join('\n')
  const loaders = selectableThemes
    .map((theme) => {
      const shard = themeShard(theme.slug).toString(16).toUpperCase()
      const missingMessage = `Codex theme shard is missing "${theme.slug}".`
      const expression = `import('./shards/Shard${shard}.js').then(module => {\n    const theme = module.themes[${JSON.stringify(theme.slug)}]\n    if (!theme) throw new Error(${JSON.stringify(missingMessage)})\n    return theme\n  })`
      return `  ${JSON.stringify(theme.slug)}: () => ${expression},`
    })
    .join('\n')
  const familyRows = families
    .map(
      (family) => `  {
    id: ${JSON.stringify(family.id)},
    label: ${JSON.stringify(family.label)},
    themes: {
      light: ${JSON.stringify(family.light ?? null)},
      dark: ${JSON.stringify(family.dark ?? null)},
    },
  },`,
    )
    .join('\n')

  return `// Generated by scripts/GenerateThemes.ts.
// Do not edit this file manually.
import type { ThemeRegistration } from 'shiki'
import { DEFAULT_CHROME_THEMES } from '@pidex/shared/desktop-theme'

export const HIGHLIGHT_THEMES = [
${rows}

  { slug: 'codex-new-light', label: 'Codex(new)', familyId: 'codex-new', variant: 'light' },
  { slug: 'codex-new-dark', label: 'Codex(new)', familyId: 'codex-new', variant: 'dark' },
] as const

export const HIGHLIGHT_THEME_FAMILIES = [
${familyRows}

  { id: 'codex-new', label: 'Codex(new)', themes: { light: 'codex-new-light', dark: 'codex-new-dark' } },
] as const

export type HighlightThemeSlug =
  (typeof HIGHLIGHT_THEMES)[number]['slug']
export type HighlightThemeVariant =
  (typeof HIGHLIGHT_THEMES)[number]['variant']

const HIGHLIGHT_THEME_SLUGS = new Set<string>(
  HIGHLIGHT_THEMES.map(theme => theme.slug),
)

const HIGHLIGHT_THEME_LOADERS: Record<
  Exclude<HighlightThemeSlug, 'codex-new-light' | 'codex-new-dark'>,
  () => Promise<ThemeRegistration>
> = {
${loaders}
}

export function isHighlightThemeSlug(
  value: unknown,
): value is HighlightThemeSlug {
  return (
    typeof value === 'string' &&
    HIGHLIGHT_THEME_SLUGS.has(value)
  )
}

export function loadHighlightTheme(
  slug: HighlightThemeSlug,
): Promise<ThemeRegistration> {
  if (slug === 'codex-new-light' || slug === 'codex-new-dark') {
    const variant = slug === 'codex-new-light' ? 'light' : 'dark'
    return HIGHLIGHT_THEME_LOADERS[variant === 'light' ? 'codex-light' : 'codex-dark']().then(theme => ({
      ...theme,
      name: slug,
      colors: {
        ...theme.colors,
        'editor.background': DEFAULT_CHROME_THEMES[variant].surface,
        'editor.foreground': DEFAULT_CHROME_THEMES[variant].ink,
      },
      chromeTheme: {
        accent: DEFAULT_CHROME_THEMES[variant].accent,
        surface: DEFAULT_CHROME_THEMES[variant].surface,
        ink: DEFAULT_CHROME_THEMES[variant].ink,
        contrast: DEFAULT_CHROME_THEMES[variant].contrast,
        semanticColors: DEFAULT_CHROME_THEMES[variant].semanticColors,
      },
    }))
  }
  return HIGHLIGHT_THEME_LOADERS[slug]()
}
`
}

function themeShard(slug: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < slug.length; index += 1) {
    hash ^= slug.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % THEME_SHARD_COUNT
}

function countSelectableThemes(families: typeof THEME_FAMILIES): number {
  return families.reduce(
    (count, family) => count + Number(Boolean(family.light)) + Number(Boolean(family.dark)),
    0,
  )
}

async function synchronizeGeneratedFiles(
  expected: Map<string, string>,
  check: boolean,
): Promise<void> {
  const currentPaths = await listGeneratedFiles()
  const expectedPaths = [...expected.keys()].sort()
  const stale = new Set<string>()

  for (const path of expectedPaths) {
    const current = await readUtf8(resolve(OUTPUT_ROOT, path)).catch(() => '')
    if (current !== expected.get(path)) stale.add(path)
  }
  for (const path of currentPaths) {
    if (!expected.has(path)) stale.add(path)
  }

  if (check && stale.size > 0) {
    throw new Error(`Codex theme catalog is out of date: ${[...stale].sort().join(', ')}`)
  }
  if (check || stale.size === 0) return

  await rm(OUTPUT_ROOT, { recursive: true, force: true })
  await mkdir(SHARDS_ROOT, { recursive: true })
  for (const [path, contents] of expected) {
    const destination = resolve(OUTPUT_ROOT, path)
    await mkdir(resolve(destination, '..'), { recursive: true })
    await writeFile(destination, contents, 'utf8')
  }
}

async function listGeneratedFiles(): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string, prefix = ''): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await visit(resolve(directory, entry.name), relative)
      } else {
        files.push(relative)
      }
    }
  }
  await visit(OUTPUT_ROOT)
  return files.sort()
}

function parseArgs(values: string[]): Record<string, string | true> {
  const result: Record<string, string | true> = {}
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index]!
    if (argument === '--check') {
      result.check = true
      continue
    }
    if (argument === '--assets-root' || argument === '--inventory') {
      const value = values[index + 1]
      if (!value) throw new Error(`${argument} requires a value.`)
      result[argument.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return result
}

async function readUtf8(path: string): Promise<string> {
  const bytes = await readFile(path)
  return decodeUtf8(bytes, path)
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`Invalid UTF-8: ${basename(path)}`)
  }
}

function normalizeVariant(value: unknown): ThemeVariant {
  return value === 'light' || value === 'dark' ? value : 'unknown'
}

function normalizeLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, sortObject(child)]),
    )
  }
  return value
}
