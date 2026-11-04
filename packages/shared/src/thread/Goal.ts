import { Schema } from 'effect'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const THREAD_GOAL_OBJECTIVE_MAX_LENGTH = 4_000

/**
 * Goal lifecycle. `blocked`, `usage-limited` and `budget-limited` are derived by
 * the agent from execution and quota state; only the user-facing subset below is
 * directly settable through `thread/goal/set`.
 */
export const ThreadGoalStatusSchema = Schema.Literals([
  'active',
  'paused',
  'blocked',
  'usage-limited',
  'budget-limited',
  'complete',
])
export type ThreadGoalStatus = typeof ThreadGoalStatusSchema.Type

export const ThreadGoalUserStatusSchema = Schema.Literals(['active', 'paused', 'complete'])
export type ThreadGoalUserStatus = typeof ThreadGoalUserStatusSchema.Type

export type ThreadGoalBudgetViolation = 'narrowed' | 'capped'

/**
 * A goal's budget may only widen once the goal exists: a finite cap can be raised
 * or removed, an unlimited goal cannot become finite, and nothing can be lowered.
 * Callers only apply this to an existing goal; creating one is unconstrained.
 */
export function threadGoalBudgetViolation(
  current: number | null,
  next: number | null,
): ThreadGoalBudgetViolation | null {
  if (current === null) return next === null ? null : 'capped'
  if (next === null || next >= current) return null
  return 'narrowed'
}

export const ThreadGoalSchema = Schema.Struct({
  /** Identity of this goal instance; a cleared-then-recreated goal gets a new id. */
  id: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema,
  objective: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(THREAD_GOAL_OBJECTIVE_MAX_LENGTH),
  ),
  status: ThreadGoalStatusSchema,
  tokenBudget: Schema.NullOr(NonNegativeIntSchema),
  tokensUsed: NonNegativeIntSchema,
  timeUsedSeconds: NonNegativeIntSchema,
  version: VersionSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  completedAt: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type ThreadGoal = typeof ThreadGoalSchema.Type
