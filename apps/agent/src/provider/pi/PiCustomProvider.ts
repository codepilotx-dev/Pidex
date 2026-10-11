import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type Provider,
  type ProviderStreams,
} from '@earendil-works/pi-ai'
import type {
  CustomProviderApi,
  PiCustomModelConfig,
  PiCustomProviderConfig,
} from './PiProviderConfig'
import { piProviderApiStreams as streams } from './PiProviderApis'

const toPiModel = (
  providerID: string,
  provider: PiCustomProviderConfig,
  model: PiCustomModelConfig,
): Model<Api> => ({
  id: model.id,
  name: model.name,
  api: model.api,
  provider: providerID,
  baseUrl: provider.baseUrl,
  reasoning: model.reasoning,
  input: [...model.input],
  cost: { ...model.cost },
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  ...(Object.keys(model.headers).length ? { headers: { ...model.headers } } : {}),
  ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
  ...(model.compat ? { compat: structuredClone(model.compat) } : {}),
})

export const createPiCustomProvider = (
  providerID: string,
  config: PiCustomProviderConfig,
): Provider<Api> => {
  const models = Object.values(config.models)
    .filter((model) => model.enabled)
    .map((model) => toPiModel(providerID, config, model))
  const requiredApis = new Set(models.map((model) => model.api as CustomProviderApi))
  const api = Object.fromEntries(
    [...requiredApis].map((id) => [id, streams[id]()] as const),
  ) as Partial<Record<Api, ProviderStreams>>
  return createProvider({
    id: providerID,
    name: config.name,
    baseUrl: config.baseUrl,
    ...(Object.keys(config.headers).length ? { headers: { ...config.headers } } : {}),
    auth:
      config.auth === 'none'
        ? {
            apiKey: {
              name: `${config.name} (no authentication)`,
              resolve: async () => ({ auth: {} }),
            },
          }
        : {
            apiKey: envApiKeyAuth(`${config.name} API key`, [...config.env]),
          },
    models,
    api,
  })
}

export interface DiscoverOpenAIModelsOptions {
  readonly baseUrl: string
  readonly headers?: Readonly<Record<string, string>>
  readonly apiKey?: string
  readonly signal?: AbortSignal
  readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export interface DiscoveredOpenAIModel {
  readonly id: string
  readonly name: string
}

const MAX_DISCOVERY_BYTES = 1024 * 1024
const DISCOVERY_TIMEOUT_MS = 8_000

export const discoverOpenAIModels = async (
  options: DiscoverOpenAIModelsOptions,
): Promise<readonly DiscoveredOpenAIModel[]> => {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const endpoint = new URL(`${options.baseUrl.replace(/\/$/, '')}/models`)
  const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: {
      Accept: 'application/json',
      ...options.headers,
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
  })
  if (!response.ok) {
    throw new Error(`Model discovery failed with HTTP ${response.status}`)
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DISCOVERY_BYTES) {
    throw new Error('Model discovery response exceeds 1 MiB')
  }
  if (!response.body) throw new Error('Model discovery returned no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_DISCOVERY_BYTES) {
      await reader.cancel()
      throw new Error('Model discovery response exceeds 1 MiB')
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  if (
    typeof document !== 'object' ||
    document === null ||
    !('data' in document) ||
    !Array.isArray(document.data)
  ) {
    throw new Error('Model discovery returned an invalid OpenAI catalog')
  }
  const models = new Map<string, DiscoveredOpenAIModel>()
  for (const candidate of document.data) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      'id' in candidate &&
      typeof candidate.id === 'string' &&
      candidate.id.trim()
    ) {
      models.set(candidate.id, {
        id: candidate.id,
        name:
          'name' in candidate && typeof candidate.name === 'string' && candidate.name.trim()
            ? candidate.name
            : candidate.id,
      })
    }
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
}
