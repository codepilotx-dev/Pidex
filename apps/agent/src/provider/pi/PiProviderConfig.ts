import type {
  Api,
  Model as PiModel,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
  AnthropicMessagesCompat,
} from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'

export const PI_PROVIDER_CONFIG_SCHEMA_VERSION = 2

export const CUSTOM_PROVIDER_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

export type CustomProviderApi = (typeof CUSTOM_PROVIDER_APIS)[number]

/** DeepSeek keeps its existing three-protocol catalog mapping. */
export const DEEPSEEK_PROVIDER_ID = 'deepseek'

export type DeepSeekProtocol = CustomProviderApi

export const DEFAULT_DEEPSEEK_PROTOCOL: DeepSeekProtocol = 'openai-completions'

/** Endpoints DeepSeek documents for each supported wire protocol. */
export const DEEPSEEK_PROTOCOL_ENDPOINTS: Readonly<Record<DeepSeekProtocol, string>> = {
  'openai-completions': 'https://api.deepseek.com',
  'openai-responses': 'https://api.deepseek.com',
  'anthropic-messages': 'https://api.deepseek.com/anthropic',
}

// Additional wire protocols verified in the vendors' API documentation.
const extraBuiltinEndpoints: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  deepseek: DEEPSEEK_PROTOCOL_ENDPOINTS,
  openai: { 'openai-completions': 'https://api.openai.com/v1' },
  google: { 'openai-completions': 'https://generativelanguage.googleapis.com/v1beta/openai' },
  xai: { 'openai-completions': 'https://api.x.ai/v1' },
  mistral: { 'openai-completions': 'https://api.mistral.ai/v1' },
  openrouter: { 'openai-responses': 'https://openrouter.ai/api/v1' },
  zai: { 'anthropic-messages': 'https://api.z.ai/api/anthropic' },
  minimax: { 'openai-completions': 'https://api.minimax.io/v1' },
  'minimax-cn': { 'openai-completions': 'https://api.minimax.cn/v1' },
}
const nativeBuiltinEndpoints = new Map(builtinProviders().map((provider) => [provider.id,
  Object.fromEntries(provider.getModels().map((model) => [model.api, model.baseUrl || provider.baseUrl || ''])),
]))
export const builtinProviderEndpoints = (id: string): Readonly<Record<string, string>> => ({
  ...nativeBuiltinEndpoints.get(id), ...extraBuiltinEndpoints[id],
})

export interface PiBuiltinProviderConfig {
  readonly kind: 'builtin'
  readonly enabled: boolean
  readonly allowModels: readonly string[]
  readonly denyModels: readonly string[]
  readonly models: Readonly<Record<string, PiBuiltinModelConfig>>
  readonly baseUrl?: string
  readonly endpoints?: Readonly<Record<string, string>>
  readonly allowInsecureHttp?: boolean
  readonly protocol?: string
}

export type PiBuiltinModelConfig = Partial<Omit<PiCustomModelConfig, 'id' | 'cost'>> & {
  readonly enabled: boolean
  readonly cost?: Partial<PiCustomModelConfig['cost']>
}

export interface PiCustomModelConfig {
  readonly id: string
  readonly api: CustomProviderApi
  readonly name: string
  readonly enabled: boolean
  readonly contextWindow: number
  readonly maxInputTokens?: number
  readonly maxTokens: number
  readonly reasoning: boolean
  readonly input: readonly ('text' | 'image')[]
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
  readonly headers: Readonly<Record<string, string>>
  readonly thinkingLevelMap?: NonNullable<PiModel<Api>['thinkingLevelMap']>
  readonly compat?: OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat
}

export interface PiCustomProviderConfig {
  readonly kind: 'custom'
  readonly name: string
  readonly enabled: boolean
  readonly baseUrl: string
  readonly endpoints?: Partial<Record<CustomProviderApi, string>>
  readonly auth: 'api-key' | 'none'
  readonly env: readonly string[]
  readonly allowInsecureHttp: boolean
  readonly headers: Readonly<Record<string, string>>
  readonly models: Readonly<Record<string, PiCustomModelConfig>>
}

export type PiProviderConfig = PiBuiltinProviderConfig | PiCustomProviderConfig

export interface PiProviderConfigIssue {
  readonly providerID: string
  readonly path: string
  readonly code:
    | 'INVALID_PROVIDER'
    | 'INVALID_MODEL'
    | 'UNSAFE_URL'
    | 'SENSITIVE_HEADER'
    | 'BUILTIN_OVERRIDE'
    | 'UNSUPPORTED_SCHEMA'
}

export interface ParsedPiProviderCatalog {
  readonly schemaVersion: number
  readonly providers: Readonly<Record<string, PiProviderConfig>>
  readonly issues: readonly PiProviderConfigIssue[]
}

export interface PiModelCatalogConfig {
  readonly schemaVersion?: number
  readonly providers?: Readonly<Record<string, unknown>>
}

export type PiProviderDefinitionInput =
  | {
      readonly kind: 'builtin'
      readonly id: string
      readonly enabled: boolean
      readonly allowModels: readonly string[]
      readonly denyModels: readonly string[]
      readonly models: readonly (Partial<Omit<PiCustomModelConfig, 'id' | 'cost'>> & {
        readonly id: string
        readonly enabled: boolean
        readonly cost?: Partial<PiCustomModelConfig['cost']>
      })[]
      readonly baseUrl?: string
      readonly endpoints?: Readonly<Record<string, string>>
      readonly allowInsecureHttp?: boolean
      readonly protocol?: string
    }
  | {
      readonly kind: 'custom'
      readonly id: string
      readonly name: string
      readonly enabled: boolean
      readonly baseUrl: string
      readonly endpoints?: Partial<Record<CustomProviderApi, string>>
      readonly auth: 'api-key' | 'none'
      readonly env: readonly string[]
      readonly allowInsecureHttp: boolean
      readonly headers: Readonly<Record<string, string>>
      readonly models: readonly (Partial<Omit<PiCustomModelConfig, 'id' | 'api' | 'cost'>> & {
        readonly id: string
        readonly api: CustomProviderApi
        readonly cost?: Partial<PiCustomModelConfig['cost']>
      })[]
    }

export class PiProviderConfigValidationError extends Error {
  constructor(readonly issues: readonly PiProviderConfigIssue[]) {
    super('Pi provider configuration is invalid')
    this.name = 'PiProviderConfigValidationError'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []

const environmentNames = (value: unknown): readonly string[] => {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry))
  ) {
    throw new Error('Custom provider env must contain environment variable names')
  }
  return [...new Set(value)]
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

const finiteNonNegative = (value: unknown, fallback: number) => {
  if (value === undefined) return fallback
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  throw new Error('Custom model cost must be a non-negative number')
}

const positiveInteger = (value: unknown, fallback: number) => {
  if (value === undefined) return fallback
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  throw new Error('Custom model limits must be positive integers')
}

const sensitiveHeader = (name: string) => {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return (
    normalized === 'authorization' ||
    normalized === 'proxyauthorization' ||
    normalized.includes('apikey') ||
    normalized.includes('accesstoken') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('clientsecret') ||
    normalized === 'cookie' ||
    normalized === 'setcookie'
  )
}

export const assertSafeProviderHeaders = (
  headers: unknown,
  context = 'provider',
): Readonly<Record<string, string>> => {
  if (headers === undefined) return {}
  if (!isObject(headers)) {
    throw new Error(`${context} headers must be an object`)
  }
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (sensitiveHeader(name)) {
      throw new Error(`${context} header ${name} contains credential material`)
    }
    if (
      typeof value !== 'string' ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
      /[\r\n]/.test(value)
    ) {
      throw new Error(`${context} header ${name} is invalid`)
    }
    output[name] = value
  }
  return output
}

const isLoopback = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  )
}

export const validateCustomProviderBaseUrl = (
  value: unknown,
  allowInsecureHttp: boolean,
): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Custom provider base_url is required')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Custom provider base_url is invalid')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Custom provider base_url must use HTTP(S)')
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Custom provider base_url cannot contain credentials or a fragment')
  }
  if (url.protocol === 'http:' && !isLoopback(url.hostname) && !allowInsecureHttp) {
    throw new Error('Remote HTTP custom providers require allow_insecure_http = true')
  }
  return url.toString().replace(/\/$/, '')
}

const parseThinkingLevelMap = (value: unknown): PiModel<Api>['thinkingLevelMap'] | undefined => {
  if (value === undefined) return undefined
  if (!isObject(value)) {
    throw new Error('Custom model thinking_level_map must be an object')
  }
  const allowed = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  const output: Record<string, string | null> = {}
  for (const [level, mapped] of Object.entries(value)) {
    if (!allowed.has(level) || (typeof mapped !== 'string' && mapped !== null)) {
      throw new Error('Custom model thinking_level_map is invalid')
    }
    output[level] = mapped
  }
  return output as PiModel<Api>['thinkingLevelMap']
}

const parseCompat = (value: unknown) => {
  if (value === undefined) return undefined
  if (!isObject(value)) {
    throw new Error('Custom model compat must be an object')
  }
  const clone = structuredClone(value)
  return clone as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat
}

const parseCustomModel = (
  providerID: string,
  configuredID: string,
  value: unknown,
): PiCustomModelConfig => {
  if (!isObject(value)) throw new Error('Model declaration must be an object')
  const api = value.api
  if (typeof api !== 'string' || !(CUSTOM_PROVIDER_APIS as readonly string[]).includes(api)) {
    throw new Error('Custom model api is unsupported')
  }
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : configuredID
  if (
    value.input !== undefined &&
    (!Array.isArray(value.input) || value.input.some((item) => item !== 'text' && item !== 'image'))
  ) {
    throw new Error('Custom model input must contain text or image')
  }
  const input = strings(value.input) as readonly ('text' | 'image')[]
  const cost = isObject(value.cost) ? value.cost : {}
  const thinkingLevelMap = parseThinkingLevelMap(value.thinking_level_map ?? value.thinkingLevelMap)
  const compat = parseCompat(value.compat)
  return {
    id,
    api: api as CustomProviderApi,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : configuredID,
    enabled: bool(value.enabled, true),
    contextWindow: positiveInteger(value.context_window ?? value.contextWindow, 32_768),
    ...((value.max_input_tokens ?? value.maxInputTokens) !== undefined
      ? { maxInputTokens: positiveInteger(value.max_input_tokens ?? value.maxInputTokens, 32_768) } : {}),
    maxTokens: positiveInteger(value.max_tokens ?? value.maxTokens, 8_192),
    reasoning: bool(value.reasoning, false),
    input: input.length ? input : ['text'],
    cost: {
      input: finiteNonNegative(cost.input, 0),
      output: finiteNonNegative(cost.output, 0),
      cacheRead: finiteNonNegative(cost.cache_read ?? cost.cacheRead, 0),
      cacheWrite: finiteNonNegative(cost.cache_write ?? cost.cacheWrite, 0),
    },
    headers: assertSafeProviderHeaders(value.headers, `model ${providerID}/${configuredID}`),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(compat ? { compat } : {}),
  }
}

const parseEndpoints = (value: unknown, allowHttp: boolean, supported: readonly string[] = CUSTOM_PROVIDER_APIS) => {
  if (!isObject(value)) throw new Error('Provider endpoints must be an object')
  return Object.fromEntries(Object.entries(value).map(([api, address]) => {
    if (!supported.includes(api))
      throw new Error('Unsupported provider endpoint protocol')
    return [api, validateCustomProviderBaseUrl(address, allowHttp)]
  })) as Partial<Record<CustomProviderApi, string>>
}

const parseBuiltinProtocol = (providerID: string, value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !(value in builtinProviderEndpoints(providerID)))
    throw new Error('Builtin provider protocol is unsupported')
  return value
}

const parseBuiltin = (providerID: string, value: Record<string, unknown>) => {
  const modelDeclarations = isObject(value.models) ? value.models : {}
  const models = Object.fromEntries(
    Object.entries(modelDeclarations).map(([id, model]) => {
      if (!isObject(model)) throw new Error('Builtin model override must be an object')
      return [id, parseBuiltinModel(providerID, id, model)]
    }),
  )
  const protocol = parseBuiltinProtocol(providerID, value.protocol)

  return {
    kind: 'builtin' as const,
    ...(value.endpoints !== undefined ? { endpoints: parseEndpoints(value.endpoints, bool(value.allow_insecure_http ?? value.allowInsecureHttp, false), Object.keys(builtinProviderEndpoints(providerID))) } : {}),
    enabled: bool(value.enabled, !bool(value.disabled, false)),
    allowModels: strings(value.allow_models ?? value.allowModels),
    denyModels: strings(value.deny_models ?? value.denyModels),
    models,
    ...(value.base_url !== undefined || value.baseUrl !== undefined
      ? {
          baseUrl: validateCustomProviderBaseUrl(
            value.base_url ?? value.baseUrl,
            bool(value.allow_insecure_http ?? value.allowInsecureHttp, false),
          ),
        }
      : {}),
    ...(value.allow_insecure_http !== undefined || value.allowInsecureHttp !== undefined
      ? { allowInsecureHttp: bool(value.allow_insecure_http ?? value.allowInsecureHttp, false) }
      : {}),
    ...(protocol ? { protocol } : {}),
  }
}

const parseBuiltinModel = (
  providerID: string,
  id: string,
  raw: Record<string, unknown>,
): PiBuiltinModelConfig => {
  const allowed = new Set([
    'id',
    'enabled',
    'api',
    'name',
    'contextWindow',
    'context_window',
    'maxInputTokens',
    'max_input_tokens',
    'maxTokens',
    'max_tokens',
    'reasoning',
    'input',
    'cost',
    'headers',
    'thinkingLevelMap',
    'thinking_level_map',
    'compat',
  ])
  if (Object.keys(raw).some((key) => !allowed.has(key)))
    throw new Error('Builtin model override is unsupported')
  const parsed = parseCustomModel(providerID, id, { ...raw, api: raw.api ?? 'openai-completions' })
  const result: Record<string, unknown> = { enabled: parsed.enabled }
  for (const [key, value] of Object.entries(parsed)) {
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (key !== 'id' && (key in raw || snake in raw)) result[key] = value
  }
  const rawCost = raw.cost
  if (isObject(rawCost))
    result.cost = Object.fromEntries(
      Object.entries(parsed.cost).filter(
        ([key]) =>
          key in rawCost ||
          key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`) in rawCost,
      ),
    )
  return result as PiBuiltinModelConfig
}

/**
 * Protocol every DeepSeek model must use. Absent configuration keeps the
 * Chat Completions default for compatibility, while a rejected DeepSeek block
 * returns undefined so callers keep the provider that is already running
 * instead of half-applying a new protocol.
 */
export const resolveDeepSeekProtocol = (
  catalog: Pick<ParsedPiProviderCatalog, 'providers' | 'issues'>,
): DeepSeekProtocol | undefined => {
  if (catalog.issues.some((issue) => issue.providerID === DEEPSEEK_PROVIDER_ID)) {
    return undefined
  }
  const provider = catalog.providers[DEEPSEEK_PROVIDER_ID]
  if (provider?.kind !== 'builtin') return DEFAULT_DEEPSEEK_PROTOCOL
  return (provider.protocol as DeepSeekProtocol | undefined) ?? DEFAULT_DEEPSEEK_PROTOCOL
}

const parseCustom = (
  providerID: string,
  value: Record<string, unknown>,
): PiCustomProviderConfig => {
  const allowInsecureHttp = bool(value.allow_insecure_http ?? value.allowInsecureHttp, false)
  const models = isObject(value.models) ? value.models : {}
  const parsedModels = Object.fromEntries(
    Object.entries(models).map(([id, model]) => [id, parseCustomModel(providerID, id, model)]),
  )
  if (Object.keys(parsedModels).length === 0) {
    throw new Error('Custom provider must declare at least one model')
  }
  const modelIDs = Object.values(parsedModels).map((model) => model.id)
  if (new Set(modelIDs).size !== modelIDs.length) {
    throw new Error('Custom provider model ids must be unique')
  }
  const auth = value.auth === 'none' ? 'none' : 'api-key'
  return {
    kind: 'custom',
    ...(value.endpoints !== undefined ? { endpoints: parseEndpoints(value.endpoints, allowInsecureHttp) } : {}),
    name: typeof value.name === 'string' && value.name.trim() ? value.name : providerID,
    enabled: bool(value.enabled, true),
    baseUrl: validateCustomProviderBaseUrl(value.base_url ?? value.baseUrl, allowInsecureHttp),
    auth,
    env: auth === 'api-key' ? environmentNames(value.env) : [],
    allowInsecureHttp,
    headers: assertSafeProviderHeaders(value.headers, `provider ${providerID}`),
    models: parsedModels,
  }
}

export const parsePiProviderCatalog = (config: PiModelCatalogConfig): ParsedPiProviderCatalog => {
  const schemaVersion = typeof config.schemaVersion === 'number' ? config.schemaVersion : 2
  if (schemaVersion > PI_PROVIDER_CONFIG_SCHEMA_VERSION) {
    return {
      schemaVersion,
      providers: {},
      issues: [
        {
          providerID: '*',
          path: 'model_catalog.schema_version',
          code: 'UNSUPPORTED_SCHEMA',
        },
      ],
    }
  }
  const builtinIDs = new Set<string>(builtinProviders().map((provider) => provider.id))
  const output: Record<string, PiProviderConfig> = {}
  const issues: PiProviderConfigIssue[] = []
  for (const [providerID, raw] of Object.entries(config.providers ?? {})) {
    if (!isObject(raw)) {
      issues.push({
        providerID,
        path: `model_providers.${providerID}`,
        code: 'INVALID_PROVIDER',
      })
      continue
    }
    try {
      const kind = raw.kind
      if (kind === 'custom') {
        if (builtinIDs.has(providerID)) {
          issues.push({
            providerID,
            path: `model_providers.${providerID}.kind`,
            code: 'BUILTIN_OVERRIDE',
          })
          continue
        }
        output[providerID] = parseCustom(providerID, raw)
        continue
      }
      if (kind === 'builtin' || (kind === undefined && builtinIDs.has(providerID))) {
        if (!builtinIDs.has(providerID)) {
          issues.push({
            providerID,
            path: `model_providers.${providerID}.kind`,
            code: 'INVALID_PROVIDER',
          })
          continue
        }
        const allowed = new Set([
          'kind',
          'enabled',
          'allow_models',
          'allowModels',
          'deny_models',
          'denyModels',
          'models',
          'baseUrl',
          'base_url',
          'endpoints',
          'allowInsecureHttp',
          'allow_insecure_http',
          'protocol',
        ])
        if (Object.keys(raw).some((key) => !allowed.has(key))) {
          issues.push({
            providerID,
            path: `model_providers.${providerID}`,
            code: 'BUILTIN_OVERRIDE',
          })
          continue
        }
        output[providerID] = parseBuiltin(providerID, raw)
        continue
      }
      issues.push({
        providerID,
        path: `model_providers.${providerID}.kind`,
        code: 'INVALID_PROVIDER',
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      issues.push({
        providerID,
        path: `model_providers.${providerID}`,
        code: message.includes('header')
          ? 'SENSITIVE_HEADER'
          : message.includes('base_url') || message.includes('HTTP')
            ? 'UNSAFE_URL'
            : message.includes('model') || message.includes('Model')
              ? 'INVALID_MODEL'
              : 'INVALID_PROVIDER',
      })
    }
  }
  return {
    schemaVersion,
    providers: output,
    issues,
  }
}

/**
 * Validates the camelCase RPC definition and returns the canonical
 * config.json object payload. Callers still write it through ConfigService
 * key paths so unrelated and future keys remain untouched.
 */
export const serializePiProviderDefinition = (
  definition: PiProviderDefinitionInput,
): { readonly providerID: string; readonly value: Record<string, unknown> } => {
  const modelIDs = definition.models.map((model) => model.id)
  if (new Set(modelIDs).size !== modelIDs.length) {
    throw new PiProviderConfigValidationError([
      {
        providerID: definition.id,
        path: `model_providers.${definition.id}.models`,
        code: 'INVALID_MODEL',
      },
    ])
  }
  const raw: Record<string, unknown> =
    definition.kind === 'builtin'
      ? {
          kind: 'builtin',
          enabled: definition.enabled,
          ...(definition.endpoints ? { endpoints: definition.endpoints } : {}),
          allow_models: [...definition.allowModels],
          deny_models: [...definition.denyModels],
          models: Object.fromEntries(definition.models.map(({ id, ...model }) => [id, model])),
          ...(definition.protocol ? { protocol: definition.protocol } : {}),
          ...(definition.baseUrl ? { base_url: definition.baseUrl } : {}),
          ...(definition.allowInsecureHttp !== undefined
            ? { allow_insecure_http: definition.allowInsecureHttp }
            : {}),
        }
      : {
          kind: 'custom',
          name: definition.name,
          enabled: definition.enabled,
          ...(definition.endpoints ? { endpoints: definition.endpoints } : {}),
          base_url: definition.baseUrl,
          auth: definition.auth,
          env: [...definition.env],
          allow_insecure_http: definition.allowInsecureHttp,
          headers: { ...definition.headers },
          models: Object.fromEntries(
            definition.models.map((model) => [
              model.id,
              {
                id: model.id,
                api: model.api,
                ...(model.name !== undefined ? { name: model.name } : {}),
                ...(model.enabled !== undefined ? { enabled: model.enabled } : {}),
                ...(model.contextWindow !== undefined
                  ? { context_window: model.contextWindow }
                  : {}),
                ...(model.maxInputTokens !== undefined ? { max_input_tokens: model.maxInputTokens } : {}),
                ...(model.maxTokens !== undefined ? { max_tokens: model.maxTokens } : {}),
                ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
                ...(model.input !== undefined ? { input: [...model.input] } : {}),
                ...(model.cost !== undefined
                  ? {
                      cost: {
                        input: model.cost.input,
                        output: model.cost.output,
                        cache_read: model.cost.cacheRead,
                        cache_write: model.cost.cacheWrite,
                      },
                    }
                  : {}),
                ...(model.headers !== undefined ? { headers: { ...model.headers } } : {}),
                ...(model.thinkingLevelMap !== undefined
                  ? {
                      thinking_level_map: {
                        ...model.thinkingLevelMap,
                      },
                    }
                  : {}),
                ...(model.compat !== undefined ? { compat: structuredClone(model.compat) } : {}),
              },
            ]),
          ),
        }
  const parsed = parsePiProviderCatalog({
    schemaVersion: PI_PROVIDER_CONFIG_SCHEMA_VERSION,
    providers: { [definition.id]: raw },
  })
  const provider = parsed.providers[definition.id]
  if (!provider || parsed.issues.length > 0) {
    throw new PiProviderConfigValidationError(parsed.issues)
  }
  return {
    providerID: definition.id,
    value:
      provider.kind === 'builtin'
        ? {
            kind: 'builtin',
            enabled: provider.enabled,
            ...(provider.endpoints ? { endpoints: provider.endpoints } : {}),
            allow_models: [...provider.allowModels],
            deny_models: [...provider.denyModels],
            models: Object.fromEntries(
              Object.entries(provider.models).map(([id, model]) => [id, { ...model }]),
            ),
            ...(provider.protocol ? { protocol: provider.protocol } : {}),
            ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
            ...(provider.allowInsecureHttp !== undefined
              ? { allow_insecure_http: provider.allowInsecureHttp }
              : {}),
          }
        : {
            kind: 'custom',
            name: provider.name,
            enabled: provider.enabled,
            ...(provider.endpoints ? { endpoints: provider.endpoints } : {}),
            base_url: provider.baseUrl,
            auth: provider.auth,
            env: [...provider.env],
            allow_insecure_http: provider.allowInsecureHttp,
            headers: { ...provider.headers },
            models: Object.fromEntries(
              Object.entries(provider.models).map(([id, model]) => [
                id,
                {
                  id: model.id,
                  api: model.api,
                  name: model.name,
                  enabled: model.enabled,
                  context_window: model.contextWindow,
                  ...(model.maxInputTokens !== undefined ? { max_input_tokens: model.maxInputTokens } : {}),
                  max_tokens: model.maxTokens,
                  reasoning: model.reasoning,
                  input: [...model.input],
                  cost: {
                    input: model.cost.input,
                    output: model.cost.output,
                    cache_read: model.cost.cacheRead,
                    cache_write: model.cost.cacheWrite,
                  },
                  ...(Object.keys(model.headers).length ? { headers: { ...model.headers } } : {}),
                  ...(model.thinkingLevelMap
                    ? {
                        thinking_level_map: {
                          ...model.thinkingLevelMap,
                        },
                      }
                    : {}),
                  ...(model.compat ? { compat: structuredClone(model.compat) } : {}),
                },
              ]),
            ),
          },
  }
}
