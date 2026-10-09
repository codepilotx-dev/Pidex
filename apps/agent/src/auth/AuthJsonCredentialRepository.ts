import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Effect } from 'effect'
import { AgentError } from '../Domain'
import type { StoredCredentialHealth } from '../storage/database/AgentDatabase'
import {
  type ApiKeyHealth,
  type ApiKeySummary,
  type CredentialSummary,
  type DecryptedCredential,
  type PortableProviderCredential,
  type ProviderCredentialRepository,
  type ProviderCredentialSummary,
} from './ProviderCredentialRepository'
import { isRecord } from '@pidex/shared/guards'

const FORMAT = 'pidex-provider-auth'
const SCHEMA_VERSION = 1

type JsonCredential = {
  id: string
  type: 'api' | 'oauth'
  methodId?: string
  label: string
  enabled: boolean
  priority: number
  key?: string
  refresh?: string
  access?: string
  expires?: number
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type JsonProvider = {
  activeId?: string
  credentials: JsonCredential[]
}

type AuthDocument = {
  format: typeof FORMAT
  schemaVersion: typeof SCHEMA_VERSION
  providers: Record<string, JsonProvider>
}

const emptyDocument = (): AuthDocument => ({
  format: FORMAT,
  schemaVersion: SCHEMA_VERSION,
  providers: {},
})

const keySuffix = (key: string) => key.slice(-4)
const healthDefault = (): ApiKeyHealth => ({
  status: 'untested',
  lastTestedAt: null,
  lastUsedAt: null,
  errorCategory: null,
  cooldownUntil: null,
})

const requiredString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', `auth.json 的 ${field} 字段无效`, 500)
  }
  return value
}

const requiredText = (value: unknown, field: string) => {
  if (typeof value !== 'string') {
    throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', `auth.json 的 ${field} 字段无效`, 500)
  }
  return value
}

const optionalMetadata = (value: unknown) =>
  value === undefined ? undefined : isRecord(value) ? value : undefined

export class AuthJsonCredentialRepository implements ProviderCredentialRepository {
  private document: AuthDocument = emptyDocument()
  private sourceSnapshot: string | null = null
  private initialized = false
  private chain = Promise.resolve()
  private readonly health = new Map<string, ApiKeyHealth>()

  constructor(readonly path: string) {}

  initialize() {
    return Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(this.path), { recursive: true })
        await this.reload()
        this.initialized = true
      },
      catch: (cause) =>
        this.error('CREDENTIAL_STORE_UNAVAILABLE', '无法打开 auth.json Provider 凭据仓库', cause),
    })
  }

  list(): CredentialSummary[] {
    this.assertInitialized()
    return this.records().map((record) => ({
      id: record.id,
      integrationID: record.integrationID,
      kind: record.kind,
      methodID: record.methodID,
      label: record.label,
      keyVersion: 0,
      enabled: record.enabled,
      priority: record.priority,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))
  }

  listApiKeys(integrationID?: string): ApiKeySummary[] {
    this.assertInitialized()
    return this.records()
      .filter(
        (record) =>
          record.kind === 'api-key' && (!integrationID || record.integrationID === integrationID),
      )
      .map((record) => ({
        id: record.id,
        integrationID: record.integrationID,
        label: record.label,
        maskedValue: `••••${keySuffix(this.apiKey(record))}`,
        enabled: record.enabled,
        active: record.active,
        priority: record.priority,
        health: this.health.get(record.id) ?? healthDefault(),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }))
  }

  listProviderCredentials(providerID?: string): ProviderCredentialSummary[] {
    this.assertInitialized()
    return this.records()
      .filter((record) => !providerID || record.integrationID === providerID)
      .map((record) => ({
        id: record.id,
        providerID: record.integrationID,
        kind: record.kind,
        methodID: record.methodID,
        label: record.label,
        maskedValue: record.kind === 'api-key' ? `••••${keySuffix(this.apiKey(record))}` : null,
        enabled: record.enabled,
        active: record.active,
        order: record.priority,
        health: record.kind === 'api-key' ? (this.health.get(record.id) ?? healthDefault()) : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }))
  }

  get<T = unknown>(integrationID: string) {
    return Effect.try({
      try: () => {
        const record = this.records().find(
          (candidate) => candidate.integrationID === integrationID && candidate.active,
        )
        return record ? this.decrypted<T>(record) : null
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法读取 auth.json 凭据', cause),
    })
  }

  activeCredential<T = unknown>(integrationID: string) {
    return this.get<T>(integrationID)
  }

  getById<T = unknown>(credentialID: string) {
    return Effect.try({
      try: () => {
        const record = this.record(credentialID)
        return record ? this.decrypted<T>(record) : null
      },
      catch: (cause) => this.error('CREDENTIAL_READ_FAILED', '无法读取 auth.json 凭据', cause),
    })
  }

  set(input: { integrationID: string; methodID?: string; label?: string; value: unknown }) {
    return this.mutate('无法写入 auth.json 凭据', async () => {
      const provider = this.provider(input.integrationID, true)
      const active = provider.credentials.find((item) => item.id === provider.activeId)
      const timestamp = Date.now()
      const encoded = this.encodeValue(input.value)
      const next: JsonCredential = {
        ...encoded,
        id: active?.id ?? `cred_${randomUUID()}`,
        label: input.label?.trim() || active?.label || 'default',
        enabled: true,
        priority: active?.priority ?? provider.credentials.length,
        createdAt: active?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.methodID ? { methodId: input.methodID } : {}),
      }
      if (active) {
        provider.credentials[provider.credentials.indexOf(active)] = next
      } else {
        provider.credentials.push(next)
      }
      provider.activeId = next.id
      if (next.type === 'api') this.health.set(next.id, healthDefault())
      await this.persist()
      return this.summary(next, input.integrationID)
    })
  }

  upsertOAuth(input: { providerID: string; methodID: string; label?: string; value: unknown }) {
    return this.mutate('无法写入 auth.json OAuth 凭据', async () => {
      const provider = this.provider(input.providerID, true)
      const current = provider.credentials.find((item) => item.type === 'oauth')
      const timestamp = Date.now()
      const encoded = this.encodeValue(input.value)
      if (encoded.type !== 'oauth') {
        throw new AgentError('INVALID_CREDENTIAL', 'OAuth 凭据格式无效', 400)
      }
      const next: JsonCredential = {
        ...encoded,
        id: current?.id ?? `cred_${randomUUID()}`,
        methodId: input.methodID,
        label: input.label?.trim() || current?.label || 'OAuth',
        enabled: true,
        priority: current?.priority ?? provider.credentials.length,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      if (current) provider.credentials[provider.credentials.indexOf(current)] = next
      else provider.credentials.push(next)
      provider.activeId ??= next.id
      await this.persist()
      return this.providerSummary(next, input.providerID)
    })
  }

  createApiKey(input: { integrationID: string; label: string; key: string }) {
    return this.mutate('无法写入 auth.json API Key', async () => {
      const key = input.key.trim()
      const label = input.label.trim()
      if (!key || !label) {
        throw new AgentError('INVALID_CREDENTIAL', 'API Key 和名称不能为空', 400)
      }
      const provider = this.provider(input.integrationID, true)
      if (provider.credentials.some((item) => item.type === 'api' && item.key === key)) {
        throw new AgentError('CONFLICT', '此 Provider 已保存相同的 API Key', 409)
      }
      const timestamp = Date.now()
      const credential: JsonCredential = {
        id: `cred_${randomUUID()}`,
        type: 'api',
        label,
        enabled: true,
        priority: provider.credentials.filter((item) => item.type === 'api').length,
        key,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      provider.credentials.push(credential)
      provider.activeId ??= credential.id
      this.health.set(credential.id, healthDefault())
      await this.persist()
      return this.apiKeySummary(credential, input.integrationID)
    })
  }

  replaceApiKey(credentialID: string, keyInput: string) {
    return this.mutate('无法更换 auth.json API Key', async () => {
      const found = this.requiredApiKey(credentialID)
      const key = keyInput.trim()
      if (!key) throw new AgentError('INVALID_CREDENTIAL', 'API Key 不能为空', 400)
      if (
        found.provider.credentials.some(
          (item) => item.id !== credentialID && item.type === 'api' && item.key === key,
        )
      ) {
        throw new AgentError('CONFLICT', '此 Provider 已保存相同的 API Key', 409)
      }
      found.credential.key = key
      found.credential.updatedAt = Date.now()
      this.health.set(credentialID, healthDefault())
      await this.persist()
      return this.apiKeySummary(found.credential, found.providerID)
    })
  }

  renameApiKey(credentialID: string, labelInput: string) {
    return this.mutate('无法重命名 auth.json API Key', async () => {
      const found = this.requiredApiKey(credentialID)
      const label = labelInput.trim()
      if (!label) throw new AgentError('INVALID_CREDENTIAL', 'API Key 名称不能为空', 400)
      found.credential.label = label
      found.credential.updatedAt = Date.now()
      await this.persist()
      return this.apiKeySummary(found.credential, found.providerID)
    })
  }

  setActive(integrationID: string, credentialID: string) {
    return this.mutate('无法设置当前 auth.json API Key', async () => {
      const found = this.requiredApiKey(credentialID)
      if (found.providerID !== integrationID || !found.credential.enabled) {
        throw new AgentError('INVALID_CREDENTIAL', 'API Key 不属于该 Provider 或已停用', 400)
      }
      found.provider.activeId = credentialID
      await this.persist()
      return this.apiKeySummary(found.credential, integrationID)
    })
  }

  compareAndSetActive(integrationID: string, expectedCredentialID: string, credentialID: string) {
    return this.mutate('无法切换 auth.json API Key', async () => {
      const provider = this.provider(integrationID)
      const next = provider?.credentials.find((item) => item.id === credentialID)
      if (!provider || provider.activeId !== expectedCredentialID || !next?.enabled) return false
      provider.activeId = credentialID
      await this.persist()
      return true
    })
  }

  setEnabled(credentialID: string, enabled: boolean) {
    return this.mutate('无法更新 auth.json API Key 状态', async () => {
      const found = this.requiredApiKey(credentialID)
      found.credential.enabled = enabled
      found.credential.updatedAt = Date.now()
      if (!enabled && found.provider.activeId === credentialID) {
        delete found.provider.activeId
      }
      await this.persist()
      return this.apiKeySummary(found.credential, found.providerID)
    })
  }

  reorder(integrationID: string, orderedCredentialIDs: readonly string[]) {
    return this.mutate('无法调整 auth.json API Key 顺序', async () => {
      const provider = this.provider(integrationID)
      const keys = provider?.credentials.filter((item) => item.type === 'api') ?? []
      if (
        keys.length !== orderedCredentialIDs.length ||
        new Set(orderedCredentialIDs).size !== orderedCredentialIDs.length ||
        orderedCredentialIDs.some((id) => !keys.some((item) => item.id === id))
      ) {
        throw new AgentError('INVALID_CREDENTIAL_ORDER', 'API Key 排序列表不完整', 400)
      }
      const timestamp = Date.now()
      orderedCredentialIDs.forEach((id, priority) => {
        const credential = keys.find((item) => item.id === id)!
        credential.priority = priority
        credential.updatedAt = timestamp
      })
      await this.persist()
      return this.listApiKeys(integrationID)
    })
  }

  deleteApiKey(credentialID: string) {
    return this.mutate('无法删除 auth.json API Key', async () => {
      const found = this.requiredApiKey(credentialID)
      this.deleteRecord(found.providerID, found.credential)
      await this.persist()
      return true
    })
  }

  setProviderCredentialActive(providerID: string, credentialID: string) {
    return this.mutate('无法设置活动 auth.json 凭据', async () => {
      const found = this.requiredRecord(credentialID)
      if (found.providerID !== providerID || !found.credential.enabled) {
        throw new AgentError('INVALID_CREDENTIAL', '凭据不属于该 Provider 或已停用', 400)
      }
      found.provider.activeId = credentialID
      await this.persist()
      return this.providerSummary(found.credential, providerID)
    })
  }

  setProviderCredentialEnabled(credentialID: string, enabled: boolean) {
    return this.mutate('无法更新 auth.json 凭据状态', async () => {
      const found = this.requiredRecord(credentialID)
      found.credential.enabled = enabled
      found.credential.updatedAt = Date.now()
      if (!enabled && found.provider.activeId === credentialID) {
        delete found.provider.activeId
      }
      await this.persist()
      return this.providerSummary(found.credential, found.providerID)
    })
  }

  deleteProviderCredential(credentialID: string) {
    return this.mutate('无法删除 auth.json Provider 凭据', async () => {
      const found = this.requiredRecord(credentialID)
      this.deleteRecord(found.providerID, found.credential)
      await this.persist()
      return this.listProviderCredentials(found.providerID)
    })
  }

  deleteCredentialByID(credentialID: string) {
    return this.mutate('无法删除 auth.json 凭据', async () => {
      const found = this.requiredRecord(credentialID)
      this.deleteRecord(found.providerID, found.credential)
      await this.persist()
      return true
    })
  }

  updateHealth(
    credentialID: string,
    patch: Partial<Omit<StoredCredentialHealth, 'credentialID' | 'updatedAt'>>,
  ) {
    return Effect.try({
      try: () => {
        this.requiredApiKey(credentialID)
        const next = {
          ...(this.health.get(credentialID) ?? healthDefault()),
          ...(patch.status === undefined ? {} : { status: patch.status }),
          ...(patch.lastTestedAt === undefined ? {} : { lastTestedAt: patch.lastTestedAt }),
          ...(patch.lastUsedAt === undefined ? {} : { lastUsedAt: patch.lastUsedAt }),
          ...(patch.lastErrorCategory === undefined
            ? {}
            : { errorCategory: patch.lastErrorCategory }),
          ...(patch.cooldownUntil === undefined ? {} : { cooldownUntil: patch.cooldownUntil }),
        }
        this.health.set(credentialID, next)
        return next
      },
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', '无法更新 API Key 健康状态', cause),
    })
  }

  exportProviderCredentials() {
    return Effect.try({
      try: () =>
        this.records().map((record): PortableProviderCredential => ({
          ...this.decrypted(record),
          enabled: record.enabled,
          priority: record.priority,
          active: record.active,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          health:
            record.kind === 'api-key' ? (this.health.get(record.id) ?? healthDefault()) : null,
        })),
      catch: (cause) =>
        this.error('CREDENTIAL_READ_FAILED', '无法读取 auth.json Provider 凭据', cause),
    })
  }

  replaceProviderCredentials(credentials: readonly PortableProviderCredential[]) {
    return this.mutate('无法写入 auth.json Provider 凭据', async () => {
      this.document.providers = {}
      this.health.clear()
      for (const credential of credentials) {
        const provider = this.provider(credential.integrationID, true)
        provider.credentials.push({
          ...this.encodeValue(credential.value),
          id: credential.id,
          ...(credential.methodID ? { methodId: credential.methodID } : {}),
          label: credential.label,
          enabled: credential.enabled,
          priority: credential.priority,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        })
        if (credential.active && credential.enabled) provider.activeId = credential.id
        if (credential.health) this.health.set(credential.id, credential.health)
      }
      await this.persist()
    })
  }

  clearProviderCredentials() {
    return this.mutate('无法清理 auth.json Provider 凭据', async () => {
      this.document.providers = {}
      this.health.clear()
      await this.persist()
    })
  }

  validateProviderCredentials() {
    return Effect.tryPromise({
      try: async () => {
        await this.reload()
      },
      catch: (cause) =>
        this.error('CREDENTIAL_STORE_UNAVAILABLE', 'auth.json Provider 凭据校验失败', cause),
    })
  }

  private mutate<T>(message: string, task: () => Promise<T>) {
    return Effect.tryPromise({
      try: () =>
        this.enqueue(async () => {
          this.assertInitialized()
          await this.assertUnchanged()
          return task()
        }),
      catch: (cause) => this.error('CREDENTIAL_WRITE_FAILED', message, cause),
    })
  }

  private enqueue<T>(task: () => Promise<T>) {
    const result = this.chain.catch(() => undefined).then(task)
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async reload() {
    if (!existsSync(this.path)) {
      this.document = emptyDocument()
      this.sourceSnapshot = null
      return
    }
    const stats = lstatSync(this.path)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new AgentError(
        'CREDENTIAL_STORE_UNAVAILABLE',
        'auth.json 不是 Pidex 可管理的普通文件',
        500,
      )
    }
    const text = await readFile(this.path, 'utf8')
    this.document = this.decodeDocument(text)
    this.sourceSnapshot = text
  }

  private async assertUnchanged() {
    if (!existsSync(this.path)) {
      if (this.sourceSnapshot !== null) {
        throw new AgentError('CONFLICT', 'auth.json 已被外部删除，请重启后重试', 409)
      }
      return
    }
    const text = await readFile(this.path, 'utf8')
    if (text !== this.sourceSnapshot) {
      throw new AgentError('CONFLICT', 'auth.json 已被外部修改，请重启后重试', 409)
    }
  }

  private async persist() {
    const text = `${JSON.stringify(this.document, null, 2)}\n`
    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
    try {
      await chmod(temporary, 0o600)
    } catch {
      // Windows ACLs do not map cleanly to POSIX mode bits.
    }
    try {
      try {
        await rename(temporary, this.path)
      } catch (cause) {
        throw new AgentError('CREDENTIAL_WRITE_FAILED', '无法原子替换 auth.json', 500, cause)
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    try {
      await chmod(this.path, 0o600)
    } catch {
      // Best effort on platforms without POSIX permissions.
    }
    this.sourceSnapshot = text
  }

  private decodeDocument(text: string): AuthDocument {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new AgentError(
        'CREDENTIAL_STORE_UNAVAILABLE',
        'auth.json 不是有效 JSON，已拒绝覆盖',
        500,
      )
    }
    if (
      !isRecord(value) ||
      value.format !== FORMAT ||
      value.schemaVersion !== SCHEMA_VERSION ||
      !isRecord(value.providers)
    ) {
      throw new AgentError(
        'CREDENTIAL_STORE_UNAVAILABLE',
        'auth.json 不属于受支持的 Pidex 数据格式，已拒绝覆盖',
        500,
      )
    }
    const providers: Record<string, JsonProvider> = {}
    for (const [providerID, rawProvider] of Object.entries(value.providers)) {
      if (!isRecord(rawProvider) || !Array.isArray(rawProvider.credentials)) {
        throw new AgentError(
          'CREDENTIAL_STORE_UNAVAILABLE',
          `auth.json Provider ${providerID} 格式无效`,
          500,
        )
      }
      const credentials = rawProvider.credentials.map((item, index) =>
        this.decodeCredential(item, `${providerID}.credentials[${index}]`),
      )
      const ids = new Set(credentials.map((item) => item.id))
      if (ids.size !== credentials.length) {
        throw new AgentError(
          'CREDENTIAL_STORE_UNAVAILABLE',
          `auth.json Provider ${providerID} 含重复凭据 ID`,
          500,
        )
      }
      const activeId = rawProvider.activeId
      if (activeId !== undefined && (typeof activeId !== 'string' || !ids.has(activeId))) {
        throw new AgentError(
          'CREDENTIAL_STORE_UNAVAILABLE',
          `auth.json Provider ${providerID} 的 activeId 无效`,
          500,
        )
      }
      providers[providerID] = {
        ...(typeof activeId === 'string' ? { activeId } : {}),
        credentials,
      }
    }
    return { format: FORMAT, schemaVersion: SCHEMA_VERSION, providers }
  }

  private decodeCredential(value: unknown, field: string): JsonCredential {
    if (!isRecord(value)) {
      throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', `auth.json ${field} 格式无效`, 500)
    }
    const type = value.type
    if (type !== 'api' && type !== 'oauth') {
      throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', `auth.json ${field}.type 无效`, 500)
    }
    const base = {
      id: requiredString(value.id, `${field}.id`),
      type,
      label: requiredString(value.label, `${field}.label`),
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
      priority:
        Number.isInteger(value.priority) && Number(value.priority) >= 0
          ? Number(value.priority)
          : 0,
      createdAt: Number.isSafeInteger(value.createdAt) ? Number(value.createdAt) : 0,
      updatedAt: Number.isSafeInteger(value.updatedAt) ? Number(value.updatedAt) : 0,
    }
    const metadata = optionalMetadata(value.metadata)
    if (type === 'api') {
      return {
        ...base,
        type,
        key: requiredString(value.key, `${field}.key`),
        ...(metadata ? { metadata } : {}),
      }
    }
    if (!Number.isSafeInteger(value.expires) || Number(value.expires) < 0) {
      throw new AgentError('CREDENTIAL_STORE_UNAVAILABLE', `auth.json ${field}.expires 无效`, 500)
    }
    return {
      ...base,
      type,
      methodId: requiredString(value.methodId, `${field}.methodId`),
      refresh: requiredText(value.refresh, `${field}.refresh`),
      access: requiredText(value.access, `${field}.access`),
      expires: Number(value.expires),
      ...(metadata ? { metadata } : {}),
    }
  }

  private records() {
    return Object.entries(this.document.providers).flatMap(([integrationID, provider]) =>
      provider.credentials.map((credential) => ({
        ...credential,
        integrationID,
        kind: credential.type === 'api' ? ('api-key' as const) : ('oauth' as const),
        methodID: credential.type === 'oauth' ? (credential.methodId ?? null) : null,
        active: provider.activeId === credential.id,
      })),
    )
  }

  private record(credentialID: string) {
    return this.records().find((item) => item.id === credentialID) ?? null
  }

  private requiredRecord(credentialID: string) {
    for (const [providerID, provider] of Object.entries(this.document.providers)) {
      const credential = provider.credentials.find((item) => item.id === credentialID)
      if (credential) return { providerID, provider, credential }
    }
    throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 Provider 凭据', 404)
  }

  private requiredApiKey(credentialID: string) {
    const found = this.requiredRecord(credentialID)
    if (found.credential.type !== 'api') {
      throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 API Key', 404)
    }
    return found
  }

  private provider(providerID: string, create: true): JsonProvider
  private provider(providerID: string, create?: false): JsonProvider | undefined
  private provider(providerID: string, create = false): JsonProvider | undefined {
    const current = this.document.providers[providerID]
    if (current || !create) return current
    const provider: JsonProvider = { credentials: [] }
    this.document.providers[providerID] = provider
    return provider
  }

  private deleteRecord(providerID: string, credential: JsonCredential) {
    const provider = this.document.providers[providerID]!
    provider.credentials.splice(provider.credentials.indexOf(credential), 1)
    if (provider.activeId === credential.id) delete provider.activeId
    if (provider.credentials.length === 0) delete this.document.providers[providerID]
    this.health.delete(credential.id)
  }

  private encodeValue(
    value: unknown,
  ): Pick<
    JsonCredential,
    'type' | 'key' | 'methodId' | 'refresh' | 'access' | 'expires' | 'metadata'
  > {
    if (!isRecord(value)) {
      throw new AgentError('INVALID_CREDENTIAL', '凭据格式无效', 400)
    }
    const metadata = optionalMetadata(value.metadata)
    if (value.type === 'key') {
      return {
        type: 'api',
        key: requiredString(value.key, 'key'),
        ...(metadata ? { metadata } : {}),
      }
    }
    if (
      value.type !== 'oauth' ||
      typeof value.methodID !== 'string' ||
      typeof value.refresh !== 'string' ||
      typeof value.access !== 'string' ||
      !Number.isSafeInteger(value.expires)
    ) {
      throw new AgentError('INVALID_CREDENTIAL', 'OAuth 凭据格式无效', 400)
    }
    return {
      type: 'oauth',
      methodId: value.methodID,
      refresh: value.refresh,
      access: value.access,
      expires: Number(value.expires),
      ...(metadata ? { metadata } : {}),
    }
  }

  private decrypted<T>(
    record: ReturnType<AuthJsonCredentialRepository['records']>[number],
  ): DecryptedCredential<T> {
    const value =
      record.type === 'api'
        ? {
            type: 'key',
            key: record.key!,
            ...(record.metadata ? { metadata: record.metadata } : {}),
          }
        : {
            type: 'oauth',
            methodID: record.methodId!,
            refresh: record.refresh!,
            access: record.access!,
            expires: record.expires!,
            ...(record.metadata ? { metadata: record.metadata } : {}),
          }
    return {
      id: record.id,
      integrationID: record.integrationID,
      kind: record.kind,
      methodID: record.methodID,
      label: record.label,
      value: value as T,
    }
  }

  private apiKey(record: ReturnType<AuthJsonCredentialRepository['records']>[number]) {
    if (record.type !== 'api' || !record.key) {
      throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 API Key', 404)
    }
    return record.key
  }

  private summary(credential: JsonCredential, integrationID: string): CredentialSummary {
    return {
      id: credential.id,
      integrationID,
      kind: credential.type === 'api' ? 'api-key' : 'oauth',
      methodID: credential.type === 'oauth' ? (credential.methodId ?? null) : null,
      label: credential.label,
      keyVersion: 0,
      enabled: credential.enabled,
      priority: credential.priority,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    }
  }

  private apiKeySummary(credential: JsonCredential, integrationID: string) {
    return this.listApiKeys(integrationID).find((item) => item.id === credential.id)!
  }

  private providerSummary(credential: JsonCredential, providerID: string) {
    return this.listProviderCredentials(providerID).find((item) => item.id === credential.id)!
  }

  private assertInitialized() {
    if (!this.initialized) {
      throw new AgentError(
        'CREDENTIAL_STORE_UNAVAILABLE',
        'auth.json Provider 凭据仓库尚未初始化',
        500,
      )
    }
  }

  private error(code: string, message: string, cause: unknown) {
    if (cause instanceof AgentError) return cause
    return new AgentError(code, message, 500, cause)
  }
}
