import { Buffer } from 'node:buffer'
import { Effect } from 'effect'
import { AgentError } from '../Domain'
import type {
  AgentDatabase,
  StoredCredentialHealth,
  StoredEncryptedCredential,
} from '../storage/database/AgentDatabase'
import {
  isProviderCredentialIntegration,
  type ApiKeyHealth,
  type ApiKeySummary,
  type CredentialSummary,
  type DecryptedCredential,
  type PortableProviderCredential,
  type ProviderCredentialRepository,
  type ProviderCredentialSummary,
} from './ProviderCredentialRepository'

export type {
  ApiKeyHealth,
  ApiKeySummary,
  CredentialSummary,
  DecryptedCredential,
  ProviderCredentialSummary,
} from './ProviderCredentialRepository'

const SERVICE = 'com.pidex.credentials'
const MASTER_KEY_NAME = 'master-key-v1'
const KEY_VERSION = 1
const KEY_BYTES = 32
const NONCE_BYTES = 12

export interface MasterKeyStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
}

const systemMasterKeyStore: MasterKeyStore = {
  get: () => Bun.secrets.get({ service: SERVICE, name: MASTER_KEY_NAME }),
  set: async (value) => {
    await Bun.secrets.set({ service: SERVICE, name: MASTER_KEY_NAME, value })
  },
}

const encodeBase64 = (value: Uint8Array | ArrayBuffer) =>
  Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString('base64')
const decodeBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'))
const aad = (id: string, integrationID: string) =>
  new TextEncoder().encode(`credential:${id}:${integrationID}:v${KEY_VERSION}`)
const fingerprint = async (key: string) =>
  encodeBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
const keySuffix = (key: string) => key.slice(-4)

const healthSummary = (health: StoredCredentialHealth | null): ApiKeyHealth => ({
  status: health?.status ?? 'untested',
  lastTestedAt: health?.lastTestedAt ?? null,
  lastUsedAt: health?.lastUsedAt ?? null,
  errorCategory: health?.lastErrorCategory ?? null,
  cooldownUntil: health?.cooldownUntil ?? null,
})

export class EncryptedCredentialRepository implements ProviderCredentialRepository {
  constructor(
    private readonly db: AgentDatabase,
    private readonly keyStore: MasterKeyStore = systemMasterKeyStore,
  ) {}

  list(): CredentialSummary[] {
    return this.db.listEncryptedCredentials().map((row) => this.summary(row))
  }

  listApiKeys(integrationID?: string): ApiKeySummary[] {
    return this.db
      .listEncryptedCredentials()
      .filter(
        (row) => row.kind === 'api-key' && (!integrationID || row.integrationID === integrationID),
      )
      .map((row) => ({
        id: row.id,
        integrationID: row.integrationID,
        label: row.label,
        maskedValue: `••••${row.keySuffix ?? ''}`,
        enabled: row.enabled,
        active: this.db.encryptedCredential(row.integrationID)?.id === row.id,
        priority: row.priority,
        health: healthSummary(this.db.credentialHealth(row.id)),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
  }

  listProviderCredentials(providerID?: string): ProviderCredentialSummary[] {
    return this.db
      .listEncryptedCredentials()
      .filter(
        (row) =>
          isProviderCredentialIntegration(row.integrationID) &&
          (!providerID || row.integrationID === providerID),
      )
      .map((row) => ({
        id: row.id,
        providerID: row.integrationID,
        kind: row.kind,
        methodID: row.methodID,
        label: row.label,
        maskedValue: row.kind === 'api-key' ? `••••${row.keySuffix ?? ''}` : null,
        enabled: row.enabled,
        active: this.db.encryptedCredential(row.integrationID)?.id === row.id,
        order: row.priority,
        health: row.kind === 'api-key' ? healthSummary(this.db.credentialHealth(row.id)) : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
  }

  get<T = unknown>(integrationID: string) {
    return this.read<T>(() => this.db.encryptedCredential(integrationID))
  }

  activeCredential<T = unknown>(integrationID: string) {
    return this.get<T>(integrationID)
  }

  getById<T = unknown>(credentialID: string) {
    return this.read<T>(() => this.db.encryptedCredentialByID(credentialID))
  }

  set(input: { integrationID: string; methodID?: string; label?: string; value: unknown }) {
    return Effect.tryPromise({
      try: async () => {
        const previous = this.db.encryptedCredential(input.integrationID)
        const id = previous?.id ?? `cred_${crypto.randomUUID()}`
        const encrypted = await this.encrypt(id, input.integrationID, input.value)
        const apiKey = input.methodID === undefined && this.apiKeyValue(input.value)
        const row = this.db.upsertEncryptedCredential({
          id,
          integrationID: input.integrationID,
          kind: apiKey ? 'api-key' : 'oauth',
          methodID: input.methodID ?? null,
          label: input.label?.trim() || previous?.label || 'default',
          keySuffix: apiKey ? keySuffix(apiKey) : null,
          fingerprint: apiKey ? await fingerprint(apiKey) : null,
          enabled: true,
          priority: previous?.priority ?? 0,
          ...encrypted,
          keyVersion: KEY_VERSION,
        })
        if (apiKey)
          this.db.updateCredentialHealth(row.id, {
            status: 'untested',
            lastTestedAt: null,
            lastErrorCategory: null,
            cooldownUntil: null,
          })
        return this.summary(row)
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法写入加密凭据', cause),
    })
  }

  upsertOAuth(input: { providerID: string; methodID: string; label?: string; value: unknown }) {
    return Effect.tryPromise({
      try: async () => {
        const existing = this.db
          .listEncryptedCredentials()
          .find((row) => row.integrationID === input.providerID && row.kind === 'oauth')
        const previousActiveID = this.db.encryptedCredential(input.providerID)?.id ?? null
        const id = existing?.id ?? `cred_${crypto.randomUUID()}`
        const encrypted = await this.encrypt(id, input.providerID, input.value)
        const row = this.db.upsertEncryptedCredential({
          id,
          integrationID: input.providerID,
          kind: 'oauth',
          methodID: input.methodID,
          label: input.label?.trim() || existing?.label || 'OAuth',
          keySuffix: null,
          fingerprint: null,
          enabled: true,
          priority:
            existing?.priority ??
            this.db
              .listEncryptedCredentials()
              .filter((candidate) => candidate.integrationID === input.providerID).length,
          ...encrypted,
          keyVersion: KEY_VERSION,
        })
        this.db.setActiveEncryptedCredential(input.providerID, previousActiveID ?? row.id)
        return this.listProviderCredentials(input.providerID).find((item) => item.id === row.id)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法写入 OAuth 凭据', cause),
    })
  }

  createApiKey(input: { integrationID: string; label: string; key: string }) {
    return Effect.tryPromise({
      try: async () => {
        const key = input.key.trim()
        const label = input.label.trim()
        if (!key || !label)
          throw new AgentError('INVALID_CREDENTIAL', 'API Key 和名称不能为空', 400)
        const id = `cred_${crypto.randomUUID()}`
        const existing = this.db
          .listEncryptedCredentials()
          .filter((row) => row.integrationID === input.integrationID && row.kind === 'api-key')
        const nextFingerprint = await fingerprint(key)
        if (existing.some((row) => row.fingerprint === nextFingerprint)) {
          throw new AgentError('CONFLICT', '此 Provider 已保存相同的 API Key', 409)
        }
        const previousActiveID = this.db.encryptedCredential(input.integrationID)?.id ?? null
        const encrypted = await this.encrypt(id, input.integrationID, { type: 'key', key })
        const row = this.db.upsertEncryptedCredential({
          id,
          integrationID: input.integrationID,
          kind: 'api-key',
          methodID: null,
          label,
          keySuffix: keySuffix(key),
          fingerprint: nextFingerprint,
          enabled: true,
          priority: existing.length,
          ...encrypted,
          keyVersion: KEY_VERSION,
        })
        // upsertEncryptedCredential establishes the binding; preserve the user's
        // existing active key when this is an additional pool member.
        if (previousActiveID)
          this.db.setActiveEncryptedCredential(input.integrationID, previousActiveID)
        return this.listApiKeys(input.integrationID).find((item) => item.id === row.id)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法写入加密凭据', cause),
    })
  }

  replaceApiKey(credentialID: string, keyInput: string) {
    return Effect.tryPromise({
      try: async () => {
        const row = this.apiKeyRow(credentialID)
        const key = keyInput.trim()
        if (!key) throw new AgentError('INVALID_CREDENTIAL', 'API Key 不能为空', 400)
        const nextFingerprint = await fingerprint(key)
        if (
          this.db
            .listEncryptedCredentials()
            .some(
              (candidate) =>
                candidate.id !== row.id &&
                candidate.integrationID === row.integrationID &&
                candidate.kind === 'api-key' &&
                candidate.fingerprint === nextFingerprint,
            )
        ) {
          throw new AgentError('CONFLICT', '此 Provider 已保存相同的 API Key', 409)
        }
        const encrypted = await this.encrypt(row.id, row.integrationID, { type: 'key', key })
        const updated = this.db.updateEncryptedCredential(row.id, {
          keySuffix: keySuffix(key),
          fingerprint: nextFingerprint,
          ...encrypted,
        })!
        this.db.updateCredentialHealth(row.id, {
          status: 'untested',
          lastTestedAt: null,
          lastErrorCategory: null,
          cooldownUntil: null,
        })
        return this.listApiKeys(row.integrationID).find((item) => item.id === updated.id)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法更换 API Key', cause),
    })
  }

  renameApiKey(credentialID: string, labelInput: string) {
    return Effect.try({
      try: () => {
        const row = this.apiKeyRow(credentialID)
        const label = labelInput.trim()
        if (!label) throw new AgentError('INVALID_CREDENTIAL', 'API Key 名称不能为空', 400)
        this.db.updateEncryptedCredential(row.id, { label })
        return this.listApiKeys(row.integrationID).find((item) => item.id === row.id)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法重命名 API Key', cause),
    })
  }

  setActive(integrationID: string, credentialID: string) {
    return Effect.try({
      try: () => {
        const row = this.apiKeyRow(credentialID)
        if (
          row.integrationID !== integrationID ||
          !this.db.setActiveEncryptedCredential(integrationID, credentialID)
        ) {
          throw new AgentError('INVALID_CREDENTIAL', 'API Key 不属于该 Provider 或已停用', 400)
        }
        return this.listApiKeys(integrationID).find((item) => item.id === credentialID)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法设置当前 API Key', cause),
    })
  }

  compareAndSetActive(integrationID: string, expectedCredentialID: string, credentialID: string) {
    return Effect.sync(() =>
      this.db.compareAndSetActiveEncryptedCredential(
        integrationID,
        expectedCredentialID,
        credentialID,
      ),
    )
  }

  setEnabled(credentialID: string, enabled: boolean) {
    return Effect.try({
      try: () => {
        const row = this.apiKeyRow(credentialID)
        if (!enabled && this.db.encryptedCredential(row.integrationID)?.id === row.id) {
          this.db.profileSqlite.transaction(() => {
            this.db.updateEncryptedCredential(row.id, { enabled: false })
            this.db.clearActiveEncryptedCredential(row.integrationID, row.id)
          })()
        } else {
          this.db.updateEncryptedCredential(row.id, { enabled })
        }
        return this.listApiKeys(row.integrationID).find((item) => item.id === row.id)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法更新 API Key 状态', cause),
    })
  }

  reorder(integrationID: string, orderedCredentialIDs: readonly string[]) {
    return Effect.try({
      try: () => {
        if (!this.db.reorderEncryptedCredentials(integrationID, orderedCredentialIDs)) {
          throw new AgentError('INVALID_CREDENTIAL_ORDER', 'API Key 排序列表不完整', 400)
        }
        return this.listApiKeys(integrationID)
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法调整 API Key 顺序', cause),
    })
  }

  deleteApiKey(credentialID: string) {
    return Effect.try({
      try: () => {
        this.apiKeyRow(credentialID)
        return this.db.deleteEncryptedCredential(credentialID)
      },
      catch: (cause) => this.error('CREDENTIAL_DELETE_FAILED', '无法删除 API Key', cause),
    })
  }

  setProviderCredentialActive(providerID: string, credentialID: string) {
    return Effect.try({
      try: () => {
        const row = this.db.encryptedCredentialByID(credentialID)
        if (
          !row ||
          !isProviderCredentialIntegration(row.integrationID) ||
          row.integrationID !== providerID ||
          !row.enabled ||
          !this.db.setActiveEncryptedCredential(providerID, credentialID)
        ) {
          throw new AgentError('INVALID_CREDENTIAL', '凭据不属于该 Provider 或已停用', 400)
        }
        return this.listProviderCredentials(providerID).find((item) => item.id === credentialID)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法设置活动凭据', cause),
    })
  }

  setProviderCredentialEnabled(credentialID: string, enabled: boolean) {
    return Effect.try({
      try: () => {
        const row = this.db.encryptedCredentialByID(credentialID)
        if (!row || !isProviderCredentialIntegration(row.integrationID)) {
          throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 Provider 凭据', 404)
        }
        this.db.profileSqlite.transaction(() => {
          this.db.updateEncryptedCredential(row.id, { enabled })
          if (!enabled) {
            this.db.clearActiveEncryptedCredential(row.integrationID, row.id)
          }
        })()
        return this.listProviderCredentials(row.integrationID).find((item) => item.id === row.id)!
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法更新凭据状态', cause),
    })
  }

  deleteProviderCredential(credentialID: string) {
    return Effect.try({
      try: () => {
        const row = this.db.encryptedCredentialByID(credentialID)
        if (!row || !isProviderCredentialIntegration(row.integrationID)) {
          throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 Provider 凭据', 404)
        }
        if (!this.db.deleteEncryptedCredential(credentialID)) {
          throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 Provider 凭据', 404)
        }
        return this.listProviderCredentials(row.integrationID)
      },
      catch: (cause) => this.error('CREDENTIAL_DELETE_FAILED', '无法删除 Provider 凭据', cause),
    })
  }

  deleteCredentialByID(credentialID: string) {
    return Effect.try({
      try: () => {
        if (!this.db.deleteEncryptedCredential(credentialID)) {
          throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到凭据', 404)
        }
        return true
      },
      catch: (cause) => this.error('CREDENTIAL_DELETE_FAILED', '无法删除凭据', cause),
    })
  }

  updateHealth(
    credentialID: string,
    patch: Partial<Omit<StoredCredentialHealth, 'credentialID' | 'updatedAt'>>,
  ) {
    return Effect.try({
      try: () => {
        this.apiKeyRow(credentialID)
        return healthSummary(this.db.updateCredentialHealth(credentialID, patch))
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法更新 API Key 健康状态', cause),
    })
  }

  backfillApiKeyMetadata() {
    return Effect.tryPromise({
      try: async () => {
        let updated = 0
        for (const row of this.db.listEncryptedCredentials()) {
          if (row.kind !== 'api-key' || (row.keySuffix && row.fingerprint)) continue
          const decrypted = await this.decrypt<{ type?: string; key?: string }>(row)
          if (decrypted?.key && typeof decrypted.key === 'string') {
            this.db.updateEncryptedCredential(row.id, {
              keySuffix: keySuffix(decrypted.key),
              fingerprint: await fingerprint(decrypted.key),
            })
            updated += 1
          }
        }
        return updated
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法补齐 API Key 元数据', cause),
    })
  }

  exportProviderCredentials() {
    return Effect.tryPromise({
      try: async (): Promise<PortableProviderCredential[]> => {
        const activeByIntegration = new Map<string, string>()
        for (const row of this.db.listEncryptedCredentials()) {
          if (!isProviderCredentialIntegration(row.integrationID)) continue
          const active = this.db.encryptedCredential(row.integrationID)
          if (active) activeByIntegration.set(row.integrationID, active.id)
        }
        const exported: PortableProviderCredential[] = []
        for (const row of this.db.listEncryptedCredentials()) {
          if (!isProviderCredentialIntegration(row.integrationID)) continue
          exported.push({
            id: row.id,
            integrationID: row.integrationID,
            kind: row.kind,
            methodID: row.methodID,
            label: row.label,
            value: await this.decrypt(row),
            enabled: row.enabled,
            priority: row.priority,
            active: activeByIntegration.get(row.integrationID) === row.id,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            health: row.kind === 'api-key' ? healthSummary(this.db.credentialHealth(row.id)) : null,
          })
        }
        return exported
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法读取 Provider 凭据', cause),
    })
  }

  replaceProviderCredentials(credentials: readonly PortableProviderCredential[]) {
    return Effect.tryPromise({
      try: async () => {
        const prepared = await Promise.all(
          credentials.map(async (credential) => {
            const value = this.apiKeyValue(credential.value)
            return {
              credential,
              value,
              fingerprint: value ? await fingerprint(value) : null,
              encrypted: await this.encrypt(
                credential.id,
                credential.integrationID,
                credential.value,
              ),
            }
          }),
        )
        this.db.profileSqlite.transaction(() => {
          for (const row of this.db.listEncryptedCredentials()) {
            if (isProviderCredentialIntegration(row.integrationID)) {
              this.db.deleteEncryptedCredential(row.id)
            }
          }
          for (const { credential, encrypted, fingerprint: keyFingerprint, value } of prepared) {
            this.db.upsertEncryptedCredential({
              id: credential.id,
              integrationID: credential.integrationID,
              kind: credential.kind,
              methodID: credential.methodID,
              label: credential.label,
              keySuffix: value ? keySuffix(value) : null,
              fingerprint: keyFingerprint,
              enabled: credential.enabled,
              priority: credential.priority,
              ...encrypted,
              keyVersion: KEY_VERSION,
            })
          }
          for (const credential of credentials) {
            if (credential.active && credential.enabled) {
              this.db.setActiveEncryptedCredential(credential.integrationID, credential.id)
            }
            if (credential.health) {
              this.db.updateCredentialHealth(credential.id, {
                status: credential.health.status,
                lastTestedAt: credential.health.lastTestedAt,
                lastUsedAt: credential.health.lastUsedAt,
                lastErrorCategory: credential.health.errorCategory,
                cooldownUntil: credential.health.cooldownUntil,
              })
            }
          }
        })()
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法写入 Provider 凭据', cause),
    })
  }

  clearProviderCredentials() {
    return Effect.try({
      try: () => {
        this.db.profileSqlite.transaction(() => {
          for (const row of this.db.listEncryptedCredentials()) {
            if (isProviderCredentialIntegration(row.integrationID)) {
              this.db.deleteEncryptedCredential(row.id)
            }
          }
        })()
      },
      catch: (cause) => this.error('CREDENTIAL_DELETE_FAILED', '无法清理 Provider 凭据', cause),
    })
  }

  validateProviderCredentials() {
    return Effect.tryPromise({
      try: async () => {
        for (const row of this.db.listEncryptedCredentials()) {
          if (isProviderCredentialIntegration(row.integrationID)) {
            await this.decrypt(row)
          }
        }
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法验证 Provider 凭据', cause),
    })
  }

  validateAll() {
    return Effect.tryPromise({
      try: async () => {
        for (const row of this.db.listEncryptedCredentials()) {
          await this.decrypt(row)
        }
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法验证迁移后的加密凭据', cause),
    })
  }

  remove(integrationID: string) {
    return Effect.sync(() => this.db.removeEncryptedCredential(integrationID))
  }

  private read<T>(find: () => StoredEncryptedCredential | null) {
    return Effect.tryPromise({
      try: async () => {
        const row = find()
        if (!row) return null
        return {
          id: row.id,
          integrationID: row.integrationID,
          kind: row.kind,
          methodID: row.methodID,
          label: row.label,
          value: await this.decrypt<T>(row),
        } satisfies DecryptedCredential<T>
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法读取加密凭据', cause),
    })
  }

  private async decrypt<T>(row: StoredEncryptedCredential): Promise<T> {
    if (row.keyVersion !== KEY_VERSION)
      throw new AgentError(
        'CREDENTIAL_KEY_VERSION_UNSUPPORTED',
        `不支持凭据密钥版本 ${row.keyVersion}`,
        500,
      )
    const key = await this.masterKey(false)
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeBase64(row.nonce),
        additionalData: aad(row.id, row.integrationID),
      },
      key,
      decodeBase64(row.ciphertext),
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  }

  private async encrypt(id: string, integrationID: string, value: unknown) {
    const key = await this.masterKey(true)
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad(id, integrationID) },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    )
    return { ciphertext: encodeBase64(ciphertext), nonce: encodeBase64(nonce) }
  }

  private apiKeyValue(value: unknown) {
    if (!value || typeof value !== 'object' || !('type' in value) || !('key' in value)) return null
    return value.type === 'key' && typeof value.key === 'string' ? value.key : null
  }

  private apiKeyRow(credentialID: string) {
    const row = this.db.encryptedCredentialByID(credentialID)
    if (!row || row.kind !== 'api-key')
      throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 API Key', 404)
    return row
  }

  private summary(row: StoredEncryptedCredential): CredentialSummary {
    return {
      id: row.id,
      integrationID: row.integrationID,
      kind: row.kind,
      methodID: row.methodID,
      label: row.label,
      keyVersion: row.keyVersion,
      enabled: row.enabled,
      priority: row.priority,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async masterKey(create: boolean) {
    const stored = await this.keyStore.get()
    if (stored) {
      const bytes = decodeBase64(stored)
      if (bytes.byteLength === KEY_BYTES)
        return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
      if (this.db.credentialCount() > 0)
        throw new AgentError('CREDENTIAL_KEY_UNAVAILABLE', '系统主密钥无效，无法解密现有凭据', 500)
    }
    if (!create || this.db.credentialCount() > 0)
      throw new AgentError('CREDENTIAL_KEY_UNAVAILABLE', '系统主密钥不存在，无法解密现有凭据', 500)
    const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES))
    await this.keyStore.set(encodeBase64(bytes))
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }

  private error(code: string, message: string, cause: unknown) {
    if (cause instanceof AgentError) return cause
    return new AgentError(code, message, 500, cause)
  }
}
