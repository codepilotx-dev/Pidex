import { randomUUID } from 'node:crypto'
import type { ThreadGoal, ThreadGoalStatus } from '@pidex/shared/thread'
import type { EventEnvelope } from '../../Domain'
import type { RepositoryDatabase } from './RepositoryDatabase'

/**
 * Goal measurement storage. `goal_id` deliberately carries no foreign key to
 * `thread_goals`: clearing a goal archives it, and the archived consumption must
 * survive that. Thread deletion still cascades, which is the lifetime that matters.
 */
export const THREAD_GOAL_LEDGER_SCHEMA = [
  `CREATE TABLE thread_goal_usage_ledger (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('item-usage')),
    source_entry_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK(input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK(output_tokens >= 0),
    cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK(cache_read_tokens >= 0),
    cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK(cache_write_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reasoning_tokens >= 0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (goal_id, source_kind, source_entry_id)
  )`,
  'CREATE INDEX thread_goal_usage_ledger_goal ON thread_goal_usage_ledger(goal_id, created_at)',
  `CREATE TABLE thread_goal_active_intervals (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX thread_goal_active_intervals_agent ON thread_goal_active_intervals(agent_id, ended_at)',
  'CREATE INDEX thread_goal_active_intervals_goal ON thread_goal_active_intervals(goal_id, started_at)',
] as const

/** Cache tokens are counted alongside uncached input, matching measured-usage accounting. */
export type GoalUsageEntry = {
  threadId: string
  goalId: string
  agentId: string
  sourceEntryId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

export type GoalMeasurement = {
  goal: ThreadGoal
  /** Durable goal update produced inside the caller's transaction. */
  event: EventEnvelope
}

type VisibleGoalRow = {
  id: string
  thread_id: string
  objective: string
  status: ThreadGoalStatus
  token_budget: number | null
  tokens_used: number
  time_used_seconds: number
  version: number
  completed_at: number | null
  created_at: number
  updated_at: number
}

const token = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/**
 * Only the history connection and the outbox writer are needed; narrowing the type
 * keeps this usable from mid-hierarchy repositories such as the execution layer.
 */
export type ThreadGoalLedgerDatabase = Pick<RepositoryDatabase, 'sqlite' | 'insertEvent'>

export class ThreadGoalLedgerRepository {
  constructor(
    private readonly db: ThreadGoalLedgerDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  private hasColumns(name: string, required: readonly string[]): boolean {
    if (!this.hasTable(name)) return false
    const columns = new Set(
      (this.db.sqlite.query(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    )
    return required.every((column) => columns.has(column))
  }

  /** Both measurement tables are required before any accounting is attempted. */
  available(): boolean {
    return (
      this.hasColumns('thread_goal_usage_ledger', [
        'thread_id',
        'goal_id',
        'source_kind',
        'source_entry_id',
        'agent_id',
        'input_tokens',
        'output_tokens',
        'cache_read_tokens',
        'cache_write_tokens',
        'reasoning_tokens',
        'created_at',
      ]) &&
      this.hasColumns('thread_goal_active_intervals', [
        'id',
        'thread_id',
        'goal_id',
        'agent_id',
        'started_at',
        'ended_at',
        'created_at',
        'updated_at',
      ])
    )
  }

  private visibleGoal(threadId: string): VisibleGoalRow | null {
    if (!this.hasTable('thread_goals')) return null
    return this.db.sqlite
      .query('SELECT * FROM thread_goals WHERE thread_id = ?')
      .get(threadId) as VisibleGoalRow | null
  }

  /**
   * Records measured usage idempotently. The primary key is
   * `(goal_id, source_kind, source_entry_id)`, so a replayed terminal transition,
   * a restart, or a duplicate measurement can never bill the same entry twice.
   */
  recordUsage(entries: readonly GoalUsageEntry[]): number {
    if (entries.length === 0 || !this.hasTable('thread_goal_usage_ledger')) return 0
    const timestamp = this.now()
    const insert = this.db.sqlite.query(`
      INSERT INTO thread_goal_usage_ledger (thread_id, goal_id, source_kind, source_entry_id, agent_id,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, created_at)
      VALUES (?, ?, 'item-usage', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(goal_id, source_kind, source_entry_id) DO NOTHING
    `)
    let inserted = 0
    for (const entry of entries) {
      const result = insert.run(
        entry.threadId,
        entry.goalId,
        entry.sourceEntryId,
        entry.agentId,
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheWriteTokens,
        entry.reasoningTokens,
        timestamp,
      )
      inserted += result.changes
    }
    return inserted
  }

  /**
   * Measured usage for a turn's agent tree, restricted to entries created after the
   * goal took effect. Descendants are reached through `parent_agent_id`, which
   * crosses into child threads, so every subagent level is included exactly once.
   */
  measuredUsageForTurn(input: {
    threadId: string
    goalId: string
    since: number
    turnId: string
  }): GoalUsageEntry[] {
    if (!this.hasTable('thread_goal_usage_ledger')) return []
    const rows = this.db.sqlite
      .query(
        `
      WITH RECURSIVE agent_tree(id) AS (
        SELECT root_agent_id FROM turns WHERE id = ? AND root_agent_id IS NOT NULL
        UNION ALL
        SELECT child.id FROM agent_executions AS child
        JOIN agent_tree AS parent ON child.parent_agent_id = parent.id
      )
      SELECT tree.id AS agent_id, item.id AS item_id, item.data AS data
      FROM agent_tree AS tree
      JOIN items AS item ON item.agent_id = tree.id
      WHERE item.type = 'text'
        AND json_type(item.data, '$.usage') = 'object'
        AND item.created_at >= ?
    `,
      )
      .all(input.turnId, input.since) as Array<{ agent_id: string; item_id: string; data: string }>

    const entries: GoalUsageEntry[] = []
    for (const row of rows) {
      let usage: Record<string, unknown> | null = null
      try {
        const parsed = JSON.parse(row.data) as { usage?: unknown }
        usage =
          parsed.usage && typeof parsed.usage === 'object'
            ? (parsed.usage as Record<string, unknown>)
            : null
      } catch {
        usage = null
      }
      if (!usage) continue
      const entry: GoalUsageEntry = {
        threadId: input.threadId,
        goalId: input.goalId,
        agentId: String(row.agent_id),
        sourceEntryId: String(row.item_id),
        inputTokens: token(usage.input),
        outputTokens: token(usage.output),
        cacheReadTokens: token(usage.cacheRead),
        cacheWriteTokens: token(usage.cacheWrite),
        reasoningTokens: token(usage.reasoning),
      }
      if (
        entry.inputTokens +
          entry.outputTokens +
          entry.cacheReadTokens +
          entry.cacheWriteTokens +
          entry.reasoningTokens ===
        0
      )
        continue
      entries.push(entry)
    }
    return entries
  }

  /** Opens a run interval for an agent, if the thread has a visible goal. */
  openInterval(input: { threadId: string; agentId: string }): string | null {
    if (!this.available()) return null
    const goal = this.visibleGoal(input.threadId)
    if (!goal) return null
    const open = this.db.sqlite
      .query('SELECT id FROM thread_goal_active_intervals WHERE agent_id = ? AND ended_at IS NULL')
      .get(input.agentId)
    if (open) return null
    const timestamp = this.now()
    const id = randomUUID()
    this.db.sqlite
      .query(
        `
      INSERT INTO thread_goal_active_intervals (id, thread_id, goal_id, agent_id, started_at, ended_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `,
      )
      .run(id, input.threadId, goal.id, input.agentId, timestamp, timestamp, timestamp)
    return id
  }

  /** Closes every open interval for an agent; an agent runs for one goal at a time. */
  closeAgentIntervals(agentId: string, endedAt = this.now()): number {
    if (!this.hasTable('thread_goal_active_intervals')) return 0
    return this.db.sqlite
      .query(
        'UPDATE thread_goal_active_intervals SET ended_at = ?, updated_at = ? WHERE agent_id = ? AND ended_at IS NULL',
      )
      .run(endedAt, endedAt, agentId).changes
  }

  /**
   * Closes intervals left open by a crash. Recovery calls this before any execution
   * resumes, so wall time spent while the application was offline is never counted.
   */
  closeOpenIntervals(endedAt = this.now()): number {
    if (!this.hasTable('thread_goal_active_intervals')) return 0
    return this.db.sqlite
      .query(
        'UPDATE thread_goal_active_intervals SET ended_at = ?, updated_at = ? WHERE ended_at IS NULL',
      )
      .run(endedAt, endedAt).changes
  }

  /** Tokens billed to a goal. Reasoning stays in the ledger for audit but is not billed. */
  tokensUsed(goalId: string): number {
    if (!this.hasTable('thread_goal_usage_ledger')) return 0
    const row = this.db.sqlite
      .query(
        `
      SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS total
      FROM thread_goal_usage_ledger WHERE goal_id = ?
    `,
      )
      .get(goalId) as { total: number }
    return Number(row.total)
  }

  /** Wall-clock seconds as the union of run intervals, so parallel agents are not double counted. */
  timeUsedSeconds(goalId: string): number {
    if (!this.hasTable('thread_goal_active_intervals')) return 0
    const rows = this.db.sqlite
      .query(
        `
      SELECT started_at, ended_at FROM thread_goal_active_intervals
      WHERE goal_id = ? AND ended_at IS NOT NULL ORDER BY started_at, ended_at
    `,
      )
      .all(goalId) as Array<{ started_at: number; ended_at: number }>
    let total = 0
    let currentStart: number | null = null
    let currentEnd = 0
    for (const row of rows) {
      const start = Number(row.started_at)
      const end = Math.max(start, Number(row.ended_at))
      if (currentStart === null) {
        currentStart = start
        currentEnd = end
        continue
      }
      if (start <= currentEnd) {
        currentEnd = Math.max(currentEnd, end)
        continue
      }
      total += currentEnd - currentStart
      currentStart = start
      currentEnd = end
    }
    if (currentStart !== null) total += currentEnd - currentStart
    return Math.floor(total / 1000)
  }

  /**
   * Accounts one terminal turn for an already-validated goal: records measured usage
   * (idempotently) and refreshes totals, derived status and the goal event. Must run
   * inside the caller's transaction so all of it commits together.
   */
  measureTurnForGoal(input: {
    threadId: string
    turnId: string
    goal: { id: string; createdAt: number }
  }): GoalMeasurement | null {
    if (!this.available()) return null
    this.recordUsage(
      this.measuredUsageForTurn({
        threadId: input.threadId,
        goalId: input.goal.id,
        since: input.goal.createdAt,
        turnId: input.turnId,
      }),
    )
    return this.refreshMeasurement(input.threadId)
  }

  /**
   * Recomputes totals and the machine-managed status band, then emits the goal update.
   * Must run inside the caller's transaction so ledger, totals, status and event commit together.
   */
  refreshMeasurement(threadId: string): GoalMeasurement | null {
    if (!this.available()) return null
    const goal = this.visibleGoal(threadId)
    if (!goal) return null
    const tokensUsed = this.tokensUsed(goal.id)
    const timeUsedSeconds = this.timeUsedSeconds(goal.id)
    const status = this.deriveStatus(goal, tokensUsed)
    // A turn that changed nothing measurable must not bump the version or emit an event.
    if (
      tokensUsed === goal.tokens_used &&
      timeUsedSeconds === goal.time_used_seconds &&
      status === goal.status
    )
      return null
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `
      UPDATE thread_goals SET tokens_used = ?, time_used_seconds = ?, status = ?,
        version = version + 1, updated_at = ? WHERE id = ?
    `,
      )
      .run(tokensUsed, timeUsedSeconds, status, timestamp, goal.id)

    const updated: ThreadGoal = {
      id: goal.id,
      threadId: goal.thread_id,
      objective: goal.objective,
      status,
      tokenBudget: goal.token_budget,
      tokensUsed,
      timeUsedSeconds,
      version: goal.version + 1,
      createdAt: goal.created_at,
      updatedAt: timestamp,
      completedAt: goal.completed_at,
    }
    const event = this.db.insertEvent(threadId, null, 'thread/goal/updated', {
      threadId,
      goal: updated,
      version: updated.version,
    })
    return { goal: updated, event }
  }

  /**
   * Only the machine-managed band is derived: an explicit `paused`/`complete`, or the
   * approval and quota states owned by other subsystems, is never overwritten here.
   */
  private deriveStatus(goal: VisibleGoalRow, tokensUsed: number): ThreadGoalStatus {
    if (goal.status !== 'active' && goal.status !== 'budget-limited') return goal.status
    if (goal.token_budget !== null && tokensUsed >= goal.token_budget) return 'budget-limited'
    return 'active'
  }
}
