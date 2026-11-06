import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonEmptyStringSchema } from '../wire/Primitives'

/**
 * 输入预测只接受线程与轮次身份：上下文由 Agent 从规范线程投影读取，
 * 客户端不得上传草稿或历史内容。
 */
export const ComposerPredictionGenerateParamsSchema = Schema.Struct({
  threadId: NonEmptyStringSchema,
  turnId: NonEmptyStringSchema,
})

export const ComposerPredictionGenerateResultSchema = Schema.Struct({
  prediction: Schema.NullOr(Schema.String),
})

const ComposerPredictionErrors = [
  'THREAD_NOT_FOUND',
  'TURN_NOT_COMPLETED',
  'PREDICTION_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

export const ComposerPredictionRpcMethods = {
  'composer-prediction/generate': defineMethod({
    params: ComposerPredictionGenerateParamsSchema,
    result: ComposerPredictionGenerateResultSchema,
    errors: ComposerPredictionErrors,
    capability: 'composer-predictions.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ComposerPredictionGenerateParams =
  typeof ComposerPredictionGenerateParamsSchema.Type
export type ComposerPredictionGenerateResult =
  typeof ComposerPredictionGenerateResultSchema.Type
