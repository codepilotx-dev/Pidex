import { Schema } from 'effect'

/** How a thread became associated with a pull request. */
export const ThreadPullRequestOriginSchema = Schema.Literals([
  /** Created from this thread's in-session "create Pull Request" flow. */
  'created',
  /** A PR watch was started from this thread. */
  'watch',
  /** Legacy read-time discovery; kept for stored rows, never shown by the sidebar. */
  'discovered',
  /** Linked explicitly by the user. */
  'manual',
])
export type ThreadPullRequestOrigin = typeof ThreadPullRequestOriginSchema.Type

/**
 * Sidebar-visible Pull Request status. The agent is the single source of truth;
 * clients only choose an icon, a color and localized copy for the value.
 */
export const ThreadPullRequestStateSchema = Schema.Literals([
  'merged',
  'closed',
  'draft',
  'conflicts',
  'checks-failed',
  'mergeable',
  'checks-passing',
  'waiting',
  'unknown',
])
export type ThreadPullRequestState = typeof ThreadPullRequestStateSchema.Type

/** Machine-readable reason explaining a `waiting` state. */
export const ThreadPullRequestReasonSchema = Schema.Literals([
  'review-required',
  'checks-running',
  'behind-base',
  'blocked',
  'unstable',
  'unknown',
])
export type ThreadPullRequestReason = typeof ThreadPullRequestReasonSchema.Type

export const ThreadPullRequestStatusSchema = Schema.Struct({
  state: ThreadPullRequestStateSchema,
  reason: Schema.NullOr(ThreadPullRequestReasonSchema),
  /** True when the last successful GitHub read is older than the freshness window. */
  stale: Schema.Boolean,
  /** Epoch milliseconds of the last successful GitHub read; 0 when never read. */
  checkedAt: Schema.Number,
})
export type ThreadPullRequestStatus = typeof ThreadPullRequestStatusSchema.Type

export const ThreadPullRequestIdentityFields = {
  owner: Schema.String,
  repository: Schema.String,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
} as const

export const ThreadPullRequestIdentitySchema = Schema.Struct(ThreadPullRequestIdentityFields)
export type ThreadPullRequestIdentity = typeof ThreadPullRequestIdentitySchema.Type

/**
 * One thread↔pull-request association as shown in the sidebar. `primary` marks
 * the single association the sidebar highlights; every association is listed in
 * the hover card.
 */
export const ThreadPullRequestSummarySchema = Schema.Struct({
  ...ThreadPullRequestIdentityFields,
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  origin: ThreadPullRequestOriginSchema,
  primary: Schema.Boolean,
  status: ThreadPullRequestStatusSchema,
})
export type ThreadPullRequestSummary = typeof ThreadPullRequestSummarySchema.Type

/** Per-thread batch read result; one failed thread never fails the batch. */
export const ThreadPullRequestListSchema = Schema.Struct({
  threadId: Schema.String,
  items: Schema.Array(ThreadPullRequestSummarySchema),
})
export type ThreadPullRequestList = typeof ThreadPullRequestListSchema.Type
