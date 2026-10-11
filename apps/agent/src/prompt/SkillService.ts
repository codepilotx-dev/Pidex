import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillSelection } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'

const COMPATIBILITY_DIRS = ['.pidex', '.agents', '.codex', '.claude'] as const
const USER_COMPATIBILITY_DIRS = ['.agents', '.codex', '.claude'] as const
const MAX_SKILL_BYTES = 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })
const skillNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export interface SkillMetadata {
  name: string
  description: string
  path: string
  root: string
  origin: 'workspace' | 'user' | 'builtin'
  format: 'pidex' | 'agents' | 'codex' | 'claude'
  /** Public identity. Built-in Skills deliberately use a stable builtin:// URI. */
  hash: string
  metadata: Record<string, unknown>
  allowedTools?: string[]
  /** Canonical on-disk SKILL.md path used only inside the Agent process. */
  documentPath: string
}

export interface LoadedSkill extends SkillMetadata {
  content: string
  body: string
}

export interface SkillCatalog {
  skills: SkillMetadata[]
  shadowed: Array<{ name: string; selectedPath: string; ignoredPath: string }>
}

export interface SkillScanOptions {
  workspaceRoot: string
  dataRoot: string
  userHome: string
  includeWorkspace?: boolean
  /** Read-only root containing application-provided Skills. */
  builtinSkillsRoot?: string
  /** Read-only Skill roots contributed by enabled plugins. */
  pluginSkillRoots?: readonly PluginSkillRoot[]
}

export type SkillServiceOptions = {
  enabled?: (skill: SkillMetadata) => boolean
  builtinSkillsRoot?: string
  /**
   * Enabled plugin Skill roots. The current workspace is passed so project
   * plugins only contribute for project chats; projectless chats load the
   * global sources only.
   */
  pluginSkillRoots?: (workspaceRoot?: string) => Promise<readonly PluginSkillRoot[]>
}

export type PluginSkillRoot = {
  pluginId: string
  pluginRoot: string
  skillsRoot: string
}

export type SkillSearchResult =
  | {
      ok: true
      name: string
      path: string
      root: string
      origin: SkillMetadata['origin']
      format: string
    }
  | {
      ok: false
      name?: string
      path: string
      root: string
      error:
        | 'SKILL_PARSE_FAILED'
        | 'SKILL_METADATA_INVALID'
        | 'SKILL_READ_FAILED'
        | 'SKILL_SIZE_EXCEEDED'
    }

export type SkillSearchDiagnostics = {
  results: SkillSearchResult[]
  failedCount: number
  successfulCount: number
}

const contained = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const missing = (cause: unknown) =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'
const builtinSkillPath = (directory: string) => `builtin://${directory}/SKILL.md`
const pluginSkillPath = (pluginId: string, directory: string) =>
  `plugin://${pluginId}/skills/${directory}/SKILL.md`

export const parseSkillDocument = (content: string) => {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n'))
    return { metadata: {}, body: content }
  const normalized = content.replace(/\r\n/g, '\n')
  const rest = normalized.slice(4)
  const closing = /^---[ \t]*$/m.exec(rest)
  if (!closing || closing.index < 0) throw new Error('SKILL.md frontmatter 缺少结束分隔符')
  const parsed = parseYaml(rest.slice(0, closing.index), { maxAliasCount: 0 })
  if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed)))
    throw new Error('SKILL.md frontmatter 必须是 YAML mapping')
  const metadata = (parsed ?? {}) as Record<string, unknown>
  const bodyStart = closing.index + closing[0].length
  return { metadata, body: rest.slice(bodyStart).replace(/^\n/, '') }
}

const parseAllowedTools = (metadata: Record<string, unknown>) => {
  const value = metadata.allowedTools ?? metadata['allowed-tools']
  const tools = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const normalized = [
    ...new Set(tools.map((tool) => (typeof tool === 'string' ? tool.trim() : '')).filter(Boolean)),
  ]
  return normalized.length ? normalized : undefined
}

export class SkillService {
  private catalog = new Map<string, SkillMetadata>()
  private catalogCache: {
    hash: string
    skills: SkillMetadata[]
    shadowed: SkillCatalog['shadowed']
  } | null = null
  /** Successfully read skills, tracked so a composition can freeze referenced-only evidence. */
  private referenced = new Map<string, { name: string; hash: string }>()
  /** Workspace of the last scan; plugin root revalidation must use the same scope. */
  private scannedWorkspace: string | undefined

  constructor(private readonly options: SkillServiceOptions = {}) {}

  private builtinSkillsRoot(options?: SkillScanOptions): string | undefined {
    return options?.builtinSkillsRoot ?? this.options.builtinSkillsRoot
  }

  private computeRootsHash(
    workspace: string,
    dataRoot: string,
    userHome: string,
    builtinSkillsRoot: string | undefined,
    pluginSkillRoots: readonly PluginSkillRoot[],
  ): string {
    const pluginRoots = pluginSkillRoots
      .map((root) => `${root.pluginId}:${root.pluginRoot}:${root.skillsRoot}`)
      .join('|')
    return sha256(
      new TextEncoder().encode(
        `${workspace}:${dataRoot}:${userHome}:${builtinSkillsRoot ?? ''}:${pluginRoots}`,
      ),
    )
  }

  private async pluginSkillRoots(options: SkillScanOptions): Promise<readonly PluginSkillRoot[]> {
    return (
      options.pluginSkillRoots ??
      (await this.options.pluginSkillRoots?.(
        options.includeWorkspace === false ? undefined : options.workspaceRoot,
      )) ??
      []
    )
  }

  /** Plugin roots revalidate against the workspace scope this service was scanned with. */
  private async enabledInstancePluginRoots(): Promise<readonly PluginSkillRoot[]> {
    return (await this.options.pluginSkillRoots?.(this.scannedWorkspace)) ?? []
  }

  async skill_search(query: string, limit?: number): Promise<SkillSearchDiagnostics> {
    const roots = await this.locateSkillRoots(this.promptStorageOptions())
    const results: SkillSearchResult[] = []
    let failedCount = 0
    let successfulCount = 0

    for (const base of roots) {
      const entries = await readdir(base.canonicalSkillsRoot, { withFileTypes: true }).catch(
        () => [],
      )
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const name = entry.name
        if (name.length > 63 || !skillNamePattern.test(name)) continue
        if (query && !name.toLowerCase().includes(query.toLowerCase())) continue

        const directory = await realpath(join(base.canonicalSkillsRoot, entry.name)).catch(
          () => null,
        )
        if (!directory || !contained(base.canonicalSkillsRoot, directory)) continue

        const documentPath = join(directory, 'SKILL.md')
        let canonicalDocument: string
        try {
          canonicalDocument = await realpath(documentPath)
        } catch {
          results.push({
            ok: false,
            name,
            path: documentPath,
            root: directory,
            error: 'SKILL_READ_FAILED',
          })
          failedCount++
          continue
        }
        if (!contained(directory, canonicalDocument)) continue

        try {
          const bytes = await readFile(canonicalDocument)
          if (bytes.byteLength > MAX_SKILL_BYTES) {
            results.push({
              ok: false,
              name,
              path: canonicalDocument,
              root: directory,
              error: 'SKILL_SIZE_EXCEEDED',
            })
            failedCount++
            continue
          }
          const content = decoder.decode(bytes)
          const parsed = parseSkillDocument(content)
          const declaredName = parsed.metadata.name
          const skillName =
            typeof declaredName === 'string' && declaredName ? declaredName : entry.name
          if (!skillNamePattern.test(skillName)) {
            results.push({
              ok: false,
              name: skillName,
              path: canonicalDocument,
              root: directory,
              error: 'SKILL_METADATA_INVALID',
            })
            failedCount++
            continue
          }
          results.push({
            ok: true,
            name: skillName,
            path: base.publicPath?.(entry.name) ?? canonicalDocument,
            root: directory,
            origin: base.origin,
            format: base.format,
          })
          successfulCount++
        } catch {
          results.push({
            ok: false,
            name,
            path: canonicalDocument,
            root: directory,
            error: 'SKILL_PARSE_FAILED',
          })
          failedCount++
        }

        if (limit && results.length >= limit) break
      }
      if (limit && results.length >= limit) break
    }

    return { results: results.slice(0, limit), failedCount, successfulCount }
  }

  async search(query: string, options?: SkillScanOptions): Promise<SkillSearchDiagnostics> {
    const opts = options ?? this.promptStorageOptions()
    const roots = await this.locateSkillRoots(opts)
    const results: SkillSearchResult[] = []
    let failedCount = 0
    let successfulCount = 0

    for (const base of roots) {
      const entries = await readdir(base.canonicalSkillsRoot, { withFileTypes: true }).catch(
        () => [],
      )
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const name = entry.name
        if (name.length > 63 || !skillNamePattern.test(name)) continue
        if (query && !name.toLowerCase().includes(query.toLowerCase())) continue

        const directory = await realpath(join(base.canonicalSkillsRoot, entry.name)).catch(
          () => null,
        )
        if (!directory || !contained(base.canonicalSkillsRoot, directory)) continue

        const documentPath = join(directory, 'SKILL.md')
        let canonicalDocument: string
        try {
          canonicalDocument = await realpath(documentPath)
        } catch {
          results.push({
            ok: false,
            name,
            path: documentPath,
            root: directory,
            error: 'SKILL_READ_FAILED',
          })
          failedCount++
          continue
        }
        if (!contained(directory, canonicalDocument)) continue

        try {
          const bytes = await readFile(canonicalDocument)
          if (bytes.byteLength > MAX_SKILL_BYTES) {
            results.push({
              ok: false,
              name,
              path: canonicalDocument,
              root: directory,
              error: 'SKILL_SIZE_EXCEEDED',
            })
            failedCount++
            continue
          }
          const content = decoder.decode(bytes)
          const parsed = parseSkillDocument(content)
          const declaredName = parsed.metadata.name
          const skillName =
            typeof declaredName === 'string' && declaredName ? declaredName : entry.name
          if (!skillNamePattern.test(skillName)) {
            results.push({
              ok: false,
              name: skillName,
              path: canonicalDocument,
              root: directory,
              error: 'SKILL_METADATA_INVALID',
            })
            failedCount++
            continue
          }
          results.push({
            ok: true,
            name: skillName,
            path: base.publicPath?.(entry.name) ?? canonicalDocument,
            root: directory,
            origin: base.origin,
            format: base.format,
          })
          successfulCount++
        } catch {
          results.push({
            ok: false,
            name,
            path: canonicalDocument,
            root: directory,
            error: 'SKILL_PARSE_FAILED',
          })
          failedCount++
        }
      }
    }

    return { results, failedCount, successfulCount }
  }

  async scan(options: SkillScanOptions): Promise<SkillCatalog> {
    const workspace = await realpath(resolve(options.workspaceRoot))
    const dataRoot = await realpath(resolve(options.dataRoot))
    const userHome = await realpath(resolve(options.userHome))
    const builtinSkillsRoot = this.builtinSkillsRoot(options)
    const pluginSkillRoots = await this.pluginSkillRoots(options)
    this.scannedWorkspace = options.includeWorkspace === false ? undefined : options.workspaceRoot
    const rootsHash = this.computeRootsHash(
      workspace,
      dataRoot,
      userHome,
      builtinSkillsRoot,
      pluginSkillRoots,
    )

    if (this.catalogCache?.hash === rootsHash) {
      const filtered = this.catalogCache.skills.filter((s) => this.options.enabled?.(s) !== false)
      return { skills: filtered, shadowed: this.catalogCache.shadowed }
    }

    const found = new Map<string, SkillMetadata>()
    const shadowed: SkillCatalog['shadowed'] = []
    const configuredBases: Array<{
      containmentRoot: string
      skillsRoot: string
      origin: SkillMetadata['origin']
      format: SkillMetadata['format']
      publicPath?: (directory: string) => string
    }> = [
      ...(options.includeWorkspace === false
        ? []
        : COMPATIBILITY_DIRS.map((compatibilityDir) => ({
            containmentRoot: workspace,
            skillsRoot: join(workspace, compatibilityDir, 'skills'),
            origin: 'workspace' as const,
            format: compatibilityDir.slice(1) as SkillMetadata['format'],
          }))),
      {
        containmentRoot: dataRoot,
        skillsRoot: join(dataRoot, 'skills'),
        origin: 'user' as const,
        format: 'pidex' as const,
      },
      ...USER_COMPATIBILITY_DIRS.map((compatibilityDir) => ({
        containmentRoot: userHome,
        skillsRoot: join(userHome, compatibilityDir, 'skills'),
        origin: 'user' as const,
        format: compatibilityDir.slice(1) as SkillMetadata['format'],
      })),
      ...(builtinSkillsRoot
        ? [
            {
              containmentRoot: builtinSkillsRoot,
              skillsRoot: builtinSkillsRoot,
              origin: 'builtin' as const,
              format: 'pidex' as const,
              publicPath: builtinSkillPath,
            },
          ]
        : []),
      ...pluginSkillRoots.map((plugin) => ({
        containmentRoot: plugin.pluginRoot,
        skillsRoot: plugin.skillsRoot,
        origin: 'builtin' as const,
        format: 'codex' as const,
        publicPath: (directory: string) => pluginSkillPath(plugin.pluginId, directory),
      })),
    ]

    const bases: Array<
      (typeof configuredBases)[number] & {
        canonicalSkillsRoot: string
      }
    > = []
    for (const base of configuredBases) {
      let canonicalSkillsRoot: string
      try {
        canonicalSkillsRoot = await realpath(base.skillsRoot)
      } catch (cause) {
        if (missing(cause)) continue
        throw cause
      }
      if (!contained(base.containmentRoot, canonicalSkillsRoot))
        throw new Error(`Skills 根目录逃出配置根: ${base.skillsRoot}`)
      bases.push({ ...base, canonicalSkillsRoot })
    }

    const trustedSkillsRoots = bases.map((base) => base.canonicalSkillsRoot)
    for (const base of bases) {
      const canonicalSkillsRoot = base.canonicalSkillsRoot
      let entries
      try {
        entries = (await readdir(canonicalSkillsRoot, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        let directory: string
        try {
          directory = await realpath(join(canonicalSkillsRoot, entry.name))
        } catch {
          continue
        }
        if (!contained(canonicalSkillsRoot, directory)) {
          if (trustedSkillsRoots.some((root) => contained(root, directory))) continue
          throw new Error('Skill 目录逃出 Skills 根')
        }
        const documentPath = join(directory, 'SKILL.md')
        let canonicalDocument: string
        try {
          canonicalDocument = await realpath(documentPath)
        } catch (cause) {
          if (missing(cause)) continue
          continue
        }
        if (!contained(directory, canonicalDocument)) continue
        let bytes: Uint8Array
        try {
          bytes = await readFile(canonicalDocument)
        } catch {
          continue
        }
        if (bytes.byteLength > MAX_SKILL_BYTES) continue
        let content: string
        try {
          content = decoder.decode(bytes)
        } catch {
          continue
        }
        let parsed: ReturnType<typeof parseSkillDocument>
        try {
          parsed = parseSkillDocument(content)
        } catch {
          continue
        }
        const declaredName = parsed.metadata.name
        const name = typeof declaredName === 'string' && declaredName ? declaredName : entry.name
        if (!skillNamePattern.test(name)) continue
        const declaredDescription = parsed.metadata.description
        const description = typeof declaredDescription === 'string' ? declaredDescription : ''
        const allowedTools = parseAllowedTools(parsed.metadata)
        const metadata: SkillMetadata = {
          name,
          description,
          path: base.publicPath?.(entry.name) ?? canonicalDocument,
          root: directory,
          origin: base.origin,
          format: base.format,
          hash: sha256(bytes),
          metadata: parsed.metadata,
          documentPath: canonicalDocument,
          ...(allowedTools ? { allowedTools } : {}),
        }
        const current = found.get(name)
        if (current)
          shadowed.push({
            name,
            selectedPath: current.path,
            ignoredPath: metadata.path,
          })
        else found.set(name, metadata)
      }
    }
    this.catalog = new Map(
      [...found].filter(([, skill]) => this.options.enabled?.(skill) !== false),
    )
    this.referenced.clear()
    const skills = [...this.catalog.values()]
    this.catalogCache = { hash: rootsHash, skills, shadowed }
    return { skills, shadowed }
  }

  private promptStorageOptions(): SkillScanOptions {
    return {
      workspaceRoot: process.cwd(),
      dataRoot: '',
      userHome: '',
      ...(this.options.builtinSkillsRoot
        ? { builtinSkillsRoot: this.options.builtinSkillsRoot }
        : {}),
    }
  }

  private async locateSkillRoots(options: SkillScanOptions) {
    const workspace = await realpath(resolve(options.workspaceRoot))
    const dataRoot = await realpath(resolve(options.dataRoot))
    const userHome = await realpath(resolve(options.userHome))
    const builtinSkillsRoot = this.builtinSkillsRoot(options)
    const pluginSkillRoots = await this.pluginSkillRoots(options)
    const configuredBases: Array<{
      containmentRoot: string
      skillsRoot: string
      origin: SkillMetadata['origin']
      format: SkillMetadata['format']
      publicPath?: (directory: string) => string
    }> = [
      ...(options.includeWorkspace === false
        ? []
        : COMPATIBILITY_DIRS.map((compatibilityDir) => ({
            containmentRoot: workspace,
            skillsRoot: join(workspace, compatibilityDir, 'skills'),
            origin: 'workspace' as const,
            format: compatibilityDir.slice(1) as SkillMetadata['format'],
          }))),
      {
        containmentRoot: dataRoot,
        skillsRoot: join(dataRoot, 'skills'),
        origin: 'user' as const,
        format: 'pidex' as const,
      },
      ...USER_COMPATIBILITY_DIRS.map((compatibilityDir) => ({
        containmentRoot: userHome,
        skillsRoot: join(userHome, compatibilityDir, 'skills'),
        origin: 'user' as const,
        format: compatibilityDir.slice(1) as SkillMetadata['format'],
      })),
      ...(builtinSkillsRoot
        ? [
            {
              containmentRoot: builtinSkillsRoot,
              skillsRoot: builtinSkillsRoot,
              origin: 'builtin' as const,
              format: 'pidex' as const,
              publicPath: builtinSkillPath,
            },
          ]
        : []),
      ...pluginSkillRoots.map((plugin) => ({
        containmentRoot: plugin.pluginRoot,
        skillsRoot: plugin.skillsRoot,
        origin: 'builtin' as const,
        format: 'codex' as const,
        publicPath: (directory: string) => pluginSkillPath(plugin.pluginId, directory),
      })),
    ]

    const bases: Array<(typeof configuredBases)[number] & { canonicalSkillsRoot: string }> = []
    for (const base of configuredBases) {
      try {
        const canonicalSkillsRoot = await realpath(base.skillsRoot)
        if (contained(base.containmentRoot, canonicalSkillsRoot)) {
          bases.push({ ...base, canonicalSkillsRoot })
        }
      } catch {
        continue
      }
    }
    return bases
  }

  list(): SkillMetadata[] {
    return [...this.catalog.values()]
  }

  /** Resolves explicit `$name` and `/name` invocations without treating ordinary prose as a Skill call. */
  resolveInvocation(value: string): SkillMetadata | null {
    const match = /^\s*[$/]([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?=\s|$)/.exec(value)
    return match?.[1] ? (this.catalog.get(match[1]) ?? null) : null
  }

  resolveInvocations(value: string, selections: readonly SkillSelection[] = []): SkillMetadata[] {
    const selected = new Map<string, SkillMetadata>()
    for (const selection of selections) {
      const skill = this.catalog.get(selection.name)
      if ((!skill || skill.path !== selection.path) && selection.path.startsWith('plugin://'))
        continue
      if (!skill || skill.path !== selection.path)
        throw new AgentError(
          'SKILL_SELECTION_UNAVAILABLE',
          '所选 Skill 已禁用、移除或发生变化，请重新选择',
          409,
        )
      selected.set(skill.name, skill)
    }
    // Code examples are evidence, not user invocations.
    const text = value
      .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, '$1')
      .replace(/(`+)[\s\S]*?\1/g, '')
    const names = [
      ...text.matchAll(/(?:^|[^\w$\\])\$([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?![\w-])/g),
    ].map((match) => match[1]!)
    const prefix = /^\s*\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?=\s|$)/.exec(text)?.[1]
    if (prefix) names.unshift(prefix)
    for (const name of names) {
      const skill = this.catalog.get(name)
      if (skill && !selected.has(name)) selected.set(name, skill)
    }
    return [...selected.values()]
  }

  async invocationData(
    value: string,
    selections: readonly SkillSelection[] = [],
  ): Promise<string[]> {
    const unavailable = selections.filter(
      (selection) =>
        selection.path.startsWith('plugin://') &&
        this.catalog.get(selection.name)?.path !== selection.path,
    )
    const loaded = await Promise.all(
      this.resolveInvocations(value, selections).map(async (skill) => {
        try {
          const loaded = await this.read(skill.name)
          return `<skill name=${JSON.stringify(skill.name)} location=${JSON.stringify(skill.documentPath)}>\nReferences are relative to ${skill.root}.\n${skill.allowedTools ? `Allowed tools guidance (does not change permissions): ${skill.allowedTools.join(', ')}.\n` : ''}${loaded.body}\n</skill>`
        } catch (cause) {
          if (
            cause instanceof AgentError &&
            cause.code === 'SKILL_SELECTION_UNAVAILABLE' &&
            skill.path.startsWith('plugin://')
          )
            return `引用的插件技能 ${JSON.stringify(skill.name)} 当前不可用；引用不能启用插件。`
          throw cause
        }
      }),
    )
    return [
      ...loaded,
      ...unavailable.map(
        (selection) =>
          `引用的插件技能 ${JSON.stringify(selection.name)} 当前不可用；引用不能启用插件。`,
      ),
    ]
  }

  async documentSkill(path: string): Promise<SkillMetadata | undefined> {
    const canonical = await realpath(path).catch(() => null)
    const skill = this.list().find((skill) => skill.documentPath === canonical)
    if (skill) await this.resolveResource(skill.name, 'SKILL.md')
    return skill
  }

  recordRead(name: string, hash: string) {
    const skill = this.catalog.get(name)
    if (!skill || skill.hash !== hash)
      throw new AgentError('SKILL_SNAPSHOT_STALE', 'Skill 内容已变化，请重新开始当前回合', 409)
    this.referenced.set(name, { name, hash })
  }

  async read(name: string): Promise<LoadedSkill> {
    const metadata = this.catalog.get(name)
    if (!metadata) throw new Error(`未知 Skill: ${name}`)
    const bytes = await readFile(await this.resolveResource(name, 'SKILL.md'))
    if (bytes.byteLength > MAX_SKILL_BYTES) throw new Error(`SKILL.md 超过 1 MiB: ${metadata.path}`)
    const content = decoder.decode(bytes)
    const parsed = parseSkillDocument(content)
    this.recordRead(name, sha256(bytes))
    return { ...metadata, content, body: parsed.body }
  }

  /** Skills whose content was successfully read this run (explicit invocation or Read). */
  referencedSkills(): Array<{ name: string; hash: string }> {
    return [...this.referenced.values()]
  }

  async skill_read(name: string, options: SkillScanOptions): Promise<LoadedSkill> {
    await this.scan(options)
    return this.read(name)
  }

  allowedTools(name: string): readonly string[] | undefined {
    return this.catalog.get(name)?.allowedTools
  }

  async resolveResource(name: string, resourcePath: string): Promise<string> {
    const metadata = this.catalog.get(name)
    if (!metadata) throw new Error(`未知 Skill: ${name}`)
    if (metadata.path.startsWith('plugin://') && this.options.pluginSkillRoots) {
      const roots = await this.enabledInstancePluginRoots()
      if (
        !roots.some(
          (root) =>
            metadata.path.startsWith(`plugin://${root.pluginId}/skills/`) &&
            contained(root.skillsRoot, metadata.root),
        )
      )
        throw new AgentError('SKILL_SELECTION_UNAVAILABLE', '插件技能已禁用或移除', 409)
    }
    if (!resourcePath || isAbsolute(resourcePath)) throw new Error('Skill 资源路径必须是相对路径')
    const lexical = resolve(metadata.root, resourcePath)
    if (!contained(metadata.root, lexical)) throw new Error('Skill 资源路径逃出 Skill 根')
    const stats = await lstat(lexical)
    if (!stats.isFile() && !stats.isDirectory() && !stats.isSymbolicLink())
      throw new Error('Skill 资源类型不受支持')
    const canonical = await realpath(lexical)
    if (!contained(metadata.root, canonical)) throw new Error('Skill 资源路径通过链接逃出 Skill 根')
    return canonical
  }
}
