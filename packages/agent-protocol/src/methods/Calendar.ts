import { CalendarOccurrenceSchema, CalendarSourceKindSchema } from '@pidex/shared/calendar'
import {
  SchedulePlanExecutionDefaultsSchema,
  SchedulePlanItemDraftSchema,
  SchedulePlanProposalSchema,
} from '@pidex/shared/schedule-plan'
import { ScheduledTaskDefinitionSchema, ScheduledTaskSchema } from '@pidex/shared/scheduled-task'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { NonEmptyStringSchema, OpaqueIDSchema } from '../wire/Primitives'

const PositiveRevisionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const SchedulePlanItemsSchema = Schema.Array(SchedulePlanItemDraftSchema).check(
  Schema.isMaxLength(100),
)

const CalendarErrors = ['INVALID_REQUEST', 'INTERNAL_ERROR'] as const
const ScheduledTaskErrors = [
  'SCHEDULED_TASK_NOT_FOUND',
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
const SchedulePlanErrors = [
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

export const CalendarRangeParamsSchema = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
  timeZone: NonEmptyStringSchema,
  query: Schema.optional(Schema.String),
  sourceKinds: Schema.optional(Schema.Array(CalendarSourceKindSchema)),
})

export const ScheduledTaskCreateParamsSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  ...ScheduledTaskDefinitionSchema.fields,
})

export const ScheduledTaskUpdateParamsSchema = Schema.Struct({
  id: OpaqueIDSchema,
  expectedRevision: PositiveRevisionSchema,
  kind: Schema.optional(ScheduledTaskDefinitionSchema.fields.kind),
  name: Schema.optional(ScheduledTaskDefinitionSchema.fields.name),
  prompt: Schema.optional(ScheduledTaskDefinitionSchema.fields.prompt),
  projectId: Schema.optional(ScheduledTaskDefinitionSchema.fields.projectId),
  targetThreadId: Schema.optional(ScheduledTaskDefinitionSchema.fields.targetThreadId),
  execution: Schema.optional(ScheduledTaskDefinitionSchema.fields.execution),
  model: Schema.optional(ScheduledTaskDefinitionSchema.fields.model),
  reasoningEffort: Schema.optional(ScheduledTaskDefinitionSchema.fields.reasoningEffort),
  permissionConfig: Schema.optional(ScheduledTaskDefinitionSchema.fields.permissionConfig),
  scheduledFor: Schema.optional(ScheduledTaskDefinitionSchema.fields.scheduledFor),
  timeZone: Schema.optional(ScheduledTaskDefinitionSchema.fields.timeZone),
  notificationPolicy: Schema.optional(ScheduledTaskDefinitionSchema.fields.notificationPolicy),
  status: Schema.optional(Schema.Literals(['scheduled', 'paused'])),
})

export const SchedulePlanCommitParamsSchema = Schema.Struct({
  id: OpaqueIDSchema,
  expectedRevision: PositiveRevisionSchema,
  operationId: OpaqueIDSchema,
  defaults: SchedulePlanExecutionDefaultsSchema,
  items: SchedulePlanItemsSchema,
})

export const CalendarRpcMethods = {
  'calendar/range': defineMethod({
    params: CalendarRangeParamsSchema,
    result: Schema.Struct({
      occurrences: Schema.Array(CalendarOccurrenceSchema),
      truncated: Schema.Boolean,
    }),
    errors: CalendarErrors,
    capability: 'calendar.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'scheduled-task/read': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema }),
    result: Schema.Struct({ scheduledTask: ScheduledTaskSchema }),
    errors: ScheduledTaskErrors,
    capability: 'calendar.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'scheduled-task/create': defineMethod({
    params: ScheduledTaskCreateParamsSchema,
    result: Schema.Struct({ scheduledTask: ScheduledTaskSchema }),
    errors: ScheduledTaskErrors,
    capability: 'calendar.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'scheduled-task/update': defineMethod({
    params: ScheduledTaskUpdateParamsSchema,
    result: Schema.Struct({ scheduledTask: ScheduledTaskSchema }),
    errors: ScheduledTaskErrors,
    capability: 'calendar.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'scheduled-task/delete': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema, expectedRevision: PositiveRevisionSchema }),
    result: Schema.Struct({ scheduledTask: ScheduledTaskSchema }),
    errors: ScheduledTaskErrors,
    capability: 'calendar.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'scheduled-task/run': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: Schema.Struct({ scheduledTask: ScheduledTaskSchema }),
    errors: ScheduledTaskErrors,
    capability: 'calendar.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'schedule-plan/read': defineMethod({
    params: Schema.Struct({ id: OpaqueIDSchema }),
    result: Schema.Struct({ proposal: SchedulePlanProposalSchema }),
    errors: SchedulePlanErrors,
    capability: 'calendar.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'schedule-plan/commit': defineMethod({
    params: SchedulePlanCommitParamsSchema,
    result: Schema.Struct({ proposal: SchedulePlanProposalSchema }),
    errors: SchedulePlanErrors,
    capability: 'calendar.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type CalendarRpcMethodMap = typeof CalendarRpcMethods
