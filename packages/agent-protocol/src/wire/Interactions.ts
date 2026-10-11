import { Schema } from 'effect'
import {
  defineServerRequest,
  type ServerRequestParamsOf,
  type ServerRequestResultOf,
} from './Definition'
import { JsonValueSchema, OpaqueIDSchema } from './Primitives'
import {
  ApprovalInteractionResponseSchema,
  HookTrustInteractionResponseSchema,
  InteractionKindSchema,
  InteractionResponseSchema as SharedInteractionResponseSchema,
  PendingApprovalInteractionSchema,
  PendingHookTrustInteractionSchema,
  PendingPermissionInteractionSchema,
  PendingQuestionInteractionSchema,
  PermissionInteractionResponseSchema,
  QuestionInteractionResponseSchema,
} from '../methods/Core'

export { InteractionKindSchema }
export type InteractionKind = typeof InteractionKindSchema.Type

export const ApprovalRequestParamsSchema = PendingApprovalInteractionSchema
export const ApprovalRequestResultSchema = ApprovalInteractionResponseSchema
export type ApprovalRequestParams = typeof ApprovalRequestParamsSchema.Type
export type ApprovalRequestResult = typeof ApprovalRequestResultSchema.Type

export const PermissionRequestParamsSchema = PendingPermissionInteractionSchema
export const PermissionRequestResultSchema = PermissionInteractionResponseSchema
export type PermissionRequestParams = typeof PermissionRequestParamsSchema.Type
export type PermissionRequestResult = typeof PermissionRequestResultSchema.Type

export const QuestionRequestParamsSchema = PendingQuestionInteractionSchema
export const QuestionRequestResultSchema = QuestionInteractionResponseSchema
export type QuestionRequestParams = typeof QuestionRequestParamsSchema.Type
export type QuestionRequestResult = typeof QuestionRequestResultSchema.Type

export const HookTrustRequestParamsSchema = PendingHookTrustInteractionSchema
export const HookTrustRequestResultSchema = HookTrustInteractionResponseSchema
export type HookTrustRequestParams = typeof HookTrustRequestParamsSchema.Type
export type HookTrustRequestResult = typeof HookTrustRequestResultSchema.Type

export const ServerRequestResultSchema = SharedInteractionResponseSchema
export type ServerRequestResponse = typeof ServerRequestResultSchema.Type

export const ServerRequests = {
  'approval/request': defineServerRequest({
    params: ApprovalRequestParamsSchema,
    result: ApprovalRequestResultSchema,
    capability: 'interactions.serverRequests.v1',
  }),
  'permission/request': defineServerRequest({
    params: PermissionRequestParamsSchema,
    result: PermissionRequestResultSchema,
    capability: 'interactions.serverRequests.v1',
  }),
  'question/request': defineServerRequest({
    params: QuestionRequestParamsSchema,
    result: QuestionRequestResultSchema,
    capability: 'interactions.serverRequests.v1',
  }),
  'hookTrust/request': defineServerRequest({
    params: HookTrustRequestParamsSchema,
    result: HookTrustRequestResultSchema,
    capability: 'hooks.trust.v1',
  }),
} as const

export const ServerRequestManifest = ServerRequests
export const ServerRequestMap = ServerRequests
export type ServerRequestMethod = keyof typeof ServerRequests
export type ServerRequestParams<M extends ServerRequestMethod> = ServerRequestParamsOf<
  (typeof ServerRequests)[M]
>
export type ServerRequestResult<M extends ServerRequestMethod> = ServerRequestResultOf<
  (typeof ServerRequests)[M]
>

export type ServerRequestMessage<M extends ServerRequestMethod = ServerRequestMethod> =
  M extends ServerRequestMethod
    ? {
        readonly jsonrpc: '2.0'
        readonly id: ServerRequestParams<M>['interactionId']
        readonly method: M
        readonly params: ServerRequestParams<M>
      }
    : never

const ServerRequestMessageSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: OpaqueIDSchema,
  method: Schema.String,
  params: JsonValueSchema,
})

export function createServerRequestMessage<M extends ServerRequestMethod>(
  method: M,
  params: ServerRequestParams<M>,
): ServerRequestMessage<M> {
  const decoded = Schema.decodeUnknownSync(ServerRequests[method].params)(
    params,
  ) as ServerRequestParams<M>
  return {
    jsonrpc: '2.0',
    id: decoded.interactionId,
    method,
    params: decoded,
  } as ServerRequestMessage<M>
}

export function decodeServerRequestMessage(input: unknown): ServerRequestMessage {
  const message = Schema.decodeUnknownSync(ServerRequestMessageSchema)(input)
  if (!(message.method in ServerRequests))
    throw new Error(`Unknown server request method: ${message.method}`)

  const method = message.method as ServerRequestMethod
  const params = Schema.decodeUnknownSync(ServerRequests[method].params)(message.params)
  if (message.id !== params.interactionId)
    throw new Error('Server request id must equal the persisted interactionId')
  return { ...message, method, params } as unknown as ServerRequestMessage
}

export function decodeServerRequestResult<M extends ServerRequestMethod>(
  method: M,
  input: unknown,
): ServerRequestResult<M> {
  return Schema.decodeUnknownSync(ServerRequests[method].result)(input) as ServerRequestResult<M>
}
