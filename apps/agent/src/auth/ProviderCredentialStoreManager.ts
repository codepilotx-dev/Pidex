import { Effect } from 'effect'
import { AgentError } from '../Domain'
import type { AgentDatabase, StoredCredentialHealth } from '../storage/database/AgentDatabase'
import type { AuthJsonCredentialRepository } from './AuthJsonCredentialRepository'
import type { EncryptedCredentialRepository } from './EncryptedCredentialRepository'
import {
  isProviderCredentialIntegration,
  type PortableProviderCredential,
  type ProviderCredentialRepository,
  type ProviderCredentialStoreKind,
} from './ProviderCredentialRepository'

const JOURNAL_KEY = 'provider.credentials.store-migration.v1'

type MigrationJournal = {
  version: 1
  phase: 'prepared' | 'committed'
  source: ProviderCredentialStoreKind
  target: ProviderCredentialStoreKind
  credentialIds: string[]
  startedAt: number
}

export interface ProviderCredentialStoreSelection {
  read(): ProviderCredentialStoreKind | null
  write(store: ProviderCredentialStoreKind): Promise<void>
}

export type ProviderCredentialStoreStatus = {
  store: ProviderCredentialStoreKind
  portable: boolean
  credentialCount: number
  migrationRequired: boolean
}

export type ProviderCredentialStoreUpdateResult = ProviderCredentialStoreStatus & {
  migratedCredentials: number
}

export class ProviderCredentialStoreManager implements ProviderCredentialRepository {
  private currentKind: ProviderCredentialStoreKind = 'auth-json'
  private current: ProviderCredentialRepository
  private switching = false
  private migrationRequired = false
  private authInitialized = false
  private readonly operations = new Map<
    string,
    {
      target: ProviderCredentialStoreKind
      result: ProviderCredentialStoreUpdateResult
    }
  >()

  constructor(
    private readonly db: AgentDatabase,
    private readonly encrypted: EncryptedCredentialRepository,
    private readonly authJson: AuthJsonCredentialRepository,
    private readonly selection: ProviderCredentialStoreSelection,
  ) {
    this.current = authJson
  }

  initialize() {
    return Effect.tryPromise({
      try: async () => {
        const configured = this.selection.read()
        const encryptedCount = this.encrypted.listProviderCredentials().length
        this.currentKind = configured ?? (encryptedCount > 0 ? 'encrypted' : 'auth-json')
        this.migrationRequired = configured === null && encryptedCount > 0
        if (this.currentKind === 'auth-json') await this.ensureAuthInitialized()
        this.current = this.repository(this.currentKind)
        await this.recover()
        await Effect.runPromise(this.current.validateProviderCredentials())
      },
      catch: (cause) =>
        this.storeError('CREDENTIAL_STORE_UNAVAILABLE', 'Provider 凭据仓库初始化失败', cause),
    })
  }

  status(): ProviderCredentialStoreStatus {
    return {
      store: this.currentKind,
      portable: this.currentKind === 'auth-json',
      credentialCount: this.current.listProviderCredentials().length,
      migrationRequired: this.migrationRequired,
    }
  }

  async updateStore(
    target: ProviderCredentialStoreKind,
    operationID?: string,
  ): Promise<ProviderCredentialStoreUpdateResult> {
    if (operationID) {
      const previous = this.operations.get(operationID)
      if (previous) {
        if (previous.target !== target) {
          throw new AgentError('CONFLICT', 'operationId 已用于其他 Provider 凭据仓库操作', 409)
        }
        return previous.result
      }
    }
    if (target === this.currentKind) {
      this.migrationRequired = false
      await this.selection.write(target)
      const result = { ...this.status(), migratedCredentials: 0 }
      if (operationID) this.operations.set(operationID, { target, result })
      return result
    }
    if (this.switching) {
      throw new AgentError('CONFLICT', 'Provider 凭据仓库正在切换', 409)
    }
    this.switching = true
    const sourceKind = this.currentKind
    const source = this.current
    let selectionUpdated = false
    try {
      if (target === 'auth-json') await this.ensureAuthInitialized()
      const targetRepository = this.repository(target)
      await Effect.runPromise(source.validateProviderCredentials())
      await Effect.runPromise(targetRepository.validateProviderCredentials())
      if (targetRepository.listProviderCredentials().length > 0) {
        throw new AgentError('CONFLICT', '目标 Provider 凭据仓库不是空仓库，已拒绝覆盖', 409)
      }
      const snapshot = await Effect.runPromise(source.exportProviderCredentials())
      const journal: MigrationJournal = {
        version: 1,
        phase: 'prepared',
        source: sourceKind,
        target,
        credentialIds: snapshot.map((credential) => credential.id),
        startedAt: Date.now(),
      }
      this.writeJournal(journal)
      await Effect.runPromise(targetRepository.replaceProviderCredentials(snapshot))
      const written = await Effect.runPromise(targetRepository.exportProviderCredentials())
      if (!this.sameSnapshot(snapshot, written)) {
        throw new AgentError(
          'CREDENTIAL_STORE_MIGRATION_FAILED',
          '迁移后的 Provider 凭据校验失败',
          500,
        )
      }
      await this.selection.write(target)
      selectionUpdated = true
      this.currentKind = target
      this.current = targetRepository
      this.migrationRequired = false
      this.writeJournal({ ...journal, phase: 'committed' })
      await Effect.runPromise(source.clearProviderCredentials())
      this.writeJournal(null)
      const result = { ...this.status(), migratedCredentials: snapshot.length }
      if (operationID) this.operations.set(operationID, { target, result })
      return result
    } catch (cause) {
      if (!selectionUpdated) {
        try {
          await Effect.runPromise(this.repository(target).clearProviderCredentials())
          this.writeJournal(null)
        } catch {
          // The prepared journal is retained for deterministic startup recovery.
        }
      }
      throw this.storeError('CREDENTIAL_STORE_MIGRATION_FAILED', 'Provider 凭据仓库迁移失败', cause)
    } finally {
      this.switching = false
    }
  }

  list() {
    return this.current.list().filter((item) => isProviderCredentialIntegration(item.integrationID))
  }
  listApiKeys(integrationID?: string) {
    return this.current.listApiKeys(integrationID)
  }
  listProviderCredentials(providerID?: string) {
    return this.current.listProviderCredentials(providerID)
  }
  get<T = unknown>(integrationID: string) {
    return this.current.get<T>(integrationID)
  }
  activeCredential<T = unknown>(integrationID: string) {
    return this.current.activeCredential<T>(integrationID)
  }
  getById<T = unknown>(credentialID: string) {
    return this.current.getById<T>(credentialID)
  }
  set(input: { integrationID: string; methodID?: string; label?: string; value: unknown }) {
    return this.guardMutation(() => this.current.set(input))
  }
  upsertOAuth(input: { providerID: string; methodID: string; label?: string; value: unknown }) {
    return this.guardMutation(() => this.current.upsertOAuth(input))
  }
  createApiKey(input: { integrationID: string; label: string; key: string }) {
    return this.guardMutation(() => this.current.createApiKey(input))
  }
  replaceApiKey(credentialID: string, keyInput: string) {
    return this.guardMutation(() => this.current.replaceApiKey(credentialID, keyInput))
  }
  renameApiKey(credentialID: string, labelInput: string) {
    return this.guardMutation(() => this.current.renameApiKey(credentialID, labelInput))
  }
  setActive(integrationID: string, credentialID: string) {
    return this.guardMutation(() => this.current.setActive(integrationID, credentialID))
  }
  compareAndSetActive(integrationID: string, expectedCredentialID: string, credentialID: string) {
    return this.guardMutation(() =>
      this.current.compareAndSetActive(integrationID, expectedCredentialID, credentialID),
    )
  }
  setEnabled(credentialID: string, enabled: boolean) {
    return this.guardMutation(() => this.current.setEnabled(credentialID, enabled))
  }
  reorder(integrationID: string, orderedCredentialIDs: readonly string[]) {
    return this.guardMutation(() => this.current.reorder(integrationID, orderedCredentialIDs))
  }
  deleteApiKey(credentialID: string) {
    return this.guardMutation(() => this.current.deleteApiKey(credentialID))
  }
  setProviderCredentialActive(providerID: string, credentialID: string) {
    return this.guardMutation(() =>
      this.current.setProviderCredentialActive(providerID, credentialID),
    )
  }
  setProviderCredentialEnabled(credentialID: string, enabled: boolean) {
    return this.guardMutation(() =>
      this.current.setProviderCredentialEnabled(credentialID, enabled),
    )
  }
  deleteProviderCredential(credentialID: string) {
    return this.guardMutation(() => this.current.deleteProviderCredential(credentialID))
  }
  deleteCredentialByID(credentialID: string) {
    return this.guardMutation(() => {
      if (!this.current.listProviderCredentials().some((item) => item.id === credentialID)) {
        return Effect.fail(new AgentError('CREDENTIAL_NOT_FOUND', '未找到 Provider 凭据', 404))
      }
      return this.current.deleteCredentialByID(credentialID)
    })
  }
  updateHealth(
    credentialID: string,
    patch: Partial<Omit<StoredCredentialHealth, 'credentialID' | 'updatedAt'>>,
  ) {
    return this.guardMutation(() => this.current.updateHealth(credentialID, patch))
  }
  exportProviderCredentials() {
    return this.current.exportProviderCredentials()
  }
  replaceProviderCredentials(credentials: readonly PortableProviderCredential[]) {
    return this.guardMutation(() => this.current.replaceProviderCredentials(credentials))
  }
  clearProviderCredentials() {
    return this.guardMutation(() => this.current.clearProviderCredentials())
  }
  validateProviderCredentials() {
    return this.current.validateProviderCredentials()
  }

  private guardMutation<T, E>(
    operation: () => Effect.Effect<T, E>,
  ): Effect.Effect<T, E | AgentError> {
    return Effect.suspend(
      () =>
        (this.switching
          ? Effect.fail(new AgentError('CONFLICT', 'Provider 凭据仓库正在切换', 409))
          : operation()) as Effect.Effect<T, E | AgentError>,
    )
  }

  private repository(kind: ProviderCredentialStoreKind): ProviderCredentialRepository {
    return kind === 'encrypted' ? this.encrypted : this.authJson
  }

  private async ensureAuthInitialized() {
    if (this.authInitialized) return
    await Effect.runPromise(this.authJson.initialize())
    this.authInitialized = true
  }

  private async recover() {
    const journal = this.readJournal()
    if (!journal) return
    if (journal.target === 'auth-json') await this.ensureAuthInitialized()
    const target = this.repository(journal.target)
    const source = this.repository(journal.source)
    const configured = this.selection.read()
    const committed = journal.phase === 'committed' || configured === journal.target
    if (committed) {
      await Effect.runPromise(target.validateProviderCredentials())
      await this.selection.write(journal.target)
      this.currentKind = journal.target
      this.current = target
      await Effect.runPromise(source.clearProviderCredentials())
    } else {
      await Effect.runPromise(target.clearProviderCredentials())
      this.currentKind = journal.source
      this.current = source
    }
    this.writeJournal(null)
  }

  private readJournal(): MigrationJournal | null {
    const value = this.db.getSetting<unknown>(JOURNAL_KEY)
    if (value === null || value === undefined) return null
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (value as { version?: unknown }).version !== 1
    ) {
      throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', 'Provider 凭据迁移记录无效', 500)
    }
    const journal = value as MigrationJournal
    if (
      (journal.phase !== 'prepared' && journal.phase !== 'committed') ||
      (journal.source !== 'auth-json' && journal.source !== 'encrypted') ||
      (journal.target !== 'auth-json' && journal.target !== 'encrypted') ||
      journal.source === journal.target ||
      !Array.isArray(journal.credentialIds) ||
      journal.credentialIds.some((id) => typeof id !== 'string')
    ) {
      throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', 'Provider 凭据迁移记录无效', 500)
    }
    return journal
  }

  private writeJournal(value: MigrationJournal | null) {
    this.db.setSetting(JOURNAL_KEY, value)
  }

  private sameSnapshot(
    expected: readonly PortableProviderCredential[],
    actual: readonly PortableProviderCredential[],
  ) {
    const normalize = (items: readonly PortableProviderCredential[]) =>
      [...items]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => ({
          id: item.id,
          integrationID: item.integrationID,
          kind: item.kind,
          methodID: item.methodID,
          label: item.label,
          value: item.value,
          enabled: item.enabled,
          priority: item.priority,
          active: item.active,
        }))
    return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual))
  }

  private storeError(code: string, message: string, cause: unknown) {
    if (cause instanceof AgentError) return cause
    return new AgentError(code, message, 500, cause)
  }
}
