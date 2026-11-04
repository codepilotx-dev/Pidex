import type { RepositoryDatabase } from './RepositoryDatabase'

export const QUEUED_GOAL_SCHEMA = [
  `CREATE TABLE queued_goal_intents (
  input_id TEXT PRIMARY KEY REFERENCES inputs(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  token_budget INTEGER,
  has_token_budget INTEGER NOT NULL DEFAULT 0
)`,
] as const

export type QueuedGoalIntent = { objective: string; tokenBudget?: number | null | undefined }

export class QueuedGoalRepository {
  constructor(private readonly db: Pick<RepositoryDatabase, 'sqlite'>) {}
  available(): boolean {
    const columns = new Set(
      (
        this.db.sqlite.query('PRAGMA table_info(queued_goal_intents)').all() as Array<{
          name: string
        }>
      ).map((column) => column.name),
    )
    return ['input_id', 'objective', 'token_budget', 'has_token_budget'].every((column) =>
      columns.has(column),
    )
  }
  get(inputId: string): QueuedGoalIntent | undefined {
    if (!this.available()) return undefined
    const row = this.db.sqlite
      .query(
        'SELECT objective, token_budget, has_token_budget FROM queued_goal_intents WHERE input_id = ?',
      )
      .get(inputId) as {
      objective: string
      token_budget: number | null
      has_token_budget: number
    } | null
    return row
      ? {
          objective: row.objective,
          ...(row.has_token_budget ? { tokenBudget: row.token_budget } : {}),
        }
      : undefined
  }
  put(inputId: string, goal: QueuedGoalIntent): void {
    this.db.sqlite
      .query(
        `INSERT INTO queued_goal_intents (input_id, objective, token_budget, has_token_budget) VALUES (?, ?, ?, ?)
      ON CONFLICT(input_id) DO UPDATE SET objective = excluded.objective, token_budget = excluded.token_budget, has_token_budget = excluded.has_token_budget`,
      )
      .run(
        inputId,
        goal.objective.trim(),
        goal.tokenBudget ?? null,
        Number(goal.tokenBudget !== undefined),
      )
  }
  remove(inputId: string): void {
    if (this.available())
      this.db.sqlite.query('DELETE FROM queued_goal_intents WHERE input_id = ?').run(inputId)
  }
}
