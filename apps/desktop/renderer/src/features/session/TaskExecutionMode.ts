import type { DesktopSessionExecution, DesktopWorktreeEligibility } from '../../../shared/Types.js'

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

/**
 * Applies a home-composer launch selection to a session creation. An explicit choice
 * wins over the project setting and project type; callers that pass nothing keep the
 * existing automatic behavior. Agents without `thread.execution.v2` cannot express a
 * worktree request, so it fails loudly instead of silently running somewhere else.
 */
export function resolveSessionCreationExecution(input: {
  execution?: DesktopSessionExecution
  supportsExplicitExecution: boolean
  projectExecutionEnvironment?: 'auto' | 'local' | null
  eligibility?: Pick<DesktopWorktreeEligibility, 'isGitRepository'> | null
}): DesktopSessionExecution | undefined {
  if (input.execution?.kind === 'worktree' && !input.supportsExplicitExecution) {
    throw new Error('当前 Agent 不支持从指定分支创建工作树，请更新 Agent 后重试')
  }
  if (input.execution && input.supportsExplicitExecution) return input.execution
  return resolveTaskExecution({
    supportsExecution: input.supportsExplicitExecution,
    projectExecutionEnvironment: input.projectExecutionEnvironment,
    eligibility: input.eligibility,
  })
}
