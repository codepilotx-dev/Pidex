import type { PermissionConfig, TaskMode } from '../../Domain'
import type { RepositoryDatabase } from './RepositoryDatabase'

export const THREAD_GOAL_CONTINUATION_SCHEMA = [
  `CREATE TABLE thread_goal_continuations (
    source_turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL,
    continuation_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
    continuation_input_id TEXT,
    trigger_reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('created', 'skipped')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX thread_goal_continuations_thread ON thread_goal_continuations(thread_id, created_at)',
] as const

export type GoalContinuationSettings = {
  model: unknown
  permissionConfig: PermissionConfig
  taskMode: TaskMode
}

export class ThreadGoalContinuationRepository {
  constructor(private readonly db: Pick<RepositoryDatabase, 'sqlite'>) {}

  available(): boolean {
    return Boolean(
      this.db.sqlite
        .query(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_goal_continuations'",
        )
        .get(),
    )
  }

  hasSourceTurn(sourceTurnId: string): boolean {
    return (
      this.available() &&
      Boolean(
        this.db.sqlite
          .query('SELECT 1 FROM thread_goal_continuations WHERE source_turn_id = ?')
          .get(sourceTurnId),
      )
    )
  }

  record(input: {
    sourceTurnId: string
    threadId: string
    goalId: string
    continuationTurnId: string
    continuationInputId: string
    triggerReason: string
    timestamp: number
  }): void {
    this.db.sqlite
      .query(
        `INSERT INTO thread_goal_continuations (
      source_turn_id, thread_id, goal_id, continuation_turn_id, continuation_input_id,
      trigger_reason, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?)
    ON CONFLICT(source_turn_id) DO NOTHING`,
      )
      .run(
        input.sourceTurnId,
        input.threadId,
        input.goalId,
        input.continuationTurnId,
        input.continuationInputId,
        input.triggerReason,
        input.timestamp,
        input.timestamp,
      )
  }
}
