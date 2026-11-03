import { Schema } from 'effect'
import {
  TaskScheduleSchema,
  TaskScheduleDefinitionSchema,
  TaskOccurrenceSchema,
  TaskScheduleLinkSchema,
  TaskArrangementProposalSchema,
} from '@pidex/shared/task-schedule'
import { ScheduleExecutionSchema } from '@pidex/shared/schedule-draft'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OpaqueIDSchema as ID, NonEmptyStringSchema as Text } from '../wire/Primitives'

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const errors = [
  'INVALID_REQUEST',
  'CONFLICT',
  'OPERATION_ID_CONFLICT',
  'THREAD_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'MODEL_UNAVAILABLE',
  'PERMISSION_DENIED',
  'INTERNAL_ERROR',
] as const
const method = <P extends Schema.Top, R extends Schema.Top>(
  params: P,
  result: R,
  mutation = true,
) =>
  defineMethod({
    params,
    result,
    errors,
    capability: 'task.schedule.v1',
    mutation,
    exactParams: true,
    exactResult: true,
  })
const taskResult = Schema.Struct({ task: TaskScheduleSchema })
const occurrenceResult = Schema.Struct({ occurrence: TaskOccurrenceSchema })
const versioned = { id: ID, expectedRevision: Revision, operationId: ID }
export const TaskScheduleRpcMethods = {
  'task-schedule/list': method(
    Schema.Record(Schema.String, Schema.Never),
    Schema.Struct({
      tasks: Schema.Array(TaskScheduleSchema),
      occurrences: Schema.Array(TaskOccurrenceSchema),
      links: Schema.Array(TaskScheduleLinkSchema),
      proposals: Schema.Array(TaskArrangementProposalSchema),
    }),
    false,
  ),
  'task-schedule/plans': method(
    Schema.Struct({ threadId: ID }),
    Schema.Struct({
      plans: Schema.Array(Schema.Struct({ itemId: ID, title: Text, content: Text })),
    }),
    false,
  ),
  'task-schedule/save': method(
    Schema.Struct({
      id: Schema.optional(ID),
      expectedRevision: Schema.optional(Revision),
      operationId: ID,
      name: Text,
      definition: Schema.optional(TaskScheduleDefinitionSchema),
    }),
    taskResult,
  ),
  'task-schedule/link': method(
    Schema.Struct({ ...versioned, threadId: ID, role: Schema.Literals(['planning', 'execution']) }),
    taskResult,
  ),
  'task-schedule/plan': method(
    Schema.Struct({
      ...versioned,
      content: Schema.optional(Text),
      threadId: Schema.optional(ID),
      itemId: Schema.optional(ID),
      execution: Schema.optional(ScheduleExecutionSchema),
      autoExecute: Schema.optional(Schema.Boolean),
    }),
    taskResult,
  ),
  'task-schedule/start': method(
    Schema.Struct({ ...versioned, occurrenceId: Schema.optional(ID) }),
    occurrenceResult,
  ),
  'task-schedule/result': method(
    Schema.Struct({ ...versioned, resultVersion: Revision, result: Text }),
    occurrenceResult,
  ),
  'task-schedule/accept': method(
    Schema.Struct({
      ...versioned,
      resultVersion: Revision,
      decision: Schema.Literals(['pass', 'rework']),
      feedback: Schema.optional(Text),
      sendFeedback: Schema.optional(Schema.Boolean),
    }),
    occurrenceResult,
  ),
  'task-schedule/snooze': method(
    Schema.Struct({ ...versioned, until: Schema.Number }),
    occurrenceResult,
  ),
  'task-schedule/notify': method(
    Schema.Struct({ id: ID, reminderVersion: Revision }),
    occurrenceResult,
  ),
  'task-schedule/propose': method(
    Schema.Struct({
      operationId: ID,
      id: Schema.optional(ID),
      expectedRevision: Schema.optional(Revision),
      items: TaskArrangementProposalSchema.fields.items,
      unscheduled: TaskArrangementProposalSchema.fields.unscheduled,
    }),
    Schema.Struct({ proposal: TaskArrangementProposalSchema }),
  ),
  'task-schedule/arrange': method(
    Schema.Struct({
      ...versioned,
      decision: Schema.optional(Schema.Literals(['confirm', 'cancel'])),
    }),
    Schema.Struct({ proposal: TaskArrangementProposalSchema }),
  ),
} as const satisfies MethodMap
