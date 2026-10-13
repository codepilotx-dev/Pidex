import type { Database } from 'bun:sqlite'
import type { CalendarSourceRef } from '@pidex/shared/calendar'
import type {
  ScheduleAcceptance,
  ScheduleConditionFallback,
  ScheduleConditions,
  ScheduleDraft,
  ScheduleDraftStatus,
  ScheduleExecution,
  ScheduleMissedRunPolicy,
  ScheduleTaskPlan,
  ScheduleTrigger,
} from '@pidex/shared/schedule-draft'
import type { AutomationNotificationPolicy } from '@pidex/shared/automation'
import { AgentError } from '../../Domain'

/**
 * 任务规划扩展表：计划快照与执行规则（schedule_drafts）、触发去重记录
 * （schedule_trigger_records）与验收记录（schedule_acceptances）。
 *
 * 全部是独立表：不改变 automations/scheduled_tasks 的既有列与状态含义，
 * “待验收”也不写进旧运行表的状态列。
 */
export const SCHEDULE_DRAFT_SCHEMA = [
  `CREATE TABLE schedule_drafts (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
    operation_id TEXT NOT NULL UNIQUE,
    commit_operation_id TEXT UNIQUE,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    tool_call_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending','committed','cancelled')),
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    task_plan TEXT NOT NULL,
    trigger TEXT NOT NULL,
    conditions TEXT NOT NULL,
    condition_fallback TEXT NOT NULL CHECK(condition_fallback IN ('skip','wait')),
    acceptance TEXT NOT NULL,
    notification_policy TEXT NOT NULL CHECK(notification_policy IN ('all','failures','off')),
    missed_runs TEXT NOT NULL CHECK(missed_runs IN ('catch-up','skip')),
    execution TEXT NOT NULL,
    created_refs TEXT NOT NULL DEFAULT '[]',
    feedback_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    committed_at INTEGER
  )`,
  'CREATE INDEX schedule_drafts_thread ON schedule_drafts(thread_id)',
  `CREATE UNIQUE INDEX schedule_drafts_pending_thread ON schedule_drafts(thread_id) WHERE status = 'pending'`,
  // 触发去重与消费位置：同一个 trigger_key 只会执行一次。
  `CREATE TABLE schedule_trigger_records (
    trigger_key TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES schedule_drafts(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK(source IN ('time','task-succeeded','acceptance-passed')),
    source_ref TEXT,
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX schedule_trigger_records_draft ON schedule_trigger_records(draft_id, created_at DESC)',
  // 验收记录：与运行状态分离，attempt 串起同一运行的返工尝试链。
  `CREATE TABLE schedule_acceptances (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES schedule_drafts(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt >= 1),
    result_version INTEGER NOT NULL DEFAULT 1 CHECK(result_version >= 1),
    status TEXT NOT NULL CHECK(status IN ('pending','passed','rework','failed','blocked')),
    decided_by TEXT NOT NULL CHECK(decided_by IN ('system','user')),
    operation_id TEXT UNIQUE,
    previous_acceptance_id TEXT REFERENCES schedule_acceptances(id) ON DELETE SET NULL,
    feedback_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  )`,
  'CREATE INDEX schedule_acceptances_run ON schedule_acceptances(run_id, attempt DESC)',
  `CREATE UNIQUE INDEX schedule_acceptances_pending_run ON schedule_acceptances(run_id) WHERE status = 'pending'`,
  // 确认之外的动作（反馈、取消）的幂等台账：重试同一个 operationId 只生效一次。
  `CREATE TABLE schedule_draft_operations (
    operation_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES schedule_drafts(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
] as const

export type ScheduleDraftDatabase = {
  sqlite: Database
  transaction<T>(work: () => T): T
}

export type ScheduleDraftCreateInput = {
  id: string
  operationId: string
  threadId: string
  turnId: string
  toolCallId: string
  name: string
  prompt: string
  taskPlan: ScheduleTaskPlan
  trigger: ScheduleTrigger
  conditions: ScheduleConditions
  conditionFallback: ScheduleConditionFallback
  acceptance: ScheduleAcceptance
  notificationPolicy: AutomationNotificationPolicy
  missedRuns: ScheduleMissedRunPolicy
  execution: ScheduleExecution
}

export type ScheduleDraftCommitInput = {
  expectedRevision: number
  operationId: string
  name: string
  prompt: string
  trigger: ScheduleTrigger
  conditions: ScheduleConditions
  conditionFallback: ScheduleConditionFallback
  acceptance: ScheduleAcceptance
  notificationPolicy: AutomationNotificationPolicy
  missedRuns: ScheduleMissedRunPolicy
  execution: ScheduleExecution
  createdRefs: readonly CalendarSourceRef[]
}

type Row = {
  id: string
  revision: number
  operation_id: string
  commit_operation_id: string | null
  thread_id: string
  turn_id: string
  tool_call_id: string
  status: ScheduleDraftStatus
  name: string
  prompt: string
  task_plan: string
  trigger: string
  conditions: string
  condition_fallback: ScheduleConditionFallback
  acceptance: string
  notification_policy: AutomationNotificationPolicy
  missed_runs: ScheduleMissedRunPolicy
  execution: string
  created_refs: string
  feedback_turn_id: string | null
  created_at: number
  updated_at: number
  committed_at: number | null
}

const parse = <T>(value: string): T => JSON.parse(value) as T

export class ScheduleDraftRepository {
  constructor(private readonly db: ScheduleDraftDatabase) {}

  available(): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schedule_drafts'")
        .get(),
    )
  }

  private project(row: Row): ScheduleDraft {
    return {
      id: row.id,
      revision: row.revision,
      threadId: row.thread_id,
      turnId: row.turn_id,
      toolCallId: row.tool_call_id,
      status: row.status,
      name: row.name,
      prompt: row.prompt,
      taskPlan: parse<ScheduleTaskPlan>(row.task_plan),
      trigger: parse<ScheduleTrigger>(row.trigger),
      conditions: parse<ScheduleConditions>(row.conditions),
      conditionFallback: row.condition_fallback,
      acceptance: parse<ScheduleAcceptance>(row.acceptance),
      notificationPolicy: row.notification_policy,
      missedRuns: row.missed_runs,
      execution: parse<ScheduleExecution>(row.execution),
      createdRefs: parse<CalendarSourceRef[]>(row.created_refs),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      committedAt: row.committed_at,
    }
  }

  get(id: string): ScheduleDraft | null {
    if (!this.available()) return null
    const row = this.db.sqlite.query('SELECT * FROM schedule_drafts WHERE id = ?').get(id) as
      | Row
      | null
    return row ? this.project(row) : null
  }

  pending(threadId: string): ScheduleDraft | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query("SELECT * FROM schedule_drafts WHERE thread_id = ? AND status = 'pending'")
      .get(threadId) as Row | null
    return row ? this.project(row) : null
  }

  findByOperation(operationId: string): ScheduleDraft | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT * FROM schedule_drafts WHERE operation_id = ?')
      .get(operationId) as Row | null
    return row ? this.project(row) : null
  }

  findByToolCall(toolCallId: string): ScheduleDraft | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT * FROM schedule_drafts WHERE tool_call_id = ?')
      .get(toolCallId) as Row | null
    return row ? this.project(row) : null
  }

  findByCommitOperation(operationId: string): ScheduleDraft | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT * FROM schedule_drafts WHERE commit_operation_id = ?')
      .get(operationId) as Row | null
    return row ? this.project(row) : null
  }

  /** 草案反馈轮次的源草案：仅当该 turn 由反馈动作创建时才返回。 */
  feedbackSource(turnId: string): ScheduleDraft | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT * FROM schedule_drafts WHERE feedback_turn_id = ?')
      .get(turnId) as Row | null
    return row ? this.project(row) : null
  }

  linkFeedbackTurn(id: string, turnId: string): void {
    this.db.sqlite
      .query('UPDATE schedule_drafts SET feedback_turn_id = ?, updated_at = ? WHERE id = ?')
      .run(turnId, Date.now(), id)
  }

  /**
   * 同一聊天只保留一份待确认草案：新草案在同一事务里先取消旧的 pending，
   * 避免旧草案被确认后产生第二组任务。重复提交同一个 tool call 时按
   * operationId / toolCallId 幂等返回已落盘草案。
   */
  create(input: ScheduleDraftCreateInput, now: number): ScheduleDraft {
    const existing = this.findByOperation(input.operationId) ?? this.findByToolCall(input.toolCallId)
    if (existing) {
      if (
        existing.threadId !== input.threadId ||
        JSON.stringify(existing.taskPlan) !== JSON.stringify(input.taskPlan) ||
        JSON.stringify(existing.trigger) !== JSON.stringify(input.trigger)
      ) {
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他任务规划草案', 409)
      }
      return existing
    }
    this.db.transaction(() => {
      this.db.sqlite
        .query(
          "UPDATE schedule_drafts SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE thread_id = ? AND status = 'pending'",
        )
        .run(now, input.threadId)
      this.db.sqlite
        .query(
          `INSERT INTO schedule_drafts(
            id, operation_id, thread_id, turn_id, tool_call_id, status, name, prompt, task_plan,
            trigger, conditions, condition_fallback, acceptance, notification_policy, missed_runs,
            execution, created_refs, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
        )
        .run(
          input.id,
          input.operationId,
          input.threadId,
          input.turnId,
          input.toolCallId,
          input.name,
          input.prompt,
          JSON.stringify(input.taskPlan),
          JSON.stringify(input.trigger),
          JSON.stringify(input.conditions),
          input.conditionFallback,
          JSON.stringify(input.acceptance),
          input.notificationPolicy,
          input.missedRuns,
          JSON.stringify(input.execution),
          now,
          now,
        )
    })
    return this.get(input.id)!
  }

  commit(id: string, input: ScheduleDraftCommitInput, now: number): ScheduleDraft {
    const existingCommit = this.findByCommitOperation(input.operationId)
    if (existingCommit) {
      if (existingCommit.id !== id)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他确认请求', 409)
      return existingCommit
    }
    const result = this.db.sqlite
      .query(
        `UPDATE schedule_drafts SET
          status = 'committed', revision = revision + 1, commit_operation_id = ?,
          name = ?, prompt = ?, trigger = ?, conditions = ?, condition_fallback = ?,
          acceptance = ?, notification_policy = ?, missed_runs = ?, execution = ?,
          created_refs = ?, updated_at = ?, committed_at = ?
        WHERE id = ? AND revision = ? AND status = 'pending' AND commit_operation_id IS NULL`,
      )
      .run(
        input.operationId,
        input.name,
        input.prompt,
        JSON.stringify(input.trigger),
        JSON.stringify(input.conditions),
        input.conditionFallback,
        JSON.stringify(input.acceptance),
        input.notificationPolicy,
        input.missedRuns,
        JSON.stringify(input.execution),
        JSON.stringify(input.createdRefs),
        now,
        now,
        id,
        input.expectedRevision,
      )
    if (result.changes !== 1)
      throw new AgentError('CONFLICT', '任务规划草案版本或状态已变化', 409)
    return this.get(id)!
  }

  cancel(id: string, revision: number, now: number): ScheduleDraft {
    const result = this.db.sqlite
      .query(
        "UPDATE schedule_drafts SET status = 'cancelled', revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND status = 'pending'",
      )
      .run(now, id, revision)
    if (result.changes !== 1) throw new AgentError('CONFLICT', '任务规划草案版本或状态已变化', 409)
    return this.get(id)!
  }

  /**
   * 确认之外的草案动作（反馈、取消）的幂等台账。同一个 operationId 重试只生效
   * 一次；requestHash 不一致说明 operationId 被复用到了不同请求。
   */
  lookupOperation(operationId: string): { draftId: string; method: string; requestHash: string } | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT draft_id, method, request_hash FROM schedule_draft_operations WHERE operation_id = ?')
      .get(operationId) as { draft_id: string; method: string; request_hash: string } | null
    return row ? { draftId: row.draft_id, method: row.method, requestHash: row.request_hash } : null
  }

  recordOperation(input: {
    operationId: string
    draftId: string
    method: string
    requestHash: string
    result: unknown
  }): void {
    this.db.sqlite
      .query(
        `INSERT OR IGNORE INTO schedule_draft_operations(operation_id, draft_id, method, request_hash, result, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.operationId,
        input.draftId,
        input.method,
        input.requestHash,
        JSON.stringify(input.result),
        Date.now(),
        Date.now(),
      )
  }

  /**
   * 只有最新 turn 上的待确认草案仍然有效；重启或出现新输入后，旧草案一律
   * 标记为 cancelled，避免确认一份已被取代的安排。
   */
  recover(threadId?: string): void {
    if (!this.available()) return
    this.db.transaction(() => {
      this.db.sqlite
        .query(
          `UPDATE schedule_drafts SET status = 'cancelled', revision = revision + 1, updated_at = ?
        WHERE status = 'pending' ${threadId ? 'AND thread_id = ?' : ''}
        AND turn_id <> (SELECT id FROM turns WHERE thread_id = schedule_drafts.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
        )
        .run(Date.now(), ...(threadId ? [threadId] : []))
    })
  }
}
