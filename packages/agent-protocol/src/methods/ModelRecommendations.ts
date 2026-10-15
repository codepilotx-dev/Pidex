import { Schema } from 'effect'
import { Model } from '@pidex/model-schema'
import { defineMethod } from '../wire/Definition'
import { OpaqueIDSchema } from '../wire/Primitives'

export const RecommendationPreviewParams = Schema.Struct({
  providerId: Schema.String,
  baseUrl: Schema.optional(Schema.String),
  modelId: Schema.String,
  modelType: Schema.Literals(['chat', 'embedding', 'rerank']),
})
export const ModelRecommendationRpcMethods = {
  'model/recommendation/preview': defineMethod({
    params: RecommendationPreviewParams,
    result: Schema.Struct({
      status: Schema.Literals(['matched', 'unmatched', 'ambiguous', 'no-cache']),
      recommended: Model.Recommendation,
      updatedAt: Schema.optional(Schema.Finite),
    }),
    errors: ['INVALID_REQUEST', 'PROVIDER_UNAVAILABLE'],
    capability: 'model.recommendations.v1',
    mutation: false,
    exactParams: true,
  }),
  'model/recommendation/refresh': defineMethod({
    params: Schema.Struct({ operationId: OpaqueIDSchema }),
    result: Schema.Struct({ updatedAt: Schema.Finite }),
    errors: ['INVALID_REQUEST', 'PROVIDER_UNAVAILABLE'],
    capability: 'model.recommendations.v1',
    mutation: true,
    exactParams: true,
  }),
} as const

export type ModelRecommendation = Model.Recommendation
