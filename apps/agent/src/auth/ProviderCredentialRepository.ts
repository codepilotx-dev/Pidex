import type { Effect } from 'effect'
import type { AgentError } from '../Domain'
import type {
  CredentialErrorCategory,
  CredentialHealthStatus,
  StoredCredentialHealth,
} from '../storage/database/AgentDatabase'

export type ProviderCredentialStoreKind = 'auth-json' | 'encrypted'

export type CredentialSummary = {
  id: string
  integrationID: string
  kind: 'api-key' | 'oauth'
  methodID: string | null
  label: string
  keyVersion: number
  enabled: boolean
  priority: number
  createdAt: number
  updatedAt: number
}

export type ApiKeyHealth = {
  status: CredentialHealthStatus
  lastTestedAt: number | null
  lastUsedAt: number | null
  errorCategory: CredentialErrorCategory | null
  cooldownUntil: number | null
}

export type ApiKeySummary = {
  id: string
  integrationID: string
  label: string
  maskedValue: string
  enabled: boolean
  active: boolean
  priority: number
  health: ApiKeyHealth
  createdAt: number
  updatedAt: number
}

export type ProviderCredentialSummary = {
  id: string
  providerID: string
  kind: 'api-key' | 'oauth'
  methodID: string | null
  label: string
  maskedValue: string | null
  enabled: boolean
  active: boolean
  order: number
  health: ApiKeyHealth | null
  createdAt: number
  updatedAt: number
}

export type DecryptedCredential<T = unknown> = {
  id: string
  integrationID: string
  kind: 'api-key' | 'oauth'
  methodID: string | null
  label: string
  value: T
}

export type PortableProviderCredential = DecryptedCredential & {
  enabled: boolean
  priority: number
  active: boolean
  createdAt: number
  updatedAt: number
  health: ApiKeyHealth | null
}

type CredentialEffect<T> = Effect.Effect<T, AgentError>

export const isProviderCredentialIntegration = (integrationID: string) =>
  integrationID !== 'github' &&
  !integrationID.startsWith('mcp-oauth:') &&
  !integrationID.startsWith('usage.')

export interface ProviderCredentialRepository {
  list(): CredentialSummary[]
  listApiKeys(integrationID?: string): ApiKeySummary[]
  listProviderCredentials(providerID?: string): ProviderCredentialSummary[]
  get<T = unknown>(integrationID: string): CredentialEffect<DecryptedCredential<T> | null>
  activeCredential<T = unknown>(
    integrationID: string,
  ): CredentialEffect<DecryptedCredential<T> | null>
  getById<T = unknown>(credentialID: string): CredentialEffect<DecryptedCredential<T> | null>
  set(input: {
    integrationID: string
    methodID?: string
    label?: string
    value: unknown
  }): CredentialEffect<CredentialSummary>
  upsertOAuth(input: {
    providerID: string
    methodID: string
    label?: string
    value: unknown
  }): CredentialEffect<ProviderCredentialSummary>
  createApiKey(input: {
    integrationID: string
    label: string
    key: string
  }): CredentialEffect<ApiKeySummary>
  replaceApiKey(credentialID: string, keyInput: string): CredentialEffect<ApiKeySummary>
  renameApiKey(credentialID: string, labelInput: string): CredentialEffect<ApiKeySummary>
  setActive(integrationID: string, credentialID: string): CredentialEffect<ApiKeySummary>
  compareAndSetActive(
    integrationID: string,
    expectedCredentialID: string,
    credentialID: string,
  ): CredentialEffect<boolean>
  setEnabled(credentialID: string, enabled: boolean): CredentialEffect<ApiKeySummary>
  reorder(
    integrationID: string,
    orderedCredentialIDs: readonly string[],
  ): CredentialEffect<ApiKeySummary[]>
  deleteApiKey(credentialID: string): CredentialEffect<boolean>
  setProviderCredentialActive(
    providerID: string,
    credentialID: string,
  ): CredentialEffect<ProviderCredentialSummary>
  setProviderCredentialEnabled(
    credentialID: string,
    enabled: boolean,
  ): CredentialEffect<ProviderCredentialSummary>
  deleteProviderCredential(credentialID: string): CredentialEffect<ProviderCredentialSummary[]>
  deleteCredentialByID(credentialID: string): CredentialEffect<boolean>
  updateHealth(
    credentialID: string,
    patch: Partial<Omit<StoredCredentialHealth, 'credentialID' | 'updatedAt'>>,
  ): CredentialEffect<ApiKeyHealth>
  exportProviderCredentials(): CredentialEffect<PortableProviderCredential[]>
  replaceProviderCredentials(
    credentials: readonly PortableProviderCredential[],
  ): CredentialEffect<void>
  clearProviderCredentials(): CredentialEffect<void>
  validateProviderCredentials(): CredentialEffect<void>
}
