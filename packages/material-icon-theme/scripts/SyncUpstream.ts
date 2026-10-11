import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const upstreamVersion = '5.37.0'
const upstreamUrl =
  'https://registry.npmjs.org/material-icon-theme/-/material-icon-theme-5.37.0.tgz'
const upstreamSha512 =
  'fc5e6594e554d0367cf15fb098f9446c1aa2f05a1c84f8395da27bcea5731824d3ca07859e92297554104d11251271f2c5259131f174c016ceab014a9ee8c52c'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDirectory = join(packageRoot, 'src', 'icons')
const generatedDirectory = join(packageRoot, 'src', 'generated')
// React 渲染部分只服务桌面端，生成到 renderer，使共享包不再依赖 React。
const rendererIconsDirectory = resolve(
  packageRoot,
  '..',
  '..',
  'apps',
  'desktop',
  'renderer',
  'src',
  'features',
  'layout',
  'material-icons',
)
/**
 * 生成产物所在目录，以及每个目录里「哪些文件名属于生成产物」。
 * renderer 目录与手写组件共存，因此不能用「目录内多余文件」判定。
 */
const outputRoots = [
  { directory: iconsDirectory, isGenerated: (name: string) => /\.tsx?$/.test(name) },
  {
    directory: rendererIconsDirectory,
    isGenerated: (name: string) =>
      /^Shard[0-9A-F]+\.ts$/.test(name) || /^(Index|Loaders)\.ts$/.test(name),
  },
] as const
const check = process.argv.includes('--check')
const iconShardCount = 16

interface UpstreamManifest {
  iconDefinitions: Record<string, { iconPath: string }>
  fileNames: Record<string, string>
  fileExtensions: Record<string, string>
  languageIds: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  rootFolderNames: Record<string, string>
  rootFolderNamesExpanded: Record<string, string>
  file: string
  folder: string
  folderExpanded: string
  rootFolder: string
  rootFolderExpanded: string
}

interface GeneratedFile {
  /** 绝对路径：生成产物分布在包内与 renderer 两个目录。 */
  path: string
  content: string
}

const temporaryRoots: string[] = []

try {
  const upstreamRoot = await resolveUpstreamRoot()
  const manifest = JSON.parse(
    await readFile(join(upstreamRoot, 'dist', 'material-icons.json'), 'utf8'),
  ) as UpstreamManifest
  const generated = await generateFiles(upstreamRoot, manifest)

  if (check) {
    await checkGeneratedFiles(generated)
    console.log(
      `material-icon-theme@${upstreamVersion}: ${Object.keys(manifest.iconDefinitions).length} icon definitions are current`,
    )
  } else {
    await writeGeneratedFiles(generated)
    console.log(
      `material-icon-theme@${upstreamVersion}: generated ${Object.keys(manifest.iconDefinitions).length} monochrome React icons`,
    )
  }
} finally {
  await Promise.all(temporaryRoots.map((path) => rm(path, { recursive: true, force: true })))
}

async function resolveUpstreamRoot(): Promise<string> {
  const configured = process.env.MATERIAL_ICON_THEME_ROOT
  const candidates = [
    configured,
    join(packageRoot, 'node_modules', 'material-icon-theme'),
    join(packageRoot, '..', '..', 'node_modules', 'material-icon-theme'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const packageJsonPath = join(candidate, 'package.json')
    if (!existsSync(packageJsonPath)) continue
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: string }
    if (packageJson.version !== upstreamVersion) {
      throw new Error(
        `Expected material-icon-theme@${upstreamVersion}, found ${packageJson.version ?? 'unknown'} at ${candidate}`,
      )
    }
    return candidate
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pidex-material-icon-theme-'))
  temporaryRoots.push(temporaryRoot)
  const archivePath = join(temporaryRoot, 'upstream.tgz')
  const response = await fetch(upstreamUrl)
  if (!response.ok) {
    throw new Error(`Unable to download ${upstreamUrl}: ${response.status} ${response.statusText}`)
  }
  const archive = Buffer.from(await response.arrayBuffer())
  const hash = createHash('sha512').update(archive).digest('hex')
  if (hash !== upstreamSha512) {
    throw new Error(`Checksum mismatch for material-icon-theme@${upstreamVersion}`)
  }
  await writeFile(archivePath, archive)
  await extractTar(gunzipSync(archive), temporaryRoot)
  return join(temporaryRoot, 'package')
}

async function extractTar(archive: Uint8Array, destination: string): Promise<void> {
  const decoder = new TextDecoder()
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readTarString(decoder, header.subarray(0, 100))
    const prefix = readTarString(decoder, header.subarray(345, 500))
    const path = prefix ? `${prefix}/${name}` : name
    const sizeText = readTarString(decoder, header.subarray(124, 136)).trim()
    const size = Number.parseInt(sizeText || '0', 8)
    if (!Number.isFinite(size) || size < 0) throw new Error('Invalid tar entry')
    const bodyOffset = offset + 512
    const type = header[156]

    if (type === 0 || type === 48) {
      const target = resolve(destination, path.replaceAll('/', sep))
      const safeRoot = `${resolve(destination)}${sep}`
      if (!target.startsWith(safeRoot)) {
        throw new Error(`Unsafe tar entry: ${path}`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, archive.subarray(bodyOffset, bodyOffset + size))
    }
    offset = bodyOffset + Math.ceil(size / 512) * 512
  }
}

function readTarString(decoder: TextDecoder, value: Uint8Array): string {
  const end = value.indexOf(0)
  return decoder.decode(end >= 0 ? value.subarray(0, end) : value)
}

async function generateFiles(
  upstreamRoot: string,
  manifest: UpstreamManifest,
): Promise<GeneratedFile[]> {
  const definitions = Object.entries(manifest.iconDefinitions).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const generated: GeneratedFile[] = []
  const shardDefinitions = Array.from(
    { length: iconShardCount },
    () =>
      [] as Array<{
        iconName: string
        componentName: string
        viewBox: string
        body: string
      }>,
  )

  for (const [iconName, definition] of definitions) {
    const sourcePath = resolve(upstreamRoot, 'dist', definition.iconPath.replaceAll('/', '\\'))
    const rawSvg = await readFile(sourcePath, 'utf8')
    const { viewBox, body } = monochromeSvg(rawSvg)
    const componentName = toComponentName(iconName)
    shardDefinitions[iconShard(iconName)].push({
      iconName,
      componentName,
      viewBox,
      body,
    })
  }

  // 包侧只保留纯数据：names 供类型与解析使用，React 部分生成到 renderer。
  generated.push({
    path: join(iconsDirectory, 'index.ts'),
    content: `${generatedHeader()}export { iconNames, type IconName } from "./Names"
`,
  })
  generated.push({
    path: join(iconsDirectory, 'Names.ts'),
    content: `${generatedHeader()}export const iconNames = ${JSON.stringify(
      definitions.map(([name]) => name),
      null,
      2,
    )} as const

export type IconName = (typeof iconNames)[number]
`,
  })
  for (const [shardIndex, shard] of shardDefinitions.entries()) {
    const entries = shard.map(
      ({ iconName, componentName, viewBox, body }) =>
        `  ${JSON.stringify(iconName)}: createMaterialIcon(\n    ${JSON.stringify(componentName)},\n    ${JSON.stringify(viewBox)},\n    ${JSON.stringify(body)},\n  ),`,
    )
    generated.push({
      path: join(rendererIconsDirectory, `Shard${shardIndex.toString(16).toUpperCase()}.ts`),
      content: `${generatedHeader()}import { createMaterialIcon } from "./CreateIcon"

export const iconComponents = {
${entries.join('\n')}
} as const
`,
    })
  }
  generated.push({
    path: join(rendererIconsDirectory, 'Loaders.ts'),
    content: generatedShardLoaders(),
  })
  generated.push({
    path: join(rendererIconsDirectory, 'Index.ts'),
    content: `${generatedHeader()}export { createMaterialIcon } from "./CreateIcon"
export type { MaterialSvgIconProps } from "./CreateIcon"
export { iconShard, loadIconShard, type IconComponent, type IconShard } from "./Loaders"
`,
  })
  generated.push({
    path: join(generatedDirectory, 'Manifest.ts'),
    content: generatedManifest(manifest),
  })
  return generated
}

function iconShard(iconName: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < iconName.length; index += 1) {
    hash ^= iconName.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % iconShardCount
}

function generatedShardLoaders(): string {
  const loaders = Array.from(
    { length: iconShardCount },
    (_, index) => `  () => import("./Shard${index.toString(16).toUpperCase()}"),`,
  )
  return `${generatedHeader()}import type { ComponentType } from "react"
import type { MaterialSvgIconProps } from "./CreateIcon"
import type { IconName } from "@pidex/material-icon-theme"

export type IconComponent = ComponentType<MaterialSvgIconProps>
export type IconShard = Readonly<Partial<Record<IconName, IconComponent>>>

const shardLoaders = [
${loaders.join('\n')}
] as const

export function iconShard(iconName: IconName): number {
  let hash = 2_166_136_261
  for (let index = 0; index < iconName.length; index += 1) {
    hash ^= iconName.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) % shardLoaders.length
}

export async function loadIconShard(iconName: IconName): Promise<IconShard> {
  const module = await shardLoaders[iconShard(iconName)]()
  return module.iconComponents as IconShard
}
`
}

function monochromeSvg(rawSvg: string): { viewBox: string; body: string } {
  const match = rawSvg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>\s*$/i)
  if (!match) throw new Error('Invalid upstream SVG')
  const viewBox = match[1].match(/\bviewBox=(["'])(.*?)\1/i)?.[2] ?? '0 0 32 32'
  const body = match[2]
    .replace(/<path\b[^>]*\bfill=(["'])(?:none|transparent)\1[^>]*\/?>/gi, '')
    .replace(/<path\b[^>]*\bd=(["'])M0\s*0h\d+v\d+H0z?\1[^>]*\/?>/gi, '')
    .replace(
      /\b(fill|stroke|color|stop-color|flood-color|lighting-color)=(["'])(?!none\b|transparent\b)[^"']*\2/gi,
      (_attribute, name: string, quote: string) => `${name}=${quote}currentColor${quote}`,
    )
    .replace(
      /\b(fill|stroke|color|stop-color|flood-color|lighting-color|solid-color|text-decoration-color)\s*:\s*(?!none\b|transparent\b)[^;}"]+/gi,
      '$1:currentColor',
    )
  return { viewBox, body }
}

function generatedManifest(manifest: UpstreamManifest): string {
  const mappings = [
    ['fileNames', manifest.fileNames],
    ['fileExtensions', manifest.fileExtensions],
    ['languageIds', manifest.languageIds],
    ['folderNames', manifest.folderNames],
    ['folderNamesExpanded', manifest.folderNamesExpanded],
    ['rootFolderNames', manifest.rootFolderNames],
    ['rootFolderNamesExpanded', manifest.rootFolderNamesExpanded],
  ] as const
  const declarations = mappings.map(
    ([name, value]) =>
      `export const ${name}: Readonly<Record<string, IconName>> = ${JSON.stringify(normalizeMapping(value), null, 2)}\n`,
  )

  return `${generatedHeader()}import type { IconName } from "../icons"

${declarations.join('\n')}
export const defaultIconNames = ${JSON.stringify(
    {
      file: manifest.file,
      folder: manifest.folder,
      folderExpanded: manifest.folderExpanded,
      rootFolder: manifest.rootFolder,
      rootFolderExpanded: manifest.rootFolderExpanded,
    },
    null,
    2,
  )} as const satisfies Readonly<Record<string, IconName>>
`
}

function normalizeMapping(mapping: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping)
      .map(([key, value]) => [key.replaceAll('\\', '/').toLowerCase(), value])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function toComponentName(iconName: string): string {
  const body = iconName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')
  const safeBody = /^\d/.test(body) ? `Icon${body}` : body
  return `${safeBody}Icon`
}

function generatedHeader(): string {
  return `// Generated from material-icon-theme@${upstreamVersion} by scripts/SyncUpstream.ts.
// Do not edit directly.

`
}

async function writeGeneratedFiles(files: GeneratedFile[]): Promise<void> {
  for (const { directory, isGenerated } of outputRoots) {
    await mkdir(directory, { recursive: true })
    const expected = new Set(
      files
        .filter((file) => dirname(file.path) === directory)
        .map((file) => file.path.split(/[\\/]/).at(-1)),
    )
    for (const name of await readdir(directory)) {
      if (isGenerated(name) && !expected.has(name)) await rm(join(directory, name))
    }
  }
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.content, 'utf8')
  }
}

async function checkGeneratedFiles(files: GeneratedFile[]): Promise<void> {
  const failures: string[] = []
  for (const file of files) {
    let actual: string
    try {
      actual = await readFile(file.path, 'utf8')
    } catch {
      failures.push(`${relativeToRepo(file.path)} is missing`)
      continue
    }
    if (actual.replaceAll('\r\n', '\n') !== file.content.replaceAll('\r\n', '\n'))
      failures.push(`${relativeToRepo(file.path)} is stale`)
  }

  for (const { directory, isGenerated } of outputRoots) {
    const expected = new Set(
      files
        .filter((file) => dirname(file.path) === directory)
        .map((file) => file.path.split(/[\\/]/).at(-1)),
    )
    for (const name of await readdir(directory)) {
      if (isGenerated(name) && !expected.has(name)) {
        failures.push(
          `${relativeToRepo(join(directory, name))} is not generated by the pinned upstream`,
        )
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Generated files are not current:\n- ${failures.join('\n- ')}`)
  }
}

/** 生成产物可能落在 renderer 目录，报错时统一用相对仓库的路径。 */
function relativeToRepo(target: string): string {
  return target.slice(packageRoot.length).replaceAll('\\', '/').replace(/^\//, '')
}
