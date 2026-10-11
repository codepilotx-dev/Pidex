import type { DesktopWorktreeEligibility } from '../../../shared/Types.js'

export type TaskExecution =
  { kind: 'local' } | { kind: 'worktree'; startingState: { type: 'working-tree' } }

const WORKTREE_EXECUTION: TaskExecution = {
  kind: 'worktree',
  startingState: { type: 'working-tree' },
}

/**
 * Chooses where a new project task runs. There is no per-task choice: the project's
 * setting decides, and otherwise the project type does. A failed eligibility probe is
 * treated as "not a Git project" (Local) and is never surfaced to the user.
 *
 * Returns `undefined` only for agents that never negotiated `thread.execution.v2`,
 * where the legacy Local behaviour must be preserved by omitting the field entirely.
 */
export function resolveTaskExecution(input: {
  supportsExecution: boolean
  projectExecutionEnvironment?: 'auto' | 'local' | null
  eligibility?: Pick<DesktopWorktreeEligibility, 'isGitRepository'> | null
}): TaskExecution | undefined {
  if (!input.supportsExecution) return undefined
  if (input.projectExecutionEnvironment === 'local') return { kind: 'local' }
  // Git projects default to a working-tree worktree so the current checkout and any
  // staged/unstaged/untracked state carry over.
  return input.eligibility?.isGitRepository ? WORKTREE_EXECUTION : { kind: 'local' }
}
