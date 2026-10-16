import { Effect } from 'effect'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface AgentConfig {
  host: string
  port: number
  authToken: string | null
  dataDir: string
  documentsDir: string
  logDir: string
  historyDatabasePath: string
  profileDatabasePath: string
  legacyDatabasePath: string
  piModelCachePath: string
  rendererDir: string | null
  rendererDevURL: string | null
  githubAuthBrokerURL: string | null
  githubOAuthClientId: string | null
  petsDir: string
  legacyDataDir: string | null
  legacyPetsDir: string | null
  relocationSourceDir: string | null
  relocationOperationId: string | null
  legacyAppearanceSettingsPath: string | null
  builtinSkillsRoot: string
  builtinPluginsRoot: string
  storage: AgentStorageLayout
}

export interface AgentStorageLayout {
  dataRoot: string
  userConfig: string
  historyDatabase: string
  profileDatabase: string
  legacyDatabase: string
  piModelCache: string
  hooksFile: string
  skillsRoot: string
  pluginsRoot: string
  pluginCacheRoot: string
  pluginInstallStagingRoot: string
  attachmentsRoot: string
  petsRoot: string
  toolingRoot: string
  speechRoot: string
  workspacesRoot: string
  logsRoot: string
}

const asPort = (value: string | undefined) => {
  const parsed = Number(value ?? '0')
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 0
}

export const resolveAgentDataDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string => resolve(environment.PIDEX_DATA_DIR?.trim() || join(userHome, '.pidex'))

export const resolveAgentLogDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string => {
  const dataDir = resolveAgentDataDirectory(environment, userHome)
  return resolve(environment.PIDEX_LOG_DIR?.trim() || join(dataDir, 'logs'))
}

export const resolveAgentPetsDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string => {
  const dataDir = resolveAgentDataDirectory(environment, userHome)
  return resolve(environment.PIDEX_PETS_DIR?.trim() || join(dataDir, 'pets'))
}

export const resolveBuiltinSkillsDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const configured = environment.PIDEX_BUILTIN_SKILLS_DIR?.trim()
  if (configured) return resolve(configured)

  const executableSibling = resolve(dirname(process.execPath), 'skills')
  if (existsSync(executableSibling)) return executableSibling

  return resolve(import.meta.dir, '../../resources/skills')
}

export const resolveBuiltinPluginsDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const configured = environment.PIDEX_BUILTIN_PLUGINS_DIR?.trim()
  if (configured) return resolve(configured)

  const executableSibling = resolve(dirname(process.execPath), 'plugins')
  if (existsSync(executableSibling)) return executableSibling

  return resolve(import.meta.dir, '../../resources/plugins')
}

export const resolveAgentStorageLayout = (
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): AgentStorageLayout => {
  const dataRoot = resolveAgentDataDirectory(environment, userHome)
  return {
    dataRoot,
    userConfig: resolve(dataRoot, 'config.json'),
    historyDatabase: resolve(dataRoot, 'history.sqlite'),
    profileDatabase: resolve(dataRoot, 'profile.sqlite'),
    legacyDatabase: resolve(dataRoot, 'agent.sqlite'),
    piModelCache: resolve(dataRoot, 'pi-models.cache.json'),
    hooksFile: resolve(dataRoot, 'hooks.json'),
    skillsRoot: resolve(dataRoot, 'skills'),
    pluginsRoot: resolve(dataRoot, 'plugins'),
    pluginCacheRoot: resolve(dataRoot, 'plugins', 'cache'),
    pluginInstallStagingRoot: resolve(dataRoot, 'plugins', '.install-staging'),
    attachmentsRoot: resolve(dataRoot, 'attachments'),
    petsRoot: resolveAgentPetsDirectory(environment, userHome),
    toolingRoot: resolve(environment.PIDEX_TOOLING_HOME?.trim() || join(dataRoot, 'tooling')),
    speechRoot: resolve(dataRoot, 'speech'),
    workspacesRoot: resolve(dataRoot, 'workspaces'),
    logsRoot: resolveAgentLogDirectory(environment, userHome),
  }
}

export const loadConfig = Effect.sync((): AgentConfig => {
  const storage = resolveAgentStorageLayout()
  const dataDir = storage.dataRoot
  return {
    host: '127.0.0.1',
    port: asPort(process.env.PIDEX_PORT ?? process.env.PORT),
    authToken: process.env.PIDEX_AUTH_TOKEN ?? null,
    dataDir,
    documentsDir: resolve(process.env.PIDEX_DOCUMENTS_DIR ?? join(homedir(), 'Documents')),
    logDir: storage.logsRoot,
    historyDatabasePath: storage.historyDatabase,
    profileDatabasePath: storage.profileDatabase,
    legacyDatabasePath: storage.legacyDatabase,
    piModelCachePath: storage.piModelCache,
    rendererDir: process.env.PIDEX_RENDERER_DIST
      ? resolve(process.env.PIDEX_RENDERER_DIST)
      : process.env.PIDEX_STATIC_DIR
        ? resolve(process.env.PIDEX_STATIC_DIR)
        : process.env.PIDEX_RENDERER_DIR
          ? resolve(process.env.PIDEX_RENDERER_DIR)
          : null,
    rendererDevURL: process.env.PIDEX_RENDERER_DEV_URL ?? process.env.PIDEX_RENDERER_URL ?? null,
    githubAuthBrokerURL:
      process.env.PIDEX_GITHUB_AUTH_BROKER_URL?.trim() || 'https://auth-staging.codepilotx.top',
    githubOAuthClientId: process.env.PIDEX_GITHUB_OAUTH_CLIENT_ID?.trim() || null,
    petsDir: storage.petsRoot,
    legacyDataDir: process.env.PIDEX_LEGACY_DATA_DIR?.trim()
      ? resolve(process.env.PIDEX_LEGACY_DATA_DIR)
      : null,
    legacyPetsDir: process.env.CODEX_HOME?.trim() ? resolve(process.env.CODEX_HOME, 'pets') : null,
    relocationSourceDir: process.env.PIDEX_RELOCATION_SOURCE_DIR?.trim()
      ? resolve(process.env.PIDEX_RELOCATION_SOURCE_DIR)
      : null,
    relocationOperationId: process.env.PIDEX_RELOCATION_OPERATION_ID?.trim() || null,
    legacyAppearanceSettingsPath: process.env.PIDEX_LEGACY_APPEARANCE_SETTINGS_PATH?.trim()
      ? resolve(process.env.PIDEX_LEGACY_APPEARANCE_SETTINGS_PATH)
      : null,
    builtinSkillsRoot: resolveBuiltinSkillsDirectory(),
    builtinPluginsRoot: resolveBuiltinPluginsDirectory(),
    storage,
  }
})
