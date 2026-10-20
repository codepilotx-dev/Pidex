import { ConfigServiceError, type ConfigService, type ConfigValue } from '../config/ConfigService'
import { AgentError } from '../Domain'
import {
  assertSafeProviderHeaders,
  CUSTOM_PROVIDER_APIS,
  validateCustomProviderBaseUrl,
  serializePiProviderDefinition,
  type PiCustomModelSyncConfig,
  type PiCustomProviderConfig,
  type ProviderEndpointApi,
} from './pi/PiProviderConfig'
import {
  listProviderModels,
  type ListableChatApi,
  type ProviderModelFetch,
} from './pi/PiModelListing'
import type { PiModelService } from './pi/PiModelService'

/** Protocol-shaped candidate returned by sync and discovery results. */
export interface ProviderModelDefinition {
  readonly id: string
  readonly name: string
  readonly api: ListableChatApi
  readonly enabled: boolean
  readonly contextWindow: number
  readonly maxTokens: number
  readonly reasoning: boolean
  readonly input: readonly 'text'[]
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
}

export interface ProviderModelSyncResult {
  readonly providerId: string
  readonly api: ListableChatApi
  readonly fetchedAt: number
  readonly candidates: readonly ProviderModelDefinition[]
  readonly removedModelIds: readonly string[]
  readonly baselineCreated: boolean
  readonly totalFetched: number
}

export interface ProviderModelSyncOptions {
  readonly fetch?: ProviderModelFetch
}

/** Unsaved provider request draft; `apiKey` is transient and never persisted. */
export interface ProviderModelSyncDraft {
  readonly baseUrl: string
  readonly endpoints?: Partial<Record<ProviderEndpointApi, string>>
  readonly headers?: Readonly<Record<string, string>>
  readonly auth: 'api-key' | 'none'
  readonly allowInsecureHttp?: boolean
  readonly apiKey?: string
}

export interface ProviderDraftModelDiscovery {
  readonly models: readonly ProviderModelDefinition[]
  readonly fetchedAt: number
}

const DEFAULT_CANDIDATE = {
  contextWindow: 32_768,
  maxTokens: 8_192,
  reasoning: false,
  input: ['text'] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isListableChatApi = (value: unknown): value is ListableChatApi =>
  typeof value === 'string' && (CUSTOM_PROVIDER_APIS as readonly string[]).includes(value)

const toModelDefinition = (
  model: { readonly id: string; readonly name: string },
  api: ListableChatApi,
  enabled: boolean,
): ProviderModelDefinition => ({
  id: model.id,
  name: model.name,
  api,
  enabled,
  contextWindow: DEFAULT_CANDIDATE.contextWindow,
  maxTokens: DEFAULT_CANDIDATE.maxTokens,
  reasoning: DEFAULT_CANDIDATE.reasoning,
  input: [...DEFAULT_CANDIDATE.input],
  cost: { ...DEFAULT_CANDIDATE.cost },
})

/**
 * Immediate upstream model sync for saved custom providers.
 *
 * The first successful read only records a baseline; later reads delete models
 * that are both configured and present in the previous baseline but missing
 * upstream. Everything else — hand-added models and every stored field of the
 * kept models — is left untouched. Failures never write configuration.
 */
export class ModelSyncService {
  constructor(
    private readonly piModels: PiModelService,
    private readonly config: ConfigService,
  ) {}

  async sync(
    providerId: string,
    options: ProviderModelSyncOptions = {},
  ): Promise<ProviderModelSyncResult> {
    const configuration = await this.config.read({ includeLayers: true })
    const userLayer = configuration.layers?.find((layer) => layer.kind === 'user')
    if (!userLayer) throw new AgentError('CONFLICT', '供应商配置层不可用，请刷新后重试', 409)
    const provider = await this.customProvider(providerId)
    const api = this.selectApi(provider)
    const request = await this.savedRequest(providerId, provider, api, options.fetch)
    const snapshot = this.config.snapshot()
    const savedProviders = isObject(snapshot.model_providers) ? snapshot.model_providers : {}
    const definition = provider.directorySource && !isObject(savedProviders[providerId])
      ? (await this.piModels.providerDefinitions()).find((entry) => entry.id === providerId)
      : undefined
    const initial = definition ? serializePiProviderDefinition(definition).value : undefined
    const raw = initial ? { models: {} as Record<string, unknown> } : await this.rawProvider(providerId)
    const listing = await listProviderModels(request)
    const fetchedIDs = new Set(listing.models.map((model) => model.id))
    const baseline = provider.modelSync
    const removedModelIds = baseline
      ? Object.keys(raw.models).filter((id) => baseline.models.includes(id) && !fetchedIDs.has(id))
      : []
    const models = structuredClone(raw.models)
    for (const id of removedModelIds) delete models[id]
    const candidates = listing.models
      .filter((model) => !(model.id in raw.models))
      .map((model) => toModelDefinition(model, api, false))
    const modelSync: PiCustomModelSyncConfig = {
      fetchedAt: listing.fetchedAt,
      api,
      models: listing.models.map((model) => model.id),
    }
    try {
      await this.config.batchWrite({
        target: { kind: 'user' },
        expectedVersion: userLayer.version,
        edits: [
          ...Object.entries(initial ?? {})
            .filter(([key]) => key !== 'models' && key !== 'model_sync')
            .map(([key, value]) => ({
              keyPath: ['model_providers', providerId, key],
              value: value as ConfigValue,
            })),
          {
            keyPath: ['model_providers', providerId, 'models'],
            value: models as unknown as ConfigValue,
          },
          {
            keyPath: ['model_providers', providerId, 'model_sync'],
            value: {
              fetched_at: modelSync.fetchedAt,
              api: modelSync.api,
              models: [...modelSync.models],
            } as unknown as ConfigValue,
          },
        ],
      })
    } catch (cause) {
      if (cause instanceof ConfigServiceError && cause.code === 'CONFIG_VERSION_CONFLICT')
        throw new AgentError('CONFLICT', '同步期间供应商配置已变化，请重新同步', 409)
      throw cause
    }
    return {
      providerId,
      api,
      fetchedAt: listing.fetchedAt,
      candidates,
      removedModelIds,
      baselineCreated: baseline === undefined,
      totalFetched: listing.models.length,
    }
  }

  /** Reads the upstream catalog of a saved custom provider for one protocol. */
  async discoverSaved(
    providerId: string,
    api: ListableChatApi,
    options: ProviderModelSyncOptions = {},
  ): Promise<readonly ProviderModelDefinition[]> {
    if (!isListableChatApi(api)) {
      throw new AgentError('INVALID_REQUEST', '不支持的模型列表协议', 400)
    }
    const provider = await this.customProvider(providerId)
    const request = await this.savedRequest(providerId, provider, api, options.fetch)
    const listing = await listProviderModels(request)
    return listing.models.map((model) => toModelDefinition(model, api, true))
  }

  /**
   * Reads the upstream catalog for an unsaved provider draft. Nothing is
   * persisted: the transient api-key is used for this request only and never
   * logged or returned.
   */
  async discoverDraft(input: {
    readonly api: ListableChatApi
    readonly draft: ProviderModelSyncDraft
    readonly providerId?: string
    readonly fetch?: ProviderModelFetch
  }): Promise<ProviderDraftModelDiscovery> {
    const { api, draft } = input
    if (!isListableChatApi(api)) {
      throw new AgentError('INVALID_REQUEST', '不支持的模型列表协议', 400)
    }
    const allowInsecureHttp = draft.allowInsecureHttp === true
    let baseUrl: string
    let endpoint: string | undefined
    try {
      baseUrl = validateCustomProviderBaseUrl(draft.baseUrl, allowInsecureHttp)
      const declared = draft.endpoints?.[api]
      endpoint =
        declared === undefined
          ? undefined
          : validateCustomProviderBaseUrl(declared, allowInsecureHttp)
    } catch {
      throw new AgentError('INVALID_REQUEST', 'Provider 地址不安全或无效', 400)
    }
    let headers: Record<string, string>
    try {
      headers = { ...assertSafeProviderHeaders(draft.headers, 'provider draft') }
    } catch {
      throw new AgentError('INVALID_REQUEST', 'Provider 请求头包含无效或敏感内容', 400)
    }
    // Registering saved custom providers happens during catalog sync, so the
    // active credential for a draft fetch is only resolvable afterwards.
    const useSavedCredential = draft.auth === 'api-key' && input.providerId !== undefined
    if (useSavedCredential) await this.piModels.catalogConfig()
    const savedAuth = useSavedCredential
      ? await this.piModels.pi.getAuth(input.providerId!)
      : undefined
    const savedAuthHeaders = savedAuth?.auth.headers ?? {}
    if (draft.auth === 'api-key') {
      for (const [key, value] of Object.entries(savedAuthHeaders)) {
        if (typeof value === 'string') headers[key] = value
      }
    }
    const apiKey = draft.auth === 'none' ? undefined : (draft.apiKey ?? savedAuth?.auth.apiKey)
    const hasAuthHeaders = Object.keys(savedAuthHeaders).length > 0
    if (draft.auth === 'api-key' && !apiKey && !hasAuthHeaders) {
      throw new AgentError('PROVIDER_UNAVAILABLE', 'Provider 尚未提供可用的 API Key', 400)
    }
    const listing = await listProviderModels({
      api,
      baseUrl: endpoint ?? baseUrl,
      headers,
      ...(apiKey ? { apiKey } : {}),
      ...(input.fetch ? { fetch: input.fetch } : {}),
    })
    return {
      models: listing.models.map((model) => toModelDefinition(model, api, true)),
      fetchedAt: listing.fetchedAt,
    }
  }

  private async customProvider(providerId: string): Promise<PiCustomProviderConfig> {
    const provider = (await this.piModels.catalogConfig()).providers[providerId]
    if (!provider) {
      throw new AgentError('PROVIDER_NOT_FOUND', `Provider ${providerId} 不存在`, 404)
    }
    if (provider.kind !== 'custom') {
      throw new AgentError('INVALID_REQUEST', '只有自定义 Provider 支持同步上游模型', 400)
    }
    return provider
  }

  /** Model protocol, saved baseline, then the configured endpoint for a new provider. */
  private selectApi(provider: PiCustomProviderConfig): ListableChatApi {
    const first = Object.values(provider.models).find(
      (model) => (!model.modelType || model.modelType === 'chat') && isListableChatApi(model.api),
    )
    if (first) return first.api
    if (provider.modelSync) return provider.modelSync.api
    const endpointApi = Object.keys(provider.endpoints ?? {}).find(isListableChatApi)
    if (endpointApi) return endpointApi
    throw new AgentError('INVALID_REQUEST', '请先添加至少一个聊天模型后再同步上游模型', 400)
  }

  private async savedRequest(
    providerId: string,
    provider: PiCustomProviderConfig,
    api: ListableChatApi,
    fetch: ProviderModelFetch | undefined,
  ) {
    const auth =
      provider.auth === 'api-key' ? await this.piModels.pi.getAuth(providerId) : undefined
    if (provider.auth === 'api-key' && !auth) {
      throw new AgentError(
        'PROVIDER_UNAVAILABLE',
        'Provider 尚未配置可用的 API Key，请先添加凭据',
        400,
      )
    }
    const headers: Record<string, string> = { ...provider.headers }
    for (const [key, value] of Object.entries(auth?.auth.headers ?? {})) {
      if (typeof value === 'string') headers[key] = value
    }
    return {
      api,
      baseUrl: provider.endpoints?.[api] ?? provider.baseUrl,
      headers,
      ...(auth?.auth.apiKey ? { apiKey: auth.auth.apiKey } : {}),
      ...(fetch ? { fetch } : {}),
    }
  }

  /** Raw saved provider object so key-path writes preserve unknown fields. */
  private async rawProvider(
    providerId: string,
  ): Promise<{ readonly models: Record<string, unknown> }> {
    const snapshot = this.config.snapshot()
    const providers = isObject(snapshot.model_providers) ? snapshot.model_providers : {}
    const raw = isObject(providers[providerId]) ? providers[providerId] : undefined
    if (!raw) {
      throw new AgentError('PROVIDER_NOT_FOUND', `Provider ${providerId} 不存在`, 404)
    }
    return { models: isObject(raw.models) ? structuredClone(raw.models) : {} }
  }
}
