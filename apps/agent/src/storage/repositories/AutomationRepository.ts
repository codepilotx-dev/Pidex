import type { Database } from 'bun:sqlite'
import type {
  Automation,
  AutomationExecution,
  AutomationNotificationPolicy,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationSchedule,
} from '@pidex/shared/automation'
import type { ModelRef } from '@pidex/shared/model'
import type { PermissionConfig } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import { nextAutomationOccurrence } from '../../automation/Schedule'

export type AutomationDatabase = {
  sqlite: Database
  profileSqlite?: Database
  transaction<T>(work: () => T): T
}

type AutomationRow = {
  id: string
  revision: number
  kind: Automation['kind']
  name: string
  prompt: string
  status: Automation['status']
  project_id: string | null
  target_thread_id: string | null
  execution: string | null
  model_ref: string
  reasoning_effort: string | null
  permission_config: string
  schedule: string
  canonical_rrule: string
  time_zone: string
  notification_policy: AutomationNotificationPolicy
  next_run_at: number | null
  pending_catch_up: number
  active_run_id: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

type RunRow = {
  id: string
  automation_id: string
  trigger: AutomationRunTrigger
  scheduled_for: number
  status: AutomationRunStatus
  thread_id: string | null
  turn_id: string | null
  worktree_id: string | null
  read_at: number | null
  safe_error_code: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
}

export type AutomationCreateRecord = Omit<
  Automation,
  | 'revision'
  | 'status'
  | 'nextRunAt'
  | 'pendingCatchUp'
  | 'activeRunId'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
> & {
  nextRunAt: number | null
}

export type AutomationUpdateRecord = Pick<
  Automation,
  | 'name'
  | 'prompt'
  | 'kind'
  | 'projectId'
  | 'targetThreadId'
  | 'execution'
  | 'model'
  | 'reasoningEffort'
  | 'permissionConfig'
  | 'schedule'
  | 'canonicalRrule'
  | 'timeZone'
  | 'notificationPolicy'
> & {
  expectedRevision: number
  status: Exclude<Automation['status'], 'deleted'>
  nextRunAt: number | null
}

const parse = <T>(value: string): T => JSON.parse(value) as T
const automationFromRow = (row: AutomationRow): Automation => ({
  id: row.id,
  revision: row.revision,
  kind: row.kind,
  name: row.name,
  prompt: row.prompt,
  status: row.status,
  projectId: row.project_id,
  targetThreadId: row.target_thread_id,
  execution: row.execution === null ? null : parse<AutomationExecution>(row.execution),
  model: parse<ModelRef>(row.model_ref),
  reasoningEffort: row.reasoning_effort,
  permissionConfig: parse<PermissionConfig>(row.permission_config),
  schedule: parse<AutomationSchedule>(row.schedule),
  canonicalRrule: row.canonical_rrule,
  timeZone: row.time_zone,
  notificationPolicy: row.notification_policy,
  nextRunAt: row.next_run_at,
  pendingCatchUp: row.pending_catch_up === 1,
  activeRunId: row.active_run_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
})
const runFromRow = (row: RunRow): AutomationRun => ({
  id: row.id,
  automationId: row.automation_id,
  trigger: row.trigger,
  scheduledFor: row.scheduled_for,
  status: row.status,
  threadId: row.thread_id,
  turnId: row.turn_id,
  worktreeId: row.worktree_id,
  readAt: row.read_at,
  safeErrorCode: row.safe_error_code,
  createdAt: row.created_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
})

const missing = () => new AgentError('AUTOMATION_NOT_FOUND', '自动化不存在', 404)
const conflict = () => new AgentError('CONFLICT', '自动化版本或运行状态已变化', 409)

export class AutomationRepository {
  constructor(
    private readonly db: AutomationDatabase,
    private readonly id: () => string = crypto.randomUUID,
  ) {}

  list(
    input: {
      statuses?: Automation['status'][]
      query?: string
      limit?: number
      offset?: number
    } = {},
  ) {
    const limit = Math.max(1, Math.min(500, input.limit ?? 100))
    const offset = Math.max(0, input.offset ?? 0)
    const clauses: string[] = []
    const values: Array<string | number> = []
    if (input.statuses?.length) {
      clauses.push(`status IN (${input.statuses.map(() => '?').join(',')})`)
      values.push(...input.statuses)
    } else clauses.push("status != 'deleted'")
    const query = input.query?.trim().toLocaleLowerCase()
    if (query) {
      clauses.push('(LOWER(name) LIKE ? OR LOWER(prompt) LIKE ?)')
      values.push(`%${query}%`, `%${query}%`)
    }
    values.push(limit, offset)
    return (
      this.db.sqlite
        .query(
          `SELECT * FROM automations WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`,
        )
        .all(...values) as AutomationRow[]
    ).map(automationFromRow)
  }

  forThread(threadId: string) {
    const rows = this.db.sqlite
      .query(
        "SELECT id FROM automations WHERE target_thread_id = ? AND kind = 'thread' AND status != 'deleted'",
      )
      .all(threadId) as Array<{ id: string }>
    return rows.flatMap(({ id }) => {
      const value = this.read(id)
      return value ? [value] : []
    })
  }

  read(id: string, includeDeleted = false) {
    const row = this.db.sqlite
      .query(
        `SELECT * FROM automations WHERE id = ? ${includeDeleted ? '' : "AND status != 'deleted'"}`,
      )
      .get(id) as AutomationRow | null
    return row ? automationFromRow(row) : null
  }

  create(input: AutomationCreateRecord, now: number) {
    const existing = this.read(input.id, true)
    if (existing) {
      const equivalent =
        existing.kind === input.kind &&
        existing.name === input.name &&
        existing.prompt === input.prompt &&
        existing.projectId === input.projectId &&
        existing.targetThreadId === input.targetThreadId &&
        JSON.stringify(existing.execution) === JSON.stringify(input.execution) &&
        JSON.stringify(existing.model) === JSON.stringify(input.model) &&
        existing.reasoningEffort === input.reasoningEffort &&
        JSON.stringify(existing.permissionConfig) === JSON.stringify(input.permissionConfig) &&
        JSON.stringify(existing.schedule) === JSON.stringify(input.schedule) &&
        existing.canonicalRrule === input.canonicalRrule &&
        existing.timeZone === input.timeZone &&
        existing.notificationPolicy === input.notificationPolicy
      if (!equivalent)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他自动化创建请求', 409)
      return existing
    }
    this.db.sqlite
      .query(
        `INSERT INTO automations (
      id, revision, kind, name, prompt, status, project_id, target_thread_id, execution, model_ref, reasoning_effort,
      permission_config, schedule, canonical_rrule, time_zone, notification_policy, next_run_at, pending_catch_up,
      active_run_id, created_at, updated_at, deleted_at
    ) VALUES (?, 1, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.kind,
        input.name,
        input.prompt,
        input.projectId,
        input.targetThreadId,
        input.execution === null ? null : JSON.stringify(input.execution),
        JSON.stringify(input.model),
        input.reasoningEffort,
        JSON.stringify(input.permissionConfig),
        JSON.stringify(input.schedule),
        input.canonicalRrule,
        input.timeZone,
        input.notificationPolicy,
        input.nextRunAt,
        now,
        now,
      )
    return this.read(input.id)!
  }

  update(id: string, input: AutomationUpdateRecord, now: number) {
    const result = this.db.sqlite
      .query(
        `UPDATE automations SET
      kind = ?, name = ?, prompt = ?, status = ?, project_id = ?, target_thread_id = ?, execution = ?, model_ref = ?, reasoning_effort = ?,
      permission_config = ?, schedule = ?, canonical_rrule = ?, time_zone = ?, notification_policy = ?, next_run_at = ?,
      revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND status != 'deleted'`,
      )
      .run(
        input.kind,
        input.name,
        input.prompt,
        input.status,
        input.projectId,
        input.targetThreadId,
        input.execution === null ? null : JSON.stringify(input.execution),
        JSON.stringify(input.model),
        input.reasoningEffort,
        JSON.stringify(input.permissionConfig),
        JSON.stringify(input.schedule),
        input.canonicalRrule,
        input.timeZone,
        input.notificationPolicy,
        input.nextRunAt,
        now,
        id,
        input.expectedRevision,
      )
    if (result.changes !== 1) {
      if (!this.read(id, true)) throw missing()
      throw conflict()
    }
    return this.read(id)!
  }

  pause(id: string, expectedRevision: number, now: number) {
    return this.changeStatus(id, expectedRevision, 'paused', null, now)
  }
  resume(id: string, expectedRevision: number, nextRunAt: number | null, now: number) {
    return this.changeStatus(id, expectedRevision, 'active', nextRunAt, now)
  }

  softDelete(id: string, expectedRevision: number, now: number) {
    const result = this.db.sqlite
      .query(
        "UPDATE automations SET status = 'deleted', next_run_at = NULL, pending_catch_up = 0, revision = revision + 1, updated_at = ?, deleted_at = ? WHERE id = ? AND revision = ? AND status != 'deleted'",
      )
      .run(now, now, id, expectedRevision)
    if (result.changes !== 1) {
      if (!this.read(id, true)) throw missing()
      throw conflict()
    }
    return this.read(id, true)!
  }

  nextDeadline() {
    const row = this.db.sqlite
      .query(
        "SELECT MIN(next_run_at) AS deadline FROM automations WHERE status = 'active' AND next_run_at IS NOT NULL",
      )
      .get() as { deadline: number | null }
    return row.deadline
  }

  claimDue(
    now: number,
    trigger: Extract<AutomationRunTrigger, 'scheduled' | 'startup-catch-up'> = 'scheduled',
  ) {
    return this.db.transaction(() => {
      const due = this.db.sqlite
        .query(
          "SELECT * FROM automations WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, id",
        )
        .all(now) as AutomationRow[]
      const claimed: AutomationRun[] = []
      for (const row of due) {
        const automation = automationFromRow(row)
        const nextRunAt = nextAutomationOccurrence(automation.schedule, automation.timeZone, now)
        if (row.active_run_id) {
          this.db.sqlite
            .query(
              'UPDATE automations SET pending_catch_up = 1, next_run_at = ?, updated_at = ? WHERE id = ? AND active_run_id = ?',
            )
            .run(nextRunAt, now, row.id, row.active_run_id)
          continue
        }
        const run = this.insertRun(
          row.id,
          trigger,
          row.next_run_at!,
          `due:${row.id}:${row.next_run_at}`,
          now,
        )
        const changed = this.db.sqlite
          .query(
            "UPDATE automations SET active_run_id = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND active_run_id IS NULL AND status = 'active'",
          )
          .run(run.id, nextRunAt, now, row.id)
        if (changed.changes === 1) claimed.push(run)
        else
          this.db.sqlite
            .query("DELETE FROM automation_runs WHERE id = ? AND status = 'claimed'")
            .run(run.id)
      }
      return claimed
    })
  }

  claimManual(automationId: string, operationId: string, now: number) {
    return this.db.transaction(() => {
      const existing = this.runByOperation(operationId)
      if (existing) {
        if (existing.automationId !== automationId)
          throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他自动化运行', 409)
        return existing
      }
      const automation = this.read(automationId)
      if (!automation) throw missing()
      if (automation.activeRunId) throw new AgentError('CONFLICT', '自动化已有运行中的任务', 409)
      const run = this.insertRun(automationId, 'manual', now, operationId, now)
      const changed = this.db.sqlite
        .query(
          "UPDATE automations SET active_run_id = ?, updated_at = ? WHERE id = ? AND active_run_id IS NULL AND status != 'deleted'",
        )
        .run(run.id, now, automationId)
      if (changed.changes !== 1) throw conflict()
      return run
    })
  }

  markPreparing(runId: string, now: number) {
    return this.changeRunStatus(runId, ['claimed'], 'preparing', now)
  }
  markQueued(runId: string, now: number) {
    return this.changeRunStatus(runId, ['claimed', 'preparing'], 'queued', now)
  }
  markRunning(runId: string, now: number) {
    return this.changeRunStatus(runId, ['claimed', 'preparing', 'queued'], 'running', now)
  }

  bindExecution(
    runId: string,
    binding: { threadId: string; turnId: string | null; worktreeId?: string | null },
    now: number,
  ) {
    const result = this.db.sqlite
      .query(
        "UPDATE automation_runs SET thread_id = ?, turn_id = ?, worktree_id = ?, status = 'queued', started_at = COALESCE(started_at, ?) WHERE id = ? AND status IN ('claimed','preparing','queued')",
      )
      .run(binding.threadId, binding.turnId, binding.worktreeId ?? null, now, runId)
    if (result.changes !== 1) throw conflict()
    return this.readRun(runId)!
  }

  completeRun(
    runId: string,
    status: Extract<AutomationRunStatus, 'completed' | 'failed' | 'interrupted'>,
    now: number,
    safeErrorCode: string | null = null,
  ) {
    return this.db.transaction(() => {
      const current = this.readRun(runId)
      if (!current) throw new AgentError('AUTOMATION_RUN_NOT_FOUND', '自动化运行不存在', 404)
      if (['completed', 'failed', 'interrupted'].includes(current.status))
        return { run: current, catchUpRun: null }
      this.db.sqlite
        .query(
          'UPDATE automation_runs SET status = ?, safe_error_code = ?, completed_at = ?, read_at = NULL WHERE id = ?',
        )
        .run(status, safeErrorCode, now, runId)
      const row = this.db.sqlite
        .query('SELECT * FROM automations WHERE id = ? AND active_run_id = ?')
        .get(current.automationId, runId) as AutomationRow | null
      let catchUpRun: AutomationRun | null = null
      if (row?.status === 'active' && row.pending_catch_up === 1) {
        catchUpRun = this.insertRun(row.id, 'overlap-catch-up', now, `overlap:${runId}`, now)
        this.db.sqlite
          .query(
            'UPDATE automations SET active_run_id = ?, pending_catch_up = 0, updated_at = ? WHERE id = ? AND active_run_id = ?',
          )
          .run(catchUpRun.id, now, row.id, runId)
      } else if (row) {
        this.db.sqlite
          .query(
            'UPDATE automations SET active_run_id = NULL, pending_catch_up = 0, updated_at = ? WHERE id = ? AND active_run_id = ?',
          )
          .run(now, row.id, runId)
      }
      return { run: this.readRun(runId)!, catchUpRun }
    })
  }

  listRuns(
    input: { automationId?: string; unreadOnly?: boolean; limit?: number; offset?: number } = {},
  ) {
    const clauses: string[] = []
    const values: Array<string | number> = []
    if (input.automationId) {
      clauses.push('automation_id = ?')
      values.push(input.automationId)
    }
    if (input.unreadOnly)
      clauses.push("read_at IS NULL AND status IN ('completed','failed','interrupted')")
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    values.push(Math.max(1, Math.min(500, input.limit ?? 100)), Math.max(0, input.offset ?? 0))
    return (
      this.db.sqlite
        .query(
          `SELECT * FROM automation_runs ${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
        )
        .all(...values) as RunRow[]
    ).map(runFromRow)
  }

  listRunsInRange(from: number, to: number, limit = 2_000) {
    return (
      this.db.sqlite
        .query(
          `SELECT * FROM automation_runs
      WHERE scheduled_for >= ? AND scheduled_for < ?
      ORDER BY scheduled_for, id LIMIT ?`,
        )
        .all(from, to, Math.max(1, Math.min(2_001, limit))) as RunRow[]
    ).map(runFromRow)
  }

  readRun(id: string) {
    const row = this.db.sqlite
      .query('SELECT * FROM automation_runs WHERE id = ?')
      .get(id) as RunRow | null
    return row ? runFromRow(row) : null
  }
  targetThreadAvailable(id: string) {
    return Boolean(
      this.db.sqlite.query('SELECT 1 FROM threads WHERE id = ? AND archived_at IS NULL').get(id),
    )
  }
  projectAvailable(id: string) {
    return Boolean(
      (this.db.profileSqlite ?? this.db.sqlite)
        .query('SELECT 1 FROM projects WHERE id = ? AND removed_at IS NULL')
        .get(id),
    )
  }
  findRunByTurn(turnId: string) {
    const row = this.db.sqlite
      .query('SELECT * FROM automation_runs WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(turnId) as RunRow | null
    return row ? runFromRow(row) : null
  }
  listActiveRuns() {
    return (
      this.db.sqlite
        .query(
          "SELECT * FROM automation_runs WHERE status IN ('claimed','preparing','queued','running') ORDER BY created_at, id",
        )
        .all() as RunRow[]
    ).map(runFromRow)
  }

  markRunRead(id: string, now: number) {
    const run = this.readRun(id)
    if (!run) throw new AgentError('AUTOMATION_RUN_NOT_FOUND', '自动化运行不存在', 404)
    if (!['completed', 'failed', 'interrupted'].includes(run.status))
      throw new AgentError('CONFLICT', '运行尚未结束，不能标记已读', 409)
    this.db.sqlite
      .query('UPDATE automation_runs SET read_at = COALESCE(read_at, ?) WHERE id = ?')
      .run(now, id)
    return this.readRun(id)!
  }

  markAllRunsRead(now: number, automationId?: string) {
    return automationId
      ? this.db.sqlite
          .query(
            "UPDATE automation_runs SET read_at = ? WHERE automation_id = ? AND read_at IS NULL AND status IN ('completed','failed','interrupted')",
          )
          .run(now, automationId).changes
      : this.db.sqlite
          .query(
            "UPDATE automation_runs SET read_at = ? WHERE read_at IS NULL AND status IN ('completed','failed','interrupted')",
          )
          .run(now).changes
  }

  private changeStatus(
    id: string,
    expectedRevision: number,
    status: 'active' | 'paused',
    nextRunAt: number | null,
    now: number,
  ) {
    const result = this.db.sqlite
      .query(
        "UPDATE automations SET status = ?, next_run_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND status != 'deleted'",
      )
      .run(status, nextRunAt, now, id, expectedRevision)
    if (result.changes !== 1) {
      if (!this.read(id, true)) throw missing()
      throw conflict()
    }
    return this.read(id)!
  }

  private changeRunStatus(
    id: string,
    from: AutomationRunStatus[],
    status: AutomationRunStatus,
    now: number,
  ) {
    const placeholders = from.map(() => '?').join(',')
    const result = this.db.sqlite
      .query(
        `UPDATE automation_runs SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(status, now, id, ...from)
    if (result.changes !== 1) throw conflict()
    return this.readRun(id)!
  }

  private insertRun(
    automationId: string,
    trigger: AutomationRunTrigger,
    scheduledFor: number,
    operationId: string,
    now: number,
  ) {
    const id = this.id()
    this.db.sqlite
      .query(
        "INSERT INTO automation_runs (id, automation_id, operation_id, trigger, scheduled_for, status, thread_id, turn_id, worktree_id, read_at, safe_error_code, created_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, 'claimed', NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL)",
      )
      .run(id, automationId, operationId, trigger, scheduledFor, now)
    return this.readRun(id)!
  }

  private runByOperation(operationId: string) {
    const row = this.db.sqlite
      .query('SELECT * FROM automation_runs WHERE operation_id = ?')
      .get(operationId) as RunRow | null
    return row ? runFromRow(row) : null
  }
}
