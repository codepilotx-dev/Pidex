import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OpaqueIDSchema, SequenceSchema, TimestampSchema } from '../wire/Primitives'

export const HandoffStepSchema = Schema.Literals([
  'preflight',
  'stop-source',
  'prepare-destination',
  'capture-source',
  'release-branch',
  'checkout-destination',
  'apply-source-changes',
  'fork-conversation',
  'transfer-core-state',
  'await-client-transfer',
  'archive-source',
  'complete',
])

export const HandoffStatusSchema = Schema.Literals([
  'running',
  'await-client-transfer',
  'completed',
  'failed',
  'rollback-failed',
])

export const HandoffDirectionSchema = Schema.Literals(['local-to-worktree', 'worktree-to-local'])

export const HandoffErrorCodeSchema = Schema.Literals([
  'HANDOFF_IN_PROGRESS',
  'SOURCE_ACTIVE',
  'QUEUE_NOT_EMPTY',
  'PENDING_INTERACTION',
  'NOT_GIT',
  'LOCAL_DETACHED',
  'WORKTREE_DETACHED',
  'DEFAULT_BRANCH',
  'BRANCH_IN_USE',
  'DESTINATION_DIRTY',
  'HEAD_MISMATCH',
  'STASH_FAILED',
  'CHECKOUT_FAILED',
  'APPLY_FAILED',
  'HISTORY_UNSUPPORTED',
  'CLIENT_TRANSFER_REQUIRED',
  'ROLLBACK_FAILED',
  'DESTINATION_UNAVAILABLE',
])

export type HandoffErrorCode = typeof HandoffErrorCodeSchema.Type

export const HandoffOperationSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  sourceThreadId: OpaqueIDSchema,
  targetThreadId: Schema.NullOr(OpaqueIDSchema),
  direction: HandoffDirectionSchema,
  status: HandoffStatusSchema,
  step: HandoffStepSchema,
  revision: SequenceSchema,
  errorCode: Schema.NullOr(HandoffErrorCodeSchema),
  warnings: Schema.Array(Schema.String),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: Schema.NullOr(TimestampSchema),
})

const HandoffErrors = [
  'THREAD_NOT_FOUND',
  'HANDOFF_IN_PROGRESS',
  'SOURCE_ACTIVE',
  'QUEUE_NOT_EMPTY',
  'PENDING_INTERACTION',
  'NOT_GIT',
  'LOCAL_DETACHED',
  'WORKTREE_DETACHED',
  'DEFAULT_BRANCH',
  'BRANCH_IN_USE',
  'DESTINATION_DIRTY',
  'HEAD_MISMATCH',
  'STASH_FAILED',
  'CHECKOUT_FAILED',
  'APPLY_FAILED',
  'HISTORY_UNSUPPORTED',
  'CLIENT_TRANSFER_REQUIRED',
  'ROLLBACK_FAILED',
  'DESTINATION_UNAVAILABLE',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

export const HandoffRpcMethods = {
  'thread/handoff/start': defineMethod({
    params: Schema.Struct({
      operationId: OpaqueIDSchema,
      sourceThreadId: OpaqueIDSchema,
      destination: Schema.Union([
        Schema.Struct({ kind: Schema.Literal('local') }),
        Schema.Struct({ kind: Schema.Literal('worktree'), worktreeId: OpaqueIDSchema }),
      ]),
    }),
    result: Schema.Struct({ operation: HandoffOperationSchema }),
    errors: HandoffErrors,
    capability: 'thread.handoff.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/handoff/status': defineMethod({
    params: Schema.Struct({
      operationId: OpaqueIDSchema,
      afterRevision: Schema.optional(SequenceSchema),
      waitMs: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30_000 }))),
    }),
    result: Schema.Struct({ operation: HandoffOperationSchema, changed: Schema.Boolean }),
    errors: ['THREAD_NOT_FOUND', 'CONFLICT', 'INTERNAL_ERROR'],
    capability: 'thread.handoff.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/handoff/pending': defineMethod({
    params: Schema.Struct({ sourceThreadId: OpaqueIDSchema }),
    result: Schema.Struct({ operation: Schema.NullOr(HandoffOperationSchema) }),
    errors: ['THREAD_NOT_FOUND', 'INTERNAL_ERROR'],
    capability: 'thread.handoff.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/handoff/ack-client-transfer': defineMethod({
    params: Schema.Struct({ operationId: OpaqueIDSchema, revision: SequenceSchema }),
    result: Schema.Struct({ operation: HandoffOperationSchema }),
    errors: HandoffErrors,
    capability: 'thread.handoff.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap
