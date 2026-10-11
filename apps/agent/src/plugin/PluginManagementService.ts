import { readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  PluginDetails,
  PluginInstallationPolicy,
  PluginSource,
  PluginSummary,
} from '@pidex/agent-protocol'
import { parseSkillDocument } from '../prompt/SkillService'
import {
  PluginSettingsConflictError,
  PluginSettingsRepository,
} from '../storage/repositories/PluginSettingsRepository'

const MAX_JSON_BYTES = 1024 * 1024
const pluginIdPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const decoder = new TextDecoder('utf-8', { fatal: true })

type PluginSkillRoot = {
  pluginId: string
  pluginRoot: string
  skillsRoot: string
}

type DiscoveredPlugin = {
  summary: PluginSummary
  details: PluginDetails
  skillRoot: PluginSkillRoot | null
}

type PluginRoots = {
  builtinPluginsRoot: string
  userHome?: string
}

type JsonRecord = Record<string, unknown>

export class PluginManagementError extends Error {
  constructor(
    readonly code:
      | 'PLUGIN_NOT_FOUND'
      | 'PLUGIN_NOT_INSTALLED'
      | 'PLUGIN_INVALID'
      | 'CONFLICT'
      | 'PATH_DENIED'
      | 'INTERNAL_ERROR',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const contained = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = stringValue(entry)
        return text ? [text] : []
      })
    : []

const stringOrStringArray = (value: unknown) => {
  const single = stringValue(value)
  return single ? [single] : stringArray(value)
}

const readJson = async (path: string): Promise<unknown> => {
  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('JSON 文件过大')
  return JSON.parse(decoder.decode(bytes)) as unknown
}

const invalidPlugin = (
  id: string,
  source: PluginSource,
  unavailableReason = '插件清单无效',
): DiscoveredPlugin => ({
  summary: {
    id,
    name: id,
    version: '0.0.0',
    description: '',
    developerName: '未知开发者',
    category: 'Other',
    source,
    installationPolicy: 'NOT_AVAILABLE',
    installed: false,
    enabled: false,
    status: 'invalid',
    capabilities: [],
    skills: [],
    unavailableReason,
  },
  details: {
    pluginId: id,
    longDescription: '',
    displayCapabilities: [],
    defaultPrompts: [],
    skills: [],
  },
  skillRoot: null,
})

const normalizePolicy = (
  value: unknown,
  fallback: PluginInstallationPolicy,
): PluginInstallationPolicy =>
  value === 'NOT_AVAILABLE' || value === 'AVAILABLE' || value === 'INSTALLED_BY_DEFAULT'
    ? value
    : fallback

export class PluginManagementService {
  private readonly userHome: string
  private readonly knownPlugins = new Map<string, DiscoveredPlugin>()
  private readonly listeners = new Set<(pluginId: string, generation: number) => void>()

  constructor(
    private readonly settings: PluginSettingsRepository,
    private readonly roots: PluginRoots,
  ) {
    this.userHome = resolve(roots.userHome ?? homedir())
  }

  initializeComputerUse(legacyEnabled: boolean) {
    this.settings.initializeComputerUse(legacyEnabled)
  }

  isEnabled(pluginId: string) {
    const plugin = this.knownPlugins.get(pluginId)?.summary
    return (
      plugin?.installed === true &&
      plugin.status === 'ready' &&
      !this.settings.state().disabledPluginIds.includes(pluginId)
    )
  }

  subscribe(listener: (pluginId: string, generation: number) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async list(
    input: {
      workspace?: string | undefined
      forceReload?: boolean | undefined
    } = {},
  ) {
    const plugins = await this.discover(input.workspace)
    this.knownPlugins.clear()
    for (const plugin of plugins) this.knownPlugins.set(plugin.summary.id, plugin)
    const state = this.settings.state()
    return {
      plugins: plugins.map(({ summary }) => summary),
      generation: state.generation,
      updatedAt: state.updatedAt,
    }
  }

  async setEnabled(input: { pluginId: string; enabled: boolean; operationId: string }) {
    let plugin = this.knownPlugins.get(input.pluginId)
    if (!plugin) {
      await this.list()
      plugin = this.knownPlugins.get(input.pluginId)
    }
    if (!plugin) {
      throw new PluginManagementError('PLUGIN_NOT_FOUND', '插件不存在', 404)
    }
    if (plugin.summary.status !== 'ready') {
      throw new PluginManagementError('PLUGIN_INVALID', '插件当前不可用', 409)
    }
    if (!plugin.summary.installed) {
      throw new PluginManagementError('PLUGIN_NOT_INSTALLED', '插件尚未安装', 409)
    }
    try {
      const result = this.settings.setEnabled(input)
      const summary = { ...plugin.summary, enabled: this.isEnabled(input.pluginId) }
      this.knownPlugins.set(input.pluginId, { ...plugin, summary })
      if (result.changed)
        for (const listener of this.listeners) listener(input.pluginId, result.state.generation)
      return {
        result: {
          plugin: summary,
          generation: result.state.generation,
          updatedAt: result.state.updatedAt,
        },
        changed: result.changed,
      }
    } catch (cause) {
      if (cause instanceof PluginSettingsConflictError) {
        throw new PluginManagementError('CONFLICT', cause.message, 409)
      }
      throw cause
    }
  }

  async getDetails(input: { pluginId: string; workspace?: string | undefined }) {
    const plugins = await this.discover(input.workspace)
    const plugin = plugins.find((candidate) => candidate.summary.id === input.pluginId)
    if (!plugin) {
      throw new PluginManagementError('PLUGIN_NOT_FOUND', '插件不存在', 404)
    }
    this.knownPlugins.set(plugin.summary.id, plugin)
    return { details: plugin.details }
  }

  async enabledSkillRoots(workspace?: string): Promise<PluginSkillRoot[]> {
    const plugins = await this.discover(workspace)
    return plugins.flatMap((plugin) =>
      plugin.summary.installed &&
      plugin.summary.enabled &&
      !this.settings.state().disabledPluginIds.includes(plugin.summary.id) &&
      plugin.summary.status === 'ready' &&
      plugin.skillRoot
        ? [plugin.skillRoot]
        : [],
    )
  }

  private async discover(workspace?: string) {
    const bundled = await this.scanBundled()
    const workspacePlugins = workspace
      ? await this.scanMarketplace(
          resolve(workspace, '.agents', 'plugins', 'marketplace.json'),
          resolve(workspace),
          'workspace',
        )
      : []
    const personal = await this.scanMarketplace(
      resolve(this.userHome, '.agents', 'plugins', 'marketplace.json'),
      this.userHome,
      'personal',
    )
    const selected = new Map<string, DiscoveredPlugin>()
    for (const plugin of [...bundled, ...workspacePlugins, ...personal]) {
      if (!selected.has(plugin.summary.id)) selected.set(plugin.summary.id, plugin)
    }
    return [...selected.values()]
  }

  private async scanBundled(): Promise<DiscoveredPlugin[]> {
    const root = await realpath(resolve(this.roots.builtinPluginsRoot)).catch(() => null)
    if (!root) return []
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const plugins: DiscoveredPlugin[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (!pluginIdPattern.test(entry.name)) continue
      const pluginRoot = await realpath(join(root, entry.name)).catch(() => null)
      if (!pluginRoot || !contained(root, pluginRoot)) {
        plugins.push(invalidPlugin(entry.name, 'bundled', '插件目录无效'))
        continue
      }
      plugins.push(
        await this.loadPlugin({
          expectedId: entry.name,
          pluginRoot,
          source: 'bundled',
          policy: undefined,
        }),
      )
    }
    return plugins
  }

  private async scanMarketplace(
    marketplacePath: string,
    sourceRoot: string,
    source: 'workspace' | 'personal',
  ): Promise<DiscoveredPlugin[]> {
    let parsed: JsonRecord | null
    try {
      parsed = record(await readJson(marketplacePath))
    } catch {
      return []
    }
    if (!parsed || !Array.isArray(parsed.plugins)) return []
    const canonicalSourceRoot = await realpath(sourceRoot).catch(() => null)
    if (!canonicalSourceRoot) return []
    const plugins: DiscoveredPlugin[] = []
    for (const rawEntry of parsed.plugins) {
      const entry = record(rawEntry)
      const id = stringValue(entry?.name)
      if (!entry || !id || !pluginIdPattern.test(id)) continue
      const sourceDescriptor = record(entry.source)
      const sourcePath = stringValue(sourceDescriptor?.path)
      if (sourceDescriptor?.source !== 'local' || !sourcePath) continue
      const candidate = resolve(canonicalSourceRoot, sourcePath)
      if (!contained(canonicalSourceRoot, candidate)) {
        plugins.push(invalidPlugin(id, source, '插件来源路径无效'))
        continue
      }
      const pluginRoot = await realpath(candidate).catch(() => null)
      if (!pluginRoot || !contained(canonicalSourceRoot, pluginRoot)) {
        plugins.push(invalidPlugin(id, source, '插件来源不可用'))
        continue
      }
      const policy = normalizePolicy(record(entry.policy)?.installation, 'AVAILABLE')
      plugins.push(
        await this.loadPlugin({
          expectedId: id,
          pluginRoot,
          source,
          policy,
        }),
      )
    }
    return plugins
  }

  private async loadPlugin(input: {
    expectedId: string
    pluginRoot: string
    source: PluginSource
    policy: PluginInstallationPolicy | undefined
  }): Promise<DiscoveredPlugin> {
    try {
      const manifestPath = await realpath(join(input.pluginRoot, '.codex-plugin', 'plugin.json'))
      if (!contained(input.pluginRoot, manifestPath)) throw new Error('manifest 路径无效')
      const manifest = record(await readJson(manifestPath))
      if (!manifest) throw new Error('manifest 无效')
      const id = stringValue(manifest.name)
      const version = stringValue(manifest.version)
      const description = stringValue(manifest.description)
      const author = record(manifest.author)
      const authorName = stringValue(author?.name)
      const interfaceMetadata = record(manifest.interface)
      const displayName = stringValue(interfaceMetadata?.displayName)
      const shortDescription = stringValue(interfaceMetadata?.shortDescription)
      const longDescription = stringValue(interfaceMetadata?.longDescription)
      const developerName = stringValue(interfaceMetadata?.developerName) ?? authorName
      const category = stringValue(interfaceMetadata?.category)
      if (
        !id ||
        id !== input.expectedId ||
        !pluginIdPattern.test(id) ||
        !version ||
        !semverPattern.test(version) ||
        !description ||
        !authorName ||
        !displayName ||
        !shortDescription ||
        !developerName ||
        !category
      ) {
        throw new Error('manifest 字段无效')
      }

      let extension: JsonRecord | null = null
      const extensionPath = await realpath(
        join(input.pluginRoot, '.cpx-plugin', 'plugin.json'),
      ).catch(() => null)
      if (extensionPath) {
        if (!contained(input.pluginRoot, extensionPath)) {
          throw new Error('Pidex 扩展清单路径无效')
        }
        extension = record(await readJson(extensionPath))
        if (
          !extension ||
          extension.schemaVersion !== 1 ||
          !Array.isArray(extension.capabilities) ||
          !extension.capabilities.every((value) => typeof value === 'string' && value.length > 0) ||
          !['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(
            String(extension.installation),
          )
        ) {
          throw new Error('Pidex 扩展清单无效')
        }
      }

      const policy = input.policy ?? normalizePolicy(extension?.installation, 'AVAILABLE')
      // 项目 marketplace 显式声明 INSTALLED_BY_DEFAULT 时随该项目生效；个人来源仍不自动安装。
      const installed =
        policy === 'INSTALLED_BY_DEFAULT' &&
        (input.source === 'bundled' || input.source === 'workspace')
      const disabled = new Set(this.settings.state().disabledPluginIds)
      const skills = await this.resolveSkills(input.pluginRoot, stringValue(manifest.skills))
      const status = policy === 'NOT_AVAILABLE' ? 'unavailable' : 'ready'
      return {
        summary: {
          id,
          name: displayName,
          version,
          description: shortDescription,
          developerName,
          category,
          source: input.source,
          installationPolicy: policy,
          installed,
          enabled: installed && !disabled.has(id) && status === 'ready',
          status,
          capabilities: extension ? stringArray(extension.capabilities) : [],
          skills: skills.names,
          ...(status === 'unavailable' ? { unavailableReason: '此插件当前不可用' } : {}),
        },
        details: {
          pluginId: id,
          longDescription: longDescription ?? shortDescription ?? description,
          displayCapabilities: stringArray(interfaceMetadata?.capabilities),
          defaultPrompts: stringOrStringArray(interfaceMetadata?.defaultPrompt),
          skills: skills.details,
        },
        skillRoot: skills.root
          ? { pluginId: id, pluginRoot: input.pluginRoot, skillsRoot: skills.root }
          : null,
      }
    } catch {
      return invalidPlugin(input.expectedId, input.source)
    }
  }

  private async resolveSkills(pluginRoot: string, configuredPath: string | null) {
    const candidate = resolve(pluginRoot, configuredPath ?? 'skills')
    if (!contained(pluginRoot, candidate)) return { root: null, names: [] as string[], details: [] }
    const skillsRoot = await realpath(candidate).catch(() => null)
    if (!skillsRoot || !contained(pluginRoot, skillsRoot)) {
      return { root: null, names: [] as string[], details: [] }
    }
    const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => [])
    const names: string[] = []
    const details: Array<PluginDetails['skills'][number]> = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (!pluginIdPattern.test(entry.name)) continue
      const document = await realpath(join(skillsRoot, entry.name, 'SKILL.md')).catch(() => null)
      if (!document || !contained(skillsRoot, document)) continue
      try {
        const bytes = await readFile(document)
        if (bytes.byteLength > MAX_JSON_BYTES) continue
        const { metadata } = parseSkillDocument(decoder.decode(bytes))
        const name = stringValue(metadata.name) ?? entry.name
        names.push(entry.name)
        details.push({
          id: entry.name,
          name,
          description: stringValue(metadata.description) ?? '',
        })
      } catch {
        continue
      }
    }
    return { root: skillsRoot, names, details }
  }
}

export type { PluginSkillRoot }
