import { createProvider, type Api, type Model, type Provider } from '@earendil-works/pi-ai'
import type { PiBuiltinProviderConfig } from './PiProviderConfig'
import { piProviderApiStreams } from './PiProviderApis'

/** Keep native auth, discovery and transport while applying explicit user overrides. */
export function withPiBuiltinProviderOverrides(
  source: Provider<Api>,
  config: PiBuiltinProviderConfig,
): Provider<Api> {
  if (
    !config.baseUrl &&
    !config.endpoints &&
    !config.protocol &&
    Object.values(config.models).every((model) =>
      Object.keys(model).every((key) => key === 'enabled'),
    )
  )
    return source
  const mapped = new WeakMap<Model<Api>, Model<Api>>()
  const getModels = () => {
    const original = source.getModels()
    const models = original.map((model) => {
      let result = mapped.get(model)
      if (!result) {
        const { enabled: _, ...override } = config.models[model.id] ?? { enabled: true }
        result = {
          ...model,
          ...override,
          ...(config.protocol ? { api: config.protocol as Api } : {}),
          input: [...(override.input ?? model.input)],
          cost: { ...model.cost, ...override.cost },
          ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        }
        if (result.api !== model.api && !(override.api === result.api && override.compat)) delete result.compat
        const endpoint = config.endpoints?.[result.api as keyof NonNullable<typeof config.endpoints>]
        if (endpoint) result.baseUrl = endpoint
        mapped.set(model, result)
      }
      return result
    })
    const known = new Set(original.map((model) => model.id))
    const template: Model<Api> = original[0] ?? {
      type: 'chat',
      id: '',
      name: '',
      provider: source.id,
      baseUrl: config.baseUrl ?? source.baseUrl ?? '',
      api: 'openai-completions',
      contextWindow: 32_768,
      maxTokens: 8_192,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }
    for (const [id, { enabled: _, ...override }] of Object.entries(config.models)) {
      if (!known.has(id) && Object.keys(override).length > 0) {
        const model = {
          ...template,
          ...override,
          ...(config.protocol ? { api: config.protocol as Api } : {}),
          input: [...(override.input ?? template.input)],
          cost: { ...template.cost, ...override.cost },
          id,
          name: override.name ?? id,
          ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        }
        if (model.api !== template.api && !(override.api === model.api && override.compat)) delete model.compat
        const endpoint = config.endpoints?.[model.api as keyof NonNullable<typeof config.endpoints>]
        if (endpoint) model.baseUrl = endpoint
        models.push(model)
      }
    }
    return models
  }
  const adapters = createProvider({
    id: source.id,
    name: source.name,
    auth: source.auth,
    ...(source.headers ? { headers: source.headers } : {}),
    models: [],
    api: Object.fromEntries(
      Object.entries(piProviderApiStreams).map(([api, stream]) => [api, stream()]),
    ),
  })
  const changedApi = (model: Model<Api>) => {
    const original =
      source.getModels().find((item) => item.id === model.id) ?? source.getModels()[0]
    return model.api !== original?.api && model.api in piProviderApiStreams
  }
  const endpointModel = (model: Model<Api>) => {
    const baseUrl = config.endpoints?.[model.api as keyof NonNullable<typeof config.endpoints>] ?? config.baseUrl
    return baseUrl ? { ...model, baseUrl } : model
  }
  return {
    ...source,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    getModels,
    getAllModels: () => [
      ...getModels(),
      ...(source.getAllModels?.().filter((model) => model.type !== 'chat') ?? []),
    ],
    stream: (model, context, options) =>
      changedApi(model)
        ? adapters.stream(
            endpointModel(model),
            context,
            options,
          )
        : source.stream(
            endpointModel(model),
            context,
            options,
          ),
    streamSimple: (model, context, options) =>
      changedApi(model)
        ? adapters.streamSimple(
            endpointModel(model),
            context,
            options,
          )
        : source.streamSimple(
            endpointModel(model),
            context,
            options,
          ),
  }
}
