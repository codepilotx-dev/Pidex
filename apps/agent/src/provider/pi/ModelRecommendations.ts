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

/**
 * 发布噪音后缀：日期版本、网关标记、量化尾。
 * 反复剥离到不动点，让 `gpt-4o-2024-08-06`、`llama-3.3-70b-instruct:free`、
 * `qwen2.5-7b-instruct-q4_k_m` 这类真实 ID 回到目录里的裸名。
 * 刻意不含 `-preview` / `-instruct`：前者是不同模型，后者本身就是目录里的正式名。
 */
const releaseNoise = [
  /-\d{4}-\d{2}-\d{2}$/,
  /-\d{8}$/,
  /[:@][a-z0-9][a-z0-9_.-]*$/i,
  /-(?:q\d+(?:_k(?:_[ms])?)?|fp8|fp16|bf16|int8|int4|awq|gptq|gguf|mlx)$/i,
]

/** 逐层剥离后的候选名，按剥离深度递增；不含原文本身。 */
const strippedCandidates = (value: string): string[] => {
  const result: string[] = []
  let current = value
  for (let round = 0; round < 8; round++) {
    const pattern = releaseNoise.find((candidate) => candidate.test(current))
    if (!pattern) break
    const next = current.replace(pattern, '')
    if (!next) break
    current = next
    result.push(current)
  }
  return result
}
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

/**
 * 把推荐值合进已保存的模型配置：只改写 `pinned` 之外的字段。
 * 未命中推荐时原样返回，所以调用方不需要分支。
 */
export function applyRecommendation<T extends PiModelFields>(
  model: T,
  recommended: Model.Recommendation | undefined,
  pinned: readonly Model.SmartConfigPinnedField[] = [],
): T {
  if (!recommended || !Object.keys(recommended).length) return model
  const fixed = new Set<string>(pinned)
  const pick = <K extends keyof Model.Recommendation>(key: K) =>
    fixed.has(key) ? undefined : recommended[key]
  const name = pick('name')
  const contextWindow = pick('contextWindow')
  const maxInputTokens = pick('maxInputTokens')
  const maxTokens = pick('maxTokens')
  const reasoning = pick('reasoning')
  const tools = pick('tools')
  const inputCost = fixed.has('inputCost') ? undefined : recommended.cost?.input
  const outputCost = fixed.has('outputCost') ? undefined : recommended.cost?.output
  const cacheReadCost = fixed.has('cacheReadCost') ? undefined : recommended.cost?.cacheRead
  const cacheWriteCost = fixed.has('cacheWriteCost') ? undefined : recommended.cost?.cacheWrite
  const input =
    recommended.input && !fixed.has('imageInput')
      ? mergeModalities(model.input, recommended.input, fixed)
      : undefined
  return {
    ...model,
    ...(name !== undefined ? { name } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(inputCost !== undefined ||
    outputCost !== undefined ||
    cacheReadCost !== undefined ||
    cacheWriteCost !== undefined
      ? {
          cost: {
            ...model.cost,
            ...(inputCost !== undefined ? { input: inputCost } : {}),
            ...(outputCost !== undefined ? { output: outputCost } : {}),
            ...(cacheReadCost !== undefined ? { cacheRead: cacheReadCost } : {}),
            ...(cacheWriteCost !== undefined ? { cacheWrite: cacheWriteCost } : {}),
          },
        }
      : {}),
  }
}

type PiModelFields = {
  readonly name: string
  readonly contextWindow: number
  readonly maxInputTokens?: number | undefined
  readonly maxTokens: number
  readonly reasoning: boolean
  readonly tools?: boolean | undefined
  readonly input: readonly ('text' | 'image' | 'audio' | 'video')[]
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
}

/**
 * 多模态按单个能力合并：已固定的 `imageInput`/`audioInput`/`videoInput`
 * 各自保留，其余跟随推荐。
 */
const mergeModalities = (
  saved: readonly ('text' | 'image' | 'audio' | 'video')[],
  recommended: readonly ('text' | 'image' | 'audio' | 'video')[],
  fixed: ReadonlySet<string>,
): ('text' | 'image' | 'audio' | 'video')[] => {
  const result = new Set<'text' | 'image' | 'audio' | 'video'>(['text'])
  for (const modality of ['image', 'audio', 'video'] as const) {
    const pin = `${modality}Input`
    const wanted = fixed.has(pin) ? saved.includes(modality) : recommended.includes(modality)
    if (wanted) result.add(modality)
  }
  return [...result]
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
  constructor(payload: unknown) {
    const catalog = object(payload)
    const models = object(catalog.models)
    const providers = object(catalog.providers)
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
    const stripped = strippedCandidates(suffix)
    // 剥离档位只在裸名精确匹配时才算数：`gpt-4o-2024-08-06` 剥掉日期后命中原名，
    // `ample` 不剥也永远不命中，避免把模糊相似当成同一个模型。
    const strippedMatch = (candidate: string) =>
      entries.filter((entry) => bare(entry.id) === candidate || bare(entry.canonical) === candidate)
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
      ...stripped.map(strippedMatch),
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
