import { WorktreeStatusSchema } from '@pidex/shared/thread'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonEmptyStringSchema,
  OpaqueIDSchema,
  SequenceSchema,
  TimestampSchema,
} from '../wire/Primitives'
const RevisionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export { WorktreeStatusSchema }

export const WorktreeOperationStatusSchema = Schema.Literals([
  'pending',
  'running',
  'completed',
  'failed',
])

export const ManagedWorktreeSchema = Schema.Struct({
  id: OpaqueIDSchema,
  projectId: OpaqueIDSchema,
  status: WorktreeStatusSchema,
  branchName: Schema.NullOr(NonEmptyStringSchema),
  baseCommit: NonEmptyStringSchema,
  headCommit: NonEmptyStringSchema,
  permanent: Schema.Boolean,
  pinned: Schema.Boolean,
  setupStatus: Schema.Literals(['pending', 'succeeded', 'failed', 'skipped']),
  continuedWithoutSetup: Schema.Boolean,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastUsedAt: TimestampSchema,
  deletedAt: Schema.NullOr(TimestampSchema),
})

export const WorktreeOperationSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  worktreeId: Schema.NullOr(OpaqueIDSchema),
  projectId: OpaqueIDSchema,
  kind: Schema.Literals([
    'create',
    'retry-setup',
    'continue-without-setup',
    'set-permanent',
    'delete',
    'restore',
    'auto-cleanup',
  ]),
  step: NonEmptyStringSchema,
  status: WorktreeOperationStatusSchema,
  revision: RevisionSchema,
  errorCode: Schema.NullOr(NonEmptyStringSchema),
  warnings: Schema.Array(NonEmptyStringSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: Schema.NullOr(TimestampSchema),
})

const WorktreeErrors = [
  'PROJECT_NOT_FOUND',
  'WORKTREE_NOT_FOUND',
  'WORKTREE_OPERATION_NOT_FOUND',
  'WORKTREE_OPERATION_CONFLICT',
  'WORKTREE_NOT_READY',
  'WORKTREE_SETUP_REQUIRED',
  'WORKTREE_PATH_DENIED',
  'WORKTREE_PATH_UNSAFE',
  'WORKTREE_BRANCH_NOT_FOUND',
  'WORKTREE_GIT_FAILED',
  'WORKTREE_APPLY_CONFLICT',
  'WORKTREE_CLEANUP_FAILED',
  'WORKTREE_RESTORE_FAILED',
  'PATH_DENIED',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

const WorktreeResultSchema = Schema.Struct({
  worktree: ManagedWorktreeSchema,
  operation: WorktreeOperationSchema,
})

export const WorktreeRpcMethods = {
  'worktree/settings/list': defineMethod({
    params: Schema.Struct({ projectId: Schema.optional(OpaqueIDSchema) }),
    result: Schema.Struct({
      worktrees: Schema.Array(
        Schema.Struct({
          worktree: ManagedWorktreeSchema,
          path: NonEmptyStringSchema,
          repositoryRoot: NonEmptyStringSchema,
          conversations: Schema.Array(
            Schema.Struct({
              id: OpaqueIDSchema,
              title: Schema.String,
              archived: Schema.Boolean,
              pinned: Schema.Boolean,
              active: Schema.Boolean,
            }),
          ),
        }),
      ),
    }),
    errors: WorktreeErrors,
    capability: 'worktree.settings.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/settings/delete': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.settings.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/settings/new-chat': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: Schema.Struct({ threadId: OpaqueIDSchema }),
    errors: WorktreeErrors,
    capability: 'worktree.settings.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/eligibility': defineMethod({
    params: Schema.Struct({ projectId: OpaqueIDSchema }),
    result: Schema.Struct({
      isGitRepository: Schema.Boolean,
      availableModes: Schema.Array(Schema.Literals(['local', 'worktree'])),
      defaultMode: Schema.Literals(['local', 'worktree']),
    }),
    errors: WorktreeErrors,
    capability: 'thread.execution.v2',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/create': defineMethod({
    params: Schema.Struct({
      projectId: OpaqueIDSchema,
      startingState: Schema.Union([
        Schema.Struct({ type: Schema.Literal('branch'), branchName: NonEmptyStringSchema }),
        Schema.Struct({ type: Schema.Literal('working-tree') }),
      ]),
      operationId: OpaqueIDSchema,
    }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/list': defineMethod({
    params: Schema.Struct({ projectId: Schema.optional(OpaqueIDSchema) }),
    result: Schema.Struct({ worktrees: Schema.Array(ManagedWorktreeSchema) }),
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/read': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema }),
    result: ManagedWorktreeSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/retry-setup': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/continue-without-setup': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/set-permanent': defineMethod({
    params: Schema.Struct({
      worktreeId: OpaqueIDSchema,
      permanent: Schema.Boolean,
      operationId: OpaqueIDSchema,
    }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/delete': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/restore': defineMethod({
    params: Schema.Struct({ worktreeId: OpaqueIDSchema, operationId: OpaqueIDSchema }),
    result: WorktreeResultSchema,
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'worktree/operation/status': defineMethod({
    params: Schema.Struct({
      operationId: OpaqueIDSchema,
      afterOutputCursor: Schema.optional(SequenceSchema),
    }),
    result: Schema.Struct({
      operation: WorktreeOperationSchema,
      output: Schema.Struct({
        cursor: SequenceSchema,
        data: Schema.String.check(Schema.isMaxLength(65_536)),
        truncated: Schema.Boolean,
        complete: Schema.Boolean,
      }),
    }),
    errors: WorktreeErrors,
    capability: 'worktree.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type ManagedWorktree = typeof ManagedWorktreeSchema.Type
export type WorktreeOperation = typeof WorktreeOperationSchema.Type
export type WorktreeRpcMethodMap = typeof WorktreeRpcMethods
