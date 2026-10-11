import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OpaqueIDSchema, SequenceSchema, TimestampSchema } from '../wire/Primitives'

export const ThreadForkDestinationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('same-worktree') }),
  Schema.Struct({ kind: Schema.Literal('new-worktree') }),
])

export const ThreadForkDestinationKindSchema = Schema.Literals(['same-worktree', 'new-worktree'])
export const ThreadForkSnapshotModeSchema = Schema.Literals(['shared', 'head', 'working-tree'])

export const ThreadForkStatusSchema = Schema.Literals([
  'running',
  'awaiting-setup-decision',
  'completed',
  'failed',
  'abandoned',
])

export const ThreadForkStepSchema = Schema.Literals([
  'preflight',
  'prepare-worktree',
  'setup',
  'fork-history',
  'bind-target',
  'complete',
])

export const ThreadForkErrorCodeSchema = Schema.Literals([
  'FORK_OPERATION_NOT_FOUND',
  'FORK_OPERATION_CONFLICT',
  'FORK_POINT_NOT_FOUND',
  'FORK_POINT_IN_PROGRESS',
  'FORK_POINT_UNAVAILABLE',
  'HISTORY_UNSUPPORTED',
  'NOT_GIT',
  'WORKTREE_SETUP_REQUIRED',
  'WORKTREE_OPERATION_CONFLICT',
  'FORK_ABANDON_UNAVAILABLE',
  'INTERNAL_ERROR',
])

export const ThreadForkOperationSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  sourceThreadId: OpaqueIDSchema,
  sourceTurnId: OpaqueIDSchema,
  sourceItemId: OpaqueIDSchema,
  targetThreadId: Schema.NullOr(OpaqueIDSchema),
  targetWorktreeId: Schema.NullOr(OpaqueIDSchema),
  destinationKind: ThreadForkDestinationKindSchema,
  snapshotMode: Schema.NullOr(ThreadForkSnapshotModeSchema),
  status: ThreadForkStatusSchema,
  step: ThreadForkStepSchema,
  revision: SequenceSchema,
  errorCode: Schema.NullOr(ThreadForkErrorCodeSchema),
  warnings: Schema.Array(Schema.String),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: Schema.NullOr(TimestampSchema),
})

export const ThreadForkOutputPageSchema = Schema.Struct({
  cursor: SequenceSchema,
  data: Schema.String.check(Schema.isMaxLength(65_536)),
  truncated: Schema.Boolean,
  complete: Schema.Boolean,
})

const ThreadForkErrors = [
  'THREAD_NOT_FOUND',
  'TURN_NOT_FOUND',
  'FORK_OPERATION_NOT_FOUND',
  'FORK_OPERATION_CONFLICT',
  'FORK_POINT_NOT_FOUND',
  'FORK_POINT_IN_PROGRESS',
  'FORK_POINT_UNAVAILABLE',
  'HISTORY_UNSUPPORTED',
  'NOT_GIT',
  'WORKTREE_SETUP_REQUIRED',
  'WORKTREE_OPERATION_CONFLICT',
  'FORK_ABANDON_UNAVAILABLE',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

const ThreadForkOperationResultSchema = Schema.Struct({ operation: ThreadForkOperationSchema })

export const ThreadForkRpcMethods = {
  'thread/fork/start': defineMethod({
    params: Schema.Struct({
      operationId: OpaqueIDSchema,
      sourceThreadId: OpaqueIDSchema,
      lastTurnId: OpaqueIDSchema,
      sourceItemId: OpaqueIDSchema,
      destination: ThreadForkDestinationSchema,
    }),
    result: ThreadForkOperationResultSchema,
    errors: ThreadForkErrors,
    capability: 'thread.fork.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/fork/status': defineMethod({
    params: Schema.Struct({
      operationId: OpaqueIDSchema,
      afterRevision: Schema.optional(SequenceSchema),
      afterOutputCursor: Schema.optional(SequenceSchema),
      waitMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30_000 }))),
    }),
    result: Schema.Struct({
      operation: ThreadForkOperationSchema,
      changed: Schema.Boolean,
      output: ThreadForkOutputPageSchema,
    }),
    errors: ThreadForkErrors,
    capability: 'thread.fork.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/fork/pending': defineMethod({
    params: Schema.Struct({
      sourceThreadId: OpaqueIDSchema,
      lastTurnId: OpaqueIDSchema,
      sourceItemId: OpaqueIDSchema,
    }),
    result: Schema.Struct({ operation: Schema.NullOr(ThreadForkOperationSchema) }),
    errors: ThreadForkErrors,
    capability: 'thread.fork.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/fork/retry-setup': defineMethod({
    params: Schema.Struct({ operationId: OpaqueIDSchema, revision: SequenceSchema }),
    result: ThreadForkOperationResultSchema,
    errors: ThreadForkErrors,
    capability: 'thread.fork.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/fork/continue-without-setup': defineMethod({
    params: Schema.Struct({ operationId: OpaqueIDSchema, revision: SequenceSchema }),
    result: ThreadForkOperationResultSchema,
    errors: ThreadForkErrors,
    capability: 'thread.fork.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/fork/abandon': defineMethod({
    params: Schema.Struct({ operationId: OpaqueIDSchema, revision: SequenceSchema }),
    result: ThreadForkOperationResultSchema,
    errors: ThreadForkErrors,
    capability: 'thread.fork.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ThreadForkDestination = typeof ThreadForkDestinationSchema.Type
export type ThreadForkErrorCode = typeof ThreadForkErrorCodeSchema.Type
export type ThreadForkOperation = typeof ThreadForkOperationSchema.Type
export type ThreadForkRpcMethodMap = typeof ThreadForkRpcMethods
