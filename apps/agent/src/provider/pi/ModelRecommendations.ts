import { Schema } from 'effect'
import { Model } from '@pidex/model-schema'

const recommendationFields = [
  'name',
  'contextWindow',
  'maxInputTokens',
  'maxTokens',
  'reasoning',
  'tools',
  'input',
  'reasoningLevels',
] as const
type RecommendationField = (typeof recommendationFields)[number]

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid models.dev catalog')
  return value as JsonObject
}
const bare = (id: string) => id.toLowerCase().split('/').at(-1)!
type Entry = {
  id: string
  canonical: string
  aliases: string[]
  type: string
  provider: string | undefined
  endpoint: string | undefined
  values: Model.Recommendation
}
export type RecommendationInput = {
  providerId: string
  baseUrl?: string | undefined
  modelId: string
  modelType: 'chat' | 'embedding' | 'rerank'
}

function values(raw: JsonObject): Model.Recommendation {
  const limit = raw.limit === undefined ? {} : object(raw.limit)
  const modalities = raw.modalities === undefined ? {} : object(raw.modalities)
  const cost = raw.cost === undefined ? undefined : object(raw.cost)
  const positive = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10_000_000 ? v : undefined
  const efforts = Array.isArray(raw.reasoning_options)
    ? raw.reasoning_options.flatMap((item) => {
        const option = object(item)
        return option.type === 'effort' && Array.isArray(option.values) ? option.values : []
      })
    : []
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
  return Schema.decodeUnknownSync(Model.Recommendation)({
    ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : {}),
    ...(positive(limit.context) ? { contextWindow: limit.context } : {}),
    ...(positive(limit.input) ? { maxInputTokens: limit.input } : {}),
    ...(positive(limit.output) ? { maxTokens: limit.output } : {}),
    ...(typeof raw.reasoning === 'boolean' ? { reasoning: raw.reasoning } : {}),
    ...(typeof raw.tool_call === 'boolean' ? { tools: raw.tool_call } : {}),
    ...(Array.isArray(modalities.input)
      ? {
          input: modalities.input.filter((v) =>
            ['text', 'image', 'audio', 'video'].includes(String(v)),
          ),
        }
      : {}),
    ...(efforts.length
      ? {
          reasoningLevels: levels.filter(
            (v) => efforts.includes(v) || (v === 'off' && efforts.includes('none')),
          ),
        }
      : {}),
    ...(cost
      ? {
          cost: {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cache_read,
            cacheWrite: cost.cache_write,
          },
        }
      : {}),
  })
}

function consensus(entries: Entry[]): Model.Recommendation {
  const result: Record<string, unknown> = {}
  for (const field of recommendationFields) {
    const votes = new Map<string, { value: unknown; count: number }>()
    for (const entry of entries) {
      const value = entry.values[field as RecommendationField]
      if (value === undefined) continue
      const key = JSON.stringify(value)
      const vote = votes.get(key) ?? { value, count: 0 }
      vote.count++
      votes.set(key, vote)
    }
    const sorted = [...votes.values()].sort(
      (a, b) =>
        b.count - a.count ||
        (typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : JSON.stringify(a.value).localeCompare(JSON.stringify(b.value))),
    )
    if (
      sorted[0] &&
      (typeof sorted[0].value === 'number' || !sorted[1] || sorted[0].count > sorted[1].count)
    )
      result[field] = sorted[0].value
  }
  return result as Model.Recommendation
}

export class ModelRecommendationIndex {
  private readonly entries: Entry[] = []
  readonly providers: readonly { id: string; name: string }[]
  constructor(payload: unknown) {
    const catalog = object(payload)
    const models = object(catalog.models)
    const providers = object(catalog.providers)
    this.providers = Object.entries(providers).map(([id, input]) => {
      const provider = object(input)
      return { id, name: typeof provider.name === 'string' && provider.name.trim() ? provider.name : id }
    })
    const commonByBare = new Map<string, string[]>()
    for (const id of Object.keys(models)) {
      const key = bare(id)
      commonByBare.set(key, [...(commonByBare.get(key) ?? []), id])
    }
    const add = (id: string, input: unknown, provider?: string, endpoint?: string) => {
      const raw = object(input)
      const type = raw.type === 'reranking' ? 'rerank' : (raw.type ?? 'chat')
      if (!['chat', 'embedding', 'rerank'].includes(String(type))) return
      // 官方供应商条目也可能缺 canonical；只在通用目录唯一确定时补齐身份。
      const common = Object.hasOwn(models, id) ? [id] : (commonByBare.get(bare(id)) ?? [])
      const canonical =
        typeof raw.canonical_model_id === 'string'
          ? raw.canonical_model_id
          : common.length === 1
            ? common[0]!
            : id
      this.entries.push({
        id,
        canonical,
        aliases: Array.isArray(raw.aliases)
          ? raw.aliases.filter((v): v is string => typeof v === 'string')
          : [],
        type: String(type),
        provider,
        endpoint,
        values: values(raw),
      })
    }
    for (const [id, model] of Object.entries(models)) add(id, model)
    for (const [id, input] of Object.entries(providers)) {
      const provider = object(input)
      for (const [modelId, model] of Object.entries(object(provider.models)))
        add(modelId, model, id, typeof provider.api === 'string' ? provider.api : undefined)
    }
    if (!this.entries.length) throw new Error('Empty models.dev catalog')
  }

  resolve(input: RecommendationInput): {
    status: 'matched' | 'unmatched' | 'ambiguous'
    recommended: Model.Recommendation
  } {
    const entries = this.entries.filter((entry) => entry.type === input.modelType)
    const unique = (matches: Entry[]) =>
      new Set(matches.map((entry) => entry.canonical.toLowerCase())).size === 1
    const id = input.modelId.trim()
    const normalized = bare(id)
    const suffix = normalized.replace(/\((?:off|none|minimal|low|medium|high|xhigh|max)\)$/, '')
    const stages = [
      entries.filter((entry) => entry.id === id),
      entries.filter((entry) => entry.canonical === id || entry.aliases.includes(id)),
      entries.filter(
        (entry) =>
          bare(entry.id) === normalized ||
          bare(entry.canonical) === normalized ||
          entry.aliases.some((alias) => bare(alias) === normalized),
      ),
      ...(suffix !== normalized
        ? [entries.filter((entry) => bare(entry.id) === suffix || bare(entry.canonical) === suffix)]
        : []),
    ]
    const matches = stages.find((stage) => stage.length)
    if (!matches) return { status: 'unmatched', recommended: {} }
    if (!unique(matches)) return { status: 'ambiguous', recommended: {} }
    const canonical = matches[0]!.canonical.toLowerCase()
    const family = entries.filter((entry) => entry.canonical.toLowerCase() === canonical)
    const common = family.find((entry) => !entry.provider)?.values ?? {}
    const specific = family.filter(
      (entry) =>
        entry.provider === input.providerId ||
        (!!input.baseUrl &&
          !!entry.endpoint &&
          entry.endpoint.replace(/\/$/, '') === input.baseUrl.replace(/\/$/, '')),
    )
    const recommended = { ...consensus(family.filter((entry) => !!entry.provider)), ...common }
    if (specific.length === 1) Object.assign(recommended, specific[0]!.values)
    // 中转的供应商未确认时，价格不能跨供应商继承。
    if (specific.length !== 1) delete recommended.cost
    if (input.modelType !== 'chat') {
      delete recommended.maxTokens
      delete recommended.reasoning
      delete recommended.reasoningLevels
      delete recommended.tools
    }
    return { status: 'matched', recommended }
  }
}
