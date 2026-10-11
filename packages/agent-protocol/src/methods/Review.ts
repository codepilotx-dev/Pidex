import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  OpaqueIDSchema,
  OkResultSchema,
  PositiveIntSchema,
  TimestampSchema,
} from '../wire/Primitives'

export const ReviewSourceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('uncommitted') }),
  Schema.Struct({ kind: Schema.Literal('unstaged') }),
  Schema.Struct({ kind: Schema.Literal('staged') }),
  Schema.Struct({ kind: Schema.Literal('branch'), baseBranch: NonEmptyStringSchema }),
  Schema.Struct({ kind: Schema.Literal('commit'), commitSha: NonEmptyStringSchema }),
  Schema.Struct({
    kind: Schema.Literal('last-turn'),
    threadId: OpaqueIDSchema,
    turnId: OpaqueIDSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('pull-request'),
    owner: NonEmptyStringSchema,
    repository: NonEmptyStringSchema,
    number: PositiveIntSchema,
  }),
])
export type ReviewSource = typeof ReviewSourceSchema.Type

export const ReviewFileStatusSchema = Schema.Literals([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'type-changed',
  'unknown',
])
export type ReviewFileStatus = typeof ReviewFileStatusSchema.Type

export const ReviewFileSummarySchema = Schema.Struct({
  path: NonEmptyStringSchema,
  previousPath: Schema.NullOr(NonEmptyStringSchema),
  status: ReviewFileStatusSchema,
  additions: Schema.NullOr(NonNegativeIntSchema),
  deletions: Schema.NullOr(NonNegativeIntSchema),
  changedLines: NonNegativeIntSchema,
  changedBytes: NonNegativeIntSchema,
  binary: Schema.Boolean,
  revision: NonEmptyStringSchema,
})
export type ReviewFileSummary = typeof ReviewFileSummarySchema.Type

export const ReviewTotalsSchema = Schema.Struct({
  files: NonNegativeIntSchema,
  additions: NonNegativeIntSchema,
  deletions: NonNegativeIntSchema,
  changedLines: NonNegativeIntSchema,
  changedBytes: NonNegativeIntSchema,
})

export const ReviewSummarySnapshotSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  generation: NonEmptyStringSchema,
  source: ReviewSourceSchema,
  repositoryRoot: NonEmptyStringSchema,
  headSha: Schema.NullOr(NonEmptyStringSchema),
  baseSha: Schema.NullOr(NonEmptyStringSchema),
  files: Schema.Array(ReviewFileSummarySchema),
  totals: ReviewTotalsSchema,
  largeDiffMode: Schema.Boolean,
})
export type ReviewSummarySnapshot = typeof ReviewSummarySnapshotSchema.Type

export const ReviewSummaryParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  source: ReviewSourceSchema,
})

export const ReviewSummaryCacheStateSchema = Schema.Literals(['fresh', 'stale'])
export type ReviewSummaryCacheState = typeof ReviewSummaryCacheStateSchema.Type

export const ReviewSummaryResultSchema = Schema.Struct({
  snapshot: ReviewSummarySnapshotSchema,
  cacheState: ReviewSummaryCacheStateSchema,
})
export type ReviewSummaryResult = typeof ReviewSummaryResultSchema.Type

export const ReviewPullRequestPrepareParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  owner: NonEmptyStringSchema,
  repository: NonEmptyStringSchema,
  number: PositiveIntSchema,
  force: Schema.optional(Schema.Boolean),
})

export const ReviewPullRequestPrepareResultSchema = Schema.Struct({
  baseSha: NonEmptyStringSchema,
  headSha: NonEmptyStringSchema,
})

export const ReviewHunkSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  header: NonEmptyStringSchema,
  oldStart: NonNegativeIntSchema,
  oldLines: NonNegativeIntSchema,
  newStart: NonNegativeIntSchema,
  newLines: NonNegativeIntSchema,
  patch: Schema.String,
})
export type ReviewHunk = typeof ReviewHunkSchema.Type

export const ReviewFileDiffParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  source: ReviewSourceSchema,
  generation: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  hideWhitespace: Schema.optional(Schema.Boolean),
  loadFullFiles: Schema.optional(Schema.Boolean),
})

export const ReviewFileDiffResultSchema = Schema.Struct({
  file: ReviewFileSummarySchema,
  revision: NonEmptyStringSchema,
  patch: Schema.String,
  contextPatch: Schema.optional(Schema.String),
  hunks: Schema.Array(ReviewHunkSchema),
  renderable: Schema.Boolean,
  tooLargeReason: Schema.NullOr(Schema.Literals(['changed-lines', 'changed-bytes', 'line-bytes'])),
})
export type ReviewFileDiffResult = typeof ReviewFileDiffResultSchema.Type

export const ReviewFileDiffsParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  source: ReviewSourceSchema,
  generation: NonEmptyStringSchema,
  paths: Schema.Array(NonEmptyStringSchema).check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  hideWhitespace: Schema.optional(Schema.Boolean),
  loadFullFiles: Schema.optional(Schema.Boolean),
})

export const ReviewFileDiffsResultSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('success'),
    generation: NonEmptyStringSchema,
    files: Schema.Array(ReviewFileDiffResultSchema),
    changedBytes: NonNegativeIntSchema,
  }),
  Schema.Struct({
    type: Schema.Literal('large'),
    generation: NonEmptyStringSchema,
    reason: Schema.Literal('changed-bytes'),
  }),
])
export type ReviewFileDiffsResult = typeof ReviewFileDiffsResultSchema.Type

export const ReviewMutationTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('file'), path: NonEmptyStringSchema }),
  Schema.Struct({
    kind: Schema.Literal('hunk'),
    path: NonEmptyStringSchema,
    hunkId: NonEmptyStringSchema,
  }),
])

export const ReviewApplyParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  source: ReviewSourceSchema,
  generation: NonEmptyStringSchema,
  expectedRevision: NonEmptyStringSchema,
  action: Schema.Literals(['stage', 'unstage', 'revert']),
  target: ReviewMutationTargetSchema,
  atomic: Schema.Literal(true),
})

export const ReviewApplyResultSchema = Schema.Struct({
  ok: Schema.Literal(true),
  action: Schema.Literals(['stage', 'unstage', 'revert']),
  path: NonEmptyStringSchema,
  generation: NonEmptyStringSchema,
})
export type ReviewApplyResult = typeof ReviewApplyResultSchema.Type

export const ReviewApplyBatchParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  source: ReviewSourceSchema,
  generation: NonEmptyStringSchema,
  action: Schema.Literals(['stage', 'unstage', 'revert']),
  items: Schema.Array(
    Schema.Struct({
      path: NonEmptyStringSchema,
      expectedRevision: NonEmptyStringSchema,
    }),
  ).check(Schema.isMinLength(1)),
})

export const ReviewApplyBatchResultSchema = Schema.Struct({
  ok: Schema.Literal(true),
  action: Schema.Literals(['stage', 'unstage', 'revert']),
  paths: Schema.Array(NonEmptyStringSchema),
  generation: NonEmptyStringSchema,
  appliedCount: NonNegativeIntSchema,
})
export type ReviewApplyBatchResult = typeof ReviewApplyBatchResultSchema.Type

export const ReviewBranchesParamsSchema = Schema.Struct({ projectId: OpaqueIDSchema })
export const ReviewBranchesResultSchema = Schema.Struct({
  current: Schema.NullOr(NonEmptyStringSchema),
  branches: Schema.Array(
    Schema.Struct({
      name: NonEmptyStringSchema,
      sha: NonEmptyStringSchema,
      current: Schema.Boolean,
      remote: Schema.Boolean,
      default: Schema.optional(Schema.Boolean),
    }),
  ),
})

export const ReviewCommitsParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})
export const ReviewCommitsResultSchema = Schema.Struct({
  commits: Schema.Array(
    Schema.Struct({
      sha: NonEmptyStringSchema,
      shortSha: NonEmptyStringSchema,
      subject: Schema.String,
      author: Schema.String,
      authoredAt: TimestampSchema,
    }),
  ),
})

export const ReviewGitFileStatusSchema = Schema.Struct({
  path: NonEmptyStringSchema,
  previousPath: Schema.NullOr(NonEmptyStringSchema),
  stagedStatus: Schema.String,
  unstagedStatus: Schema.String,
  untracked: Schema.Boolean,
})

export const ReviewGitStatusSchema = Schema.Struct({
  branchName: Schema.NullOr(NonEmptyStringSchema),
  upstream: Schema.NullOr(NonEmptyStringSchema),
  ahead: NonNegativeIntSchema,
  behind: NonNegativeIntSchema,
  clean: Schema.Boolean,
  files: Schema.Array(ReviewGitFileStatusSchema),
})
export type ReviewGitStatus = typeof ReviewGitStatusSchema.Type

export const ReviewStatusParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
})
export const ReviewStatusResultSchema = Schema.Struct({
  status: ReviewGitStatusSchema,
})

export const ReviewCommitParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  message: NonEmptyStringSchema,
  paths: Schema.Array(NonEmptyStringSchema),
})
export const ReviewCommitResultSchema = Schema.Struct({
  ok: Schema.Literal(true),
  headSha: NonEmptyStringSchema,
  output: Schema.String,
  status: ReviewGitStatusSchema,
})

export const ReviewCommentSideSchema = Schema.Literals(['old', 'new'])
export const ReviewCommentStatusSchema = Schema.Literals(['open', 'resolved'])
export const ReviewCommentSchema = Schema.Struct({
  id: OpaqueIDSchema,
  threadId: OpaqueIDSchema,
  projectId: OpaqueIDSchema,
  sourceKey: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  side: ReviewCommentSideSchema,
  line: PositiveIntSchema,
  hunkId: Schema.NullOr(NonEmptyStringSchema),
  revision: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  status: ReviewCommentStatusSchema,
  githubCommentId: Schema.NullOr(NonEmptyStringSchema),
  githubThreadId: Schema.NullOr(NonEmptyStringSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type ReviewComment = typeof ReviewCommentSchema.Type

export const ReviewCommentListParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  projectId: OpaqueIDSchema,
  sourceKey: NonEmptyStringSchema,
})
export const ReviewCommentListResultSchema = Schema.Struct({
  comments: Schema.Array(ReviewCommentSchema),
})

export const ReviewCommentSaveParamsSchema = Schema.Struct({
  id: Schema.optional(OpaqueIDSchema),
  threadId: OpaqueIDSchema,
  projectId: OpaqueIDSchema,
  sourceKey: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  side: ReviewCommentSideSchema,
  line: PositiveIntSchema,
  hunkId: Schema.NullOr(NonEmptyStringSchema),
  revision: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  githubCommentId: Schema.optional(NonEmptyStringSchema),
  githubThreadId: Schema.optional(NonEmptyStringSchema),
})
export const ReviewCommentSaveResultSchema = Schema.Struct({ comment: ReviewCommentSchema })

export const ReviewCommentIDParamsSchema = Schema.Struct({
  id: OpaqueIDSchema,
  threadId: OpaqueIDSchema,
  projectId: OpaqueIDSchema,
})

export const ReviewAiTargetSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('uncommittedChanges') }),
  Schema.Struct({ type: Schema.Literal('baseBranch'), branch: NonEmptyStringSchema }),
  Schema.Struct({
    type: Schema.Literal('commit'),
    sha: NonEmptyStringSchema,
    title: Schema.optional(Schema.NullOr(Schema.String)),
  }),
])
export type ReviewAiTarget = typeof ReviewAiTargetSchema.Type

export const ReviewAiStartParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  target: ReviewAiTargetSchema,
  delivery: Schema.Literals(['inline', 'detached']),
})

export const ReviewAiStartResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  delivery: Schema.Literals(['inline', 'detached']),
  source: ReviewSourceSchema,
})

const ReviewErrors = [
  'PROJECT_NOT_FOUND',
  'PATH_DENIED',
  'REPOSITORY_NOT_FOUND',
  'REVIEW_SOURCE_UNAVAILABLE',
  'REVIEW_SNAPSHOT_EXPIRED',
  'REVIEW_REPOSITORY_BUSY',
  'REVIEW_SOURCE_NOT_PREPARED',
  'GIT_COMMAND_FAILED',
  'GIT_OUTPUT_TOO_LARGE',
  'GIT_OUTPUT_ENCODING_INVALID',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const

const ReviewMutationErrors = [...ReviewErrors, 'REVIEW_BATCH_PARTIAL'] as const

const ReviewPullRequestPrepareErrors = [
  ...ReviewErrors,
  'GITHUB_AUTH_REQUIRED',
  'GITHUB_AUTH_INVALID',
  'GITHUB_API_FAILED',
  'GITHUB_UNAVAILABLE',
  'GITHUB_RATE_LIMITED',
] as const

export const ReviewRpcMethods = {
  'review/summary': defineMethod({
    params: ReviewSummaryParamsSchema,
    result: ReviewSummaryResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/fileDiff': defineMethod({
    params: ReviewFileDiffParamsSchema,
    result: ReviewFileDiffResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/file-diffs': defineMethod({
    params: ReviewFileDiffsParamsSchema,
    result: ReviewFileDiffsResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.batch.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/refresh': defineMethod({
    params: ReviewSummaryParamsSchema,
    result: ReviewSummaryResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/pullRequest/prepare': defineMethod({
    params: ReviewPullRequestPrepareParamsSchema,
    result: ReviewPullRequestPrepareResultSchema,
    errors: ReviewPullRequestPrepareErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/apply': defineMethod({
    params: ReviewApplyParamsSchema,
    result: ReviewApplyResultSchema,
    errors: ReviewMutationErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/applyBatch': defineMethod({
    params: ReviewApplyBatchParamsSchema,
    result: ReviewApplyBatchResultSchema,
    errors: ReviewMutationErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/branches': defineMethod({
    params: ReviewBranchesParamsSchema,
    result: ReviewBranchesResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/commits': defineMethod({
    params: ReviewCommitsParamsSchema,
    result: ReviewCommitsResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/status': defineMethod({
    params: ReviewStatusParamsSchema,
    result: ReviewStatusResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/commit': defineMethod({
    params: ReviewCommitParamsSchema,
    result: ReviewCommitResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/comment/list': defineMethod({
    params: ReviewCommentListParamsSchema,
    result: ReviewCommentListResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'review/comment/save': defineMethod({
    params: ReviewCommentSaveParamsSchema,
    result: ReviewCommentSaveResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/comment/resolve': defineMethod({
    params: ReviewCommentIDParamsSchema,
    result: ReviewCommentSaveResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/comment/delete': defineMethod({
    params: ReviewCommentIDParamsSchema,
    result: OkResultSchema,
    errors: ReviewErrors,
    capability: 'git.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'review/ai/start': defineMethod({
    params: ReviewAiStartParamsSchema,
    result: ReviewAiStartResultSchema,
    errors: [...ReviewErrors, 'THREAD_NOT_FOUND', 'MODEL_UNAVAILABLE'],
    capability: 'ai.review.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap
