import { createProvider, type Api, type AuthResult, type Provider } from '@earendil-works/pi-ai'
import { discoverOpenAIModels } from './PiCustomProvider'
import { piProviderApiStreams } from './PiProviderApis'

/** Adds /models discovery to static OpenAI-compatible catalogs, retaining native transport. */
export function withPiOpenAIModelDiscovery(
  source: Provider<Api>,
  resolveAuth: (signal: AbortSignal) => Promise<AuthResult | undefined>,
  resolveBaseUrl: () => string | undefined = () => source.baseUrl,
): Provider<Api> {
  const baseline = source.getModels()
  const api = baseline[0]?.api
  if (
    source.refreshModels ||
    !source.baseUrl ||
    !source.auth.apiKey ||
    (api !== 'openai-completions' && api !== 'openai-responses') ||
    baseline.some((model) => model.api !== 'openai-completions' && model.api !== 'openai-responses')
  )
    return source

  const discoveryApi = api === 'openai-responses' ? 'openai-responses' : 'openai-completions'

  const byId = new Map(baseline.map((model) => [model.id, model]))
  const catalog = createProvider({
    id: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    auth: source.auth,
    models: source.getAllModels?.() ?? baseline,
    api: piProviderApiStreams[discoveryApi](),
    fetchModels: async ({ signal }) => {
      const auth = await resolveAuth(signal)
      if (!auth) throw new Error('Provider credentials are unavailable for model discovery')
      const discovered = await discoverOpenAIModels({
        baseUrl: resolveBaseUrl() ?? source.baseUrl!,
        ...(auth.auth.apiKey ? { apiKey: auth.auth.apiKey } : {}),
        headers: {
          ...Object.fromEntries(
            Object.entries({ ...source.headers, ...auth.auth.headers }).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          ),
        },
        signal,
      })
      return discovered.map(
        (model) =>
          byId.get(model.id) ?? {
            type: 'chat' as const,
            id: model.id,
            name: model.name,
            provider: source.id,
            baseUrl: source.baseUrl!,
            api: discoveryApi,
            reasoning: false,
            input: ['text' as const],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32_768,
            maxTokens: 8_192,
          },
      )
    },
  })
  return {
    ...source,
    getModels: catalog.getModels,
    getAllModels: catalog.getAllModels!,
    refreshModels: catalog.refreshModels!,
  }
}
