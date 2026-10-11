import {
  specializedModelMigrationEdits,
  type ConfigEdit,
  type ConfigObject,
  type ConfigService,
  type ConfigValue,
} from './ConfigService'
import type { ConfigMigrationRepository } from '../storage/repositories/ConfigMigrationRepository'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { planPiProviderConfigMigration } from '../provider/pi/PiProviderConfigMigration'

const SPECIALIZED_MODEL_PURPOSES = ['generation', 'organization', 'coding', 'security'] as const

const DESKTOP_RUNTIME_KEYS = new Set([
  'recentWorkspaces',
  'lastActiveWorkspacePath',
  'removedWorkspaces',
  'currentDrawer',
  'drawer',
  'drawerTab',
  'collapsed',
  'collapsedSections',
  'pinnedSessions',
  'sessionPins',
  'manualSessionOrder',
  'sidebarStateVersion',
  'sidebarManualOrder',
  'sidebarSessionPins',
  'collapsedSidebarProjectPaths',
  'sidebarSectionOrder',
  'collapsedSidebarSections',
  'windowBounds',
  'overlayPosition',
  'migrationVersion',
  'settingsVersion',
  'workspaceDependenciesMigrated',
])
const DEPRECATED_DESKTOP_RUNTIME_KEYS = new Set(['manualSessionOrder', 'sidebarSectionOrder'])
const DESKTOP_CORE_PATHS: Record<string, string[]> = {
  model: ['model'],
  providerID: ['model_provider'],
  thinkingMode: ['model_reasoning_effort'],
  personality: ['personality'],
  systemPrompt: ['system_prompt'],
  appendSystemPrompt: ['append_system_prompt'],
  customInstructions: ['custom_instructions'],
  smallFastModel: ['task_models', 'small_fast'],
  fastModel: ['task_models', 'fast'],
  defaultModel: ['task_models', 'default'],
  deepModel: ['task_models', 'deep'],
  planExecutionModel: ['task_models', 'plan'],
  reviewModel: ['task_models', 'reviewer'],
  enableMemory: ['features', 'memory'],
  enableParetoCodeRouter: ['features', 'pareto_code_router'],
  enableFusionRouter: ['features', 'fusion_router'],
  allowNetworkAccess: ['sandbox_workspace_write', 'network_access'],
}
const isSecretMaterialKey = (key: string) => {
  const normalized = key.replace(/[-_]/g, '').toLowerCase()
  if (/(?:env|environment|credentialid|credentialref|secretid)$/.test(normalized)) {
    return false
  }
  return [
    'apikey',
    'oauthtoken',
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'password',
    'privatekey',
  ].some((part) => normalized === part || normalized.endsWith(part))
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const atPath = (value: ConfigObject, path: readonly string[]) => {
  let cursor: unknown = value
  for (const part of path) {
    if (!isObject(cursor) || !(part in cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

const safeValue = (value: unknown): ConfigValue | undefined => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value
  if (Array.isArray(value)) {
    const children = value.map(safeValue)
    return children.every((child) => child !== undefined) ? (children as ConfigValue[]) : undefined
  }
  if (isObject(value)) {
    const output: Record<string, ConfigValue> = {}
    for (const [key, child] of Object.entries(value)) {
      if (isSecretMaterialKey(key)) continue
      const safe = safeValue(child)
      if (safe !== undefined) output[key] = safe
    }
    return output
  }
  return undefined
}

const addMissingLeaves = (
  edits: ConfigEdit[],
  current: ConfigObject,
  prefix: string[],
  value: Record<string, unknown>,
) => {
  for (const [key, child] of Object.entries(value)) {
    const path = [...prefix, key]
    if (atPath(current, path) !== undefined) continue
    if (isObject(child)) addMissingLeaves(edits, current, path, child)
    else {
      const safe = safeValue(child)
      if (safe !== undefined) edits.push({ keyPath: path, value: safe })
    }
  }
}

const addLegacyDesktopEdits = (
  edits: ConfigEdit[],
  current: ConfigObject,
  desktop: Record<string, unknown>,
) => {
  for (const [key, value] of Object.entries(desktop)) {
    if (DESKTOP_RUNTIME_KEYS.has(key)) continue
    if (key === 'permissionConfig' && isObject(value)) {
      const permissionPaths: Record<string, string[]> = {
        approvalPolicy: ['approval_policy'],
        approvalsReviewer: ['approvals_reviewer'],
        sandboxMode: ['sandbox_mode'],
      }
      for (const [permissionKey, permissionValue] of Object.entries(value)) {
        const path = permissionPaths[permissionKey]
        const safe = safeValue(permissionValue)
        if (path && safe !== undefined && atPath(current, path) === undefined) {
          edits.push({ keyPath: path, value: safe })
        }
      }
      continue
    }
    const path = DESKTOP_CORE_PATHS[key] ?? ['desktop', key]
    if (atPath(current, path) !== undefined) continue
    if (isObject(value)) addMissingLeaves(edits, current, path, value)
    else {
      const safe = safeValue(value)
      if (safe !== undefined) edits.push({ keyPath: path, value: safe })
    }
  }
}

const modelEdits = (
  edits: ConfigEdit[],
  current: ConfigObject,
  model: Record<string, unknown> | null,
  path: string[],
) => {
  if (!model) return
  const providerID = typeof model.providerID === 'string' ? model.providerID : undefined
  const id = typeof model.id === 'string' ? model.id : undefined
  const variant = typeof model.variant === 'string' ? model.variant : undefined
  if (id && atPath(current, path) === undefined) edits.push({ keyPath: path, value: id })
  if (
    providerID &&
    path.length === 1 &&
    path[0] === 'model' &&
    atPath(current, ['model_provider']) === undefined
  ) {
    edits.push({ keyPath: ['model_provider'], value: providerID })
  }
  if (
    variant &&
    path.length === 1 &&
    path[0] === 'model' &&
    atPath(current, ['model_reasoning_effort']) === undefined
  ) {
    edits.push({ keyPath: ['model_reasoning_effort'], value: variant })
  }
}

export class ConfigMigrationService {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: ConfigMigrationRepository,
    private readonly legacyAppearanceSettingsPath?: string | null,
    private readonly legacyToolingSettingsPath?: string | null,
  ) {}

  async run() {
    const legacy = this.repository.read()
    if (legacy.completed) {
      await this.migratePortableDesktopRuntimeState()
      await this.migratePiProviderConfig()
      await this.migrateRecentNewThreadModel()
      await this.migrateSpecializedModelReferences()
      return
    }
    const read = await this.config.read({ includeLayers: true })
    const current = read.layers?.find((layer) => layer.kind === 'user')?.config ?? {}
    const userVersion = read.layers?.find((layer) => layer.kind === 'user')?.version
    const edits: ConfigEdit[] = []
    let migratedAppearance = false
    let migratedTooling = false
    if (this.legacyAppearanceSettingsPath) {
      try {
        const appearance = JSON.parse(
          await readFile(this.legacyAppearanceSettingsPath, 'utf8'),
        ) as unknown
        if (isObject(appearance)) {
          addMissingLeaves(edits, current, ['desktop', 'appearance'], appearance)
          migratedAppearance = true
        }
      } catch {}
    }
    if (this.legacyToolingSettingsPath) {
      try {
        const tooling = JSON.parse(
          await readFile(this.legacyToolingSettingsPath, 'utf8'),
        ) as unknown
        if (isObject(tooling) && isObject(tooling.preferences)) {
          addMissingLeaves(edits, current, ['desktop', 'tooling'], tooling.preferences)
          migratedTooling = true
        }
      } catch {}
    }
    if (legacy.desktop) {
      addLegacyDesktopEdits(edits, current, legacy.desktop)
    }
    modelEdits(edits, current, legacy.defaultModel, ['model'])
    modelEdits(edits, current, legacy.reviewerModel, ['task_models', 'reviewer'])
    for (const provider of legacy.providerSettings) {
      const safe = safeValue(provider.payload)
      if (isObject(safe)) {
        addMissingLeaves(edits, current, ['model_providers', provider.providerID], safe)
      }
    }
    const legacyMcpUser = isObject(legacy.mcp?.user)
      ? (legacy.mcp.user as Record<string, unknown>)
      : {}
    for (const [name, declaration] of Object.entries(legacyMcpUser)) {
      if (isObject(declaration)) {
        addMissingLeaves(edits, current, ['mcp_servers', name], declaration)
      }
    }
    const legacyMcpLocal = isObject(legacy.mcp?.local)
      ? (legacy.mcp.local as Record<string, unknown>)
      : {}
    const projectHashes = new Set(
      legacy.projects.map((project) =>
        createHash('sha256').update(project.rootPath.toLowerCase()).digest('hex'),
      ),
    )
    for (const [hash, servers] of Object.entries(legacyMcpLocal)) {
      if (projectHashes.has(hash) || !isObject(servers)) continue
      addMissingLeaves(edits, current, ['migration', 'unresolved_mcp', hash], servers)
    }
    const disabledSkillHashes = Array.isArray(legacy.skills?.disabledPathHashes)
      ? legacy.skills.disabledPathHashes.filter(
          (value): value is string => typeof value === 'string',
        )
      : []
    if (
      disabledSkillHashes.length &&
      atPath(current, ['migration', 'unresolved_skills']) === undefined
    ) {
      edits.push({
        keyPath: ['migration', 'unresolved_skills'],
        value: disabledSkillHashes,
      })
    }
    if (edits.length > 0) {
      await this.config.batchWrite({
        edits,
        ...(userVersion ? { expectedVersion: userVersion } : {}),
      })
      const verified = await this.config.read()
      if (verified.diagnostics.some((item) => item.severity === 'error')) {
        throw new Error('config.json migration verification failed')
      }
    }
    const migratedRead = await this.config.read({ includeLayers: true })
    const migratedUser = migratedRead.layers?.find((layer) => layer.kind === 'user')
    const specializedEdits = specializedModelMigrationEdits(migratedUser?.config ?? {})
    if (specializedEdits.length > 0) {
      await this.config.batchWrite({
        edits: specializedEdits,
        ...(migratedUser?.version ? { expectedVersion: migratedUser.version } : {}),
      })
    }
    for (const project of legacy.projects) {
      const projectFile = join(project.rootPath, '.pidex', 'config.json')
      const projectRead = await this.config.read({
        includeLayers: true,
        cwd: project.rootPath,
      })
      const existingProject =
        projectRead.layers?.find((layer) => layer.kind === 'project')?.config ?? {}
      const projectEdits: ConfigEdit[] = []
      modelEdits(projectEdits, existingProject, project.defaultModel, ['model'])
      const projectHash = createHash('sha256').update(project.rootPath.toLowerCase()).digest('hex')
      const projectMcp = legacyMcpLocal[projectHash]
      if (isObject(projectMcp)) {
        for (const [name, declaration] of Object.entries(projectMcp)) {
          if (isObject(declaration)) {
            addMissingLeaves(projectEdits, existingProject, ['mcp_servers', name], declaration)
          }
        }
      }
      if (projectEdits.length) {
        await this.config.batchWrite({
          edits: projectEdits,
          filePath: projectFile,
          migrationScope: 'project',
        })
      }
    }
    const runtimeState = Object.fromEntries(
      Object.entries(legacy.desktop ?? {}).filter(
        ([key]) => DESKTOP_RUNTIME_KEYS.has(key) && !DEPRECATED_DESKTOP_RUNTIME_KEYS.has(key),
      ),
    )
    const mcpRuntime = legacy.mcp ? { ...legacy.mcp, user: {}, local: {} } : null
    this.repository.commit(runtimeState, mcpRuntime, legacy.skills)
    if (migratedAppearance && this.legacyAppearanceSettingsPath) {
      await rm(this.legacyAppearanceSettingsPath, { force: true })
    }
    if (migratedTooling && this.legacyToolingSettingsPath) {
      await rm(this.legacyToolingSettingsPath, { force: true })
    }
    await this.migratePortableDesktopRuntimeState()
    await this.migratePiProviderConfig()
    await this.migrateRecentNewThreadModel()
    await this.migrateSpecializedModelReferences()
  }

  /**
   * 把仍使用裸模型 ID 的专用模型解析为完整 providerID/modelID 引用。
   * 这样 Provider 删除保护只需检查真实专用模型引用，不再依赖遗留的 model_provider。
   * 无法确定 Provider 或已是完整引用时保持原值。
   */
  private async migrateSpecializedModelReferences() {
    if (this.repository.specializedModelReferencesMigrated()) return
    const read = await this.config.read({ includeLayers: true })
    if (read.diagnostics.some((item) => item.scope === 'user' && item.severity === 'error')) return
    const user = read.layers?.find((layer) => layer.kind === 'user')
    const current = user?.config ?? {}
    const providerID =
      typeof current.model_provider === 'string' ? current.model_provider.trim() : ''
    const specialized = isObject(current.specialized_models)
      ? (current.specialized_models as Record<string, unknown>)
      : {}
    const edits: ConfigEdit[] = []
    if (providerID) {
      for (const purpose of SPECIALIZED_MODEL_PURPOSES) {
        const value = specialized[purpose]
        if (typeof value !== 'string') continue
        const reference = value.trim()
        if (!reference || reference.includes('/')) continue
        edits.push({
          keyPath: ['specialized_models', purpose],
          value: `${providerID}/${reference}`,
        })
      }
    }
    if (edits.length) {
      await this.config.batchWrite({
        edits,
        ...(user?.version ? { expectedVersion: user.version } : {}),
      })
    }
    this.repository.markSpecializedModelReferencesMigrated()
  }

  /**
   * 把旧的全局默认模型一次性导入新建任务最近选择。
   * 项目默认模型保持原样存储但不再被消费。写入后用版本标记阻止重复导入，
   * 因此用户后续清空或更换最近选择不会被旧值覆盖。
   */
  private async migrateRecentNewThreadModel() {
    if (this.repository.recentNewThreadModelMigrated()) return
    const read = await this.config.read({ includeLayers: true })
    if (read.diagnostics.some((item) => item.scope === 'user' && item.severity === 'error')) return
    const user = read.layers?.find((layer) => layer.kind === 'user')
    const current = user?.config ?? {}
    const desktop = isObject(current.desktop) ? (current.desktop as Record<string, unknown>) : {}
    if (desktop.recent_new_thread_model !== undefined) {
      this.repository.markRecentNewThreadModelMigrated()
      return
    }
    const providerID =
      typeof current.model_provider === 'string' ? current.model_provider.trim() : ''
    const id = typeof current.model === 'string' ? current.model.trim() : ''
    if (providerID && id) {
      const variant =
        typeof current.model_reasoning_effort === 'string' &&
        current.model_reasoning_effort.trim() &&
        current.model_reasoning_effort !== 'default'
          ? current.model_reasoning_effort.trim()
          : undefined
      await this.config.batchWrite({
        edits: [
          {
            keyPath: ['desktop', 'recent_new_thread_model'],
            value: { providerID, id, ...(variant ? { variant } : {}) },
          },
        ],
        ...(user?.version ? { expectedVersion: user.version } : {}),
      })
    }
    this.repository.markRecentNewThreadModelMigrated()
  }

  private async migratePortableDesktopRuntimeState() {
    const read = await this.config.read({ includeLayers: true })
    if (read.diagnostics.some((item) => item.scope === 'user' && item.severity === 'error')) return
    const user = read.layers?.find((layer) => layer.kind === 'user')
    const desktop = isObject(user?.config.desktop)
      ? (user.config.desktop as Record<string, unknown>)
      : null
    if (!desktop) return
    const runtimeState = Object.fromEntries(
      Object.entries(desktop).filter(
        ([key]) => DESKTOP_RUNTIME_KEYS.has(key) && !DEPRECATED_DESKTOP_RUNTIME_KEYS.has(key),
      ),
    )
    const runtimeKeys = Object.keys(desktop).filter((key) => DESKTOP_RUNTIME_KEYS.has(key))
    if (runtimeKeys.length === 0) return
    this.repository.mergeDesktopRuntimeState(runtimeState)
    await this.config.batchWrite({
      edits: runtimeKeys.map((key) => ({
        keyPath: ['desktop', key],
        value: null,
      })),
      ...(user?.version ? { expectedVersion: user.version } : {}),
    })
  }

  private async migratePiProviderConfig() {
    const read = await this.config.read({ includeLayers: true })
    const current = read.layers?.find((layer) => layer.kind === 'user')?.config ?? {}
    const userVersion = read.layers?.find((layer) => layer.kind === 'user')?.version
    const edits = planPiProviderConfigMigration(current)
    if (edits.length === 0) return
    await this.config.batchWrite({
      edits,
      ...(userVersion ? { expectedVersion: userVersion } : {}),
    })
    const verified = await this.config.read()
    if (verified.diagnostics.some((item) => item.severity === 'error')) {
      throw new Error('Pi provider config migration verification failed')
    }
  }
}
