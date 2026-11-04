import { Schema } from 'effect'
import { Model } from '@pidex/model-schema'
import { defineMethod } from '../wire/Definition'

const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(65536))
const Texts = Schema.Array(Text).check(Schema.isMinLength(1), Schema.isMaxLength(256))
export const EmbedParamsSchema = Schema.Struct({
  model: Model.Ref,
  input: Texts,
  dimensions: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65536 }))),
})
export const RerankParamsSchema = Schema.Struct({
  model: Model.Ref,
  query: Text,
  documents: Texts,
  topN: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 }))),
})
export const ModelOperationsRpcMethods = {
  'model/embed': defineMethod({
    params: EmbedParamsSchema,
    result: Schema.Struct({
      vectors: Schema.Array(Schema.Array(Schema.Finite)),
      inputTokens: Schema.Number,
    }),
    errors: [
      'INVALID_REQUEST',
      'PROVIDER_NOT_FOUND',
      'AUTHORIZATION_FAILED',
      'PROVIDER_UNAVAILABLE',
    ],
    capability: 'model.operations.v1',
    mutation: false,
    exactParams: true,
  }),
  'model/rerank': defineMethod({
    params: RerankParamsSchema,
    result: Schema.Struct({
      results: Schema.Array(Schema.Struct({ index: Schema.Int, score: Schema.Finite })),
      inputTokens: Schema.Number,
    }),
    errors: [
      'INVALID_REQUEST',
      'PROVIDER_NOT_FOUND',
      'AUTHORIZATION_FAILED',
      'PROVIDER_UNAVAILABLE',
    ],
    capability: 'model.operations.v1',
    mutation: false,
    exactParams: true,
  }),
} as const
