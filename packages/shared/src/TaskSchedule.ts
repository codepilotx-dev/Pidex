import { Schema } from 'effect'
import { AutomationNotificationPolicySchema } from './Automation'
import {
  ScheduleAutomaticCheckSchema,
  ScheduleConditionsSchema,
  ScheduleExecutionSchema,
  ScheduleTriggerSchema,
} from './ScheduleDraft'

const Text = Schema.String.check(Schema.isMinLength(1))
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export const TaskScheduleDefinitionSchema = Schema.Struct({
  name: Text,
  description: Schema.String,
  owner: Schema.Literals(['human', 'agent']),
  status: Schema.Literals(['active', 'paused', 'cancelled']),
  trigger: Schema.NullOr(ScheduleTriggerSchema),
  durationMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  durationEstimated: Schema.Boolean,
  priority: Schema.Literals(['low', 'normal', 'high']),
  plan: Schema.NullOr(
    Schema.Struct({
      content: Text,
      contentHash: Text,
      threadId: Schema.NullOr(Text),
      itemId: Schema.NullOr(Text),
    }),
  ),
  execution: Schema.NullOr(ScheduleExecutionSchema),
  autoExecute: Schema.Boolean,
  requireManualAcceptance: Schema.Boolean,
  checks: Schema.Array(ScheduleAutomaticCheckSchema),
  conditions: ScheduleConditionsSchema,
  conditionFallback: Schema.Literals(['skip', 'wait']),
  missedRuns: Schema.Literals(['catch-up', 'skip']),
  notificationPolicy: AutomationNotificationPolicySchema,
})
export const TaskScheduleSchema = Schema.Struct({
  ...TaskScheduleDefinitionSchema.fields,
  id: Text,
  revision: Revision,
  readyAt: Schema.NullOr(Schema.Number),
  nextRunAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type TaskScheduleDefinition = typeof TaskScheduleDefinitionSchema.Type
export type TaskSchedule = typeof TaskScheduleSchema.Type

export const TaskOccurrenceSchema = Schema.Struct({
  id: Text,
  taskId: Text,
  revision: Revision,
  scheduledFor: Schema.Number,
  status: Schema.Literals([
    'waiting',
    'needs-plan',
    'human',
    'dispatching',
    'running',
    'checking',
    'awaiting-acceptance',
    'completed',
    'rework',
    'failed',
    'skipped',
    'cancelled',
  ]),
  executionSucceeded: Schema.Boolean,
  resultVersion: Revision,
  result: Schema.String,
  feedback: Schema.String,
  snapshot: TaskScheduleSchema,
  scheduledTaskId: Schema.NullOr(Text),
  threadId: Schema.NullOr(Text),
  attention: Schema.NullOr(Schema.Literals(['needs-plan', 'awaiting-acceptance'])),
  reminderAt: Schema.NullOr(Schema.Number),
  reminderVersion: Revision,
  notifiedVersion: Schema.Int,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type TaskOccurrence = typeof TaskOccurrenceSchema.Type
export const TaskScheduleLinkSchema = Schema.Struct({
  taskId: Text,
  threadId: Text,
  role: Schema.Literals(['planning', 'execution']),
  createdAt: Schema.Number,
})
export type TaskScheduleLink = typeof TaskScheduleLinkSchema.Type
export const TaskArrangementSchema = Schema.Union([
  Schema.Struct({
    taskId: Text,
    expectedRevision: Revision,
    at: Schema.Number,
    durationMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({
    name: Text,
    owner: Schema.Literals(['human', 'agent']),
    at: Schema.Number,
    durationMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
])
export const TaskArrangementProposalSchema = Schema.Struct({
  id: Text,
  revision: Revision,
  status: Schema.Literals(['pending', 'committed', 'cancelled']),
  items: Schema.Array(TaskArrangementSchema),
  unscheduled: Schema.Array(
    Schema.Union([
      Schema.Struct({ taskId: Text, reason: Text }),
      Schema.Struct({ name: Text, owner: Schema.Literals(['human', 'agent']), reason: Text }),
    ]),
  ),
  createdAt: Schema.Number,
})
export type TaskArrangementProposal = typeof TaskArrangementProposalSchema.Type
export const decodeTaskArrangementProposal = Schema.decodeUnknownSync(TaskArrangementProposalSchema)

export function defaultTaskSchedule(name: string): TaskScheduleDefinition {
  return {
    name,
    description: '',
    owner: 'agent',
    status: 'active',
    trigger: null,
    durationMinutes: 30,
    durationEstimated: true,
    priority: 'normal',
    plan: null,
    execution: null,
    autoExecute: false,
    requireManualAcceptance: true,
    checks: [],
    conditions: { dependsOn: [], requireEnvironment: false, notBefore: null, deadline: null },
    conditionFallback: 'wait',
    missedRuns: 'catch-up',
    notificationPolicy: 'all',
  }
}
