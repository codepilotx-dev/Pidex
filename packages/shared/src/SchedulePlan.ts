import { Schema } from 'effect'
import {
  AutomationExecutionSchema,
  AutomationKindSchema,
  AutomationNotificationPolicySchema,
  AutomationScheduleSchema,
} from './Automation'
import { CalendarSourceRefSchema } from './Calendar'
import { ModelRefSchema } from './Model'
import { PermissionConfigSchema } from './thread/Permission'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const PositiveIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const SchedulePlanItemDraftSchema = Schema.Union([
  Schema.Struct({
    key: NonEmptyStringSchema,
    enabled: Schema.Boolean,
    kind: Schema.Literal('one-off'),
    name: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema,
    scheduledFor: Schema.Number,
  }),
  Schema.Struct({
    key: NonEmptyStringSchema,
    enabled: Schema.Boolean,
    kind: Schema.Literal('recurring'),
    name: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema,
    schedule: AutomationScheduleSchema,
    timeZone: NonEmptyStringSchema,
  }),
])
export type SchedulePlanItemDraft = typeof SchedulePlanItemDraftSchema.Type

export const SchedulePlanExecutionDefaultsSchema = Schema.Struct({
  kind: AutomationKindSchema,
  projectId: Schema.NullOr(NonEmptyStringSchema),
  targetThreadId: Schema.NullOr(NonEmptyStringSchema),
  execution: Schema.NullOr(AutomationExecutionSchema),
  model: ModelRefSchema,
  reasoningEffort: Schema.NullOr(NonEmptyStringSchema),
  permissionConfig: PermissionConfigSchema,
  timeZone: NonEmptyStringSchema,
  notificationPolicy: AutomationNotificationPolicySchema,
})
export type SchedulePlanExecutionDefaults = typeof SchedulePlanExecutionDefaultsSchema.Type

export const SchedulePlanProposalStatusSchema = Schema.Literals([
  'pending',
  'committed',
  'cancelled',
])
export type SchedulePlanProposalStatus = typeof SchedulePlanProposalStatusSchema.Type

export const SchedulePlanHorizonSchema = Schema.Literals(['day', 'week', 'month', 'year'])
export type SchedulePlanHorizon = typeof SchedulePlanHorizonSchema.Type

export const SchedulePlanProposalSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  revision: PositiveIntegerSchema,
  threadId: NonEmptyStringSchema,
  turnId: NonEmptyStringSchema,
  toolCallId: NonEmptyStringSchema,
  status: SchedulePlanProposalStatusSchema,
  horizon: SchedulePlanHorizonSchema,
  defaults: SchedulePlanExecutionDefaultsSchema,
  items: Schema.Array(SchedulePlanItemDraftSchema),
  createdRefs: Schema.Array(CalendarSourceRefSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  committedAt: Schema.NullOr(Schema.Number),
})
export type SchedulePlanProposal = typeof SchedulePlanProposalSchema.Type
