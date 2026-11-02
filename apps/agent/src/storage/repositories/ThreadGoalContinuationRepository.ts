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

  canContinue(threadId: string, taskMode: TaskMode): boolean {
    return (
      taskMode === 'chat' &&
      Boolean(
        this.db.sqlite
          .query(
            'SELECT 1 FROM threads WHERE id = ? AND archived_at IS NULL AND queue_pause_reason IS NULL',
          )
          .get(threadId),
      ) &&
      !this.db.sqlite
        .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
        .get(threadId)
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

  goalForContinuation(turnId: string): string | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT goal_id FROM thread_goal_continuations WHERE continuation_turn_id = ?')
      .get(turnId) as { goal_id: string } | null
    return row?.goal_id ?? null
  }

  pendingInputs(goalId: string): Array<{ id: string }> {
    if (!this.available()) return []
    return this.db.sqlite
      .query(
        `
      SELECT input.id FROM thread_goal_continuations AS continuation
      JOIN inputs AS input ON input.id = continuation.continuation_input_id
      JOIN turns AS turn ON turn.id = input.turn_id
      WHERE continuation.goal_id = ? AND input.status = 'queued' AND turn.status = 'queued'
    `,
      )
      .all(goalId) as Array<{ id: string }>
  }

  shouldPauseContinuation(turnId: string, goalId: string): boolean {
    if (!this.available()) return false
    const source = this.db.sqlite
      .query(
        `
      SELECT source_turn_id AS id, trigger_reason AS reason FROM thread_goal_continuations
      WHERE continuation_turn_id = ? AND goal_id = ?
    `,
      )
      .get(turnId, goalId) as { id: string; reason: string } | null
    if (!source || source.reason === 'goal-resumed-idle') return false
    const controlsAvailable = this.db.sqlite
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_goal_turn_observations'",
      )
      .get()
    if (controlsAvailable) {
      const current = this.db.sqlite
        .query(
          `SELECT revision, classification FROM thread_goal_turn_observations
        WHERE goal_id = ? AND turn_id = ? ORDER BY revision DESC LIMIT 1`,
        )
        .get(goalId, turnId) as { revision: number; classification: string } | null
      const previous =
        current &&
        (this.db.sqlite
          .query(
            `SELECT classification FROM thread_goal_turn_observations
        WHERE goal_id = ? AND revision = ? AND turn_id = ?`,
          )
          .get(goalId, current.revision, source.id) as { classification: string } | null)
      if (
        current &&
        previous &&
        (current.classification !== 'no-progress' || previous.classification !== 'no-progress')
      )
        return false
      if (current && previous) return true
    }
    const answer = (id: string) =>
      (
        this.db.sqlite
          .query(
            `
      SELECT json_extract(data, '$.text') AS text FROM items
      WHERE turn_id = ? AND type = 'text' AND status = 'completed'
        AND json_extract(data, '$.placement') = 'result'
      ORDER BY ordinal
    `,
          )
          .all(id) as Array<{ text: string }>
      )
        .map(({ text }) => text.trim())
        .join('\n')
        .trim()
    const current = answer(turnId)
    if (
      current &&
      current === answer(source.id) &&
      !this.db.sqlite
        .query("SELECT 1 FROM items WHERE turn_id = ? AND type = 'tool' LIMIT 1")
        .get(turnId)
    )
      return true
    const hasAction = (id: string) =>
      Boolean(
        this.db.sqlite
          .query(
            `
      SELECT 1 FROM items WHERE turn_id = ? AND type = 'tool' AND status = 'completed'
        AND json_extract(data, '$.tool') NOT IN ('ToolSearch', 'update_plan') LIMIT 1
    `,
          )
          .get(id),
      )
    // 两轮自动续跑仅回复、规划或检索不算实际推进；暂停不等于完成。
    return (
      !hasAction(turnId) &&
      !hasAction(source.id) &&
      Boolean(
        this.db.sqlite
          .query(
            `
      SELECT 1 FROM thread_goal_continuations WHERE continuation_turn_id = ? AND goal_id = ?
    `,
          )
          .get(source.id, goalId),
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
