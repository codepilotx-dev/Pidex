import { Credential, Provider } from '@pidex/model-schema'
import { Effect, Schema } from 'effect'
import { AgentError } from '../Domain'
import type {
  ApiKeyHealth,
  ApiKeySummary as StoredApiKeySummary,
  ProviderCredentialRepository,
} from '../auth/ProviderCredentialRepository'
import type { PiModelService } from './pi'
import type { ModelHealthService } from './ModelHealthService'

export type PublicApiKeySummary = {
  id: Credential.ID
  providerId: Provider.ID
  kind: 'api-key'
  label: string
  maskedValue: string
  enabled: boolean
  active: boolean
  order: number
  health: {
    status: ApiKeyHealth['status']
    lastTestedAt?: number
    errorCategory?: NonNullable<ApiKeyHealth['errorCategory']>
  }
  createdAt: number
  updatedAt: number
}

export type PublicApiKeyTestResult = {
  credential: PublicApiKeySummary
  ok: boolean
  message: string
}

export class ApiKeyService {
  constructor(
    private readonly providers: PiModelService,
    private readonly credentials: ProviderCredentialRepository,
    private readonly modelHealth: ModelHealthService,
  ) {}

  async list(providerID?: string): Promise<PublicApiKeySummary[]> {
    if (providerID) await this.requiredProviderID(providerID)
    return this.credentials
      .listApiKeys(providerID)
      .filter((summary) => !summary.integrationID.startsWith('usage.'))
      .map((summary) => this.publicSummary(summary, Provider.ID.make(summary.integrationID)))
  }

  async create(input: { providerID: string; label: string; key: string }) {
    const integrationID = await this.requiredProviderID(input.providerID, true)
    const summary = await Effect.runPromise(
      this.credentials.createApiKey({
        integrationID,
        label: input.label,
        key: input.key,
      }),
    )
    return this.publicSummary(summary, Provider.ID.make(input.providerID))
  }

  async update(input: { credentialID: string; label?: string; key?: string }) {
    let summary = this.requiredSummary(input.credentialID)
    if (input.label !== undefined)
      summary = await Effect.runPromise(
        this.credentials.renameApiKey(input.credentialID, input.label),
      )
    if (input.key !== undefined)
      summary = await Effect.runPromise(
        this.credentials.replaceApiKey(input.credentialID, input.key),
      )
    const providerID = Provider.ID.make(summary.integrationID)
    return this.publicSummary(summary, providerID)
  }

  async setActive(providerID: string, credentialID: string) {
    const integrationID = await this.requiredProviderID(providerID, true)
    const summary = await Effect.runPromise(this.credentials.setActive(integrationID, credentialID))
    return this.publicSummary(summary, Provider.ID.make(providerID))
  }

  async setEnabled(credentialID: string, enabled: boolean) {
    this.requiredSummary(credentialID)
    const summary = await Effect.runPromise(this.credentials.setEnabled(credentialID, enabled))
    const providerID = Provider.ID.make(summary.integrationID)
    return this.publicSummary(summary, providerID)
  }

  async reorder(providerID: string, credentialIDs: readonly string[]) {
    const integrationID = await this.requiredProviderID(providerID, true)
    const summaries = await Effect.runPromise(
      this.credentials.reorder(integrationID, credentialIDs),
    )
    return summaries.map((summary) => this.publicSummary(summary, Provider.ID.make(providerID)))
  }

  async delete(credentialID: string) {
    const summary = this.requiredSummary(credentialID)
    await Effect.runPromise(this.credentials.deleteApiKey(credentialID))
    const providerID = Provider.ID.make(summary.integrationID)
    return this.credentials
      .listApiKeys(summary.integrationID)
      .map((item) => this.publicSummary(item, providerID))
  }

  async test(credentialID: string): Promise<PublicApiKeyTestResult> {
    const summary = this.requiredSummary(credentialID)
    const stored = await Effect.runPromise(this.credentials.getById<Credential.Value>(credentialID))
    if (!stored || stored.kind !== 'api-key' || !Schema.is(Credential.Key)(stored.value)) {
      throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到可测试的 API Key', 404)
    }
    const providerID = Provider.ID.make(summary.integrationID)
    const model = (await this.providers.models()).find(
      (candidate) => candidate.providerID === providerID && candidate.enabled,
    )
    if (!model) {
      return {
        credential: this.publicSummary(summary, providerID),
        ok: false,
        message: `配置不可用：Provider ${providerID} 没有可用模型`,
      }
    }
    const testedAt = Date.now()
    const probe = await this.modelHealth.probe(
      { providerID, id: model.id },
      { explicitApiKey: stored.value.key },
    )
    if (!probe.ok) {
      const category: ApiKeyHealth['errorCategory'] =
        probe.category === 'authentication' ||
        probe.category === 'rate-limit' ||
        probe.category === 'network'
          ? probe.category
          : 'unknown'
      await Effect.runPromise(
        this.credentials.updateHealth(credentialID, {
          status:
            probe.category === 'authentication'
              ? 'auth-failed'
              : probe.category === 'rate-limit'
                ? 'rate-limited'
                : 'error',
          lastTestedAt: testedAt,
          lastErrorCategory: category,
          cooldownUntil: null,
        }),
      )
      return {
        credential: this.latestCredential(providerID, credentialID),
        ok: false,
        message: probe.message,
      }
    }
    await Effect.runPromise(
      this.credentials.updateHealth(credentialID, {
        status: 'healthy',
        lastTestedAt: testedAt,
        lastErrorCategory: null,
        cooldownUntil: null,
      }),
    )
    return {
      credential: this.latestCredential(providerID, credentialID),
      ok: true,
      message: 'API Key 可用。',
    }
  }

  async copyMaterial(credentialID: string): Promise<string> {
    this.requiredSummary(credentialID)
    const stored = await Effect.runPromise(this.credentials.getById<Credential.Value>(credentialID))
    if (!stored || stored.kind !== 'api-key' || !Schema.is(Credential.Key)(stored.value)) {
      throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到可复制的 API Key', 404)
    }
    return stored.value.key
  }

  private latestCredential(providerID: Provider.ID, credentialID: string): PublicApiKeySummary {
    const summary = this.credentials
      .listApiKeys()
      .find((item) => item.id === credentialID && !item.integrationID.startsWith('usage.'))
    if (!summary) throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 API Key', 404)
    return this.publicSummary(summary, providerID)
  }

  private requiredSummary(credentialID: string) {
    const summary = this.credentials
      .listApiKeys()
      .find((item) => item.id === credentialID && !item.integrationID.startsWith('usage.'))
    if (!summary) throw new AgentError('CREDENTIAL_NOT_FOUND', '未找到 API Key', 404)
    return summary
  }

  private async requiredProviderID(providerID: string, requireKeyMethod = false) {
    const provider = (await this.providers.list()).find((item) => String(item.id) === providerID)
    if (!provider) throw new AgentError('PROVIDER_NOT_FOUND', `未找到 Provider ${providerID}`, 404)
    if (requireKeyMethod && !provider.auth.apiKey) {
      throw new AgentError('PROVIDER_UNAVAILABLE', `Provider ${providerID} 不支持 API Key`, 400)
    }
    return providerID
  }

  private publicSummary(
    summary: StoredApiKeySummary,
    providerId: Provider.ID,
  ): PublicApiKeySummary {
    return {
      id: Credential.ID.make(summary.id),
      providerId,
      kind: 'api-key',
      label: summary.label,
      maskedValue: summary.maskedValue,
      enabled: summary.enabled,
      active: summary.active,
      order: summary.priority,
      health: {
        status: summary.health.status,
        ...(summary.health.lastTestedAt === null
          ? {}
          : { lastTestedAt: summary.health.lastTestedAt }),
        ...(summary.health.errorCategory === null
          ? {}
          : { errorCategory: summary.health.errorCategory }),
      },
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }
  }
}
