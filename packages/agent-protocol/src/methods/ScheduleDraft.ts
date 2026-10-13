import { ScheduleDraftSchema } from '@pidex/shared/schedule-draft'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonEmptyStringSchema, OpaqueIDSchema } from '../wire/Primitives'

const PositiveRevisionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

const ScheduleDraftErrors = [
  'SCHEDULE_PLAN_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'PROJECT_REMOVED',
  'THREAD_NOT_FOUND',
  'MODEL_UNAVAILABLE',
  'WORKTREE_BRANCH_NOT_FOUND',
  'OPERATION_ID_CONFLICT',
  'PERMISSION_DENIED',
  'CONFLICT',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const

export const ScheduleDraftCommitParamsSchema = Schema.Struct({
  id: OpaqueIDSchema,
  expectedRevision: PositiveRevisionSchema,
  operationId: OpaqueIDSchema,
  name: Schema.optional(NonEmptyStringSchema),
  prompt: Schema.optional(NonEmptyStringSchema),
  trigger: ScheduleDraftSchema.fields.trigger,
  conditions: ScheduleDraftSchema.fields.conditions,
  conditionFallback: ScheduleDraftSchema.fields.conditionFallback,
  acceptance: ScheduleDraftSchema.fields.acceptance,
  notificationPolicy: ScheduleDraftSchema.fields.notificationPolicy,
  missedRuns: ScheduleDraftSchema.fields.missedRuns,
  execution: ScheduleDraftSchema.fields.execution,
})

export const ScheduleDraftFeedbackParamsSchema = Schema.Struct({
  id: OpaqueIDSchema,
  expectedRevision: PositiveRevisionSchema,
  operationId: OpaqueIDSchema,
  feedback: NonEmptyStringSchema,
})

/**
 * 任务规划草案能力独立于 calendar.manage.v1：确认依赖新表的客户端只有在
 * Agent 真正提供该能力时才允许提交确认，不存在时不得剥掉条件后继续创建普通自动化。
 */
export const ScheduleDraftRpcMethods = {
  'schedule-draft/read': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema }),
    result: Schema.Struct({ draft: ScheduleDraftSchema }),
    errors: ScheduleDraftErrors,
    capability: 'schedule.draft.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'schedule-draft/commit': defineMethod({
    params: ScheduleDraftCommitParamsSchema,
    result: Schema.Struct({ draft: ScheduleDraftSchema }),
    errors: ScheduleDraftErrors,
    capability: 'schedule.draft.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'schedule-draft/cancel': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema, expectedRevision: PositiveRevisionSchema }),
    result: Schema.Struct({ draft: ScheduleDraftSchema }),
    errors: ScheduleDraftErrors,
    capability: 'schedule.draft.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'schedule-draft/feedback': defineMethod({
    params: ScheduleDraftFeedbackParamsSchema,
    result: Schema.Struct({ draft: ScheduleDraftSchema }),
    errors: ScheduleDraftErrors,
    capability: 'schedule.draft.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ScheduleDraftRpcMethodMap = typeof ScheduleDraftRpcMethods
