export * as Model from './Model'

import { Schema } from 'effect'
import { Provider } from './Provider'
import { optional, statics } from './Schema'

export const ID = Schema.String.pipe(Schema.brand('Model.ID'))
export type ID = typeof ID.Type

export const VariantID = Schema.String.pipe(Schema.brand('Model.VariantID'))
export type VariantID = typeof VariantID.Type

export const Ref = Schema.Struct({
  providerID: Provider.ID,
  id: ID,
  variant: optional(VariantID),
}).annotate({ identifier: 'Model.Ref' })
export interface Ref extends Schema.Schema.Type<typeof Ref> {}

export const Family = Schema.String.pipe(Schema.brand('Model.Family'))
export type Family = typeof Family.Type

export const ReasoningLevels = Schema.Array(Schema.Literals(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']))

/**
 * 可被推荐值接管、也可被用户固定的模型草稿字段。
 * 固定值本身仍写在普通模型字段里，这里只记录哪些字段已脱离推荐。
 */
export const SmartConfigPinnedFields = [
  'name',
  'contextWindow',
  'maxInputTokens',
  'maxTokens',
  'reasoning',
  'tools',
  'imageInput',
  'audioInput',
  'videoInput',
  'inputCost',
  'outputCost',
  'cacheReadCost',
  'cacheWriteCost',
] as const
export const SmartConfigPinnedField = Schema.Literals(SmartConfigPinnedFields)
export type SmartConfigPinnedField = typeof SmartConfigPinnedField.Type

export const SmartConfig = Schema.Struct({
  pinned: Schema.Array(SmartConfigPinnedField),
})
export type SmartConfig = typeof SmartConfig.Type

/**
 * 双层模型参数规格（沿用 ZCode 的 values + map 结构）。
 * - `values` 定义公开可选档位及展示顺序（可为 disabled/enabled、none/high/max 等实际值）。
 * - `map` 是受限 CEL 表达式，把选中的值转换成当前协议请求体的 JSON Merge Patch。
 * values 与 map 分别继承、分别覆盖；语义校验（CEL 可编译）在 Agent Provider 保存/导入边界完成。
 */
export const ReasoningLevelOptionSpec = Schema.Struct({
  values: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
  ),
  map: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
})
export type ReasoningLevelOptionSpec = typeof ReasoningLevelOptionSpec.Type

export const MaxOutputTokensOptionSpec = Schema.Struct({
  max: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  map: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
})
export type MaxOutputTokensOptionSpec = typeof MaxOutputTokensOptionSpec.Type

export const OptionSpecs = Schema.Struct({
  reasoningLevel: Schema.optional(ReasoningLevelOptionSpec),
  maxOutputTokens: Schema.optional(MaxOutputTokensOptionSpec),
})
export type OptionSpecs = typeof OptionSpecs.Type

export const Recommendation = Schema.Struct({
  name: Schema.optional(Schema.String),
  contextWindow: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  maxInputTokens: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  maxTokens: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }))),
  reasoning: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Boolean),
  input: Schema.optional(Schema.Array(Schema.Literals(['text', 'image', 'audio', 'video']))),
  reasoningLevels: Schema.optional(ReasoningLevels),
  /** 双层参数规格（values/map）；显式存在时优先于 reasoningLevels 固定七档。 */
  optionSpecs: Schema.optional(OptionSpecs),
  cost: Schema.optional(Schema.Struct({
    input: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    output: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    cacheRead: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    cacheWrite: Schema.optional(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  })),
})
export type Recommendation = typeof Recommendation.Type

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
}).annotate({ identifier: 'Model.Capabilities' })

export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  tier: optional(
    Schema.Struct({
      type: Schema.Literal('context'),
      size: Schema.Int,
    }),
  ),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
}).annotate({ identifier: 'Model.Cost' })

export const Api = Schema.Union([
  Schema.Struct({
    id: ID,
    type: Schema.Literal('pi'),
    name: Schema.String,
    baseUrl: Schema.String,
  }),
])
  .pipe(Schema.toTaggedUnion('type'))
  .annotate({ identifier: 'Model.Api' })
export type Api = typeof Api.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  providerID: Provider.ID,
  family: optional(Family),
  name: Schema.String,
  modelType: optional(Schema.Literals(['chat', 'embedding', 'rerank'])),
  api: Api,
  variant: optional(Schema.String),
  capabilities: Capabilities,
  variants: Schema.Array(
    Schema.Struct({
      id: VariantID,
    }),
  ),
  time: Schema.Struct({
    released: Schema.Finite,
  }),
  cost: Schema.Array(Cost),
  status: Schema.Literals(['alpha', 'beta', 'deprecated', 'active']),
  enabled: Schema.Boolean,
  limit: Schema.Struct({
    context: Schema.Int,
    input: optional(Schema.Int),
    output: Schema.Int,
  }),
})
  .annotate({ identifier: 'Model.Info' })
  .pipe(
    statics((schema) => ({
      empty: (providerID: Provider.ID, modelID: ID) =>
        schema.make({
          id: modelID,
          providerID,
          name: modelID,
          api: { id: modelID, type: 'pi', name: '', baseUrl: '' },
          capabilities: { tools: false, input: [], output: [] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: 'active',
          enabled: true,
          limit: { context: 0, output: 0 },
        }),
    })),
  )
