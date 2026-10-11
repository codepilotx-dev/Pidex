import { Schema } from 'effect'
import {
  AutomationExecutionSchema,
  AutomationKindSchema,
  AutomationNotificationPolicySchema,
} from './Automation'
import { ModelRefSchema } from './Model'
import { PermissionConfigSchema } from './thread/Permission'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const PositiveIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const ScheduledTaskStatusSchema = Schema.Literals([
  'scheduled',
  'paused',
  'claimed',
  'preparing',
  'queued',
  'running',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
])
export type ScheduledTaskStatus = typeof ScheduledTaskStatusSchema.Type

export const ScheduledTaskDefinitionSchema = Schema.Struct({
  kind: AutomationKindSchema,
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  projectId: Schema.NullOr(NonEmptyStringSchema),
  targetThreadId: Schema.NullOr(NonEmptyStringSchema),
  execution: Schema.NullOr(AutomationExecutionSchema),
  model: ModelRefSchema,
  reasoningEffort: Schema.NullOr(NonEmptyStringSchema),
  permissionConfig: PermissionConfigSchema,
  scheduledFor: Schema.Number,
  timeZone: NonEmptyStringSchema,
  notificationPolicy: AutomationNotificationPolicySchema,
})
export type ScheduledTaskDefinition = typeof ScheduledTaskDefinitionSchema.Type

export const ScheduledTaskSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  revision: PositiveIntegerSchema,
  ...ScheduledTaskDefinitionSchema.fields,
  status: ScheduledTaskStatusSchema,
  threadId: Schema.NullOr(NonEmptyStringSchema),
  turnId: Schema.NullOr(NonEmptyStringSchema),
  worktreeId: Schema.NullOr(NonEmptyStringSchema),
  readAt: Schema.NullOr(Schema.Number),
  safeErrorCode: Schema.NullOr(NonEmptyStringSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  completedAt: Schema.NullOr(Schema.Number),
  cancelledAt: Schema.NullOr(Schema.Number),
})
export type ScheduledTask = typeof ScheduledTaskSchema.Type
