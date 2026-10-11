import type {
  Api,
  Model as PiModel,
  Models,
  ModelsStore,
  MutableModels,
  Provider as PiProvider,
} from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { Model, Provider } from '@pidex/model-schema'
import type { ProviderCredentialRepository } from '../../auth/ProviderCredentialRepository'
import {
  EncryptedCredentialStore,
  type EncryptedCredentialStoreOptions,
} from './EncryptedCredentialStore'
import {
  parsePiProviderCatalog,
  PI_PROVIDER_CONFIG_SCHEMA_VERSION,
  DEEPSEEK_PROVIDER_ID,
  DEFAULT_DEEPSEEK_PROTOCOL,
  resolveDeepSeekProtocol,
  type DeepSeekProtocol,
  type ParsedPiProviderCatalog,
  type PiModelCatalogConfig,
  type PiProviderConfig,
  type PiProviderConfigIssue,
  type PiProviderDefinitionInput,
} from './PiProviderConfig'
import { createPiDeepSeekProvider } from './PiDeepSeekProvider'
import {
  createPiCustomProvider,
  discoverOpenAIModels,
  type DiscoveredOpenAIModel,
} from './PiCustomProvider'

export interface PiModelServiceOptions extends EncryptedCredentialStoreOptions {
  readonly models?: Models
  readonly modelsStore?: ModelsStore
  readonly config?:
    PiModelCatalogConfig | (() => PiModelCatalogConfig | PromiseLike<PiModelCatalogConfig>)
  readonly env?: Readonly<Record<string, string | undefined>>
}

export class PiModelServiceError extends Error {
  constructor(
    readonly code:
      | 'CATALOG_REFRESH_FAILED'
      | 'PROVIDER_NOT_FOUND'
      | 'MODEL_NOT_FOUND'
      | 'VARIANT_NOT_FOUND'
      | 'PROVIDER_NOT_CONFIGURED'
      | 'DISPOSED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PiModelServiceError'
  }
}

const clone = <T>(value: T): T => structuredClone(value)

const piProviderToInfo = (
  provider: PiProvider,
  kind: Provider.SourceKind,
  apis: readonly string[],
  disabled: boolean,
  configured?: PiProviderConfig,
  catalogOrigin: Provider.CatalogOrigin = 'pi-bundled',
): Provider.Info => ({
  id: Provider.ID.make(provider.id),
  name: provider.name,
  ...(disabled ? { disabled: true } : {}),
  source: {
    type: 'pi',
    kind,
    apis: [...new Set(apis)],
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
  },
  catalogOrigin,
  availability: { status: 'ready' },
  auth: {
    apiKey:
      configured?.kind === 'custom'
        ? configured.auth === 'api-key'
        : provider.auth.apiKey !== undefined,
    oauth: provider.auth.oauth !== undefined,
  },
})

const cost = (model: PiModel<Api>): Model.Cost[] => [
  {
    input: model.cost.input,
    output: model.cost.output,
    cache: { read: model.cost.cacheRead, write: model.cost.cacheWrite },
  },
  ...(model.cost.tiers ?? []).map((tier) => ({
    tier: { type: 'context' as const, size: tier.inputTokensAbove },
    input: tier.input,
    output: tier.output,
    cache: { read: tier.cacheRead, write: tier.cacheWrite },
  })),
]

const thinkingLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

const supportedThinkingLevels = (model: PiModel<Api>) =>
  model.reasoning ? thinkingLevels.filter((level) => model.thinkingLevelMap?.[level] !== null) : []

const piModelToInfo = (model: PiModel<Api>, enabled: boolean, variant?: string): Model.Info => ({
  id: Model.ID.make(model.id),
  providerID: Provider.ID.make(model.provider),
  name: model.name,
  api: {
    id: Model.ID.make(model.id),
    type: 'pi',
    name: model.api,
    baseUrl: model.baseUrl,
  },
  ...(variant ? { variant } : {}),
  capabilities: {
    tools: true,
    input: [...model.input],
    output: ['text'],
  },
  variants: supportedThinkingLevels(model).map((level) => ({
    id: Model.VariantID.make(level),
  })),
  time: { released: 0 },
  cost: cost(model),
  status: 'active',
  enabled,
  limit: {
    context: model.contextWindow,
    output: model.maxTokens,
  },
})

export type ProviderDefinition = PiProviderDefinitionInput

/** Pi-backed model catalog with the existing Pidex catalog shape. */
export class PiModelService {
  readonly pi: Models
  readonly credentials: EncryptedCredentialStore
  private readonly mutablePi: MutableModels | undefined
  private readonly configSource: PiModelServiceOptions['config']
  private readonly baseProviders: ReadonlyMap<string, PiProvider>
  private readonly builtinProviderIDs: ReadonlySet<string>
  private configuredCustomProviderIDs = new Set<string>()
  private catalogVersion = 0
  private configFingerprint = ''
  private parsedConfig: ParsedPiProviderCatalog = {
    schemaVersion: PI_PROVIDER_CONFIG_SCHEMA_VERSION,
    providers: {},
    issues: [],
  }
  private syncOperation: Promise<ParsedPiProviderCatalog> = Promise.resolve(this.parsedConfig)
  private deepSeekProtocol:
    | {
        readonly protocol: DeepSeekProtocol
        readonly provider: PiProvider
        readonly source: PiProvider
      }
    | undefined
  private disposed = false

  constructor(repository: ProviderCredentialRepository, options: PiModelServiceOptions = {}) {
    this.credentials = new EncryptedCredentialStore(repository, options)
    this.pi =
      options.models ??
      builtinModels({
        credentials: this.credentials,
        ...(options.modelsStore ? { modelsStore: options.modelsStore } : {}),
        authContext: {
          env: async (name) => options.env?.[name] ?? process.env[name],
          // Pidex intentionally does not let Pi discover auth files.
          fileExists: async () => false,
        },
      })
    this.mutablePi = isMutableModels(this.pi) ? this.pi : undefined
    this.baseProviders = new Map(this.pi.getProviders().map((provider) => [provider.id, provider]))
    this.builtinProviderIDs = new Set(this.pi.getProviders().map((provider) => provider.id))
    this.configSource = options.config
  }

  async list(): Promise<readonly Provider.Info[]> {
    this.assertActive()
    const config = await this.syncProviders()
    return this.pi
      .getProviders()
      .map((provider) => {
        const configured = config.providers[provider.id]
        const kind = configured?.kind === 'custom' ? 'custom' : 'builtin'
        const origin: Provider.CatalogOrigin = configured?.kind === 'custom' ? 'user' : 'pi-bundled'
        return piProviderToInfo(
          provider,
          kind,
          this.pi.getModels(provider.id).map((model) => model.api),
          !this.providerEnabled(provider.id, config),
          configured,
          origin,
        )
      })
      .map(clone)
  }

  async isAuthConfigured(providerID: string): Promise<boolean> {
    this.assertActive()
    await this.syncProviders()
    const provider = this.pi.getProviders().find((candidate) => candidate.id === providerID)
    if (!provider) return false
    if (!provider.auth.apiKey && !provider.auth.oauth) return true
    return (await this.pi.checkAuth(providerID)) !== undefined
  }

  async providerDefinitions(): Promise<readonly ProviderDefinition[]> {
    this.assertActive()
    const config = await this.syncProviders()
    const definitions = this.pi.getProviders().map((provider): ProviderDefinition => {
      const configured = config.providers[provider.id]
      if (configured?.kind === 'custom') {
        return {
          kind: 'custom',
          id: provider.id,
          name: configured.name,
          enabled: configured.enabled,
          baseUrl: configured.baseUrl,
          auth: configured.auth,
          env: [...configured.env],
          allowInsecureHttp: configured.allowInsecureHttp,
          headers: { ...configured.headers },
          models: Object.values(configured.models).map((model) => ({
            id: model.id,
            api: model.api,
            name: model.name,
            enabled: model.enabled,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            reasoning: model.reasoning,
            input: [...model.input],
            cost: { ...model.cost },
            ...(Object.keys(model.headers).length ? { headers: { ...model.headers } } : {}),
            ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
            ...(model.compat ? { compat: structuredClone(model.compat) } : {}),
          })),
        }
      }
      const builtin = configured?.kind === 'builtin' ? configured : undefined
      return {
        kind: 'builtin',
        id: provider.id,
        enabled: builtin?.enabled ?? true,
        allowModels: [...(builtin?.allowModels ?? [])],
        denyModels: [...(builtin?.denyModels ?? [])],
        models: Object.entries(builtin?.models ?? {}).map(([id, model]) => ({
          id,
          enabled: model.enabled,
        })),
        ...(builtin?.protocol ? { protocol: builtin.protocol } : {}),
      }
    })
    return definitions.map(clone)
  }

  async models(providerID?: Provider.ID): Promise<readonly Model.Info[]> {
    this.assertActive()
    const config = await this.syncProviders()
    const available = new Set(
      (await this.pi.getAvailable(providerID ? String(providerID) : undefined)).map(
        (model) => `${model.provider}/${model.id}`,
      ),
    )
    return this.pi
      .getModels(providerID ? String(providerID) : undefined)
      .filter((model) => this.modelEnabled(model, config))
      .map((model) => piModelToInfo(model, available.has(`${model.provider}/${model.id}`)))
      .map(clone)
  }

  async resolve(ref: Model.Ref): Promise<Model.Info> {
    const model = await this.getPiModel(ref)
    const auth = await this.pi.checkAuth(model.provider)
    return clone(
      piModelToInfo(model, auth !== undefined, ref.variant ? String(ref.variant) : undefined),
    )
  }

  async getPiModel(ref: Model.Ref): Promise<PiModel<Api>> {
    this.assertActive()
    const config = await this.syncProviders()
    const providerID = String(ref.providerID)
    const modelID = String(ref.id)
    if (!this.providerEnabled(providerID, config)) {
      throw new PiModelServiceError('PROVIDER_NOT_FOUND', `Provider ${providerID} was not found`)
    }
    const model = this.pi.getModel(providerID, modelID)
    if (!model || !this.modelEnabled(model, config)) {
      throw new PiModelServiceError(
        'MODEL_NOT_FOUND',
        `Model ${providerID}/${modelID} was not found`,
      )
    }
    if (
      ref.variant &&
      !supportedThinkingLevels(model).includes(
        String(ref.variant) as (typeof thinkingLevels)[number],
      )
    ) {
      throw new PiModelServiceError(
        'VARIANT_NOT_FOUND',
        `Variant ${providerID}/${modelID}/${ref.variant} was not found`,
      )
    }
    const auth = await this.pi.checkAuth(providerID)
    if (!auth)
      throw new PiModelServiceError(
        'PROVIDER_NOT_CONFIGURED',
        `Provider ${providerID} is not configured`,
      )
    return model
  }

  async refresh(force = false): Promise<void> {
    this.assertActive()
    await this.syncProviders()
    const result = await this.pi.refresh({ allowNetwork: true, force })
    if (result.errors.size > 0) {
      throw new PiModelServiceError(
        'CATALOG_REFRESH_FAILED',
        'Failed to refresh one or more Pi providers',
        {
          cause: new AggregateError(result.errors.values()),
        },
      )
    }
    this.catalogVersion += 1
  }

  async reload(): Promise<void> {
    this.assertActive()
    await this.syncProviders()
    await this.pi.refresh({ allowNetwork: false })
    this.catalogVersion += 1
  }

  getModel(ref: Model.Ref): Promise<PiModel<Api>> {
    return this.getPiModel(ref)
  }

  catalogRevision(): number {
    return this.catalogVersion
  }

  async discoverModels(
    providerID: string,
    options: {
      readonly signal?: AbortSignal
      readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    } = {},
  ): Promise<readonly DiscoveredOpenAIModel[]> {
    const config = await this.syncProviders()
    const provider = config.providers[providerID]
    if (!provider || provider.kind !== 'custom' || !provider.enabled) {
      throw new PiModelServiceError(
        'PROVIDER_NOT_FOUND',
        `Custom provider ${providerID} was not found`,
      )
    }
    if (
      !Object.values(provider.models).some(
        (model) => model.api === 'openai-completions' || model.api === 'openai-responses',
      )
    ) {
      throw new PiModelServiceError(
        'PROVIDER_NOT_CONFIGURED',
        `Provider ${providerID} does not use an OpenAI-compatible API`,
      )
    }
    const auth = await this.pi.getAuth(providerID)
    if (provider.auth === 'api-key' && !auth) {
      throw new PiModelServiceError(
        'PROVIDER_NOT_CONFIGURED',
        `Provider ${providerID} is not configured`,
      )
    }
    return discoverOpenAIModels({
      baseUrl: provider.baseUrl,
      headers: {
        ...provider.headers,
        ...Object.fromEntries(
          Object.entries(auth?.auth.headers ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ),
      },
      ...(auth?.auth.apiKey ? { apiKey: auth.auth.apiKey } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
  }

  async configIssues(): Promise<readonly PiProviderConfigIssue[]> {
    return [...(await this.syncProviders()).issues]
  }

  async catalogConfig(): Promise<ParsedPiProviderCatalog> {
    return structuredClone(await this.syncProviders())
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }

  private async rawConfig(): Promise<PiModelCatalogConfig> {
    return typeof this.configSource === 'function'
      ? await this.configSource()
      : (this.configSource ?? {})
  }

  private syncProviders(force = false): Promise<ParsedPiProviderCatalog> {
    const operation = async () => {
      const raw = await this.rawConfig()
      const fingerprint = JSON.stringify(raw)
      if (!force && fingerprint === this.configFingerprint) return this.parsedConfig
      const parsed = parsePiProviderCatalog(raw)
      const custom = Object.entries(parsed.providers).filter(
        (entry): entry is [string, Extract<(typeof entry)[1], { kind: 'custom' }>] =>
          entry[1].kind === 'custom',
      )
      if (custom.length > 0 && !this.mutablePi) {
        throw new PiModelServiceError(
          'CATALOG_REFRESH_FAILED',
          'The configured Pi Models collection is not mutable',
        )
      }
      for (const providerID of this.configuredCustomProviderIDs) {
        this.mutablePi?.deleteProvider(providerID)
      }
      const nextCustomProviderIDs = new Set<string>()
      for (const [providerID, provider] of custom) {
        this.mutablePi?.setProvider(createPiCustomProvider(providerID, provider))
        nextCustomProviderIDs.add(providerID)
      }
      this.configuredCustomProviderIDs = nextCustomProviderIDs
      this.applyProviderProtocolOverride(parsed)
      this.parsedConfig = parsed
      this.configFingerprint = fingerprint
      return parsed
    }
    this.syncOperation = this.syncOperation.then(operation, operation)
    return this.syncOperation
  }

  /**
   * DeepSeek selects one global wire protocol per config write, so the runtime
   * provider is rebuilt from whatever catalog is currently installed.
   */
  private applyProviderProtocolOverride(config: ParsedPiProviderCatalog): void {
    if (!this.mutablePi) return
    const base = this.baseProviders.get(DEEPSEEK_PROVIDER_ID)
    if (!base) return
    const active = this.deepSeekProtocol
    const current = this.pi.getProvider(DEEPSEEK_PROVIDER_ID) ?? base
    const protocol = resolveDeepSeekProtocol(config)
    // A rejected DeepSeek block keeps the provider that is already running.
    if (!protocol) return
    if (protocol === DEFAULT_DEEPSEEK_PROTOCOL) {
      if (!active) return
      this.deepSeekProtocol = undefined
      this.mutablePi.setProvider(active.source)
      return
    }
    if (active?.protocol === protocol && current === active.provider) return
    // A provider other than our own override means the catalog was rebuilt
    // underneath it, so that provider becomes the new mapping source.
    const source = current === active?.provider ? active.source : current
    const provider = createPiDeepSeekProvider(source, protocol)
    this.deepSeekProtocol = { protocol, provider, source }
    this.mutablePi.setProvider(provider)
  }

  private providerEnabled(providerID: string, config: ParsedPiProviderCatalog) {
    if (config.schemaVersion > PI_PROVIDER_CONFIG_SCHEMA_VERSION) return false
    const provider = config.providers[providerID]
    if (!provider) return this.builtinProviderIDs.has(providerID)
    return provider.enabled
  }

  private modelEnabled(model: PiModel<Api>, config: ParsedPiProviderCatalog) {
    if (!this.providerEnabled(model.provider, config)) return false
    const provider = config.providers?.[model.provider]
    if (!provider) return true
    if (provider.kind === 'custom') {
      return (
        provider.models[model.id]?.enabled !== false &&
        Object.values(provider.models).some(
          (configured) => configured.id === model.id && configured.enabled,
        )
      )
    }
    if (provider.allowModels.length > 0 && !provider.allowModels.includes(model.id)) return false
    if (provider.denyModels.includes(model.id)) return false
    return provider.models[model.id]?.enabled !== false
  }

  private assertActive() {
    if (this.disposed)
      throw new PiModelServiceError('DISPOSED', 'Pi model service has been disposed')
  }
}

const isMutableModels = (models: Models): models is MutableModels =>
  'setProvider' in models &&
  typeof (models as Partial<MutableModels>).setProvider === 'function' &&
  'deleteProvider' in models &&
  typeof (models as Partial<MutableModels>).deleteProvider === 'function'
