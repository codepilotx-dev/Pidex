import type {
  BillingCredentialInput,
  BillingCredentialSourceId,
  LocalUsageResult,
  ProviderUsageSource,
  UsageSourceDescriptor,
} from '@pidex/agent-protocol'
import { ProviderUsageSourceSchema, UsageSourceDescriptorSchema } from '@pidex/agent-protocol'
import { Credential, Provider } from '@pidex/model-schema'
import { Effect, Schema } from 'effect'
import { createHash } from 'node:crypto'
import type { EncryptedCredentialRepository } from '../auth/EncryptedCredentialRepository'
import type { ProviderCredentialRepository } from '../auth/ProviderCredentialRepository'
import { AgentError } from '../Domain'
import type { AgentModelCatalog } from '../provider/AgentModelCatalog'
import type { PiModelService } from '../provider/pi'
import type { Models } from '@earendil-works/pi-ai'
import { UsageRepository, type LocalUsageRange } from '../storage/repositories/UsageRepository'
import { providerUsageAdapters } from './Adapters'
import { createSafeUsageRequester, UsageRequestError, type UsageFetcher } from './SafeFetch'
import type {
  ProviderUsageAdapter,
  ResolvedUsageCredential,
  UsageQueryContext,
  UsageRange,
} from './Types'

const BILLING_INTEGRATIONS: Readonly<Record<BillingCredentialSourceId, string>> = {
  'openai-admin': 'usage.openai.admin',
  'anthropic-admin': 'usage.anthropic.admin',
  'xai-management': 'usage.xai.management',
  'openrouter-management': 'usage.openrouter.management',
  'cloudflare-ai-gateway': 'usage.cloudflare.gateway',
}

const SUBSCRIPTION_INTEGRATION = 'usage.anthropic.subscription'
const DEFAULT_CACHE_MS = 60_000
const decodeProviderUsageSource = Schema.decodeUnknownSync(ProviderUsageSourceSchema, {
  onExcessProperty: 'error',
})
const decodeUsageSourceDescriptor = Schema.decodeUnknownSync(UsageSourceDescriptorSchema, {
  onExcessProperty: 'error',
})

type CachedSource = {
  value: ProviderUsageSource
  expiresAt: number
}
type BillingConnectResult = {
  sourceId: BillingCredentialSourceId
  connection: ProviderUsageSource['connection']
}

type UsageServiceOptions = {
  fetch?: UsageFetcher
  env?: Readonly<Record<string, string | undefined>>
  now?: () => number
  adapters?: readonly ProviderUsageAdapter[]
  subscriptionModels?: Models
  providerCredentials?: ProviderCredentialRepository
}

const safeError = (
  adapter: ProviderUsageAdapter,
  cause: unknown,
  now: number,
  connection?: ProviderUsageSource['connection'],
): ProviderUsageSource => {
  const error =
    cause instanceof UsageRequestError
      ? cause
      : new UsageRequestError('unknown', '厂商用量查询失败', false)
  const status =
    error.category === 'permission'
      ? 'permission-required'
      : error.category === 'plan'
        ? 'plan-required'
        : 'unavailable'
  return {
    sourceId: adapter.sourceId,
    providerIds: adapter.providerIds.map((id) => Provider.ID.make(id)),
    displayName: adapter.displayName,
    scope: adapter.scope,
    stability: adapter.stability,
    status,
    checkedAt: now,
    connection: connection ?? { kind: 'none', disconnectible: false },
    groups: [],
    error: {
      category: error.category,
      message: error.message.slice(0, 500) || '厂商用量查询失败',
      retryable: error.retryable,
    },
  }
}

const mask = (value: string) => `••••${value.slice(-4)}`

export class UsageService {
  private readonly request: ReturnType<typeof createSafeUsageRequester>
  private readonly env: Readonly<Record<string, string | undefined>>
  private readonly now: () => number
  private readonly adapters: readonly ProviderUsageAdapter[]
  private readonly subscriptionModels: Models | undefined
  private readonly providerCredentials: ProviderCredentialRepository
  private readonly cache = new Map<string, CachedSource>()
  private readonly inflight = new Map<string, Promise<ProviderUsageSource>>()
  private readonly operations = new Map<string, { fingerprint: string; result: unknown }>()

  constructor(
    private readonly local: UsageRepository,
    private readonly providers: AgentModelCatalog,
    private readonly piModels: PiModelService,
    private readonly credentials: EncryptedCredentialRepository,
    options: UsageServiceOptions = {},
  ) {
    this.request = createSafeUsageRequester(options.fetch)
    this.env = options.env ?? process.env
    this.now = options.now ?? Date.now
    this.adapters = options.adapters ?? providerUsageAdapters
    this.subscriptionModels = options.subscriptionModels
    this.providerCredentials = options.providerCredentials ?? credentials
  }

  localUsage(range: LocalUsageRange, timeZone: string): LocalUsageResult {
    return this.local.getLocalUsage(range, timeZone)
  }

  async providerUsage(input: {
    range: UsageRange
    timeZone: string
    providerIds?: readonly string[]
    sourceIds?: readonly string[]
    force?: boolean
  }) {
    const now = this.now()
    const providers = await this.providers.list()
    const providerTargeted = Boolean(input.providerIds?.length)
    const sourceTargeted = Boolean(input.sourceIds?.length)
    const selected = this.adapters
      .filter((adapter) => !sourceTargeted || input.sourceIds!.includes(adapter.sourceId))
      .filter(
        (adapter) =>
          !providerTargeted || adapter.providerIds.some((id) => input.providerIds!.includes(id)),
      )
      // Targeted passive consumers (sidebar/composer) must not accidentally
      // trigger metered reports. The billing page queries the full catalog,
      // while source-targeted queries represent an explicit catalog selection.
      .filter(
        (adapter) =>
          !(
            providerTargeted &&
            !sourceTargeted &&
            input.force !== true &&
            adapter.queryPolicy === 'metered'
          ),
      )
    const context: UsageQueryContext = {
      range: input.range,
      timeZone: input.timeZone,
      force: input.force === true,
      now,
      providers,
      credential: (providerIds, envNames) =>
        this.providerCredential(providers, providerIds, envNames),
      billingCredential: (sourceId, envNames) => this.billingCredential(sourceId, envNames),
      connection: (providerIds, envNames) =>
        this.providerConnection(providers, providerIds, envNames),
      billingConnection: (sourceId, envNames) => this.billingConnection(sourceId, envNames),
      request: this.request,
    }
    const sources = await Promise.all(
      selected.map((adapter) => this.queryAdapter(adapter, context)),
    )
    return { range: input.range, timeZone: input.timeZone, generatedAt: now, sources }
  }

  async sourceList(): Promise<{ sources: UsageSourceDescriptor[] }> {
    const providers = await this.providers.list()
    const context = {
      providers,
      credential: (providerIds: readonly string[], envNames?: readonly string[]) =>
        this.providerCredential(providers, providerIds, envNames),
      billingCredential: (sourceId: string, envNames?: readonly string[]) =>
        this.billingCredential(sourceId, envNames),
      connection: (providerIds: readonly string[], envNames?: readonly string[]) =>
        this.providerConnection(providers, providerIds, envNames),
      billingConnection: (sourceId: string, envNames?: readonly string[]) =>
        this.billingConnection(sourceId, envNames),
    }
    const sources = await Promise.all(
      this.adapters.map(async (adapter): Promise<UsageSourceDescriptor> =>
        decodeUsageSourceDescriptor({
          sourceId: adapter.sourceId,
          canonicalProviderId: Provider.ID.make(adapter.canonicalProviderId),
          providerIds: adapter.providerIds.map((id) => Provider.ID.make(id)),
          displayName: adapter.displayName,
          scope: adapter.scope,
          stability: adapter.stability,
          availability: adapter.availability,
          capabilities: [...adapter.capabilities],
          queryPolicy: adapter.queryPolicy,
          connection: await adapter.resolveConnection(context),
          connectionMethod: adapter.connectionMethod,
        }),
      ),
    )
    return { sources }
  }

  async connect(input: BillingCredentialInput) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          method: 'connect',
          sourceId: input.sourceId,
          key: createHash('sha256').update(input.key).digest('hex'),
          ...('teamId' in input ? { teamId: input.teamId } : {}),
          ...('accountId' in input ? { accountId: input.accountId } : {}),
        }),
      )
      .digest('hex')
    const previous = this.operation(input.operationId, fingerprint)
    if (previous) return previous as BillingConnectResult
    const integrationID = BILLING_INTEGRATIONS[input.sourceId]
    const key = input.key.trim()
    if (!key) throw new AgentError('INVALID_CREDENTIAL', '计费凭据不能为空', 400)
    const metadata =
      input.sourceId === 'xai-management'
        ? { teamId: input.teamId.trim() }
        : input.sourceId === 'cloudflare-ai-gateway'
          ? { accountId: input.accountId.trim() }
          : undefined
    if (input.sourceId === 'xai-management' && !metadata?.teamId) {
      throw new AgentError('INVALID_CREDENTIAL', 'xAI Team ID 不能为空', 400)
    }
    if (input.sourceId === 'cloudflare-ai-gateway' && !metadata?.accountId) {
      throw new AgentError('INVALID_CREDENTIAL', 'Cloudflare Account ID 不能为空', 400)
    }
    const summary = await Effect.runPromise(
      this.credentials.set({
        integrationID,
        label: 'usage',
        value: Credential.Key.make({ type: 'key', key, metadata }),
      }),
    )
    this.invalidate(input.sourceId)
    const result: BillingConnectResult = {
      sourceId: input.sourceId,
      connection: {
        kind: 'billing-key' as const,
        credentialId: Credential.ID.make(summary.id),
        maskedValue: mask(key),
        disconnectible: true,
      },
    }
    this.operations.set(input.operationId, { fingerprint, result })
    return result
  }

  async disconnect(input: { sourceId: BillingCredentialSourceId; operationId: string }) {
    const fingerprint = createHash('sha256').update(`disconnect:${input.sourceId}`).digest('hex')
    const previous = this.operation(input.operationId, fingerprint)
    if (previous) return previous as { sourceId: BillingCredentialSourceId; disconnected: true }
    await Effect.runPromise(this.credentials.remove(BILLING_INTEGRATIONS[input.sourceId]))
    this.invalidate(input.sourceId)
    const result = { sourceId: input.sourceId, disconnected: true as const }
    this.operations.set(input.operationId, { fingerprint, result })
    return result
  }

  private operation(operationId: string, fingerprint: string) {
    const existing = this.operations.get(operationId)
    if (!existing) return undefined
    if (existing.fingerprint !== fingerprint) {
      throw new AgentError('CONFLICT', 'operationId 已用于其他计费凭据操作', 409)
    }
    return existing.result
  }

  private async queryAdapter(adapter: ProviderUsageAdapter, context: UsageQueryContext) {
    const cacheKey = `${adapter.sourceId}\u0000${context.range}\u0000${context.timeZone}`
    const cached = this.cache.get(cacheKey)
    if (!context.force && cached && cached.expiresAt > context.now) return cached.value
    const existing = this.inflight.get(cacheKey)
    if (existing) return existing
    let resolvedConnection: ProviderUsageSource['connection'] | undefined
    const trackedContext: UsageQueryContext = {
      ...context,
      credential: async (...args) => {
        const value = await context.credential(...args)
        if (value) resolvedConnection = value.connection
        return value
      },
      billingCredential: async (...args) => {
        const value = await context.billingCredential(...args)
        if (value) resolvedConnection = value.connection
        return value
      },
    }
    const pending = adapter
      .query(trackedContext)
      .then((value) => {
        let decoded: ProviderUsageSource
        try {
          decoded = decodeProviderUsageSource(value)
        } catch {
          throw new UsageRequestError('invalid-response', '厂商用量响应校验失败', false)
        }
        this.cache.set(cacheKey, {
          value: decoded,
          expiresAt: context.now + (adapter.cacheMs ?? DEFAULT_CACHE_MS),
        })
        return decoded
      })
      .catch((cause) => {
        if (cached)
          return {
            ...cached.value,
            error: safeError(adapter, cause, context.now, resolvedConnection).error,
          }
        return safeError(adapter, cause, context.now, resolvedConnection)
      })
      .finally(() => {
        if (this.inflight.get(cacheKey) === pending) this.inflight.delete(cacheKey)
      })
    this.inflight.set(cacheKey, pending)
    return pending
  }

  private invalidate(sourceId: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${sourceId}\u0000`)) this.cache.delete(key)
    }
  }

  private async providerCredential(
    providers: readonly Provider.Info[],
    providerIds: readonly string[],
    envNames: readonly string[] = [],
  ): Promise<ResolvedUsageCredential | null> {
    let matchedProvider = false
    for (const providerID of providerIds) {
      const provider = providers.find((item) => String(item.id) === providerID)
      if (!provider) continue
      matchedProvider = true
      const integrationID = String(provider.id)
      await this.piModels.pi.getAuth(providerID)
      const stored = await Effect.runPromise(
        this.providerCredentials.get<Credential.Value>(integrationID),
      )
      const value = stored?.value
      if (!value || !Schema.is(Credential.Value)(value)) continue
      const summary = stored
        ? this.providerCredentials.listApiKeys(integrationID).find((item) => item.id === stored.id)
        : undefined
      return {
        value,
        connection: {
          kind: value.type === 'oauth' ? 'oauth' : 'provider-key',
          ...(stored ? { credentialId: Credential.ID.make(stored.id) } : {}),
          ...(summary ? { maskedValue: summary.maskedValue } : {}),
          disconnectible: false,
        },
      }
    }
    if (!matchedProvider) return null
    for (const name of envNames) {
      const key = this.env[name]?.trim()
      if (!key) continue
      return {
        value: Credential.Key.make({ type: 'key', key }),
        connection: { kind: 'env', maskedValue: mask(key), disconnectible: false },
      }
    }
    return null
  }

  private async providerConnection(
    providers: readonly Provider.Info[],
    providerIds: readonly string[],
    envNames: readonly string[] = [],
  ): Promise<ProviderUsageSource['connection']> {
    let matchedProvider = false
    for (const providerID of providerIds) {
      const provider = providers.find((item) => String(item.id) === providerID)
      if (!provider) continue
      matchedProvider = true
      const integrationID = String(provider.id)
      const stored = await Effect.runPromise(
        this.providerCredentials.get<Credential.Value>(integrationID),
      )
      if (!stored || !Schema.is(Credential.Value)(stored.value)) continue
      const summary = this.providerCredentials
        .listApiKeys(integrationID)
        .find((item) => item.id === stored.id)
      return {
        kind: stored.value.type === 'oauth' ? 'oauth' : 'provider-key',
        credentialId: Credential.ID.make(stored.id),
        ...(summary ? { maskedValue: summary.maskedValue } : {}),
        disconnectible: false,
      }
    }
    if (!matchedProvider) return { kind: 'none', disconnectible: false }
    for (const name of envNames) {
      const key = this.env[name]?.trim()
      if (key) return { kind: 'env', maskedValue: mask(key), disconnectible: false }
    }
    return { kind: 'none', disconnectible: false }
  }

  private async billingCredential(
    sourceId: string,
    envNames: readonly string[] = [],
  ): Promise<ResolvedUsageCredential | null> {
    const integrationID =
      sourceId === 'anthropic-subscription'
        ? SUBSCRIPTION_INTEGRATION
        : BILLING_INTEGRATIONS[sourceId as BillingCredentialSourceId]
    if (integrationID) {
      if (sourceId === 'anthropic-subscription') {
        await this.subscriptionModels?.getAuth('anthropic')
      }
      const value = (await Effect.runPromise(this.credentials.get<Credential.Value>(integrationID)))
        ?.value
      if (value && Schema.is(Credential.Value)(value)) {
        const stored = await Effect.runPromise(
          this.credentials.get<Credential.Value>(integrationID),
        )
        const summary = stored
          ? this.credentials.listApiKeys(integrationID).find((item) => item.id === stored.id)
          : undefined
        return {
          value,
          connection: {
            kind: value.type === 'oauth' ? 'oauth' : 'billing-key',
            ...(stored ? { credentialId: Credential.ID.make(stored.id) } : {}),
            ...(summary ? { maskedValue: summary.maskedValue } : {}),
            disconnectible: true,
          },
        }
      }
    }
    for (const name of envNames) {
      const key = this.env[name]?.trim()
      if (!key) continue
      const metadata =
        sourceId === 'xai-management' && this.env.XAI_TEAM_ID
          ? { teamId: this.env.XAI_TEAM_ID }
          : sourceId === 'cloudflare-ai-gateway' && this.env.CLOUDFLARE_ACCOUNT_ID
            ? { accountId: this.env.CLOUDFLARE_ACCOUNT_ID }
            : undefined
      return {
        value: Credential.Key.make({ type: 'key', key, metadata }),
        connection: { kind: 'env', maskedValue: mask(key), disconnectible: false },
      }
    }
    return null
  }

  private async billingConnection(
    sourceId: string,
    envNames: readonly string[] = [],
  ): Promise<ProviderUsageSource['connection']> {
    const integrationID =
      sourceId === 'anthropic-subscription'
        ? SUBSCRIPTION_INTEGRATION
        : BILLING_INTEGRATIONS[sourceId as BillingCredentialSourceId]
    if (integrationID) {
      const stored = await Effect.runPromise(this.credentials.get<Credential.Value>(integrationID))
      if (stored && Schema.is(Credential.Value)(stored.value)) {
        const summary = this.credentials
          .listApiKeys(integrationID)
          .find((item) => item.id === stored.id)
        return {
          kind: stored.value.type === 'oauth' ? 'oauth' : 'billing-key',
          credentialId: Credential.ID.make(stored.id),
          ...(summary ? { maskedValue: summary.maskedValue } : {}),
          disconnectible: true,
        }
      }
    }
    for (const name of envNames) {
      const key = this.env[name]?.trim()
      if (!key) continue
      if (sourceId === 'xai-management' && !this.env.XAI_TEAM_ID?.trim()) continue
      if (sourceId === 'cloudflare-ai-gateway' && !this.env.CLOUDFLARE_ACCOUNT_ID?.trim()) continue
      return { kind: 'env', maskedValue: mask(key), disconnectible: false }
    }
    return { kind: 'none', disconnectible: false }
  }
}
