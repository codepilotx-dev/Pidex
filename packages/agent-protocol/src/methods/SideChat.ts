import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OkResultSchema, OpaqueIDSchema, TimestampSchema } from '../wire/Primitives'

export const SideChatDescriptorSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  sourceThreadId: OpaqueIDSchema,
  inheritedThroughTurnId: Schema.NullOr(OpaqueIDSchema),
  createdAt: TimestampSchema,
})

const SideChatErrors = [
  'THREAD_NOT_FOUND',
  'OPERATION_ID_CONFLICT',
  'FORK_POINT_UNAVAILABLE',
  'HISTORY_UNSUPPORTED',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

export const SideChatRpcMethods = {
  'thread/side-chat/create': defineMethod({
    params: Schema.Struct({
      sourceThreadId: OpaqueIDSchema,
      referenceText: Schema.optional(Schema.String),
      operationId: OpaqueIDSchema,
    }),
    result: Schema.Struct({ sideChat: SideChatDescriptorSchema }),
    errors: SideChatErrors,
    capability: 'thread.side-chat.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/side-chat/discard': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      operationId: OpaqueIDSchema,
    }),
    result: OkResultSchema,
    errors: SideChatErrors,
    capability: 'thread.side-chat.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type SideChatDescriptor = typeof SideChatDescriptorSchema.Type
export type SideChatRpcMethodMap = typeof SideChatRpcMethods
