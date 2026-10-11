import type { RepositoryDatabase } from './RepositoryDatabase'

export const THREAD_WORKTREE_OPERATION_SCHEMA = [
  `CREATE TABLE thread_worktree_operations (
    thread_operation_id TEXT PRIMARY KEY,
    worktree_operation_id TEXT NOT NULL UNIQUE,
    worktree_id TEXT,
    thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
    stage TEXT NOT NULL CHECK(stage IN ('worktree-created','thread-published','failed','cleaned')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
] as const

export class ThreadWorktreeOperationRepository {
  constructor(private readonly db: Pick<RepositoryDatabase, 'sqlite'>) {}
  recordCreated(input: {
    threadOperationId: string
    worktreeOperationId: string
    worktreeId: string
    timestamp: number
  }) {
    this.db.sqlite
      .query(
        `INSERT INTO thread_worktree_operations
      (thread_operation_id, worktree_operation_id, worktree_id, thread_id, stage, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'worktree-created', ?, ?)
      ON CONFLICT(thread_operation_id) DO UPDATE SET worktree_id = excluded.worktree_id, updated_at = excluded.updated_at`,
      )
      .run(
        input.threadOperationId,
        input.worktreeOperationId,
        input.worktreeId,
        input.timestamp,
        input.timestamp,
      )
  }
  markPublished(threadOperationId: string, threadId: string, timestamp: number) {
    this.db.sqlite
      .query(
        "UPDATE thread_worktree_operations SET thread_id = ?, stage = 'thread-published', updated_at = ? WHERE thread_operation_id = ?",
      )
      .run(threadId, timestamp, threadOperationId)
  }
  markFailed(threadOperationId: string, timestamp: number) {
    this.db.sqlite
      .query(
        "UPDATE thread_worktree_operations SET stage = 'failed', updated_at = ? WHERE thread_operation_id = ? AND stage <> 'thread-published'",
      )
      .run(timestamp, threadOperationId)
  }
  recoverable() {
    return this.db.sqlite
      .query(
        `SELECT operation.thread_operation_id AS threadOperationId,
      operation.worktree_operation_id AS worktreeOperationId, operation.worktree_id AS worktreeId,
      thread.id AS threadId, binding.worktree_id AS boundWorktreeId
      FROM thread_worktree_operations operation
      LEFT JOIN threads thread ON thread.create_operation_id = operation.thread_operation_id
      LEFT JOIN thread_execution_bindings binding ON binding.thread_id = thread.id
      WHERE operation.stage = 'worktree-created'
      ORDER BY operation.created_at, operation.thread_operation_id`,
      )
      .all() as Array<{
      threadOperationId: string
      worktreeOperationId: string
      worktreeId: string
      threadId: string | null
      boundWorktreeId: string | null
    }>
  }
  markCleaned(threadOperationId: string, timestamp: number) {
    this.db.sqlite
      .query(
        "UPDATE thread_worktree_operations SET stage = 'cleaned', updated_at = ? WHERE thread_operation_id = ? AND stage = 'worktree-created'",
      )
      .run(timestamp, threadOperationId)
  }
}
