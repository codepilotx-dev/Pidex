export type PluginRuntimeState = {
  version: 1
  disabledPluginIds: string[]
  generation: number
  updatedAt: number
  operations: Array<{
    operationId: string
    pluginId: string
    enabled: boolean
    generation: number
    updatedAt: number
  }>
}

type SettingsDatabase = {
  getSetting<T>(key: string): T | null
  setSetting(key: string, value: unknown): void
  profileSqlite: { transaction<T>(work: () => T): () => T }
}

const SETTINGS_KEY = 'plugins.runtime.v1'
const MAX_OPERATIONS = 100
const pluginIdPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/

const defaultState = (): PluginRuntimeState => ({
  version: 1,
  disabledPluginIds: [],
  generation: 1,
  updatedAt: 0,
  operations: [],
})

const normalizeState = (value: PluginRuntimeState | null): PluginRuntimeState => {
  if (!value || value.version !== 1) return defaultState()
  return {
    version: 1,
    disabledPluginIds: [
      ...new Set(value.disabledPluginIds.filter((pluginId) => pluginIdPattern.test(pluginId))),
    ].sort(),
    generation:
      Number.isSafeInteger(value.generation) && value.generation >= 1 ? value.generation : 1,
    updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0,
    operations: Array.isArray(value.operations)
      ? value.operations
          .filter(
            (operation) =>
              typeof operation.operationId === 'string' &&
              pluginIdPattern.test(operation.pluginId) &&
              typeof operation.enabled === 'boolean' &&
              Number.isSafeInteger(operation.generation) &&
              operation.generation >= 1 &&
              Number.isFinite(operation.updatedAt) &&
              operation.updatedAt >= 0,
          )
          .slice(-MAX_OPERATIONS)
      : [],
  }
}

export class PluginSettingsConflictError extends Error {}

export class PluginSettingsRepository {
  constructor(private readonly database: SettingsDatabase) {}

  state() {
    return normalizeState(this.database.getSetting<PluginRuntimeState>(SETTINGS_KEY))
  }

  initializeComputerUse(legacyEnabled: boolean) {
    this.database.profileSqlite.transaction(() => {
      const marker = 'plugins.computer-use.initialized.v1'
      const raw = this.database.getSetting<PluginRuntimeState>(SETTINGS_KEY)
      if (raw && raw.version !== 1) throw new Error('不支持的插件设置版本')
      if (this.database.getSetting(marker) === true) return
      const state = this.state()
      const explicitlyConfigured =
        state.disabledPluginIds.includes('computer-use') ||
        state.operations.some((operation) => operation.pluginId === 'computer-use')
      if (!explicitlyConfigured && !legacyEnabled) {
        this.setEnabled({
          pluginId: 'computer-use',
          enabled: false,
          operationId: 'migration:computer-use:v1',
        })
      }
      this.database.setSetting(marker, true)
    })()
  }

  setEnabled(input: { pluginId: string; enabled: boolean; operationId: string }) {
    const state = this.state()
    const existing = state.operations.find(
      (operation) => operation.operationId === input.operationId,
    )
    if (existing) {
      if (existing.pluginId !== input.pluginId || existing.enabled !== input.enabled) {
        throw new PluginSettingsConflictError('operationId 已用于其他插件设置请求')
      }
      return {
        state: {
          ...state,
          generation: existing.generation,
          updatedAt: existing.updatedAt,
        },
        changed: false,
      }
    }

    const disabled = new Set(state.disabledPluginIds)
    const wasEnabled = !disabled.has(input.pluginId)
    if (input.enabled) disabled.delete(input.pluginId)
    else disabled.add(input.pluginId)
    const changed = wasEnabled !== input.enabled
    const updatedAt = changed ? Date.now() : state.updatedAt
    const generation = changed ? state.generation + 1 : state.generation
    const next: PluginRuntimeState = {
      version: 1,
      disabledPluginIds: [...disabled].sort(),
      generation,
      updatedAt,
      operations: [
        ...state.operations,
        {
          operationId: input.operationId,
          pluginId: input.pluginId,
          enabled: input.enabled,
          generation,
          updatedAt,
        },
      ].slice(-MAX_OPERATIONS),
    }
    this.database.setSetting(SETTINGS_KEY, next)
    return { state: next, changed }
  }
}
