import type { RepositoryDatabase } from './RepositoryDatabase'

/**
 * Goal control revision and per-turn observation storage. These tables live
 * outside `thread_goals` on purpose: the schema-46 goal table has a hard
 * required-columns gate, so adding columns there would silently downgrade
 * stores that an older build wrote.
 *
 * `revision` is the generation that cancels stale asynchronous work. It is not
 * `thread_goals.version`, which moves on every usage settlement.
 */
export const THREAD_GOAL_CONTROL_SCHEMA = [
  `CREATE TABLE thread_goal_controls (
    goal_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    objective_revision INTEGER NOT NULL DEFAULT 0,
    objective_ack_revision INTEGER NOT NULL DEFAULT 0,
    wrapup_revision INTEGER,
    budget_revision INTEGER NOT NULL DEFAULT 0,
    budget_ack_revision INTEGER NOT NULL DEFAULT 0,
    previous_budget INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX thread_goal_controls_thread ON thread_goal_controls(thread_id)',
  `CREATE TABLE thread_goal_turn_observations (
    goal_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    classification TEXT NOT NULL CHECK(classification IN ('waiting','blocker-candidate','progress','no-progress')),
    blocker_text TEXT,
    blocker_norm TEXT,
    blocker_tool_call_id TEXT,
    processing TEXT NOT NULL DEFAULT 'pending' CHECK(processing IN ('pending','claimed','settled')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (goal_id, revision, turn_id)
  )`,
  'CREATE INDEX thread_goal_turn_observations_pending ON thread_goal_turn_observations(goal_id, revision, processing, created_at)',
  `CREATE TABLE thread_goal_verifications (
    goal_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending','running','pass','fail','error','stale','cancelled','interrupted')),
    model_ref TEXT,
    reason TEXT,
    next_action TEXT,
    continuation TEXT,
    usage_item_id TEXT,
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (goal_id, revision, source_turn_id)
  )`,
] as const

export type GoalTurnClassification = 'waiting' | 'blocker-candidate' | 'progress' | 'no-progress'

export type GoalControlRow = {
  goal_id: string
  thread_id: string
  revision: number
  objective_revision: number
  objective_ack_revision: number
  budget_revision: number
  budget_ack_revision: number
  previous_budget: number | null
  wrapup_revision: number | null
  created_at: number
  updated_at: number
}

export type GoalObservationRow = {
  goal_id: string
  revision: number
  turn_id: string
  thread_id: string
  classification: GoalTurnClassification
  blocker_text: string | null
  blocker_norm: string | null
  blocker_tool_call_id: string | null
  processing: 'pending' | 'claimed' | 'settled'
  created_at: number
  updated_at: number
}

export type GoalVerificationStatus =
  'pending' | 'running' | 'pass' | 'fail' | 'error' | 'stale' | 'cancelled' | 'interrupted'

/**
 * Blocker identity for the consecutive-round gate. Deliberately deterministic:
 * no similarity scoring and no second model. Unicode folding, case folding,
 * punctuation removal and whitespace collapse only.
 */
export function normalizeGoalBlocker(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Consecutive identical blocker rounds required before a goal may be blocked. */
export const GOAL_BLOCKED_THRESHOLD = 3

export class ThreadGoalControlRepository {
  constructor(
    private readonly db: Pick<RepositoryDatabase, 'sqlite'>,
    private readonly now: () => number = Date.now,
  ) {}

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  /** New behaviour only switches on when every extension table is present. */
  available(): boolean {
    return (
      this.hasTable('thread_goal_controls') &&
      this.hasTable('thread_goal_turn_observations') &&
      this.hasTable('thread_goal_verifications')
    )
  }

  /**
   * Idempotently gives a goal its control row. Called on create and on the first
   * use of a goal written by a build that predates this table.
   */
  ensure(goalId: string, threadId: string): GoalControlRow {
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `INSERT INTO thread_goal_controls (goal_id, thread_id, revision, objective_revision,
          objective_ack_revision, wrapup_revision, created_at, updated_at)
         VALUES (?, ?, 1, 0, 0, NULL, ?, ?)
         ON CONFLICT(goal_id) DO NOTHING`,
      )
      .run(goalId, threadId, timestamp, timestamp)
    return this.get(goalId)!
  }

  get(goalId: string): GoalControlRow | null {
    if (!this.available()) return null
    return this.db.sqlite
      .query('SELECT * FROM thread_goal_controls WHERE goal_id = ?')
      .get(goalId) as GoalControlRow | null
  }

  /** Current control revision, or 0 when the goal has no control row yet. */
  revision(goalId: string): number {
    return this.get(goalId)?.revision ?? 0
  }

  /**
   * Advances the control generation. Any user-meaningful change (objective,
   * budget, status, stop, resume, clear) and any terminal internal transition
   * ends the current continuation generation; usage settlement must not.
   */
  bump(
    goalId: string,
    threadId: string,
    options: {
      objectiveChanged?: boolean
      budgetChanged?: boolean
      previousBudget?: number | null
    } = {},
  ): GoalControlRow {
    const timestamp = this.now()
    this.ensure(goalId, threadId)
    this.db.sqlite
      .query(
        `UPDATE thread_goal_controls
         SET revision = revision + 1,
           objective_revision = objective_revision + ?,
           budget_revision = budget_revision + ?,
           previous_budget = CASE WHEN ? THEN ? ELSE previous_budget END,
           wrapup_revision = NULL,
           updated_at = ?
         WHERE goal_id = ?`,
      )
      .run(
        options.objectiveChanged ? 1 : 0,
        options.budgetChanged ? 1 : 0,
        options.budgetChanged ? 1 : 0,
        options.previousBudget ?? null,
        timestamp,
        goalId,
      )
    return this.get(goalId)!
  }

  /** Marks the objective revision the model has actually consumed. */
  acknowledgeObjective(goalId: string, revision: number): void {
    this.db.sqlite
      .query(
        `UPDATE thread_goal_controls SET objective_ack_revision = MAX(objective_ack_revision, ?),
           updated_at = ? WHERE goal_id = ?`,
      )
      .run(revision, this.now(), goalId)
  }

  pendingBudgetForThread(threadId: string): number | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query(
        `SELECT control.budget_revision AS revision FROM thread_goal_controls AS control
      JOIN thread_goals AS goal ON goal.id = control.goal_id WHERE goal.thread_id = ? AND goal.status = 'active'
      AND control.budget_revision > control.budget_ack_revision`,
      )
      .get(threadId) as { revision: number } | null
    return row?.revision ?? null
  }

  acknowledgeBudget(goalId: string, revision: number): void {
    this.db.sqlite
      .query(
        'UPDATE thread_goal_controls SET budget_ack_revision = MAX(budget_ack_revision, ?), updated_at = ? WHERE goal_id = ?',
      )
      .run(revision, this.now(), goalId)
  }

  /** Claims the single wrap-up request allowed per control revision. */
  claimWrapup(goalId: string, revision: number): boolean {
    if (!this.available()) return false
    return (
      this.db.sqlite
        .query(
          `UPDATE thread_goal_controls SET wrapup_revision = ?, updated_at = ?
           WHERE goal_id = ? AND revision = ?
             AND (wrapup_revision IS NULL OR wrapup_revision <> ?)`,
        )
        .run(revision, this.now(), goalId, revision, revision).changes > 0
    )
  }

  observation(goalId: string, revision: number, turnId: string): GoalObservationRow | null {
    if (!this.available()) return null
    return this.db.sqlite
      .query(
        'SELECT * FROM thread_goal_turn_observations WHERE goal_id = ? AND revision = ? AND turn_id = ?',
      )
      .get(goalId, revision, turnId) as GoalObservationRow | null
  }

  /**
   * The observation this turn already has, whatever revision wrote it. A turn can
   * register its blocker before a terminal transition bumps the control revision,
   * and settlement must land on that same row or the candidate would stay
   * pending forever.
   */
  observationForTurn(goalId: string, turnId: string): GoalObservationRow | null {
    if (!this.available()) return null
    return this.db.sqlite
      .query(
        'SELECT * FROM thread_goal_turn_observations WHERE goal_id = ? AND turn_id = ? ORDER BY revision DESC LIMIT 1',
      )
      .get(goalId, turnId) as GoalObservationRow | null
  }

  /**
   * Records the blocker the model submitted in this turn. The unique key keeps
   * one blocker per turn: a retry with the same text is a no-op, a different
   * text does not overwrite the first record.
   */
  recordBlocker(input: {
    goalId: string
    revision: number
    threadId: string
    turnId: string
    blockerText: string
    blockerNorm: string
    toolCallId: string
  }): { observation: GoalObservationRow; created: boolean } {
    const timestamp = this.now()
    const inserted = this.db.sqlite
      .query(
        `INSERT INTO thread_goal_turn_observations (goal_id, revision, turn_id, thread_id,
          classification, blocker_text, blocker_norm, blocker_tool_call_id, processing,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, 'blocker-candidate', ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(goal_id, revision, turn_id) DO NOTHING`,
      )
      .run(
        input.goalId,
        input.revision,
        input.turnId,
        input.threadId,
        input.blockerText,
        input.blockerNorm,
        input.toolCallId,
        timestamp,
        timestamp,
      )
    return {
      observation: this.observation(input.goalId, input.revision, input.turnId)!,
      created: inserted.changes > 0,
    }
  }

  /** Settles the turn classification from host facts; the unique key keeps one row per turn. */
  settleTurn(input: {
    goalId: string
    revision: number
    threadId: string
    turnId: string
    classification: GoalTurnClassification
    processing?: 'pending' | 'settled'
  }): void {
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `INSERT INTO thread_goal_turn_observations (goal_id, revision, turn_id, thread_id,
          classification, blocker_text, blocker_norm, blocker_tool_call_id, processing,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
         ON CONFLICT(goal_id, revision, turn_id) DO UPDATE SET
           classification = excluded.classification,
           processing = excluded.processing,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.goalId,
        input.revision,
        input.turnId,
        input.threadId,
        input.classification,
        input.processing ?? 'settled',
        timestamp,
        timestamp,
      )
  }

  /**
   * Settled rounds immediately preceding this turn, newest last. The window is
   * the threshold minus the current round; ordering uses turn insertion order
   * rather than timestamps, which can tie.
   */
  previousSettled(
    goalId: string,
    revision: number,
    excludeTurnId: string,
    limit = GOAL_BLOCKED_THRESHOLD - 1,
  ): GoalObservationRow[] {
    if (!this.available()) return []
    const rows = this.db.sqlite
      .query(
        `SELECT observation.* FROM thread_goal_turn_observations AS observation
         JOIN turns ON turns.id = observation.turn_id
         WHERE observation.goal_id = ? AND observation.revision = ?
           AND turns.status = 'completed' AND observation.turn_id <> ?
           AND turns.rowid < (SELECT rowid FROM turns WHERE id = ?)
         ORDER BY turns.rowid DESC LIMIT ?`,
      )
      .all(goalId, revision, excludeTurnId, excludeTurnId, limit) as GoalObservationRow[]
    return rows.reverse()
  }

  /** Unsettled observations handed to the continuation coordinator. */
  pending(goalId: string, revision: number, limit = 20): GoalObservationRow[] {
    if (!this.available()) return []
    return this.db.sqlite
      .query(
        `SELECT observation.* FROM thread_goal_turn_observations AS observation
         JOIN turns ON turns.id = observation.turn_id
         WHERE observation.goal_id = ? AND observation.revision = ?
           AND observation.processing = 'pending'
         ORDER BY turns.rowid ASC LIMIT ?`,
      )
      .all(goalId, revision, limit) as GoalObservationRow[]
  }

  markProcessing(
    goalId: string,
    revision: number,
    turnId: string,
    processing: 'claimed' | 'settled',
  ): void {
    this.db.sqlite
      .query(
        `UPDATE thread_goal_turn_observations SET processing = ?, updated_at = ?
         WHERE goal_id = ? AND revision = ? AND turn_id = ?`,
      )
      .run(processing, this.now(), goalId, revision, turnId)
  }

  claimObservation(goalId: string, revision: number, turnId: string): boolean {
    return (
      this.db.sqlite
        .query(
          `UPDATE thread_goal_turn_observations SET processing = 'claimed', updated_at = ?
      WHERE goal_id = ? AND revision = ? AND turn_id = ? AND processing = 'pending'`,
        )
        .run(this.now(), goalId, revision, turnId).changes > 0
    )
  }

  recoverObservations(): void {
    if (!this.available()) return
    this.db.sqlite
      .query(
        `UPDATE thread_goal_turn_observations SET processing = 'pending'
      WHERE processing = 'claimed' AND turn_id IN (SELECT turns.id FROM turns WHERE status = 'completed' OR (status = 'interrupted' AND EXISTS (SELECT 1 FROM agent_executions WHERE id = turns.root_agent_id AND error = 'budget-limited')))`,
      )
      .run()
    // Repair observations settled by the earlier implementation before any decision was recorded.
    if (this.hasTable('thread_goal_continuations'))
      this.db.sqlite
        .query(
          `UPDATE thread_goal_turn_observations AS observation SET processing = 'pending'
      WHERE processing = 'settled'
        AND EXISTS (SELECT 1 FROM thread_goals AS goal JOIN thread_goal_controls AS control ON control.goal_id = goal.id
          WHERE goal.id = observation.goal_id AND goal.status = 'active' AND control.revision = observation.revision)
        AND EXISTS (SELECT 1 FROM turns AS source WHERE source.id = observation.turn_id AND source.status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM turns AS newer WHERE newer.thread_id = source.thread_id AND newer.rowid > source.rowid))
        AND NOT EXISTS (SELECT 1 FROM thread_goal_continuations WHERE source_turn_id = observation.turn_id)`,
        )
        .run()
  }

  pendingSettlements(): Array<{ threadId: string; turnId: string }> {
    if (!this.available()) return []
    return this.db.sqlite
      .query(
        `SELECT observation.thread_id AS threadId, observation.turn_id AS turnId
      FROM thread_goal_turn_observations AS observation
      JOIN turns ON turns.id = observation.turn_id AND (turns.status = 'completed' OR (turns.status = 'interrupted' AND EXISTS (SELECT 1 FROM agent_executions WHERE id = turns.root_agent_id AND error = 'budget-limited')))
      JOIN thread_goals AS goal ON goal.id = observation.goal_id AND goal.status = 'active'
      JOIN thread_goal_controls AS control ON control.goal_id = goal.id AND control.revision = observation.revision
      WHERE observation.processing = 'pending' ORDER BY turns.rowid`,
      )
      .all() as Array<{ threadId: string; turnId: string }>
  }

  ownsTurn(threadId: string, turnId: string): boolean {
    return Boolean(
      this.db.sqlite
        .query('SELECT 1 FROM turns WHERE id = ? AND thread_id = ?')
        .get(turnId, threadId),
    )
  }

  eligible(input: {
    threadId: string
    turnId: string
    goalId: string
    revision: number
    allowStopped?: boolean
  }): boolean {
    return Boolean(
      this.db.sqlite
        .query(
          `SELECT 1 FROM turns AS source
      JOIN threads ON threads.id = source.thread_id
      JOIN thread_goals AS goal ON goal.thread_id = threads.id
      JOIN thread_goal_controls AS control ON control.goal_id = goal.id
      WHERE source.id = ? AND source.thread_id = ? AND (source.status = 'completed' OR (source.status = 'interrupted' AND EXISTS (SELECT 1 FROM agent_executions WHERE id = source.root_agent_id AND error = 'budget-limited')) OR (? AND source.status IN ('failed','interrupted')))
        AND goal.id = ? AND (goal.status = 'active' OR (? AND goal.status IN ('paused','blocked','budget-limited','usage-limited'))) AND control.revision = ?
        AND threads.archived_at IS NULL AND (threads.queue_pause_reason IS NULL OR ?)
        AND NOT EXISTS (SELECT 1 FROM turns AS newer WHERE newer.thread_id = source.thread_id AND newer.rowid > source.rowid)
        AND NOT EXISTS (SELECT 1 FROM turns AS active WHERE active.thread_id = source.thread_id
          AND active.status IN ('queued','running','waiting_permission','waiting_question','waiting_subagents'))`,
        )
        .get(
          input.turnId,
          input.threadId,
          input.allowStopped ? 1 : 0,
          input.goalId,
          input.allowStopped ? 1 : 0,
          input.revision,
          input.allowStopped ? 1 : 0,
        ),
    )
  }

  progressEvidence(
    turnId: string,
  ): Array<{ current: number; type: string; status: string; data: string }> {
    return this.db.sqlite
      .query(
        `SELECT item.turn_id = ? AS current, item.type, item.status, item.data
      FROM items AS item JOIN turns ON turns.id = item.turn_id
      JOIN thread_goals AS goal ON goal.thread_id = turns.thread_id
      WHERE turns.thread_id = (SELECT thread_id FROM turns WHERE id = ?)
        AND turns.rowid <= (SELECT rowid FROM turns WHERE id = ?)
        AND (turns.id = ? OR turns.created_at >= goal.created_at OR EXISTS (
          SELECT 1 FROM thread_goal_turn_observations AS observation
          WHERE observation.goal_id = goal.id AND observation.turn_id = turns.id
        )) AND item.type IN ('tool','patch')
      ORDER BY turns.rowid DESC, item.ordinal DESC`,
      )
      .all(turnId, turnId, turnId, turnId) as Array<{
      current: number
      type: string
      status: string
      data: string
    }>
  }

  latestGoalTurn(threadId: string): { id: string } | null {
    // A queued Turn can predate its Goal; settled host observations bind that first Turn.
    return this.db.sqlite
      .query(
        `SELECT turns.id FROM turns JOIN thread_goals AS goal ON goal.thread_id = turns.thread_id
      WHERE turns.thread_id = ? AND (turns.created_at >= goal.created_at OR EXISTS (
        SELECT 1 FROM thread_goal_turn_observations AS observation
        WHERE observation.goal_id = goal.id AND observation.turn_id = turns.id
      )) ORDER BY turns.rowid DESC LIMIT 1`,
      )
      .get(threadId) as { id: string } | null
  }

  verifierEvidence(input: {
    threadId: string
    goalId: string
    turnId: string
  }): Array<{ type: string; status: string; data: unknown; turnId: string; current: boolean }> {
    const rows = this.db.sqlite
      .query(
        `SELECT item.turn_id AS turnId, item.type, item.status, item.data FROM items AS item
      JOIN turns ON turns.id = item.turn_id JOIN thread_goals AS goal ON goal.thread_id = turns.thread_id
      WHERE turns.thread_id = ? AND goal.id = ? AND turns.rowid <= (SELECT rowid FROM turns WHERE id = ?)
        AND (turns.created_at >= goal.created_at OR EXISTS (
          SELECT 1 FROM thread_goal_turn_observations AS observation
          WHERE observation.goal_id = goal.id AND observation.turn_id = turns.id
        )) AND item.type IN ('tool','text','execution-plan','plan','patch')
      ORDER BY turns.rowid DESC, item.ordinal DESC LIMIT 100`,
      )
      .all(input.threadId, input.goalId, input.turnId) as Array<{
      type: string
      status: string
      data: string
      turnId: string
    }>
    return rows.reverse().map((row) => ({
      ...row,
      current: row.turnId === input.turnId,
      data: JSON.parse(row.data) as unknown,
    }))
  }

  verification(goalId: string, revision: number, sourceTurnId: string) {
    if (!this.available()) return null
    return this.db.sqlite
      .query(
        'SELECT * FROM thread_goal_verifications WHERE goal_id = ? AND revision = ? AND source_turn_id = ?',
      )
      .get(goalId, revision, sourceTurnId) as {
      goal_id: string
      revision: number
      source_turn_id: string
      status: GoalVerificationStatus
      reason: string | null
      next_action: string | null
      continuation: 'work' | 'external-input' | 'no-progress' | null
      error_code: string | null
    } | null
  }

  carryBudgetReview(goalId: string, fromRevision: number, toRevision: number): void {
    this.db.sqlite
      .query(
        `INSERT INTO thread_goal_verifications
      (goal_id, revision, source_turn_id, thread_id, status, model_ref, reason, next_action, continuation, usage_item_id, error_code, created_at, updated_at)
      SELECT goal_id, ?, source_turn_id, thread_id, status, model_ref, reason, next_action, continuation, usage_item_id, error_code, created_at, ?
      FROM thread_goal_verifications WHERE goal_id = ? AND revision = ? AND status = 'fail'
      ON CONFLICT(goal_id, revision, source_turn_id) DO NOTHING`,
      )
      .run(toRevision, this.now(), goalId, fromRevision)
  }

  attachVerificationUsage(
    goalId: string,
    revision: number,
    sourceTurnId: string,
    itemId: string,
  ): void {
    this.db.sqlite
      .query(
        `UPDATE thread_goal_verifications SET usage_item_id = ?
      WHERE goal_id = ? AND revision = ? AND source_turn_id = ?`,
      )
      .run(itemId, goalId, revision, sourceTurnId)
  }

  /** One verification attempt per source turn; the unique key is the concurrency guard. */
  claimVerification(input: {
    goalId: string
    revision: number
    sourceTurnId: string
    threadId: string
    modelRef: string
  }): boolean {
    if (!this.available()) return false
    const timestamp = this.now()
    return (
      this.db.sqlite
        .query(
          `INSERT INTO thread_goal_verifications (goal_id, revision, source_turn_id, thread_id,
            status, model_ref, reason, next_action, usage_item_id, error_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(goal_id, revision, source_turn_id) DO NOTHING`,
        )
        .run(
          input.goalId,
          input.revision,
          input.sourceTurnId,
          input.threadId,
          input.modelRef,
          timestamp,
          timestamp,
        ).changes > 0
    )
  }

  finishVerification(input: {
    goalId: string
    revision: number
    sourceTurnId: string
    status: GoalVerificationStatus
    reason?: string | null
    nextAction?: string | null
    continuation?: string | null
    usageItemId?: string | null
    errorCode?: string | null
  }): void {
    this.db.sqlite
      .query(
        `UPDATE thread_goal_verifications
         SET status = ?, reason = ?, next_action = ?, usage_item_id = COALESCE(?, usage_item_id),
           error_code = ?, continuation = ?, updated_at = ?
         WHERE goal_id = ? AND revision = ? AND source_turn_id = ?`,
      )
      .run(
        input.status,
        input.reason ?? null,
        input.nextAction ?? null,
        input.usageItemId ?? null,
        input.errorCode ?? null,
        input.continuation ?? null,
        this.now(),
        input.goalId,
        input.revision,
        input.sourceTurnId,
      )
  }

  /** Verifications left `running` by a crash are audited, never re-sent. */
  interruptRunning(): number {
    if (!this.available()) return 0
    const timestamp = this.now()
    return this.db.sqlite
      .query(
        `UPDATE thread_goal_verifications SET status = 'interrupted', updated_at = ?
         WHERE status IN ('pending','running')`,
      )
      .run(timestamp).changes
  }
}
