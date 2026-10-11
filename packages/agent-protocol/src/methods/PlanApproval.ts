import { Model } from '@pidex/model-schema'
import { PlanApprovalSchema } from '@pidex/shared/thread'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OpaqueIDSchema, PositiveIntSchema } from '../wire/Primitives'

const PlanApprovalErrors = [
  'THREAD_NOT_FOUND',
  'CONFLICT',
  'OPERATION_ID_CONFLICT',
  'TURN_ACTIVE',
  'PERMISSION_DENIED',
  'MODEL_UNAVAILABLE',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const

export const PlanApprovalResponseSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literal('implement'), model: Schema.optional(Model.Ref) }),
  Schema.Struct({
    action: Schema.Literal('feedback'),
    feedback: Schema.String.check(Schema.isPattern(/^\S(?:[\s\S]*\S)?$/)),
    model: Schema.optional(Model.Ref),
  }),
  Schema.Struct({ action: Schema.Literal('close') }),
])

export const PlanApprovalRpcMethods = {
  'planApproval/implementFresh': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      approvalId: OpaqueIDSchema,
      expectedVersion: PositiveIntSchema,
      operationId: OpaqueIDSchema,
      model: Schema.optional(Model.Ref),
    }),
    result: Schema.Struct({
      approval: PlanApprovalSchema,
      targetThreadId: OpaqueIDSchema,
      nextTurnId: OpaqueIDSchema,
      disposition: Schema.Literals(['applied', 'duplicate']),
    }),
    errors: PlanApprovalErrors,
    capability: 'plan.approval.fresh.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'planApproval/read': defineMethod({
    params: Schema.Struct({ threadId: OpaqueIDSchema }),
    result: Schema.Struct({ approval: Schema.NullOr(PlanApprovalSchema) }),
    errors: PlanApprovalErrors,
    capability: 'plan.approval.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'planApproval/respond': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      approvalId: OpaqueIDSchema,
      expectedVersion: PositiveIntSchema,
      operationId: OpaqueIDSchema,
      response: PlanApprovalResponseSchema,
    }),
    result: Schema.Struct({
      approval: PlanApprovalSchema,
      disposition: Schema.Literals(['applied', 'duplicate']),
    }),
    errors: PlanApprovalErrors,
    capability: 'plan.approval.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap
