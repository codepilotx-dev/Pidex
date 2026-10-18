import type { ProtocolDetectionCell, ProtocolDetectionResult } from '@pidex/agent-protocol'
import { Model, Provider } from '@pidex/model-schema'
import { AgentError } from '../Domain'
import {
  providerFailureCategory,
  providerFailureMessage,
  type ModelHealthFailureCategory,
} from './ModelHealthService'
import { PiTransientProbe, type PiTransientProbeOptions } from './PiTransientProbe'
import type { PiModelService } from './pi'
import type { CustomProviderApi } from './pi/PiProviderConfig'
import {
  PROTOCOL_DETECTION_APIS,
  hasAuthorizationHeader,
  protocolProbeAddress,
  resolveTransientProbeApiKey,
  validateDraftHeaders,
  type ProviderRequestDraftLike,
} from './ProviderProtocolUrl'

/** Saved models probed by one batch detection run. */
export const PROTOCOL_DETECTION_BATCH_LIMIT = 30

/** Global in-flight request ceiling across the whole detection run. */
export const PROTOCOL_DETECTION_CONCURRENCY = 8

/** Per-request timeout used by protocol detection cells. */
export const PROTOCOL_DETECTION_REQUEST_TIMEOUT_MS = 12_000

export type ProtocolDetectionInput = {
  readonly draft: ProviderRequestDraftLike
  readonly providerId?: string
  readonly model?: string
  readonly batch: boolean
}

export type ProtocolDetectionServiceOptions = {
  /** Test seam; production uses the real Pi adapters through PiTransientProbe. */
  readonly probe?: PiTransientProbe
  readonly probeOptions?: PiTransientProbeOptions
  /** Per-request timeout override; production keeps the 12 second ceiling. */
  readonly requestTimeoutMs?: number
}

type SavedChatModel = {
  readonly id: string
  readonly api?: CustomProviderApi
}

type ResolvedCredential = {
  readonly apiKey?: string
  readonly headers: Record<string, string>
}

const chatApi = (value: string): CustomProviderApi | undefined =>
  (PROTOCOL_DETECTION_APIS as readonly string[]).includes(value)
    ? (value as CustomProviderApi)
    : undefined

/** Bounded worker pool: at most `limit` tasks are in flight at any time. */
const runBounded = async <T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> => {
  const results = new Array<T>(tasks.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      const task = tasks[index]
      if (!task) return
      results[index] = await task()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, tasks.length)) }, worker),
  )
  return results
}

/**
 * Probes an unsaved provider draft against the four supported chat wire
 * protocols. It never writes configuration, registers catalog providers or
 * switches the active credential: every request runs against an in-memory Pi
 * model built from the draft.
 */
export class ProtocolDetectionService {
  private readonly probe: PiTransientProbe
  private readonly requestTimeoutMs: number

  constructor(
    private readonly piModels: PiModelService,
    options: ProtocolDetectionServiceOptions = {},
  ) {
    this.probe = options.probe ?? new PiTransientProbe(options.probeOptions ?? {})
    this.requestTimeoutMs = options.requestTimeoutMs ?? PROTOCOL_DETECTION_REQUEST_TIMEOUT_MS
  }

  async detect(input: ProtocolDetectionInput): Promise<ProtocolDetectionResult> {
    const draft = this.requireDraft(input.draft)
    const providerID = this.normalizeProviderID(input.providerId)
    const mode: ProtocolDetectionResult['mode'] = input.batch === true ? 'batch' : 'single'

    // Validate the draft surface before any request: one invalid address or
    // sensitive header fails the whole call with a safe message.
    let draftHeaders: Readonly<Record<string, string>>
    const addresses = new Map<CustomProviderApi, string>()
    try {
      draftHeaders = validateDraftHeaders(draft.headers)
      for (const protocol of PROTOCOL_DETECTION_APIS) {
        addresses.set(protocol, protocolProbeAddress(protocol, draft))
      }
    } catch {
      throw new AgentError('INVALID_REQUEST', '服务地址或请求头不合法，请检查后重试', 400)
    }

    const credential = await this.resolveCredential(providerID)
    const headers: Record<string, string> = { ...draftHeaders, ...credential.headers }
    // Draft input always wins over the saved provider's active credential.
    const credentialKey = credential.apiKey?.trim()
    const apiKey = resolveTransientProbeApiKey(
      credentialKey && !draft.apiKey?.trim() ? { ...draft, apiKey: credentialKey } : draft,
      headers,
    )
    // `auth: 'none'` gets an adapter placeholder, so a genuinely keyless draft
    // still reaches the endpoint. Anything else without a usable credential is
    // a configuration failure rather than a network request with a bogus key.
    const missingCredential = !apiKey && !hasAuthorizationHeader(headers)

    if (mode === 'batch') {
      if (!providerID) {
        throw new AgentError('INVALID_REQUEST', '批量检测需要先选择供应商', 400)
      }
      const exists = (await this.piModels.list()).some(
        (provider) => String(provider.id) === providerID,
      )
      if (!exists) {
        throw new AgentError('PROVIDER_NOT_FOUND', `供应商 ${providerID} 不存在`, 404)
      }
      const saved = await this.savedChatModels(providerID)
      if (saved.length === 0) {
        throw new AgentError(
          'INVALID_REQUEST',
          '该供应商没有可用于检测的聊天模型，请先添加模型',
          400,
        )
      }
      const selected = saved.slice(0, PROTOCOL_DETECTION_BATCH_LIMIT)
      const totalModels = saved.length
      const skippedModels = totalModels - selected.length
      const tasks: Array<{ readonly modelIndex: number; readonly protocolIndex: number }> = []
      const runCell = (model: SavedChatModel, protocol: CustomProviderApi) =>
        this.probeCell(
          protocol,
          model.id,
          addresses.get(protocol)!,
          headers,
          apiKey,
          missingCredential,
          providerID,
        )
      selected.forEach((_, modelIndex) => {
        PROTOCOL_DETECTION_APIS.forEach((_, protocolIndex) => {
          tasks.push({ modelIndex, protocolIndex })
        })
      })
      const results = await runBounded(
        tasks.map(
          (task) => () =>
            runCell(selected[task.modelIndex]!, PROTOCOL_DETECTION_APIS[task.protocolIndex]!),
        ),
        PROTOCOL_DETECTION_CONCURRENCY,
      )
      const cellsByModel = new Map<number, ProtocolDetectionCell[]>()
      tasks.forEach((task, index) => {
        const cells = cellsByModel.get(task.modelIndex) ?? []
        cells[task.protocolIndex] = results[index]!
        cellsByModel.set(task.modelIndex, cells)
      })
      return {
        mode,
        protocols: [...PROTOCOL_DETECTION_APIS],
        models: selected.map((model, modelIndex) => ({
          model: Model.ID.make(model.id),
          cells: cellsByModel.get(modelIndex) ?? [],
        })),
        totalModels,
        skippedModels,
      }
    }

    const explicitModel = input.model?.trim() || undefined
    const saved = providerID ? await this.savedChatModels(providerID) : []
    const primaryModel = explicitModel ?? saved[0]?.id ?? (await this.baselineModel(providerID))
    if (!primaryModel) {
      throw new AgentError('INVALID_REQUEST', '请输入试用模型或先为供应商添加模型', 400)
    }
    const modelForProtocol = (protocol: CustomProviderApi): string =>
      explicitModel ?? saved.find((model) => model.api === protocol)?.id ?? primaryModel
    const cells = await runBounded(
      PROTOCOL_DETECTION_APIS.map(
        (protocol) => () =>
          this.probeCell(
            protocol,
            modelForProtocol(protocol),
            addresses.get(protocol)!,
            headers,
            apiKey,
            missingCredential,
            providerID,
          ),
      ),
      PROTOCOL_DETECTION_CONCURRENCY,
    )
    return {
      mode,
      protocols: [...PROTOCOL_DETECTION_APIS],
      models: [{ model: Model.ID.make(primaryModel), cells }],
      totalModels: 1,
      skippedModels: 0,
    }
  }

  private requireDraft(draft: ProviderRequestDraftLike | undefined): ProviderRequestDraftLike {
    if (
      !draft ||
      typeof draft !== 'object' ||
      typeof draft.baseUrl !== 'string' ||
      draft.baseUrl.trim().length === 0 ||
      (draft.auth !== 'api-key' && draft.auth !== 'none')
    ) {
      throw new AgentError('INVALID_REQUEST', '试用配置不完整，请检查服务地址与认证方式', 400)
    }
    return draft
  }

  private normalizeProviderID(providerId: string | undefined): string | undefined {
    if (typeof providerId !== 'string') return undefined
    const trimmed = providerId.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  /**
   * Active credential of a saved provider, used only for this request. Draft
   * apiKey/headers take precedence; failures degrade to "no credential" instead
   * of blocking a protocol report.
   */
  private async resolveCredential(providerID: string | undefined): Promise<ResolvedCredential> {
    if (!providerID) return { headers: {} }
    try {
      const auth = await this.piModels.pi.getAuth(providerID)
      if (!auth) return { headers: {} }
      const headers: Record<string, string> = {}
      for (const [name, value] of Object.entries(auth.auth.headers ?? {})) {
        if (typeof value === 'string') headers[name] = value
      }
      return {
        ...(typeof auth.auth.apiKey === 'string' && auth.auth.apiKey
          ? { apiKey: auth.auth.apiKey }
          : {}),
        headers,
      }
    } catch {
      return { headers: {} }
    }
  }

  /** Saved chat-capable models: custom config models, or the builtin catalog filtered by availability. */
  private async savedChatModels(providerID: string): Promise<SavedChatModel[]> {
    const definitions = await this.piModels.providerDefinitions()
    const definition = definitions.find((candidate) => candidate.id === providerID)
    if (definition?.kind === 'custom') {
      return definition.models
        .filter(
          (model) =>
            model.enabled !== false &&
            model.modelType !== 'embedding' &&
            model.modelType !== 'rerank',
        )
        .map((model) => ({ id: String(model.id), api: model.api }))
    }
    const models = await this.piModels.models(Provider.ID.make(providerID))
    return models
      .filter(
        (model) => model.enabled && model.modelType !== 'embedding' && model.modelType !== 'rerank',
      )
      .map((model) => ({
        id: String(model.id),
        ...(chatApi(model.api.name) ? { api: chatApi(model.api.name)! } : {}),
      }))
  }

  /** Last successful upstream model-sync baseline, used when no model is saved yet. */
  private async baselineModel(providerID: string | undefined): Promise<string | undefined> {
    if (!providerID) return undefined
    try {
      const config = await this.piModels.catalogConfig()
      const provider = config.providers[providerID] as unknown as
        { modelSync?: { models?: readonly unknown[] } } | undefined
      const models = provider?.modelSync?.models
      if (!Array.isArray(models)) return undefined
      return models.find((model): model is string => typeof model === 'string' && model.length > 0)
    } catch {
      return undefined
    }
  }

  private async probeCell(
    protocol: CustomProviderApi,
    modelId: string,
    baseUrl: string,
    headers: Readonly<Record<string, string>>,
    apiKey: string | undefined,
    missingCredential: boolean,
    providerId: string | undefined,
  ): Promise<ProtocolDetectionCell> {
    if (missingCredential) {
      const category: ModelHealthFailureCategory = 'configuration'
      return {
        protocol,
        status: 'failed',
        category,
        message: providerFailureMessage(category, 'request'),
      }
    }
    try {
      const result = await this.probe.probe(
        {
          protocol,
          modelId,
          baseUrl,
          headers,
          ...(apiKey ? { apiKey } : {}),
          ...(providerId ? { providerId } : {}),
        },
        { timeoutMs: this.requestTimeoutMs },
      )
      if (result.ok) return { protocol, status: 'success', latencyMs: result.latencyMs }
      // The raw cause stays internal: clients only receive category + safe text.
      const category = providerFailureCategory(result.cause)
      return {
        protocol,
        status: 'failed',
        category,
        message: providerFailureMessage(category, 'request'),
      }
    } catch {
      const category: ModelHealthFailureCategory = 'unknown'
      return {
        protocol,
        status: 'failed',
        category,
        message: providerFailureMessage(category, 'request'),
      }
    }
  }
}
