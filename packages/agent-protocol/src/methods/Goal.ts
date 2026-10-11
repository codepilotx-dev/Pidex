import {
  THREAD_GOAL_OBJECTIVE_MAX_LENGTH,
  ThreadGoalSchema,
  ThreadGoalUserStatusSchema,
} from '@pidex/shared/thread'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonNegativeIntSchema,
  OpaqueIDSchema,
  OperationParamsSchema,
  TimestampSchema,
} from '../wire/Primitives'

const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const GoalObjectiveSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(THREAD_GOAL_OBJECTIVE_MAX_LENGTH),
)

const GoalErrors = [
  'THREAD_NOT_FOUND',
  'OPERATION_ID_CONFLICT',
  'CONFLICT',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const

export const ThreadGoalGetParamsSchema = Schema.Struct({ threadId: OpaqueIDSchema })
export const ThreadGoalGetResultSchema = Schema.Struct({
  goal: Schema.NullOr(ThreadGoalSchema),
})

export const ThreadGoalSetParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  objective: Schema.optional(GoalObjectiveSchema),
  status: Schema.optional(ThreadGoalUserStatusSchema),
  tokenBudget: Schema.optional(Schema.NullOr(NonNegativeIntSchema)),
  /** Null asserts no goal exists yet; a number asserts that exact goal version. */
  expectedVersion: Schema.NullOr(VersionSchema),
  ...OperationParamsSchema.fields,
})
export const ThreadGoalSetResultSchema = Schema.Struct({ goal: ThreadGoalSchema })

export const ThreadGoalClearParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  expectedVersion: Schema.NullOr(VersionSchema),
  ...OperationParamsSchema.fields,
})
export const ThreadGoalClearResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  /** Identity of the archived goal, so clients can reconcile history after a clear. */
  goalId: OpaqueIDSchema,
  clearedAt: TimestampSchema,
})

export const ThreadGoalRpcMethods = {
  'thread/goal/get': defineMethod({
    params: ThreadGoalGetParamsSchema,
    result: ThreadGoalGetResultSchema,
    errors: GoalErrors,
    capability: 'thread.goal.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/goal/set': defineMethod({
    params: ThreadGoalSetParamsSchema,
    result: ThreadGoalSetResultSchema,
    errors: GoalErrors,
    capability: 'thread.goal.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/goal/clear': defineMethod({
    params: ThreadGoalClearParamsSchema,
    result: ThreadGoalClearResultSchema,
    errors: GoalErrors,
    capability: 'thread.goal.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ThreadGoalRpcMethodMap = typeof ThreadGoalRpcMethods

// Keep the objective limit reachable from the protocol package for form validation.
export const ThreadGoalWireLimits = {
  objective: THREAD_GOAL_OBJECTIVE_MAX_LENGTH,
} as const
