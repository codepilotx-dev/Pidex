import { createHash, randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
} from 'node:path'
import { parse as parseToml, type TomlTable } from 'smol-toml'
import {
  JsoncDocumentError,
  parseJsoncObject,
  patchJsonc,
  stringifyConfigJson,
} from './JsoncDocument'

export type ConfigScope = 'user' | 'profile' | 'project'
export type ConfigMergeStrategy = 'replace' | 'upsert'
export type ConfigValue =
  null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue }
export type ConfigObject = { [key: string]: ConfigValue }

export type ConfigDiagnostic = {
  severity: 'warning' | 'error'
  code: string
  message: string
  scope: ConfigScope
}

export type ConfigLayer = {
  kind: ConfigScope | 'defaults'
  displayName: string
  filePath?: string
  version: string
  writable: boolean
  trusted: boolean
  config: ConfigObject
}

export type ConfigReadResult = {
  config: ConfigObject
  origins: Record<string, ConfigScope | 'defaults'>
  layers?: ConfigLayer[]
  diagnostics: ConfigDiagnostic[]
  profileState: ConfigProfileState
}

export type ConfigProfileState = {
  activeProfile: string | null
  selectedProfile: string | null
  restartRequired: boolean
}

export type ConfigProfileSummary = {
  id: string
  displayName: string
  description?: string
  filePath: string
  version: string
  valid: boolean
  diagnostics: ConfigDiagnostic[]
}

export type ConfigEdit = {
  keyPath: readonly string[]
  value: ConfigValue
  mergeStrategy?: ConfigMergeStrategy | undefined
}

export type ConfigWriteResult = {
  status: 'ok' | 'ok-overridden'
  version: string
  filePath: string
  overridden?: Array<{ keyPath: string[]; by: ConfigScope }>
}

export type ConfigUpdated = {
  version: string
  changedKeyPaths: string[][]
  scope: ConfigScope
  diagnostics: ConfigDiagnostic[]
  profileState?: ConfigProfileState
}

export type ConfigErrorCode =
  | 'CONFIG_LAYER_READONLY'
  | 'CONFIG_VERSION_CONFLICT'
  | 'CONFIG_VALIDATION_ERROR'
  | 'CONFIG_PATH_NOT_FOUND'
  | 'CONFIG_PROJECT_UNTRUSTED'
  | 'CONFIG_PROFILE_INVALID'
  | 'CONFIG_PROFILE_NOT_FOUND'

export class ConfigServiceError extends Error {
  constructor(
    readonly code: ConfigErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConfigServiceError'
  }
}

type LoadedFile = {
  config: ConfigObject
  text: string
  version: string
  diagnostics: ConfigDiagnostic[]
  fromLegacy?: boolean
}

const EMPTY_VERSION = createHash('sha256').update('').digest('hex')
const PROJECT_CONFIG_DIRECTORY = '.pidex'
const CONFIG_FILE_NAME = 'config.json'
const LEGACY_CONFIG_FILE_NAME = 'config.toml'
const PROFILE_DIRECTORY_NAME = 'profiles'
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PROFILE_ALLOWED_ROOTS = new Set([
  'schema_version',
  'display_name',
  'description',
  'model',
  'model_provider',
  'model_reasoning_effort',
  'personality',
  'system_prompt',
  'append_system_prompt',
  'custom_instructions',
  'sandbox_mode',
  'sandbox_workspace_write',
  'approval_policy',
  'approvals_reviewer',
  'shell_security_level',
  'task_models',
  'specialized_models',
])
const KNOWN_CONFIG_ROOTS = new Set([
  'approval_rules',
  'permission_rules',
  ...PROFILE_ALLOWED_ROOTS,
  'profile',
  'model_providers',
  'provider_credentials',
  'mcp_servers',
  'hooks',
  'projects',
  'desktop',
  'cli',
  'features',
  'agent',
  'model_catalog',
  'auto_review',
  'telemetry',
  'logging',
  'migration',
  'data_dir',
])
const PROJECT_FORBIDDEN_ROOTS = new Set([
  'model_providers',
  'projects',
  'telemetry',
  'logging',
  'data_dir',
  'shell_security_level',
  'provider_credentials',
  'profile',
  'profiles',
])
const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const STATIC_SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])
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

const isMcpEnvironmentReferencePath = (path: readonly string[]) =>
  (path.length === 5 &&
    path[0] === 'mcp_servers' &&
    path[2] === 'transport' &&
    (path[3] === 'envFromHost' || path[3] === 'headerFromEnv')) ||
  (path.length === 4 &&
    path[0] === 'mcp_servers' &&
    path[2] === 'transport' &&
    path[3] === 'bearerTokenEnvVar')

const isStaticMcpSecretHeaderPath = (path: readonly string[]) =>
  path.length === 5 &&
  path[0] === 'mcp_servers' &&
  path[2] === 'transport' &&
  path[3] === 'headers' &&
  STATIC_SECRET_HEADERS.has(path[4]!.toLowerCase())

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asConfigObject = (value: TomlTable): ConfigObject => value as unknown as ConfigObject

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

const clone = <T>(value: T): T => structuredClone(value)

const mergeConfig = (base: ConfigObject, next: ConfigObject): ConfigObject => {
  const output = clone(base)
  for (const [key, value] of Object.entries(next)) {
    const current = output[key]
    output[key] =
      isObject(current) && isObject(value)
        ? mergeConfig(current as ConfigObject, value as ConfigObject)
        : clone(value)
  }
  return output
}

const valueAtPath = (config: ConfigObject, keyPath: readonly string[]) => {
  let current: ConfigValue | ConfigObject = config
  for (const key of keyPath) {
    if (!isObject(current) || !(key in current)) return undefined
    current = current[key]!
  }
  return current
}

const collectOrigins = (
  value: ConfigObject,
  scope: ConfigScope | 'defaults',
  output: Record<string, ConfigScope | 'defaults'>,
  prefix: string[] = [],
) => {
  for (const [key, child] of Object.entries(value)) {
    const path = [...prefix, key]
    if (isObject(child)) collectOrigins(child as ConfigObject, scope, output, path)
    else output[path.join('.')] = scope
  }
}

const findProjectConfig = async (cwd: string, userConfigPath?: string): Promise<string | null> => {
  let cursor = resolve(cwd)
  while (true) {
    const configDirectory = join(cursor, PROJECT_CONFIG_DIRECTORY)
    const candidate = join(configDirectory, CONFIG_FILE_NAME)
    const legacyCandidate = join(configDirectory, LEGACY_CONFIG_FILE_NAME)
    if (
      userConfigPath &&
      (process.platform === 'win32'
        ? resolve(candidate).toLowerCase() === resolve(userConfigPath).toLowerCase()
        : resolve(candidate) === resolve(userConfigPath))
    )
      return null
    for (const existing of [candidate, legacyCandidate]) {
      try {
        if ((await stat(existing)).isFile()) return candidate
      } catch {}
    }
    const parent = dirname(cursor)
    if (parent === cursor || cursor === parsePath(cursor).root) return null
    cursor = parent
  }
}

const validateConfig = (config: ConfigObject, scope: ConfigScope) => {
  const visit = (value: ConfigObject, prefix: string[] = []) => {
    for (const [key, child] of Object.entries(value)) {
      const path = [...prefix, key]
      if (isMcpEnvironmentReferencePath(path)) {
        if (typeof child !== 'string' || !ENVIRONMENT_VARIABLE_NAME.test(child)) {
          throw new ConfigServiceError(
            'CONFIG_VALIDATION_ERROR',
            `配置 ${path.join('.')} 的环境变量名无效`,
          )
        }
        continue
      }
      if (isStaticMcpSecretHeaderPath(path)) {
        throw new ConfigServiceError(
          'CONFIG_VALIDATION_ERROR',
          `配置 ${path.join('.')} 不允许保存密钥材料`,
        )
      }
      if (isSecretMaterialKey(key) && typeof child === 'string' && child.trim()) {
        throw new ConfigServiceError(
          'CONFIG_VALIDATION_ERROR',
          `配置 ${path.join('.')} 不允许保存密钥材料`,
        )
      }
      if (isObject(child)) visit(child as ConfigObject, path)
    }
  }
  visit(config)
  if (config.schema_version !== undefined && config.schema_version !== 1) {
    throw new ConfigServiceError('CONFIG_VALIDATION_ERROR', '配置 schema_version 仅支持 1')
  }
  if (scope === 'user' && config.profile !== undefined && config.profile !== null) {
    if (typeof config.profile !== 'string' || !PROFILE_ID.test(config.profile)) {
      throw new ConfigServiceError(
        'CONFIG_PROFILE_INVALID',
        '配置 profile 必须是小写字母、数字、连字符或下划线组成的有效 Profile ID',
      )
    }
  }
  const providerCredentials = config.provider_credentials
  if (
    providerCredentials !== undefined &&
    (!isObject(providerCredentials) ||
      (providerCredentials.store !== undefined &&
        providerCredentials.store !== 'auth-json' &&
        providerCredentials.store !== 'encrypted'))
  ) {
    throw new ConfigServiceError(
      'CONFIG_VALIDATION_ERROR',
      '配置 provider_credentials.store 仅支持 auth-json 或 encrypted',
    )
  }
  if (scope === 'project') {
    for (const root of Object.keys(config)) {
      if (PROJECT_FORBIDDEN_ROOTS.has(root) || root === 'desktop') {
        throw new ConfigServiceError('CONFIG_LAYER_READONLY', `项目配置不允许覆盖 ${root}`)
      }
    }
  }
  if (scope === 'profile') {
    for (const root of Object.keys(config)) {
      if (!PROFILE_ALLOWED_ROOTS.has(root)) {
        throw new ConfigServiceError('CONFIG_LAYER_READONLY', `Profile 不允许覆盖 ${root}`)
      }
    }
    if (
      config.display_name !== undefined &&
      (typeof config.display_name !== 'string' || !config.display_name.trim())
    ) {
      throw new ConfigServiceError(
        'CONFIG_PROFILE_INVALID',
        'Profile display_name 必须是非空字符串',
      )
    }
    if (config.description !== undefined && typeof config.description !== 'string') {
      throw new ConfigServiceError('CONFIG_PROFILE_INVALID', 'Profile description 必须是字符串')
    }
  }
}

const legacyDesktopMigrationEdits = (config: ConfigObject): ConfigEdit[] => {
  const desktop = isObject(config.desktop) ? (config.desktop as ConfigObject) : null
  if (!desktop) return []
  const mappings: Array<{ legacy: string[]; canonical: string[] }> = [
    { legacy: ['model'], canonical: ['model'] },
    { legacy: ['providerID'], canonical: ['model_provider'] },
    { legacy: ['thinkingMode'], canonical: ['model_reasoning_effort'] },
    { legacy: ['personality'], canonical: ['personality'] },
    { legacy: ['systemPrompt'], canonical: ['system_prompt'] },
    { legacy: ['appendSystemPrompt'], canonical: ['append_system_prompt'] },
    { legacy: ['customInstructions'], canonical: ['custom_instructions'] },
    { legacy: ['smallFastModel'], canonical: ['task_models', 'small_fast'] },
    { legacy: ['fastModel'], canonical: ['task_models', 'fast'] },
    { legacy: ['defaultModel'], canonical: ['task_models', 'default'] },
    { legacy: ['deepModel'], canonical: ['task_models', 'deep'] },
    { legacy: ['planExecutionModel'], canonical: ['task_models', 'plan'] },
    { legacy: ['reviewModel'], canonical: ['task_models', 'reviewer'] },
    { legacy: ['permissionConfig', 'sandboxMode'], canonical: ['sandbox_mode'] },
    { legacy: ['permissionConfig', 'approvalPolicy'], canonical: ['approval_policy'] },
    { legacy: ['permissionConfig', 'approvalsReviewer'], canonical: ['approvals_reviewer'] },
    { legacy: ['enableMemory'], canonical: ['features', 'memory'] },
    { legacy: ['enableParetoCodeRouter'], canonical: ['features', 'pareto_code_router'] },
    { legacy: ['enableFusionRouter'], canonical: ['features', 'fusion_router'] },
    { legacy: ['allowNetworkAccess'], canonical: ['sandbox_workspace_write', 'network_access'] },
  ]
  return mappings.flatMap(({ legacy, canonical }) => {
    const value = valueAtPath(desktop, legacy)
    if (value === undefined) return []
    return [
      ...(valueAtPath(config, canonical) === undefined
        ? [{ keyPath: canonical, value: clone(value) }]
        : []),
      { keyPath: ['desktop', ...legacy], value: null },
    ]
  })
}

const SPECIALIZED_MODEL_MIGRATION_SOURCES = {
  generation: ['small_fast', 'fast'],
  organization: ['small_fast', 'fast'],
  coding: ['plan', 'deep', 'default', 'reviewer'],
  security: ['reviewer'],
} as const

export const specializedModelMigrationEdits = (config: ConfigObject): ConfigEdit[] => {
  const specializedModels = isObject(config.specialized_models)
    ? (config.specialized_models as Record<string, unknown>)
    : {}
  const taskModels = isObject(config.task_models)
    ? (config.task_models as Record<string, unknown>)
    : {}
  const edits: ConfigEdit[] = []
  for (const [purpose, sources] of Object.entries(SPECIALIZED_MODEL_MIGRATION_SOURCES)) {
    if (specializedModels[purpose] !== undefined) continue
    const value = sources
      .map((source) => taskModels[source])
      .find((candidate) => typeof candidate === 'string' && candidate.trim())
    if (typeof value === 'string') {
      edits.push({ keyPath: ['specialized_models', purpose], value })
    }
  }
  return edits
}

const runtimeConfig = (config: ConfigObject): ConfigObject => {
  const output = clone(config)
  delete output.schema_version
  delete output.profile
  delete output.display_name
  delete output.description
  delete output.projects
  return output
}

const scopeDisplayName = (scope: ConfigScope) =>
  scope === 'user' ? '用户' : scope === 'profile' ? 'Profile' : '项目'

const unknownKeyDiagnostics = (config: ConfigObject, scope: ConfigScope): ConfigDiagnostic[] =>
  scope === 'profile'
    ? []
    : Object.keys(config)
        .filter((key) => !KNOWN_CONFIG_ROOTS.has(key))
        .map((key) => ({
          severity: 'warning' as const,
          code: 'CONFIG_UNKNOWN_KEY',
          message: `${scopeDisplayName(scope)} config.json 包含未知字段 ${key}；已保留但当前版本不会使用`,
          scope,
        }))

const readConfigFile = async (
  filePath: string,
  scope: ConfigScope,
  previous?: LoadedFile,
): Promise<LoadedFile> => {
  let text = ''
  let missing = false
  try {
    text = await readFile(filePath, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    missing = true
  }
  if (missing && previous?.fromLegacy) {
    return previous
  }
  try {
    const config = parseJsoncObject(text)
    validateConfig(config, scope)
    return {
      config,
      text,
      version: sha256(text),
      diagnostics: unknownKeyDiagnostics(config, scope),
    }
  } catch (cause) {
    const diagnostic: ConfigDiagnostic = {
      severity: 'error',
      code: 'CONFIG_VALIDATION_ERROR',
      message: `${scopeDisplayName(scope)} config.json 无效；继续使用上次有效配置${
        cause instanceof JsoncDocumentError ? `：${cause.message}` : ''
      }`,
      scope,
    }
    return previous
      ? {
          ...previous,
          text,
          version: sha256(text),
          diagnostics: [diagnostic],
          fromLegacy: false,
        }
      : { config: {}, text, version: sha256(text), diagnostics: [diagnostic] }
  }
}

const fileExists = async (filePath: string) => {
  try {
    return (await stat(filePath)).isFile()
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

const legacyConfigPath = (filePath: string) => join(dirname(filePath), LEGACY_CONFIG_FILE_NAME)

const writeConfigAtomically = async (filePath: string, text: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = join(dirname(filePath), `.${randomUUID()}.config.tmp`)
  try {
    await writeFile(temporary, text, 'utf8')
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

const migrateSpecializedModelsFile = async (
  filePath: string,
  scope: ConfigScope,
  loaded: LoadedFile,
) => {
  if (loaded.diagnostics.some((item) => item.severity === 'error')) return loaded
  const edits = specializedModelMigrationEdits(loaded.config)
  if (edits.length === 0) return loaded
  const text = patchJsonc(loaded.text, edits)
  const parsed = parseJsoncObject(text)
  validateConfig(parsed, scope)
  await writeConfigAtomically(filePath, text)
  return readConfigFile(filePath, scope, loaded)
}

const migrateLegacyToml = async (
  filePath: string,
  scope: ConfigScope,
): Promise<LoadedFile | undefined> => {
  if (await fileExists(filePath)) return undefined
  const legacyPath = legacyConfigPath(filePath)
  if (!(await fileExists(legacyPath))) return undefined

  let config: ConfigObject
  let text: string
  try {
    const legacyText = await readFile(legacyPath, 'utf8')
    config = asConfigObject(parseToml(legacyText))
    text = stringifyConfigJson(config)
    config = parseJsoncObject(text)
    validateConfig(config, scope)
  } catch {
    return {
      config: {},
      text: '{}\n',
      version: EMPTY_VERSION,
      fromLegacy: true,
      diagnostics: [
        {
          severity: 'error',
          code: 'CONFIG_VALIDATION_ERROR',
          message: `${scopeDisplayName(scope)} config.toml 无效；未生成 config.json`,
          scope,
        },
      ],
    }
  }

  try {
    if (await fileExists(filePath)) return undefined
    await writeConfigAtomically(filePath, text)
    const verified = await readConfigFile(filePath, scope)
    if (verified.diagnostics.some((item) => item.severity === 'error')) {
      await rm(filePath, { force: true })
      throw new Error('config.json migration verification failed')
    }
    return verified
  } catch {
    return {
      config,
      text,
      version: EMPTY_VERSION,
      fromLegacy: true,
      diagnostics: [
        {
          severity: 'warning',
          code: 'CONFIG_MIGRATION_DEFERRED',
          message: `${scopeDisplayName(scope)} config.toml 暂未迁移；当前继续使用旧配置`,
          scope,
        },
      ],
    }
  }
}

type ConfigBatchWriteInput = {
  edits: readonly ConfigEdit[]
  filePath?: string | undefined
  cwd?: string | undefined
  expectedVersion?: string | undefined
  migrationScope?: ConfigScope | undefined
  target?:
    | {
        kind: 'user' | 'profile' | 'project'
        profileId?: string | undefined
      }
    | undefined
}

type ConfigWriteTarget = {
  scope: ConfigScope
  filePath: string
}

export type ProjectTrustStore = {
  read(projectRoot: string): 'trusted' | 'untrusted' | null
  write(projectRoot: string, trustLevel: 'trusted' | 'untrusted'): void
  import?(entries: Record<string, 'trusted' | 'untrusted'>): void
}

const writeQueueKey = (filePath: string) => {
  const normalized = resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export class ConfigService {
  private user: LoadedFile | undefined
  private projects = new Map<string, LoadedFile>()
  private profiles = new Map<string, LoadedFile>()
  private activeProfileId: string | null = null
  private activeProfile: LoadedFile | null = null
  private memoryTrust = new Map<string, 'trusted' | 'untrusted'>()
  private watchers = new Map<string, FSWatcher>()
  private listeners = new Set<(event: ConfigUpdated) => void | Promise<void>>()
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private writeQueues = new Map<string, Promise<void>>()

  constructor(
    readonly userConfigPath: string,
    private readonly defaults: ConfigObject = {},
    private readonly trustStore?: ProjectTrustStore,
  ) {}

  get profilesDirectory() {
    return join(dirname(this.userConfigPath), PROFILE_DIRECTORY_NAME)
  }

  private profilePath(profileId: string) {
    if (!PROFILE_ID.test(profileId)) {
      throw new ConfigServiceError('CONFIG_PROFILE_INVALID', 'Profile ID 无效')
    }
    return join(this.profilesDirectory, `${profileId}.json`)
  }

  private selectedProfile() {
    const value = this.user?.config.profile
    return typeof value === 'string' && PROFILE_ID.test(value) ? value : null
  }

  isProjectTrusted(projectRoot: string) {
    return this.trustLevel(projectRoot) === 'trusted'
  }

  private trustLevel(projectRoot: string) {
    const canonical = resolve(projectRoot)
    return this.trustStore?.read(canonical) ?? this.memoryTrust.get(canonical) ?? 'untrusted'
  }

  private setTrustLevel(projectRoot: string, trustLevel: 'trusted' | 'untrusted') {
    const canonical = resolve(projectRoot)
    if (this.trustStore) this.trustStore.write(canonical, trustLevel)
    else this.memoryTrust.set(canonical, trustLevel)
  }

  private async loadActiveProfile() {
    const selected = this.selectedProfile()
    this.activeProfileId = selected
    this.activeProfile = null
    if (!selected) return
    const filePath = this.profilePath(selected)
    if (!(await fileExists(filePath))) {
      throw new ConfigServiceError(
        'CONFIG_PROFILE_NOT_FOUND',
        `已选择的 Profile ${selected} 不存在`,
      )
    }
    const loaded = await migrateSpecializedModelsFile(
      filePath,
      'profile',
      await readConfigFile(filePath, 'profile'),
    )
    if (loaded.diagnostics.some((item) => item.severity === 'error')) {
      throw new ConfigServiceError('CONFIG_PROFILE_INVALID', `已选择的 Profile ${selected} 无效`)
    }
    this.activeProfile = clone(loaded)
    this.profiles.set(selected, loaded)
    this.watchFile(filePath, 'profile')
  }

  async initialize() {
    await mkdir(dirname(this.userConfigPath), { recursive: true })
    await mkdir(this.profilesDirectory, { recursive: true })
    const migrated = await migrateLegacyToml(this.userConfigPath, 'user')
    if (!migrated && !(await fileExists(this.userConfigPath))) {
      await writeFile(this.userConfigPath, '{}\n', {
        encoding: 'utf8',
        flag: 'wx',
      }).catch(() => undefined)
    }
    this.user = await migrateSpecializedModelsFile(
      this.userConfigPath,
      'user',
      migrated ?? (await readConfigFile(this.userConfigPath, 'user')),
    )
    const legacyProjects = isObject(this.user.config.projects)
      ? (this.user.config.projects as ConfigObject)
      : {}
    const trustEntries = Object.fromEntries(
      Object.entries(legacyProjects).flatMap(([projectRoot, value]) =>
        isObject(value) &&
        ((value as ConfigObject).trust_level === 'trusted' ||
          (value as ConfigObject).trust_level === 'untrusted')
          ? [[resolve(projectRoot), (value as ConfigObject).trust_level as 'trusted' | 'untrusted']]
          : [],
      ),
    )
    if (Object.keys(trustEntries).length) {
      if (this.trustStore?.import) this.trustStore.import(trustEntries)
      else
        for (const [projectRoot, trustLevel] of Object.entries(trustEntries)) {
          this.memoryTrust.set(projectRoot, trustLevel)
        }
    }
    const userConfigValid = !this.user.diagnostics.some((item) => item.severity === 'error')
    const initializationEdits: ConfigEdit[] = userConfigValid
      ? legacyDesktopMigrationEdits(this.user.config)
      : []
    if (userConfigValid && this.user.config.schema_version === undefined) {
      initializationEdits.push({ keyPath: ['schema_version'], value: 1 })
    }
    if (userConfigValid && this.trustStore && this.user.config.projects !== undefined) {
      initializationEdits.push({ keyPath: ['projects'], value: null })
    }
    if (initializationEdits.length) {
      await this.batchWrite({ edits: initializationEdits })
      this.user = await migrateSpecializedModelsFile(this.userConfigPath, 'user', this.user)
    }
    await this.loadActiveProfile()
    this.watchFile(this.userConfigPath, 'user')
  }

  snapshot(): ConfigObject {
    const base = mergeConfig(this.defaults, runtimeConfig(this.user?.config ?? {}))
    return this.activeProfile ? mergeConfig(base, runtimeConfig(this.activeProfile.config)) : base
  }

  snapshotLayers(cwd?: string): ConfigLayer[] {
    const layers: ConfigLayer[] = [
      {
        kind: 'user',
        displayName: '用户配置',
        filePath: this.userConfigPath,
        version: this.user?.version ?? EMPTY_VERSION,
        writable: true,
        trusted: true,
        config: clone(this.user?.config ?? {}),
      },
    ]
    if (this.activeProfileId && this.activeProfile) {
      layers.push({
        kind: 'profile',
        displayName:
          typeof this.activeProfile.config.display_name === 'string'
            ? this.activeProfile.config.display_name
            : this.activeProfileId,
        filePath: this.profilePath(this.activeProfileId),
        version: this.activeProfile.version,
        writable: true,
        trusted: true,
        config: clone(this.activeProfile.config),
      })
    }
    if (!cwd || !isAbsolute(cwd)) return layers
    const canonicalCwd = resolve(cwd)
    const match = [...this.projects.entries()]
      .map(([filePath, loaded]) => ({
        filePath,
        loaded,
        projectRoot: dirname(dirname(filePath)),
      }))
      .filter(({ projectRoot }) => {
        const child = relative(projectRoot, canonicalCwd)
        return child === '' || (!child.startsWith('..') && !isAbsolute(child))
      })
      .sort((left, right) => right.projectRoot.length - left.projectRoot.length)[0]
    if (!match) return layers
    const trusted = this.trustLevel(match.projectRoot) === 'trusted'
    layers.push({
      kind: 'project',
      displayName: '项目配置',
      filePath: match.filePath,
      version: match.loaded.version,
      writable: trusted,
      trusted,
      config: clone(match.loaded.config),
    })
    return layers
  }

  validateDocument(text: string, scope: ConfigScope) {
    try {
      validateConfig(parseJsoncObject(text), scope)
    } catch (cause) {
      if (cause instanceof ConfigServiceError) throw cause
      throw new ConfigServiceError(
        'CONFIG_VALIDATION_ERROR',
        cause instanceof JsoncDocumentError ? cause.message : 'config.json 语法无效',
      )
    }
  }

  subscribe(listener: (event: ConfigUpdated) => void | Promise<void>) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ConfigUpdated) {
    for (const listener of this.listeners) void listener(event)
  }

  private watchFile(filePath: string, scope: ConfigScope) {
    const directory = dirname(filePath)
    if (this.watchers.has(filePath)) return
    try {
      const watcher = watch(directory, (_event, fileName) => {
        if (fileName?.toString() !== basename(filePath)) return
        const oldTimer = this.refreshTimers.get(filePath)
        if (oldTimer) clearTimeout(oldTimer)
        this.refreshTimers.set(
          filePath,
          setTimeout(() => {
            void this.refreshFile(filePath, scope, [])
          }, 80),
        )
      })
      this.watchers.set(filePath, watcher)
    } catch {}
  }

  private async refreshFile(filePath: string, scope: ConfigScope, changedKeyPaths: string[][]) {
    const profileId = scope === 'profile' ? basename(filePath, '.json') : null
    const previous =
      scope === 'user'
        ? this.user
        : scope === 'profile' && profileId
          ? this.profiles.get(profileId)
          : this.projects.get(filePath)
    const loaded = await readConfigFile(filePath, scope, previous)
    if (scope === 'user') this.user = loaded
    else if (scope === 'profile' && profileId) this.profiles.set(profileId, loaded)
    else this.projects.set(filePath, loaded)
    if (previous?.version !== loaded.version || changedKeyPaths.length > 0) {
      this.emit({
        version: loaded.version,
        changedKeyPaths,
        scope,
        diagnostics: loaded.diagnostics,
        profileState: this.profileState(),
      })
    }
    return loaded
  }

  private async projectLayer(cwd?: string) {
    if (!cwd || !isAbsolute(cwd)) return null
    const filePath = await findProjectConfig(cwd, this.userConfigPath)
    if (!filePath) return null
    const projectRoot = dirname(dirname(filePath))
    const trusted = this.trustLevel(projectRoot) === 'trusted'
    const previous = this.projects.get(filePath)
    const migrated = trusted ? await migrateLegacyToml(filePath, 'project') : undefined
    const loaded = trusted
      ? await migrateSpecializedModelsFile(
          filePath,
          'project',
          migrated ?? (await readConfigFile(filePath, 'project', previous)),
        )
      : (migrated ?? (await readConfigFile(filePath, 'project', previous)))
    this.projects.set(filePath, loaded)
    this.watchFile(filePath, 'project')
    return { filePath, projectRoot, trusted, loaded }
  }

  async read(
    options: { includeLayers?: boolean | undefined; cwd?: string | undefined } = {},
  ): Promise<ConfigReadResult> {
    if (!this.user) await this.initialize()
    this.user = await readConfigFile(this.userConfigPath, 'user', this.user)
    const project = await this.projectLayer(options.cwd)
    const origins: Record<string, ConfigScope | 'defaults'> = {}
    collectOrigins(this.defaults, 'defaults', origins)
    const userRuntime = runtimeConfig(this.user.config)
    collectOrigins(userRuntime, 'user', origins)
    let config = mergeConfig(this.defaults, userRuntime)
    const diagnostics = [...this.user.diagnostics]
    if (this.activeProfile) {
      const profileRuntime = runtimeConfig(this.activeProfile.config)
      config = mergeConfig(config, profileRuntime)
      collectOrigins(profileRuntime, 'profile', origins)
      diagnostics.push(...this.activeProfile.diagnostics)
    }
    if (project) {
      if (project.trusted) {
        config = mergeConfig(config, project.loaded.config)
        collectOrigins(project.loaded.config, 'project', origins)
        diagnostics.push(...project.loaded.diagnostics)
      } else {
        diagnostics.push({
          severity: 'warning',
          code: 'CONFIG_PROJECT_UNTRUSTED',
          message: '项目 config.json 尚未信任，当前已忽略',
          scope: 'project',
        })
      }
    }
    const layers = options.includeLayers
      ? [
          {
            kind: 'defaults' as const,
            displayName: '内置默认值',
            version: EMPTY_VERSION,
            writable: false,
            trusted: true,
            config: clone(this.defaults),
          },
          {
            kind: 'user' as const,
            displayName: '用户配置',
            filePath: this.userConfigPath,
            version: this.user.version,
            writable: true,
            trusted: true,
            config: clone(this.user.config),
          },
          ...(this.activeProfileId && this.activeProfile
            ? [
                {
                  kind: 'profile' as const,
                  displayName:
                    typeof this.activeProfile.config.display_name === 'string'
                      ? this.activeProfile.config.display_name
                      : this.activeProfileId,
                  filePath: this.profilePath(this.activeProfileId),
                  version: this.activeProfile.version,
                  writable: true,
                  trusted: true,
                  config: clone(this.activeProfile.config),
                },
              ]
            : []),
          ...(project
            ? [
                {
                  kind: 'project' as const,
                  displayName: '项目配置',
                  filePath: project.filePath,
                  version: project.loaded.version,
                  writable: project.trusted,
                  trusted: project.trusted,
                  config: clone(project.loaded.config),
                },
              ]
            : []),
        ]
      : undefined
    return {
      config,
      origins,
      ...(layers ? { layers } : {}),
      diagnostics,
      profileState: this.profileState(),
    }
  }

  profileState(): ConfigProfileState {
    const selectedProfile = this.selectedProfile()
    const current = this.activeProfileId ? this.profiles.get(this.activeProfileId) : undefined
    const activeChanged = Boolean(
      this.activeProfile &&
      current &&
      (current.version !== this.activeProfile.version ||
        current.diagnostics.some((item) => item.severity === 'error')),
    )
    return {
      activeProfile: this.activeProfileId,
      selectedProfile,
      restartRequired: selectedProfile !== this.activeProfileId || activeChanged,
    }
  }

  async profileList(): Promise<{
    profileState: ConfigProfileState
    profiles: ConfigProfileSummary[]
    profilesDirectory: string
  }> {
    await mkdir(this.profilesDirectory, { recursive: true })
    const entries = await readdir(this.profilesDirectory, { withFileTypes: true })
    const profiles: ConfigProfileSummary[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
      const id = entry.name.slice(0, -5)
      if (!PROFILE_ID.test(id) || entry.name !== `${id}.json`) continue
      const filePath = this.profilePath(id)
      const loaded = await migrateSpecializedModelsFile(
        filePath,
        'profile',
        await readConfigFile(filePath, 'profile', this.profiles.get(id)),
      )
      this.profiles.set(id, loaded)
      this.watchFile(filePath, 'profile')
      profiles.push({
        id,
        displayName:
          typeof loaded.config.display_name === 'string' ? loaded.config.display_name : id,
        ...(typeof loaded.config.description === 'string'
          ? { description: loaded.config.description }
          : {}),
        filePath,
        version: loaded.version,
        valid: !loaded.diagnostics.some((item) => item.severity === 'error'),
        diagnostics: clone(loaded.diagnostics),
      })
    }
    profiles.sort((left, right) => left.id.localeCompare(right.id, 'en'))
    return {
      profileState: this.profileState(),
      profiles,
      profilesDirectory: this.profilesDirectory,
    }
  }

  async profileSelect(profileId: string | null) {
    if (profileId !== null) {
      const filePath = this.profilePath(profileId)
      if (!(await fileExists(filePath))) {
        throw new ConfigServiceError('CONFIG_PROFILE_NOT_FOUND', `Profile ${profileId} 不存在`)
      }
      const loaded = await migrateSpecializedModelsFile(
        filePath,
        'profile',
        await readConfigFile(filePath, 'profile', this.profiles.get(profileId)),
      )
      if (loaded.diagnostics.some((item) => item.severity === 'error')) {
        throw new ConfigServiceError('CONFIG_PROFILE_INVALID', `Profile ${profileId} 无效`)
      }
      this.profiles.set(profileId, loaded)
      this.watchFile(filePath, 'profile')
    }
    const write = await this.writeValue({
      keyPath: ['profile'],
      value: profileId,
    })
    return { ...write, profileState: this.profileState() }
  }

  private async resolveWriteTarget(filePath?: string, cwd?: string) {
    if (!filePath || resolve(filePath) === resolve(this.userConfigPath)) {
      return { scope: 'user' as const, filePath: this.userConfigPath }
    }
    const project = await this.projectLayer(cwd ?? dirname(dirname(filePath)))
    if (
      !project &&
      cwd &&
      resolve(filePath) === resolve(cwd, PROJECT_CONFIG_DIRECTORY, CONFIG_FILE_NAME)
    ) {
      const projectRoot = resolve(cwd)
      if (this.trustLevel(projectRoot) !== 'trusted') {
        throw new ConfigServiceError('CONFIG_PROJECT_UNTRUSTED', '项目配置尚未信任')
      }
      return { scope: 'project' as const, filePath: resolve(filePath) }
    }
    if (!project || resolve(project.filePath) !== resolve(filePath)) {
      throw new ConfigServiceError('CONFIG_PATH_NOT_FOUND', '配置文件不属于当前用户或项目层')
    }
    if (!project.trusted) {
      throw new ConfigServiceError('CONFIG_PROJECT_UNTRUSTED', '项目配置尚未信任')
    }
    return { scope: 'project' as const, filePath: project.filePath }
  }

  private async resolveStructuredWriteTarget(
    target: NonNullable<ConfigBatchWriteInput['target']>,
    cwd?: string,
  ): Promise<ConfigWriteTarget> {
    if (target.kind === 'user') {
      return { scope: 'user', filePath: this.userConfigPath }
    }
    if (target.kind === 'profile') {
      if (!target.profileId) {
        throw new ConfigServiceError('CONFIG_PROFILE_INVALID', '缺少 Profile ID')
      }
      const filePath = this.profilePath(target.profileId)
      if (!(await fileExists(filePath))) {
        throw new ConfigServiceError('CONFIG_PROFILE_NOT_FOUND', 'Profile 不存在')
      }
      return { scope: 'profile', filePath }
    }
    if (!cwd) {
      throw new ConfigServiceError('CONFIG_PATH_NOT_FOUND', '缺少项目配置工作目录')
    }
    return this.resolveWriteTarget(resolve(cwd, PROJECT_CONFIG_DIRECTORY, CONFIG_FILE_NAME), cwd)
  }

  private async performBatchWrite(
    input: ConfigBatchWriteInput,
    target: ConfigWriteTarget,
  ): Promise<ConfigWriteResult> {
    if (target.scope === 'project' && !input.migrationScope) {
      const projectRoot = resolve(dirname(dirname(target.filePath)))
      if (this.trustLevel(projectRoot) !== 'trusted') {
        throw new ConfigServiceError('CONFIG_PROJECT_UNTRUSTED', '项目配置尚未信任')
      }
    }
    const previous = await readConfigFile(
      target.filePath,
      target.scope,
      target.scope === 'user'
        ? this.user
        : target.scope === 'profile'
          ? this.profiles.get(basename(target.filePath, '.json'))
          : this.projects.get(target.filePath),
    )
    if (input.expectedVersion && input.expectedVersion !== previous.version) {
      throw new ConfigServiceError('CONFIG_VERSION_CONFLICT', 'config.json 已被其他编辑更新')
    }
    if (previous.diagnostics.some((item) => item.severity === 'error')) {
      throw new ConfigServiceError('CONFIG_VALIDATION_ERROR', '请先修复 config.json 语法错误')
    }
    let text: string
    let parsed: ConfigObject
    try {
      text = patchJsonc(previous.text, input.edits)
      parsed = parseJsoncObject(text)
      validateConfig(parsed, target.scope)
    } catch (cause) {
      if (cause instanceof ConfigServiceError) throw cause
      throw new ConfigServiceError(
        'CONFIG_VALIDATION_ERROR',
        cause instanceof JsoncDocumentError ? cause.message : '配置修改产生了无效 JSONC',
      )
    }
    await writeConfigAtomically(target.filePath, text)
    const loaded = await this.refreshFile(
      target.filePath,
      target.scope,
      input.edits.map((edit) => [...edit.keyPath]),
    )

    const effective = await this.read({ cwd: input.cwd })
    const overridden = input.edits
      .filter((edit) => edit.value !== null)
      .map((edit) => ({
        keyPath: [...edit.keyPath],
        by: effective.origins[edit.keyPath.join('.')],
      }))
      .filter(
        (item): item is { keyPath: string[]; by: ConfigScope } =>
          item.by === 'project' || item.by === 'profile' || item.by === 'user',
      )
      .filter((item) => item.by !== target.scope)
    return {
      status: overridden.length > 0 ? 'ok-overridden' : 'ok',
      version: loaded.version,
      filePath: target.filePath,
      ...(overridden.length ? { overridden } : {}),
    }
  }

  async batchWrite(input: ConfigBatchWriteInput): Promise<ConfigWriteResult> {
    if (!this.user) await this.initialize()
    const target =
      input.migrationScope && input.filePath
        ? { scope: input.migrationScope, filePath: resolve(input.filePath) }
        : input.target
          ? await this.resolveStructuredWriteTarget(input.target, input.cwd)
          : await this.resolveWriteTarget(input.filePath, input.cwd)
    const pathKey = writeQueueKey(target.filePath)
    const task = (this.writeQueues.get(pathKey) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.performBatchWrite(input, target))
    const tail = task.then(
      () => undefined,
      () => undefined,
    )
    this.writeQueues.set(pathKey, tail)
    void tail.then(() => {
      if (this.writeQueues.get(pathKey) === tail) this.writeQueues.delete(pathKey)
    })
    return task
  }

  async writeValue(
    input: ConfigEdit & {
      filePath?: string | undefined
      cwd?: string | undefined
      expectedVersion?: string | undefined
      target?: ConfigBatchWriteInput['target']
    },
  ) {
    return this.batchWrite({
      edits: [
        {
          keyPath: input.keyPath,
          value: input.value,
          ...(input.mergeStrategy ? { mergeStrategy: input.mergeStrategy } : {}),
        },
      ],
      ...(input.filePath ? { filePath: input.filePath } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
      ...(input.target ? { target: input.target } : {}),
    })
  }

  async resolveUnresolvedMcp(cwd: string) {
    if (!isAbsolute(cwd)) return false
    const projectRoot = resolve(cwd)
    const hash = createHash('sha256').update(projectRoot.toLowerCase()).digest('hex')
    const servers = valueAtPath(this.user?.config ?? {}, ['migration', 'unresolved_mcp', hash])
    if (!isObject(servers)) return false
    if (this.trustLevel(projectRoot) !== 'trusted') return false
    const projectFile = join(projectRoot, PROJECT_CONFIG_DIRECTORY, CONFIG_FILE_NAME)
    const migrated = await migrateLegacyToml(projectFile, 'project')
    const previous =
      migrated ?? (await readConfigFile(projectFile, 'project', this.projects.get(projectFile)))
    const edits: ConfigEdit[] = []
    const addMissingLeaves = (value: ConfigObject, prefix: string[]) => {
      for (const [key, child] of Object.entries(value)) {
        const path = [...prefix, key]
        if (isObject(child)) addMissingLeaves(child as ConfigObject, path)
        else if (valueAtPath(previous.config, path) === undefined) {
          edits.push({ keyPath: path, value: clone(child) })
        }
      }
    }
    addMissingLeaves(servers as ConfigObject, ['mcp_servers'])
    if (edits.length) {
      await this.batchWrite({
        edits,
        filePath: projectFile,
        migrationScope: 'project',
      })
    }
    await this.batchWrite({
      edits: [
        {
          keyPath: ['migration', 'unresolved_mcp', hash],
          value: null,
        },
      ],
    })
    return true
  }

  async trustRead(cwd: string) {
    const project = await this.projectLayer(cwd)
    const projectRoot = resolve(project?.projectRoot ?? cwd)
    const trusted = this.trustLevel(projectRoot) === 'trusted'
    return {
      projectRoot,
      trustLevel: trusted ? ('trusted' as const) : ('untrusted' as const),
      hasProjectConfig: project !== null,
    }
  }

  async trustUpdate(cwd: string, trustLevel: 'trusted' | 'untrusted', expectedVersion?: string) {
    if (!this.user) await this.initialize()
    const project = await this.projectLayer(cwd)
    const projectRoot = resolve(project?.projectRoot ?? cwd)
    if (expectedVersion && expectedVersion !== this.user!.version) {
      throw new ConfigServiceError('CONFIG_VERSION_CONFLICT', '配置状态已被其他客户端更新')
    }
    this.setTrustLevel(projectRoot, trustLevel)
    if (trustLevel === 'trusted' && project) {
      await this.projectLayer(cwd)
    }
    this.emit({
      version: this.user!.version,
      changedKeyPaths: [],
      scope: 'user',
      diagnostics: clone(this.user!.diagnostics),
      profileState: this.profileState(),
    })
    return {
      status: 'ok' as const,
      version: this.user!.version,
      filePath: this.userConfigPath,
    }
  }

  async notifyFileSaved(workspaceRoot: string, filePath: string) {
    if (filePath === '@pidex/config.json') {
      await this.refreshFile(this.userConfigPath, 'user', [])
      return
    }
    if (filePath.replaceAll('\\', '/').toLowerCase() !== '.pidex/config.json') return
    const target = resolve(workspaceRoot, PROJECT_CONFIG_DIRECTORY, CONFIG_FILE_NAME)
    await this.refreshFile(target, 'project', [])
  }

  async dispose() {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer)
    this.refreshTimers.clear()
    const watchers = [...this.watchers.values()]
    this.watchers.clear()
    await Promise.all(
      watchers.map(
        (watcher) =>
          new Promise<void>((resolve) => {
            watcher.once('close', resolve)
            watcher.close()
          }),
      ),
    )
    this.listeners.clear()
  }
}
