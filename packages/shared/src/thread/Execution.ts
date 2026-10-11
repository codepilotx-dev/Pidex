import { Schema } from 'effect'

const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/**
 * Persisted lifecycle of a managed worktree. Shared so the thread projection and
 * the worktree RPC surface cannot drift apart.
 */
export const WorktreeStatusSchema = Schema.Literals([
  'creating',
  'ready',
  'ready-with-setup-error',
  'deleting',
  'cleaned',
  'restoring',
  'restore-conflict',
])
export type WorktreeStatus = typeof WorktreeStatusSchema.Type

/**
 * Where a thread executes. The agent projects this from the execution binding so
 * clients never infer the environment from workspace, branch, or standalone flags.
 */
export const ThreadExecutionEnvironmentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('local'),
    cwd: Schema.String,
    revision: VersionSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('worktree'),
    worktreeId: Schema.String,
    cwd: Schema.String,
    branchName: Schema.NullOr(Schema.String),
    status: WorktreeStatusSchema,
    revision: VersionSchema,
  }),
])
export type ThreadExecutionEnvironment = typeof ThreadExecutionEnvironmentSchema.Type
