export type SkillSettingsState = {
  version: 1
  disabledPathHashes: string[]
  generation: number
  updatedAt: number
  operations: Array<{
    operationId: string
    pathHash: string
    enabled: boolean
    generation: number
    updatedAt: number
  }>
}

type SettingsDatabase = {
  getSetting<T>(key: string): T | null
  setSetting(key: string, value: unknown): void
}

const SETTINGS_KEY = 'skills.runtime.v1'
const MAX_OPERATIONS = 100
const defaultState = (): SkillSettingsState => ({
  version: 1,
  disabledPathHashes: [],
  generation: 1,
  updatedAt: 0,
  operations: [],
})

const normalizeState = (value: SkillSettingsState | null): SkillSettingsState => {
  if (!value || value.version !== 1) return defaultState()
  return {
    version: 1,
    disabledPathHashes: [
      ...new Set(value.disabledPathHashes.filter((hash) => /^[a-f\d]{64}$/i.test(hash))),
    ],
    generation:
      Number.isSafeInteger(value.generation) && value.generation >= 1 ? value.generation : 1,
    updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0,
    operations: Array.isArray(value.operations)
      ? value.operations
          .filter(
            (operation) =>
              typeof operation.operationId === 'string' &&
              /^[a-f\d]{64}$/i.test(operation.pathHash) &&
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

export class SkillSettingsConflictError extends Error {}

export class SkillSettingsRepository {
  constructor(private readonly database: SettingsDatabase) {}

  state() {
    return normalizeState(this.database.getSetting<SkillSettingsState>(SETTINGS_KEY))
  }

  disabledPathHashes() {
    return new Set(this.state().disabledPathHashes)
  }

  setEnabled(input: { pathHash: string; enabled: boolean; operationId: string }) {
    const state = this.state()
    const existing = state.operations.find(
      (operation) => operation.operationId === input.operationId,
    )
    if (existing) {
      if (existing.pathHash !== input.pathHash || existing.enabled !== input.enabled) {
        throw new SkillSettingsConflictError('operationId 已用于其他技能设置请求')
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

    const disabled = new Set(state.disabledPathHashes)
    const wasEnabled = !disabled.has(input.pathHash)
    if (input.enabled) disabled.delete(input.pathHash)
    else disabled.add(input.pathHash)
    const changed = wasEnabled !== input.enabled
    const updatedAt = changed ? Date.now() : state.updatedAt
    const generation = changed ? state.generation + 1 : state.generation
    const next: SkillSettingsState = {
      version: 1,
      disabledPathHashes: [...disabled].sort(),
      generation,
      updatedAt,
      operations: [
        ...state.operations,
        {
          operationId: input.operationId,
          pathHash: input.pathHash,
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
