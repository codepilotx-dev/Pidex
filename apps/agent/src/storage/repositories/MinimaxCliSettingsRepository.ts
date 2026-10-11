export type MiniMaxCliRuntimeState = {
  version: 1
  syncedProviderId?: 'minimax-cn-coding-plan' | 'minimax-coding-plan'
  syncedCredentialId?: string
  syncedCredentialFingerprint?: string
  generation: number
  updatedAt: number
  operations: Array<{
    operationId: string
    kind: 'install' | 'uninstall'
    generation: number
    updatedAt: number
  }>
}

type SettingsDatabase = {
  getSetting<T>(key: string): T | null
  setSetting(key: string, value: unknown): void
}

const SETTINGS_KEY = 'integrations.minimax-cli.runtime.v1'
const MAX_OPERATIONS = 50
const fingerprintPattern = /^[a-f\d]{64}$/i

const defaultState = (): MiniMaxCliRuntimeState => ({
  version: 1,
  generation: 1,
  updatedAt: 0,
  operations: [],
})

const normalizeState = (value: MiniMaxCliRuntimeState | null): MiniMaxCliRuntimeState => {
  if (!value || value.version !== 1) return defaultState()
  const provider =
    value.syncedProviderId === 'minimax-cn-coding-plan' ||
    value.syncedProviderId === 'minimax-coding-plan'
      ? value.syncedProviderId
      : undefined
  return {
    version: 1,
    ...(provider ? { syncedProviderId: provider } : {}),
    ...(typeof value.syncedCredentialId === 'string' && value.syncedCredentialId
      ? { syncedCredentialId: value.syncedCredentialId }
      : {}),
    ...(typeof value.syncedCredentialFingerprint === 'string' &&
    fingerprintPattern.test(value.syncedCredentialFingerprint)
      ? { syncedCredentialFingerprint: value.syncedCredentialFingerprint }
      : {}),
    generation:
      Number.isSafeInteger(value.generation) && value.generation >= 1 ? value.generation : 1,
    updatedAt: Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? value.updatedAt : 0,
    operations: Array.isArray(value.operations)
      ? value.operations
          .filter(
            (operation) =>
              typeof operation.operationId === 'string' &&
              (operation.kind === 'install' || operation.kind === 'uninstall') &&
              Number.isSafeInteger(operation.generation) &&
              operation.generation >= 1 &&
              Number.isFinite(operation.updatedAt) &&
              operation.updatedAt >= 0,
          )
          .slice(-MAX_OPERATIONS)
      : [],
  }
}

export class MiniMaxCliSettingsConflictError extends Error {}

export class MiniMaxCliSettingsRepository {
  constructor(private readonly database: SettingsDatabase) {}

  state() {
    return normalizeState(this.database.getSetting<MiniMaxCliRuntimeState>(SETTINGS_KEY))
  }

  recordCredential(input: {
    providerId?: MiniMaxCliRuntimeState['syncedProviderId']
    credentialId?: string
    fingerprint?: string
  }) {
    const current = this.state()
    const changed =
      current.syncedProviderId !== input.providerId ||
      current.syncedCredentialId !== input.credentialId ||
      current.syncedCredentialFingerprint !== input.fingerprint
    if (!changed) return { state: current, changed: false }
    const next: MiniMaxCliRuntimeState = {
      ...current,
      ...(input.providerId ? { syncedProviderId: input.providerId } : {}),
      ...(input.credentialId ? { syncedCredentialId: input.credentialId } : {}),
      ...(input.fingerprint ? { syncedCredentialFingerprint: input.fingerprint } : {}),
      generation: current.generation + 1,
      updatedAt: Date.now(),
    }
    if (!input.providerId) delete next.syncedProviderId
    if (!input.credentialId) delete next.syncedCredentialId
    if (!input.fingerprint) delete next.syncedCredentialFingerprint
    this.database.setSetting(SETTINGS_KEY, next)
    return { state: next, changed: true }
  }

  prepareOperation(operationId: string, kind: 'install' | 'uninstall') {
    const current = this.state()
    const existing = current.operations.find((operation) => operation.operationId === operationId)
    if (existing) {
      if (existing.kind !== kind) {
        throw new MiniMaxCliSettingsConflictError('operationId 已用于其他 MiniMax CLI 操作')
      }
      return { state: current, repeated: true }
    }
    return { state: current, repeated: false }
  }

  completeOperation(operationId: string, kind: 'install' | 'uninstall') {
    const prepared = this.prepareOperation(operationId, kind)
    if (prepared.repeated) return { state: prepared.state, changed: false }
    const updatedAt = Date.now()
    const next: MiniMaxCliRuntimeState = {
      ...prepared.state,
      generation: prepared.state.generation + 1,
      updatedAt,
      operations: [
        ...prepared.state.operations,
        {
          operationId,
          kind,
          generation: prepared.state.generation + 1,
          updatedAt,
        },
      ].slice(-MAX_OPERATIONS),
    }
    this.database.setSetting(SETTINGS_KEY, next)
    return { state: next, changed: true }
  }
}
