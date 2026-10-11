import { Credential, Provider } from '@pidex/model-schema'
import { Effect } from 'effect'
import type {
  ProviderCredentialSummary as StoredCredentialSummary,
  ProviderCredentialRepository,
} from '../auth/ProviderCredentialRepository'
import { AgentError } from '../Domain'
import type { PiModelService } from './pi'

export type ProviderAuthMethodSummary = {
  type: 'api-key' | 'oauth'
  label: string
}

export type PublicProviderCredentialSummary = {
  id: Credential.ID
  providerId: Provider.ID
  kind: 'api-key' | 'oauth'
  methodId?: string
  label: string
  maskedValue?: string
  enabled: boolean
  active: boolean
  order: number
  health?: {
    status: 'untested' | 'healthy' | 'auth-failed' | 'rate-limited' | 'error'
    lastTestedAt?: number
    errorCategory?: 'authentication' | 'rate-limit' | 'network' | 'unknown'
  }
  createdAt: number
  updatedAt: number
}

/**
 * Provider-scoped credential management.
 *
 * The SQLite column is still named integration_id for forward compatibility,
 * but inference credentials are keyed directly by Pi Provider.id.
 */
export class ProviderCredentialService {
  constructor(
    private readonly providers: PiModelService,
    private readonly credentials: ProviderCredentialRepository,
  ) {}

  async methods(providerID: string): Promise<ProviderAuthMethodSummary[]> {
    const info = await this.requiredProvider(providerID)
    const provider = this.providers.pi
      .getProviders()
      .find((candidate) => candidate.id === providerID)!
    return [
      ...(info.auth.apiKey
        ? [
            {
              type: 'api-key' as const,
              label: provider.auth.apiKey?.name ?? 'API Key',
            },
          ]
        : []),
      ...(info.auth.oauth && provider.auth.oauth
        ? [
            {
              type: 'oauth' as const,
              label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
            },
          ]
        : []),
    ]
  }

  async list(providerID?: string): Promise<PublicProviderCredentialSummary[]> {
    if (providerID) await this.requiredProvider(providerID)
    return this.credentials
      .listProviderCredentials(providerID)
      .map((item) => this.publicSummary(item))
  }

  async setActive(providerID: string, credentialID: string) {
    await this.requiredProvider(providerID)
    const summary = await Effect.runPromise(
      this.credentials.setProviderCredentialActive(providerID, credentialID),
    )
    return this.publicSummary(summary)
  }

  async setEnabled(credentialID: string, enabled: boolean) {
    const summary = await Effect.runPromise(
      this.credentials.setProviderCredentialEnabled(credentialID, enabled),
    )
    return this.publicSummary(summary)
  }

  async delete(credentialID: string) {
    const current = this.credentials
      .listProviderCredentials()
      .find((item) => item.id === credentialID)
    if (!current) {
      throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 Provider 凭据', 404)
    }
    const remaining = await Effect.runPromise(
      this.credentials.deleteProviderCredential(credentialID),
    )
    return remaining.map((item) => this.publicSummary(item))
  }

  private async requiredProvider(providerID: string) {
    const provider = (await this.providers.list()).find(
      (candidate) => String(candidate.id) === providerID,
    )
    if (!provider) {
      throw new AgentError('PROVIDER_NOT_FOUND', `未找到 Provider ${providerID}`, 404)
    }
    return provider
  }

  private publicSummary(summary: StoredCredentialSummary): PublicProviderCredentialSummary {
    return {
      id: Credential.ID.make(summary.id),
      providerId: Provider.ID.make(summary.providerID),
      kind: summary.kind,
      ...(summary.methodID ? { methodId: summary.methodID } : {}),
      label: summary.label,
      ...(summary.maskedValue ? { maskedValue: summary.maskedValue } : {}),
      enabled: summary.enabled,
      active: summary.active,
      order: summary.order,
      ...(summary.health
        ? {
            health: {
              status: summary.health.status,
              ...(summary.health.lastTestedAt === null
                ? {}
                : { lastTestedAt: summary.health.lastTestedAt }),
              ...(summary.health.errorCategory === null
                ? {}
                : { errorCategory: summary.health.errorCategory }),
            },
          }
        : {}),
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }
  }
}
