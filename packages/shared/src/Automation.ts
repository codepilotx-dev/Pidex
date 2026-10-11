import { Schema } from 'effect'
import { ModelRefSchema } from './Model'
import { PermissionConfigSchema } from './thread/Permission'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const PositiveIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const AutomationKindSchema = Schema.Literals(['standalone', 'thread'])
export type AutomationKind = typeof AutomationKindSchema.Type

export const AutomationStatusSchema = Schema.Literals(['active', 'paused', 'deleted'])
export type AutomationStatus = typeof AutomationStatusSchema.Type

export const AutomationExecutionKindSchema = Schema.Literals(['local', 'new-worktree'])
export type AutomationExecutionKind = typeof AutomationExecutionKindSchema.Type

export const AutomationNotificationPolicySchema = Schema.Literals(['all', 'failures', 'off'])
export type AutomationNotificationPolicy = typeof AutomationNotificationPolicySchema.Type

export const AutomationWeekdaySchema = Schema.Literals(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
export type AutomationWeekday = typeof AutomationWeekdaySchema.Type

export const AutomationScheduleSchema = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('hourly'), intervalMinutes: PositiveIntegerSchema }),
  Schema.Struct({ mode: Schema.Literal('daily'), time: NonEmptyStringSchema }),
  Schema.Struct({ mode: Schema.Literal('weekdays'), time: NonEmptyStringSchema }),
  Schema.Struct({
    mode: Schema.Literal('weekly'),
    weekdays: Schema.Array(AutomationWeekdaySchema).check(Schema.isMinLength(1)),
    time: NonEmptyStringSchema,
  }),
  Schema.Struct({ mode: Schema.Literal('custom'), rrule: NonEmptyStringSchema }),
])
export type AutomationSchedule = typeof AutomationScheduleSchema.Type

export const AutomationExecutionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('local') }),
  Schema.Struct({ kind: Schema.Literal('new-worktree'), branchName: NonEmptyStringSchema }),
])
export type AutomationExecution = typeof AutomationExecutionSchema.Type

export const AutomationSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  revision: PositiveIntegerSchema,
  kind: AutomationKindSchema,
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  status: AutomationStatusSchema,
  projectId: Schema.NullOr(NonEmptyStringSchema),
  targetThreadId: Schema.NullOr(NonEmptyStringSchema),
  execution: Schema.NullOr(AutomationExecutionSchema),
  model: ModelRefSchema,
  reasoningEffort: Schema.NullOr(NonEmptyStringSchema),
  permissionConfig: PermissionConfigSchema,
  schedule: AutomationScheduleSchema,
  canonicalRrule: NonEmptyStringSchema,
  timeZone: NonEmptyStringSchema,
  notificationPolicy: AutomationNotificationPolicySchema,
  nextRunAt: Schema.NullOr(Schema.Number),
  pendingCatchUp: Schema.Boolean,
  activeRunId: Schema.NullOr(NonEmptyStringSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  deletedAt: Schema.NullOr(Schema.Number),
})
export type Automation = typeof AutomationSchema.Type

export const AutomationRunTriggerSchema = Schema.Literals([
  'scheduled',
  'startup-catch-up',
  'overlap-catch-up',
  'manual',
])
export type AutomationRunTrigger = typeof AutomationRunTriggerSchema.Type

export const AutomationRunStatusSchema = Schema.Literals([
  'claimed',
  'preparing',
  'queued',
  'running',
  'completed',
  'failed',
  'interrupted',
])
export type AutomationRunStatus = typeof AutomationRunStatusSchema.Type

export const AutomationRunSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  automationId: NonEmptyStringSchema,
  trigger: AutomationRunTriggerSchema,
  scheduledFor: Schema.Number,
  status: AutomationRunStatusSchema,
  threadId: Schema.NullOr(NonEmptyStringSchema),
  turnId: Schema.NullOr(NonEmptyStringSchema),
  worktreeId: Schema.NullOr(NonEmptyStringSchema),
  readAt: Schema.NullOr(Schema.Number),
  safeErrorCode: Schema.NullOr(NonEmptyStringSchema),
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  completedAt: Schema.NullOr(Schema.Number),
})
export type AutomationRun = typeof AutomationRunSchema.Type
