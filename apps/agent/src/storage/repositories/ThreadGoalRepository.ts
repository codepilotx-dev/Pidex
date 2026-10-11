import { createHash, randomUUID } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { Schema } from 'effect'
import { ThreadGoalSchema, type ThreadGoal, type ThreadGoalStatus } from '@pidex/shared/thread'
import type { RepositoryDatabase } from './RepositoryDatabase'

const THREAD_GOAL_OPERATIONS_SCHEMA = [
  `CREATE TABLE thread_goal_operations (
    operation_id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
] as const

/** Schema 45 shape, retained so the 44 → 45 step stays reproducible. */
export const THREAD_GOAL_SCHEMA_V45 = [
  `CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
    objective TEXT NOT NULL CHECK(length(objective) BETWEEN 1 AND 4000),
    status TEXT NOT NULL CHECK(status IN ('active','paused','blocked','usage-limited','budget-limited','complete')),
    token_budget INTEGER CHECK(token_budget IS NULL OR token_budget >= 0),
    tokens_used INTEGER NOT NULL DEFAULT 0 CHECK(tokens_used >= 0),
    time_used_seconds INTEGER NOT NULL DEFAULT 0 CHECK(time_used_seconds >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    cleared_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  ...THREAD_GOAL_OPERATIONS_SCHEMA,
] as const

/**
 * Schema 46 shape. Each goal instance has a stable `id`, and clearing moves the
 * row into `thread_goal_history` so a replacement goal never inherits the
 * previous goal's consumption or creation time.
 */
const THREAD_GOALS_TABLE_V46 = `CREATE TABLE thread_goals (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
    objective TEXT NOT NULL CHECK(length(objective) BETWEEN 1 AND 4000),
    status TEXT NOT NULL CHECK(status IN ('active','paused','blocked','usage-limited','budget-limited','complete')),
    token_budget INTEGER CHECK(token_budget IS NULL OR token_budget >= 0),
    tokens_used INTEGER NOT NULL DEFAULT 0 CHECK(tokens_used >= 0),
    time_used_seconds INTEGER NOT NULL DEFAULT 0 CHECK(time_used_seconds >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`

const THREAD_GOAL_HISTORY_SCHEMA = [
  `CREATE TABLE thread_goal_history (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    token_budget INTEGER,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    time_used_seconds INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL,
    completed_at INTEGER,
    cleared_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX thread_goal_history_thread ON thread_goal_history(thread_id, cleared_at DESC, id)',
] as const

export const THREAD_GOAL_SCHEMA = [
  THREAD_GOALS_TABLE_V46,
  ...THREAD_GOAL_HISTORY_SCHEMA,
  ...THREAD_GOAL_OPERATIONS_SCHEMA,
] as const

type LegacyGoalRow = {
  thread_id: string
  objective: string
  status: string
  token_budget: number | null
  tokens_used: number
  time_used_seconds: number
  version: number
  cleared_at: number | null
  created_at: number
  updated_at: number
}

const createIfMissing = (statements: readonly string[]) =>
  statements
    .map((statement) =>
      statement
        .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '),
    )
    .join(';\n')

/**
 * Deterministic id derived from the surviving identity columns, so re-running the
 * backfill over the same row can never mint a second identity for one goal.
 */
const legacyGoalId = (row: LegacyGoalRow) =>
  createHash('sha256')
    .update([row.thread_id, String(row.created_at), String(row.version)].join('\0'), 'utf8')
    .digest('hex')

/** Backfills schema 45 goals into the schema 46 identity + history shape. */
export const migrateThreadGoals45To46 = (sqlite: Database) => {
  const columns = new Set(
    (sqlite.query('PRAGMA table_info(thread_goals)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
  // A store that already carries the identity shape (for example a current database
  // whose user_version was rolled back) has nothing to backfill.
  const isLegacyShape = columns.has('cleared_at') && !columns.has('id')
  if (!isLegacyShape) {
    sqlite.exec(createIfMissing(THREAD_GOAL_SCHEMA))
    return
  }
  const legacy = sqlite
    .query(
      `
    SELECT thread_id, objective, status, token_budget, tokens_used, time_used_seconds,
      version, cleared_at, created_at, updated_at
    FROM thread_goals
  `,
    )
    .all() as LegacyGoalRow[]
  // Rows are held in memory because the table is dropped rather than renamed: a
  // rename reparses every schema object, which fails on stores that predate the
  // threads workspace columns while still carrying the workspace validation trigger.
  sqlite.exec('DROP TABLE thread_goals')
  sqlite.exec(createIfMissing(THREAD_GOAL_SCHEMA))
  const insertGoal = sqlite.query(`
    INSERT INTO thread_goals (id, thread_id, objective, status, token_budget, tokens_used,
      time_used_seconds, version, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertHistory = sqlite.query(`
    INSERT INTO thread_goal_history (id, thread_id, objective, status, token_budget, tokens_used,
      time_used_seconds, version, completed_at, cleared_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of legacy) {
    const id = legacyGoalId(row)
    const completedAt = row.status === 'complete' ? row.updated_at : null
    if (row.cleared_at == null) {
      insertGoal.run(
        id,
        row.thread_id,
        row.objective,
        row.status,
        row.token_budget,
        row.tokens_used,
        row.time_used_seconds,
        row.version,
        completedAt,
        row.created_at,
        row.updated_at,
      )
    } else {
      insertHistory.run(
        id,
        row.thread_id,
        row.objective,
        row.status,
        row.token_budget,
        row.tokens_used,
        row.time_used_seconds,
        row.version,
        completedAt,
        row.cleared_at,
        row.created_at,
        row.updated_at,
      )
    }
  }
}

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(stringify(value), 'utf8').digest('hex')

const isStoredGoal = Schema.is(ThreadGoalSchema)

/** Columns this build requires on `thread_goals` to treat the store as schema 46. */
const THREAD_GOALS_REQUIRED_COLUMNS = [
  'id',
  'thread_id',
  'objective',
  'status',
  'token_budget',
  'tokens_used',
  'time_used_seconds',
  'version',
  'completed_at',
  'created_at',
  'updated_at',
] as const

/** Columns this build writes into `thread_goal_history` when archiving a cleared goal. */
const THREAD_GOAL_HISTORY_REQUIRED_COLUMNS = ['id', 'thread_id', 'cleared_at'] as const

/** Columns this build reads from the idempotent-mutation replay log. */
const THREAD_GOAL_OPERATIONS_REQUIRED_COLUMNS = [
  'operation_id',
  'method',
  'request_hash',
  'result',
] as const

const tableColumns = (sqlite: Database, table: string): Set<string> =>
  new Set(
    (sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )

type GoalRow = {
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

type HistoryRow = GoalRow & { cleared_at: number }

export type ArchivedThreadGoal = ThreadGoal & { clearedAt: number }

const goalRecord = (row: GoalRow): ThreadGoal => ({
  id: row.id,
  threadId: row.thread_id,
  objective: row.objective,
  status: row.status,
  tokenBudget: row.token_budget,
  tokensUsed: row.tokens_used,
  timeUsedSeconds: row.time_used_seconds,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
})

/** Only the history connection is touched; narrowing keeps this usable from any repository layer. */
export type ThreadGoalDatabase = Pick<RepositoryDatabase, 'sqlite'>

export class ThreadGoalRepository {
  constructor(
    private readonly db: ThreadGoalDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  /** Reads only need the goal tables; a missing replay log does not hide existing goals. */
  private hasGoalsTable(): boolean {
    return this.hasTable('thread_goals')
  }

  /**
   * Full read+write support. All three schema 46 objects must exist with the columns
   * this build reads and writes, so a partial or newer unknown shape never advertises
   * `thread.goal.v1` nor accepts mutations it cannot replay idempotently.
   */
  available(): boolean {
    if (
      !this.hasTable('thread_goals') ||
      !this.hasTable('thread_goal_history') ||
      !this.hasTable('thread_goal_operations')
    )
      return false
    const goals = tableColumns(this.db.sqlite, 'thread_goals')
    const history = tableColumns(this.db.sqlite, 'thread_goal_history')
    const operations = tableColumns(this.db.sqlite, 'thread_goal_operations')
    return (
      THREAD_GOALS_REQUIRED_COLUMNS.every((column) => goals.has(column)) &&
      THREAD_GOAL_HISTORY_REQUIRED_COLUMNS.every((column) => history.has(column)) &&
      THREAD_GOAL_OPERATIONS_REQUIRED_COLUMNS.every((column) => operations.has(column))
    )
  }

  /**
   * True when every visible goal row conforms to the shared wire schema. Unknown
   * statuses, missing identities, or illegal counts mean a newer or foreign writer
   * owns this store: the capability closes and those rows are omitted from
   * projections instead of breaking `thread/read`.
   */
  visibleGoalsValid(): boolean {
    if (!this.hasGoalsTable()) return false
    const rows = this.db.sqlite.query('SELECT * FROM thread_goals').all() as GoalRow[]
    return rows.every((row) => isStoredGoal(goalRecord(row)))
  }

  /** The single visible goal for a thread; cleared goals live only in history. */
  get(threadId: string): ThreadGoal | null {
    if (!this.hasGoalsTable()) return null
    const row = this.db.sqlite
      .query('SELECT * FROM thread_goals WHERE thread_id = ?')
      .get(threadId) as GoalRow | null
    if (!row) return null
    // Rows written by a newer build may not map onto the shared schema; hide them
    // instead of projecting a goal the client cannot trust.
    const goal = goalRecord(row)
    return isStoredGoal(goal) ? goal : null
  }

  history(threadId: string): ArchivedThreadGoal[] {
    if (!this.hasGoalsTable() || !this.hasTable('thread_goal_history')) return []
    return (
      this.db.sqlite
        .query('SELECT * FROM thread_goal_history WHERE thread_id = ? ORDER BY cleared_at DESC, id')
        .all(threadId) as HistoryRow[]
    ).flatMap((row) => {
      const goal = goalRecord(row)
      return isStoredGoal(goal) ? [{ ...goal, clearedAt: row.cleared_at }] : []
    })
  }

  /** A row exists but failed validation; the caller must fail closed instead of replacing it blindly. */
  private hasVisibleRow(threadId: string): boolean {
    if (!this.hasGoalsTable()) return false
    return Boolean(
      this.db.sqlite.query('SELECT 1 FROM thread_goals WHERE thread_id = ?').get(threadId),
    )
  }

  /**
   * Creates or updates the visible goal. `expectedVersion` is null when the caller
   * asserts no goal is visible; otherwise it must match the visible version.
   * A create always mints a new identity with zeroed consumption.
   */
  write(input: {
    threadId: string
    objective: string
    status: ThreadGoalStatus
    tokenBudget: number | null
    expectedVersion: number | null
  }): ThreadGoal | null {
    const timestamp = this.now()
    const current = this.get(input.threadId)
    if ((current?.version ?? null) !== input.expectedVersion) return null
    if (!current && this.hasVisibleRow(input.threadId)) return null
    if (current) {
      const completedAt = input.status === 'complete' ? (current.completedAt ?? timestamp) : null
      this.db.sqlite
        .query(
          `
        UPDATE thread_goals
        SET objective = ?, status = ?, token_budget = ?, completed_at = ?,
          version = version + 1, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(input.objective, input.status, input.tokenBudget, completedAt, timestamp, current.id)
    } else {
      this.db.sqlite
        .query(
          `
        INSERT INTO thread_goals (id, thread_id, objective, status, token_budget, version,
          completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `,
        )
        .run(
          randomUUID(),
          input.threadId,
          input.objective,
          input.status,
          input.tokenBudget,
          input.status === 'complete' ? timestamp : null,
          timestamp,
          timestamp,
        )
    }
    return this.get(input.threadId)
  }

  /** Archives the visible goal into history; the next goal starts from zero. */
  clear(
    threadId: string,
    expectedVersion: number | null,
  ): { goalId: string; clearedAt: number } | null {
    const current = this.get(threadId)
    if (!current || current.version !== expectedVersion) return null
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `
      INSERT INTO thread_goal_history (id, thread_id, objective, status, token_budget, tokens_used,
        time_used_seconds, version, completed_at, cleared_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        current.id,
        current.threadId,
        current.objective,
        current.status,
        current.tokenBudget,
        current.tokensUsed,
        current.timeUsedSeconds,
        current.version,
        current.completedAt ?? null,
        timestamp,
        current.createdAt,
        current.updatedAt,
      )
    this.db.sqlite.query('DELETE FROM thread_goals WHERE id = ?').run(current.id)
    return { goalId: current.id, clearedAt: timestamp }
  }

  completedOperation(operationId: string, method: string, request: unknown) {
    if (!this.hasTable('thread_goal_operations')) return null
    const row = this.db.sqlite
      .query(
        'SELECT method, request_hash, result FROM thread_goal_operations WHERE operation_id = ?',
      )
      .get(operationId) as { method: string; request_hash: string; result: string | null } | null
    if (!row) return null
    return {
      matches: row.method === method && row.request_hash === hash(request),
      result: row.result ? parse(row.result) : null,
    }
  }

  recordOperation(operationId: string, method: string, request: unknown, result: unknown) {
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `
      INSERT INTO thread_goal_operations (operation_id, method, request_hash, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(operationId, method, hash(request), stringify(result), timestamp, timestamp)
  }
}
