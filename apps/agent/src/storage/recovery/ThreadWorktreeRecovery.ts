import type { ThreadWorktreeOperationRepository } from '../repositories/ThreadWorktreeOperationRepository'

/**
 * Resumes thread-create operations that died between worktree creation and thread
 * publication. Exactly one outcome per operation, and each outcome is terminal, so
 * rerunning recovery after a crash is a no-op rather than a second cleanup.
 */
export type ThreadWorktreeRecoveryDatabase = Pick<
  ThreadWorktreeOperationRepository,
  'recoverable' | 'markPublished' | 'markFailed' | 'markCleaned'
>

export type ThreadWorktreeRecoveryDeps = {
  /** Removes an orphaned worktree; the operation id stays deterministic per worktree operation. */
  deleteWorktree: (input: { worktreeId: string; operationId: string }) => Promise<unknown>
  database: ThreadWorktreeRecoveryDatabase
  now?: () => number
}

export type ThreadWorktreeRecoveryResult = {
  published: number
  failed: number
  cleaned: number
}

export async function recoverThreadWorktreeOperations(
  deps: ThreadWorktreeRecoveryDeps,
): Promise<ThreadWorktreeRecoveryResult> {
  const now = deps.now ?? Date.now
  const result: ThreadWorktreeRecoveryResult = { published: 0, failed: 0, cleaned: 0 }
  for (const operation of deps.database.recoverable()) {
    // The thread was published and points at the worktree this operation created.
    if (operation.threadId && operation.boundWorktreeId === operation.worktreeId) {
      deps.database.markPublished(operation.threadOperationId, operation.threadId, now())
      result.published += 1
      continue
    }
    // The thread exists but does not own this worktree: keep the resource for a
    // human to inspect instead of deleting something a user may still be using.
    if (operation.threadId) {
      deps.database.markFailed(operation.threadOperationId, now())
      result.failed += 1
      continue
    }
    // No thread was ever published, so the worktree is an orphan.
    await deps.deleteWorktree({
      worktreeId: operation.worktreeId,
      operationId: `${operation.worktreeOperationId}:orphan-cleanup`,
    })
    deps.database.markCleaned(operation.threadOperationId, now())
    result.cleaned += 1
  }
  return result
}
