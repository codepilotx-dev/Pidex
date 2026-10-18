import { ModelRecommendationStore } from './ModelRecommendationStore'
import type { RecommendationInput } from './ModelRecommendations'
import { AgentError } from '../../Domain'
import type { AgentLogger } from '../../observability/AgentLogger'
import { providerFailureCategory, providerFailureMessage } from '../ModelHealthService'
import {
  requestModelOperation,
  operationInputTokens,
  type ModelOperationOptions,
} from './PiModelOperations'
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
  type CustomProviderApi,
  type DeepSeekProtocol,
  type ParsedPiProviderCatalog,
  type PiModelCatalogConfig,
  type PiProviderConfig,
  type PiProviderConfigIssue,
  type PiProviderDefinitionInput,
} from './PiProviderConfig'
import { createPiDeepSeekProvider } from './PiDeepSeekProvider'
import { withPiOpenAIModelDiscovery } from './PiOpenAIModelDiscovery'
import { withPiBuiltinProviderOverrides } from './PiBuiltinProviderOverrides'
import {
  createPiCustomProvider,
  discoverOpenAIModels,
  type DiscoveredOpenAIModel,
} from './PiCustomProvider'

export interface PiModelServiceOptions extends EncryptedCredentialStoreOptions {
  readonly logger?: Pick<AgentLogger, 'warn'>
  readonly recommendations?: ModelRecommendationStore
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
    readonly refreshFailures: readonly string[] = [],
  ) {
    super(message, options)
    this.name = 'PiModelServiceError'
  }
}

import { builtinProviderEndpoints } from './PiProviderConfig'

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
    ...(kind === 'builtin'
      ? {
          endpoints: builtinProviderEndpoints(provider.id),
          defaultApi:
            configured?.kind === 'builtin' && configured.protocol ? configured.protocol : apis[0],
        }
      : {}),
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
  (!(model as ConfiguredPiModel).modelType || (model as ConfiguredPiModel).modelType === 'chat') &&
  model.reasoning
    ? thinkingLevels.filter((level) => model.thinkingLevelMap?.[level] !== null)
    : []

type ConfiguredPiModel = PiModel<Api> & {
  maxInputTokens?: number
  inputExplicit?: boolean
  modelType?: 'chat' | 'embedding' | 'rerank'
  tools?: boolean
}

const effectiveInput = (model: PiModel<Api>): string[] => {
  const kind = (model as ConfiguredPiModel).modelType
  if (kind === 'embedding' || kind === 'rerank') return ['text']
  const gemini = model.api === 'google-generative-ai' || model.api === 'google-vertex'
  const nativeMedia =
    gemini && !(model as ConfiguredPiModel).inputExplicit && model.id.includes('gemini')
  return [...new Set<string>([...model.input, ...(nativeMedia ? ['audio', 'video'] : [])])].filter(
    (input) =>
      (input !== 'audio' || gemini || model.api === 'openai-completions') &&
      (input !== 'video' || gemini),
  )
}

const piModelToInfo = (model: PiModel<Api>, enabled: boolean, variant?: string): Model.Info => ({
  id: Model.ID.make(model.id),
  providerID: Provider.ID.make(model.provider),
  name: model.name,
  ...((model as ConfiguredPiModel).modelType && (model as ConfiguredPiModel).modelType !== 'chat'
    ? { modelType: (model as ConfiguredPiModel).modelType! }
    : {}),
  api: {
    id: Model.ID.make(model.id),
    type: 'pi',
    name: model.api,
    baseUrl: model.baseUrl,
  },
  ...(variant ? { variant } : {}),
  capabilities: {
    tools:
      (!(model as ConfiguredPiModel).modelType ||
        (model as ConfiguredPiModel).modelType === 'chat') &&
      (model as ConfiguredPiModel).tools !== false,
    input: effectiveInput(model),
    output: [
      (model as ConfiguredPiModel).modelType === 'embedding'
        ? 'embedding'
        : (model as ConfiguredPiModel).modelType === 'rerank'
          ? 'rerank'
          : 'text',
    ],
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
    ...((model as ConfiguredPiModel).maxInputTokens !== undefined
      ? { input: (model as ConfiguredPiModel).maxInputTokens! }
      : {}),
    output: model.maxTokens,
  },
})

export type ProviderDefinition = PiProviderDefinitionInput

/** provider/list baseline summary; the full baseline stays internal. */
export interface PiProviderModelSyncSummary {
  readonly fetchedAt: number
  readonly api: CustomProviderApi
  readonly modelCount: number
}

/** Pi-backed model catalog with the existing Pidex catalog shape. */
export class PiModelService {
  readonly recommendations: ModelRecommendationStore
  readonly pi: Models
  private readonly mediaModels = new WeakMap<PiModel<Api>, PiModel<Api>>()
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

  constructor(
    repository: ProviderCredentialRepository,
    private readonly options: PiModelServiceOptions = {},
  ) {
    this.recommendations = options.recommendations ?? new ModelRecommendationStore()
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
    for (const provider of this.pi.getProviders()) {
      const discovered = withPiOpenAIModelDiscovery(
        provider,
        (signal) => this.pi.getAuth(provider.id, { signal }),
        () => {
          const config = this.parsedConfig.providers[provider.id]
          return config?.kind === 'builtin'
            ? (config.baseUrl ?? provider.baseUrl)
            : provider.baseUrl
        },
      )
      if (discovered !== provider) this.mutablePi?.setProvider(discovered)
    }
    this.baseProviders = new Map(this.pi.getProviders().map((provider) => [provider.id, provider]))
    this.builtinProviderIDs = new Set(this.pi.getProviders().map((provider) => provider.id))
    this.configSource = options.config
    options.recommendations?.startAutoRefresh()
  }

  async list(): Promise<readonly Provider.Info[]> {
    this.assertActive()
    const config = await this.syncProviders()
    const directory = new Map((await this.recommendations.providerDirectory()).map((entry) => [entry.id, entry]))
    const providers = this.pi
      .getProviders()
      .map((provider) => {
        const configured = config.providers[provider.id]
        const kind = configured?.kind === 'custom' ? 'custom' : 'builtin'
        const origin: Provider.CatalogOrigin = configured?.kind === 'custom' ? 'user' : 'pi-bundled'
        const info = piProviderToInfo(
          provider,
          kind,
          this.pi.getModels(provider.id).map((model) => model.api),
          !this.providerEnabled(provider.id, config),
          configured,
          origin,
        )
        const entry = directory.get(provider.id)
        directory.delete(provider.id)
        return kind === 'builtin' && entry ? { ...info, name: entry.name } : info
      })
      .map(clone)
    return [
      ...providers,
      ...[...directory.values()].map((entry): Provider.Info => ({
        ...Provider.Info.empty(Provider.ID.make(entry.id)),
        name: entry.name,
        availability: { status: 'unavailable', reason: 'unsupported-protocol' },
      })),
    ]
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
          ...(configured.endpoints ? { endpoints: configured.endpoints } : {}),
          auth: configured.auth,
          env: [...configured.env],
          allowInsecureHttp: configured.allowInsecureHttp,
          headers: { ...configured.headers },
          models: Object.values(configured.models).map((model) => ({
            id: model.id,
            api: model.api,
            name: model.name,
            ...(model.group !== undefined ? { group: model.group } : {}),
            enabled: model.enabled,
            contextWindow: model.contextWindow,
            ...(model.maxInputTokens !== undefined ? { maxInputTokens: model.maxInputTokens } : {}),
            maxTokens: model.maxTokens,
            ...(model.modelType ? { modelType: model.modelType } : {}),
            ...(model.tools !== undefined ? { tools: model.tools } : {}),
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
          ...model,
        })),
        ...(builtin?.endpoints ? { endpoints: builtin.endpoints } : {}),
        ...(builtin?.baseUrl ? { baseUrl: builtin.baseUrl } : {}),
        ...(builtin?.allowInsecureHttp !== undefined
          ? { allowInsecureHttp: builtin.allowInsecureHttp }
          : {}),
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
    const input = effectiveInput(model)
    if (
      input.length === model.input.length &&
      input.every((kind, index) => kind === model.input[index])
    )
      return model
    let extended = this.mediaModels.get(model)
    if (!extended) {
      extended = { ...model, input: input as PiModel<Api>['input'] }
      this.mediaModels.set(model, extended)
    }
    return extended
  }

  private async operationRequest(
    ref: Model.Ref,
    kind: 'embedding' | 'rerank',
    body: Record<string, unknown>,
    options: ModelOperationOptions,
  ) {
    const model = (await this.getPiModel(ref)) as ConfiguredPiModel & { maxInputTokens?: number }
    if (model.modelType !== kind)
      throw new AgentError('INVALID_REQUEST', '模型类型与请求操作不匹配', 400)
    const texts =
      kind === 'embedding'
        ? (body.input as string[])
        : [String(body.query), ...(body.documents as string[])]
    if (
      texts.some(
        (text) =>
          new TextEncoder().encode(text).length / 4 > (model.maxInputTokens ?? model.contextWindow),
      )
    )
      throw new AgentError('INVALID_REQUEST', '输入超过模型最大输入 Token 预算', 400)
    const config = (await this.syncProviders()).providers[model.provider]
    const endpointKey = kind === 'embedding' ? 'openai-embeddings' : 'jina-rerank'
    const explicitEndpoint = config?.endpoints?.[endpointKey]
    if (!explicitEndpoint && !['openai-completions', 'openai-responses'].includes(model.api))
      throw new AgentError('INVALID_REQUEST', '请先为该模型类型添加对应端点', 400)
    const base = explicitEndpoint ?? model.baseUrl
    const suffix = kind === 'embedding' ? '/embeddings' : '/rerank'
    const endpoint = base.replace(/\/$/, '').endsWith(suffix)
      ? base
      : `${base.replace(/\/$/, '')}${suffix}`
    const auth = await this.pi.getAuth(model.provider)
    const headers = new Headers({
      ...(config?.kind === 'custom' ? config.headers : {}),
      ...model.headers,
    })
    for (const [key, value] of Object.entries(auth?.auth.headers ?? {}))
      if (typeof value === 'string') headers.set(key, value)
    const apiKey = options.apiKey ?? auth?.auth.apiKey
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('Content-Type', 'application/json')
    return requestModelOperation(endpoint, headers, { ...body, model: model.id }, options)
  }

  async embed(
    ref: Model.Ref,
    input: readonly string[],
    dimensions?: number,
    options: ModelOperationOptions = {},
  ) {
    const result = await this.operationRequest(
      ref,
      'embedding',
      { input, ...(dimensions ? { dimensions } : {}) },
      options,
    )
    const data = result.data
    if (!Array.isArray(data) || data.length !== input.length)
      throw new AgentError('PROVIDER_UNAVAILABLE', '嵌入响应数量无效', 502)
    const vectors: number[][] = new Array(input.length)
    for (const item of data) {
      if (
        !item ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= input.length ||
        vectors[item.index] ||
        !Array.isArray(item.embedding) ||
        !item.embedding.length ||
        !item.embedding.every(
          (value: unknown) => typeof value === 'number' && Number.isFinite(value),
        )
      )
        throw new AgentError('PROVIDER_UNAVAILABLE', '嵌入响应格式无效', 502)
      vectors[item.index] = item.embedding
    }
    const dimension = dimensions ?? vectors[0]!.length
    if (vectors.some((vector) => vector.length !== dimension))
      throw new AgentError('PROVIDER_UNAVAILABLE', '嵌入向量维度不一致', 502)
    return { vectors, inputTokens: operationInputTokens(result) }
  }

  async rerank(
    ref: Model.Ref,
    query: string,
    documents: readonly string[],
    topN?: number,
    options: ModelOperationOptions = {},
  ) {
    if (topN !== undefined && topN > documents.length)
      throw new AgentError('INVALID_REQUEST', '重排数量不能超过文档数量', 400)
    const result = await this.operationRequest(
      ref,
      'rerank',
      { query, documents, ...(topN ? { top_n: topN } : {}) },
      options,
    )
    if (!Array.isArray(result.results) || result.results.length > (topN ?? documents.length))
      throw new AgentError('PROVIDER_UNAVAILABLE', '重排响应数量无效', 502)
    const indices = new Set<number>()
    const results = result.results.map((item) => {
      if (
        !item ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= documents.length ||
        indices.has(item.index) ||
        typeof item.relevance_score !== 'number' ||
        !Number.isFinite(item.relevance_score)
      )
        throw new AgentError('PROVIDER_UNAVAILABLE', '重排响应格式无效', 502)
      indices.add(item.index)
      return { index: item.index as number, score: item.relevance_score as number }
    })
    return { results, inputTokens: operationInputTokens(result) }
  }

  async refresh(force: boolean, providerID: string): Promise<void> {
    this.assertActive()
    const config = await this.syncProviders()
    if (!this.pi.getProviders().some((provider) => provider.id === providerID)) {
      throw new AgentError('INVALID_REQUEST', '供应商不存在', 400)
    }
    const result = await this.pi.refresh({
      allowNetwork: true,
      force,
      providers: this.pi
        .getProviders()
        .filter(
          (provider) =>
            provider.id === providerID &&
            this.providerEnabled(provider.id, config),
        )
        .map((provider) => provider.id),
    })
    if (result.errors.size > 0) {
      const failures = [...result.errors].map(([provider, error]) => {
        const httpStatus = /\bHTTP (\d{3})\b/.exec(error.message)?.[1]
        const category = providerFailureCategory(httpStatus ? { status: Number(httpStatus) } : error)
        const discoveryReason = new Map([
          ['Model discovery response exceeds 1 MiB', '模型列表响应超过 1 MiB'],
          ['Model discovery returned no body', '模型列表响应为空'],
          ['Model discovery returned an invalid OpenAI catalog', '模型列表响应格式无效'],
          ['Provider credentials are unavailable for model discovery', '模型发现凭据不可用'],
        ]).get(error.message)
        const reason = `${discoveryReason ?? providerFailureMessage(category, 'request')}${httpStatus ? `（HTTP ${httpStatus}）` : ''}`
        this.options.logger?.warn('provider.catalog.refresh.failed', { provider, category, reason })
        return `${provider}：${reason}`
      })
      throw new PiModelServiceError(
        'CATALOG_REFRESH_FAILED',
        'Failed to refresh one or more Pi providers',
        {
          cause: new AggregateError(result.errors.values()),
        },
        failures,
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

  async refreshDirectory(): Promise<void> {
    this.assertActive()
    try {
      await this.recommendations.refresh()
    } catch {
      this.options.logger?.warn('provider.directory.refresh.failed', { reason: 'MODELS_DEV_UNAVAILABLE' })
      throw new AgentError('PROVIDER_UNAVAILABLE', '供应商目录更新失败：无法下载或解析 models.dev 目录，已保留现有目录，请稍后重试。', 502)
    }
    await this.reload()
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

  /** Bounded provider/list summary of the saved upstream baseline. */
  async modelSyncSummary(providerID: string): Promise<PiProviderModelSyncSummary | undefined> {
    const provider = (await this.syncProviders()).providers[providerID]
    if (provider?.kind !== 'custom' || !provider.modelSync) return undefined
    return {
      fetchedAt: provider.modelSync.fetchedAt,
      api: provider.modelSync.api,
      modelCount: provider.modelSync.models.length,
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.recommendations.dispose()
  }

  previewRecommendation(input: RecommendationInput) {
    return this.recommendations.resolve(input)
  }

  refreshRecommendations() {
    return this.recommendations.refresh()
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
      for (const [id, base] of this.baseProviders) {
        const configured = parsed.providers[id]
        if (id === DEEPSEEK_PROVIDER_ID && parsed.issues.some((issue) => issue.providerID === id))
          continue
        const source =
          id === DEEPSEEK_PROVIDER_ID ? (this.deepSeekProtocol?.provider ?? base) : base
        this.mutablePi?.setProvider(
          configured?.kind === 'builtin'
            ? withPiBuiltinProviderOverrides(source, configured)
            : source,
        )
      }
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
    const current = base
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
