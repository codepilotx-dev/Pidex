import type { Database } from 'bun:sqlite'
import type {
  SchedulePlanProposal,
  SchedulePlanExecutionDefaults,
  SchedulePlanHorizon,
  SchedulePlanItemDraft,
} from '@pidex/shared/schedule-plan'
import type {
  ScheduledTask,
  ScheduledTaskDefinition,
  ScheduledTaskStatus,
} from '@pidex/shared/scheduled-task'
import type { CalendarSourceRef } from '@pidex/shared/calendar'
import type { AutomationExecution, AutomationNotificationPolicy } from '@pidex/shared/automation'
import type { ModelRef } from '@pidex/shared/model'
import type { PermissionConfig } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'

export type ScheduleCalendarDatabase = {
  sqlite: Database
  transaction<T>(work: () => T): T
}

type ScheduledTaskRow = {
  id: string
  revision: number
  operation_id: string
  manual_run_operation_id: string | null
  proposal_id: string | null
  kind: ScheduledTask['kind']
  name: string
  prompt: string
  status: ScheduledTaskStatus
  project_id: string | null
  target_thread_id: string | null
  execution: string | null
  model_ref: string
  reasoning_effort: string | null
  permission_config: string
  scheduled_for: number
  time_zone: string
  notification_policy: AutomationNotificationPolicy
  thread_id: string | null
  turn_id: string | null
  worktree_id: string | null
  read_at: number | null
  safe_error_code: string | null
  created_at: number
  updated_at: number
  started_at: number | null
  completed_at: number | null
  cancelled_at: number | null
}

type ProposalRow = {
  id: string
  revision: number
  operation_id: string
  thread_id: string
  turn_id: string
  tool_call_id: string
  status: SchedulePlanProposal['status']
  horizon: SchedulePlanHorizon
  defaults: string
  items: string
  created_refs: string
  commit_operation_id: string | null
  created_at: number
  updated_at: number
  committed_at: number | null
}

export type ScheduledTaskCreateRecord = ScheduledTaskDefinition & {
  id: string
  operationId: string
  proposalId?: string | null | undefined
  status?: Extract<ScheduledTaskStatus, 'scheduled' | 'paused'> | undefined
}

export type ScheduledTaskUpdate = Partial<ScheduledTaskDefinition> & {
  expectedRevision: number
  status?: Extract<ScheduledTaskStatus, 'scheduled' | 'paused'> | undefined
}

export type SchedulePlanProposalCreateRecord = Pick<
  SchedulePlanProposal,
  'id' | 'threadId' | 'turnId' | 'toolCallId' | 'horizon' | 'defaults' | 'items'
> & { operationId: string }

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown): string => JSON.stringify(value)
const activeStatuses: readonly ScheduledTaskStatus[] = ['claimed', 'preparing', 'queued', 'running']

const taskFromRow = (row: ScheduledTaskRow): ScheduledTask => ({
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
  scheduledFor: row.scheduled_for,
  timeZone: row.time_zone,
  notificationPolicy: row.notification_policy,
  threadId: row.thread_id,
  turnId: row.turn_id,
  worktreeId: row.worktree_id,
  readAt: row.read_at,
  safeErrorCode: row.safe_error_code,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  cancelledAt: row.cancelled_at,
})

const proposalFromRow = (row: ProposalRow): SchedulePlanProposal => ({
  id: row.id,
  revision: row.revision,
  threadId: row.thread_id,
  turnId: row.turn_id,
  toolCallId: row.tool_call_id,
  status: row.status,
  horizon: row.horizon,
  defaults: parse<SchedulePlanExecutionDefaults>(row.defaults),
  items: parse<SchedulePlanItemDraft[]>(row.items),
  createdRefs: parse<CalendarSourceRef[]>(row.created_refs),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  committedAt: row.committed_at,
})

const missingTask = () => new AgentError('SCHEDULED_TASK_NOT_FOUND', '计划任务不存在', 404)
const missingProposal = () => new AgentError('SCHEDULE_PLAN_NOT_FOUND', '排期方案不存在', 404)
const conflict = () => new AgentError('CONFLICT', '计划任务或排期方案的版本、状态已变化', 409)
const operationConflict = () =>
  new AgentError('OPERATION_ID_CONFLICT', '操作标识已用于其他请求', 409)
const invalidTaskReference = () => new AgentError('INVALID_REQUEST', '计划任务引用无效', 400)
const invalidProposalReference = () => new AgentError('INVALID_REQUEST', '排期方案引用无效', 400)

export class ScheduledTaskRepository {
  constructor(private readonly db: ScheduleCalendarDatabase) {}

  forThread(threadId: string) {
    const rows = this.db.sqlite
      .query(
        "SELECT id FROM scheduled_tasks WHERE target_thread_id = ? AND kind = 'thread' AND status IN ('scheduled', 'paused', 'claimed', 'preparing', 'queued', 'running')",
      )
      .all(threadId) as Array<{ id: string }>
    return rows.flatMap(({ id }) => {
      const value = this.read(id)
      return value ? [value] : []
    })
  }

  listRange(input: {
    from: number
    to: number
    query?: string
    statuses?: ScheduledTaskStatus[]
    limit?: number
  }): ScheduledTask[] {
    const clauses = ['scheduled_for >= ?', 'scheduled_for < ?']
    const values: Array<string | number> = [input.from, input.to]
    if (input.statuses?.length) {
      clauses.push(`status IN (${input.statuses.map(() => '?').join(',')})`)
      values.push(...input.statuses)
    } else {
      clauses.push("status != 'cancelled'")
    }
    const query = input.query?.trim().toLocaleLowerCase()
    if (query) {
      clauses.push('(LOWER(name) LIKE ? OR LOWER(prompt) LIKE ?)')
      values.push(`%${query}%`, `%${query}%`)
    }
    values.push(Math.max(1, Math.min(2_001, input.limit ?? 500)))
    return (
      this.db.sqlite
        .query(
          `SELECT * FROM scheduled_tasks WHERE ${clauses.join(' AND ')} ORDER BY scheduled_for, id LIMIT ?`,
        )
        .all(...values) as ScheduledTaskRow[]
    ).map(taskFromRow)
  }

  read(id: string, includeCancelled = false): ScheduledTask | null {
    const row = this.row(id, includeCancelled)
    return row ? taskFromRow(row) : null
  }

  proposalId(id: string): string | null {
    const row = this.db.sqlite
      .query('SELECT proposal_id FROM scheduled_tasks WHERE id = ?')
      .get(id) as { proposal_id: string | null } | null
    return row?.proposal_id ?? null
  }

  create(input: ScheduledTaskCreateRecord, now: number): ScheduledTask {
    const byOperation = this.rowByOperation(input.operationId)
    if (byOperation) {
      if (!sameTaskCreate(byOperation, input)) throw operationConflict()
      return taskFromRow(byOperation)
    }
    try {
      this.db.sqlite
        .query(
          `INSERT INTO scheduled_tasks (
        id, revision, operation_id, manual_run_operation_id, proposal_id, kind, name, prompt, status,
        project_id, target_thread_id, execution, model_ref, reasoning_effort, permission_config,
        scheduled_for, time_zone, notification_policy, thread_id, turn_id, worktree_id, read_at,
        safe_error_code, created_at, updated_at, started_at, completed_at, cancelled_at
      ) VALUES (?, 1, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
        )
        .run(
          input.id,
          input.operationId,
          input.proposalId ?? null,
          input.kind,
          input.name,
          input.prompt,
          input.status ?? 'scheduled',
          input.projectId,
          input.targetThreadId,
          input.execution === null ? null : stringify(input.execution),
          stringify(input.model),
          input.reasoningEffort,
          stringify(input.permissionConfig),
          input.scheduledFor,
          input.timeZone,
          input.notificationPolicy,
          now,
          now,
        )
    } catch {
      const retried = this.rowByOperation(input.operationId)
      if (retried && sameTaskCreate(retried, input)) return taskFromRow(retried)
      if (retried || this.row(input.id, true)) throw operationConflict()
      throw invalidTaskReference()
    }
    return taskFromRow(this.row(input.id, true)!)
  }

  update(id: string, patch: ScheduledTaskUpdate, now: number): ScheduledTask {
    const current = this.row(id, true)
    if (!current) throw missingTask()
    if (
      current.revision !== patch.expectedRevision ||
      !['scheduled', 'paused'].includes(current.status)
    )
      throw conflict()
    const definition = mergeTaskDefinition(taskFromRow(current), patch)
    const status = patch.status ?? current.status
    let result
    try {
      result = this.db.sqlite
        .query(
          `UPDATE scheduled_tasks SET
        kind = ?, name = ?, prompt = ?, status = ?, project_id = ?, target_thread_id = ?, execution = ?,
        model_ref = ?, reasoning_effort = ?, permission_config = ?, scheduled_for = ?, time_zone = ?,
        notification_policy = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND status IN ('scheduled','paused')`,
        )
        .run(
          definition.kind,
          definition.name,
          definition.prompt,
          status,
          definition.projectId,
          definition.targetThreadId,
          definition.execution === null ? null : stringify(definition.execution),
          stringify(definition.model),
          definition.reasoningEffort,
          stringify(definition.permissionConfig),
          definition.scheduledFor,
          definition.timeZone,
          definition.notificationPolicy,
          now,
          id,
          patch.expectedRevision,
        )
    } catch {
      throw invalidTaskReference()
    }
    if (result.changes !== 1) throw conflict()
    return taskFromRow(this.row(id, true)!)
  }

  cancel(id: string, expectedRevision: number, now: number): ScheduledTask {
    const current = this.row(id, true)
    if (!current) throw missingTask()
    if (current.status === 'cancelled' && current.revision === expectedRevision)
      return taskFromRow(current)
    const result = this.db.sqlite
      .query(
        `UPDATE scheduled_tasks SET
      status = 'cancelled', revision = revision + 1, updated_at = ?, cancelled_at = ?, completed_at = COALESCE(completed_at, ?)
      WHERE id = ? AND revision = ? AND status IN ('scheduled','paused')`,
      )
      .run(now, now, now, id, expectedRevision)
    if (result.changes !== 1) throw conflict()
    return taskFromRow(this.row(id, true)!)
  }

  nextDeadline(): number | null {
    const row = this.db.sqlite
      .query(
        "SELECT MIN(scheduled_for) AS deadline FROM scheduled_tasks WHERE status = 'scheduled'",
      )
      .get() as { deadline: number | null }
    return row.deadline
  }

  claimDue(now: number): ScheduledTask[] {
    return this.db.transaction(() => {
      const rows = this.db.sqlite
        .query(
          "SELECT * FROM scheduled_tasks WHERE status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for, id",
        )
        .all(now) as ScheduledTaskRow[]
      const claimed: ScheduledTask[] = []
      for (const row of rows) {
        const result = this.db.sqlite
          .query(
            `UPDATE scheduled_tasks SET
          status = 'claimed', revision = revision + 1, updated_at = ?
          WHERE id = ? AND revision = ? AND status = 'scheduled'`,
          )
          .run(now, row.id, row.revision)
        if (result.changes === 1) claimed.push(taskFromRow(this.row(row.id, true)!))
      }
      return claimed
    })
  }

  claimManual(id: string, operationId: string, now: number): ScheduledTask {
    return this.db.transaction(() => {
      const existing = this.rowByManualOperation(operationId)
      if (existing) {
        if (existing.id !== id) throw operationConflict()
        return taskFromRow(existing)
      }
      const current = this.row(id, true)
      if (!current) throw missingTask()
      if (current.manual_run_operation_id !== null) throw operationConflict()
      const result = this.db.sqlite
        .query(
          `UPDATE scheduled_tasks SET
        manual_run_operation_id = ?, status = 'claimed', revision = revision + 1, updated_at = ?
        WHERE id = ? AND revision = ? AND manual_run_operation_id IS NULL AND status IN ('scheduled','paused')`,
        )
        .run(operationId, now, id, current.revision)
      if (result.changes !== 1) throw conflict()
      return taskFromRow(this.row(id, true)!)
    })
  }

  markPreparing(id: string, now: number): ScheduledTask {
    return this.changeStatus(id, ['claimed'], 'preparing', now)
  }

  bindExecution(
    id: string,
    binding: { threadId: string; turnId: string; worktreeId?: string | null },
    now: number,
  ): ScheduledTask {
    let result
    try {
      result = this.db.sqlite
        .query(
          `UPDATE scheduled_tasks SET
        thread_id = ?, turn_id = ?, worktree_id = ?, status = 'queued', revision = revision + 1,
        updated_at = ?, started_at = COALESCE(started_at, ?)
        WHERE id = ? AND status IN ('claimed','preparing','queued')`,
        )
        .run(binding.threadId, binding.turnId, binding.worktreeId ?? null, now, now, id)
    } catch {
      throw invalidTaskReference()
    }
    if (result.changes !== 1) this.throwMissingOrConflict(id)
    return taskFromRow(this.row(id, true)!)
  }

  markRunning(id: string, now: number): ScheduledTask {
    return this.changeStatus(id, ['claimed', 'preparing', 'queued'], 'running', now, true)
  }

  complete(
    id: string,
    status: Extract<ScheduledTaskStatus, 'completed' | 'failed' | 'interrupted'>,
    now: number,
    safeErrorCode: string | null = null,
  ): ScheduledTask {
    const current = this.row(id, true)
    if (!current) throw missingTask()
    if (['completed', 'failed', 'interrupted'].includes(current.status)) {
      if (current.status !== status) throw conflict()
      return taskFromRow(current)
    }
    const result = this.db.sqlite
      .query(
        `UPDATE scheduled_tasks SET
      status = ?, safe_error_code = ?, revision = revision + 1, updated_at = ?,
      started_at = COALESCE(started_at, ?), completed_at = ?, read_at = NULL
      WHERE id = ? AND status IN ('claimed','preparing','queued','running')`,
      )
      .run(status, safeErrorCode, now, now, now, id)
    if (result.changes !== 1) throw conflict()
    return taskFromRow(this.row(id, true)!)
  }

  findByTurn(turnId: string): ScheduledTask | null {
    const row = this.db.sqlite
      .query('SELECT * FROM scheduled_tasks WHERE turn_id = ? ORDER BY created_at DESC, id LIMIT 1')
      .get(turnId) as ScheduledTaskRow | null
    return row ? taskFromRow(row) : null
  }

  listActive(): ScheduledTask[] {
    const placeholders = activeStatuses.map(() => '?').join(',')
    return (
      this.db.sqlite
        .query(
          `SELECT * FROM scheduled_tasks WHERE status IN (${placeholders}) ORDER BY scheduled_for, id`,
        )
        .all(...activeStatuses) as ScheduledTaskRow[]
    ).map(taskFromRow)
  }

  private changeStatus(
    id: string,
    from: ScheduledTaskStatus[],
    status: ScheduledTaskStatus,
    now: number,
    started = false,
  ): ScheduledTask {
    const placeholders = from.map(() => '?').join(',')
    const result = this.db.sqlite
      .query(
        `UPDATE scheduled_tasks SET
      status = ?, revision = revision + 1, updated_at = ?,
      started_at = CASE WHEN ? = 1 THEN COALESCE(started_at, ?) ELSE started_at END
      WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(status, now, started ? 1 : 0, now, id, ...from)
    if (result.changes !== 1) this.throwMissingOrConflict(id)
    return taskFromRow(this.row(id, true)!)
  }

  private throwMissingOrConflict(id: string): never {
    if (!this.row(id, true)) throw missingTask()
    throw conflict()
  }

  private row(id: string, includeCancelled: boolean): ScheduledTaskRow | null {
    return this.db.sqlite
      .query(
        `SELECT * FROM scheduled_tasks WHERE id = ? ${includeCancelled ? '' : "AND status != 'cancelled'"}`,
      )
      .get(id) as ScheduledTaskRow | null
  }

  private rowByOperation(operationId: string): ScheduledTaskRow | null {
    return this.db.sqlite
      .query('SELECT * FROM scheduled_tasks WHERE operation_id = ?')
      .get(operationId) as ScheduledTaskRow | null
  }

  private rowByManualOperation(operationId: string): ScheduledTaskRow | null {
    return this.db.sqlite
      .query('SELECT * FROM scheduled_tasks WHERE manual_run_operation_id = ?')
      .get(operationId) as ScheduledTaskRow | null
  }
}

export class SchedulePlanProposalRepository {
  constructor(private readonly db: ScheduleCalendarDatabase) {}

  create(input: SchedulePlanProposalCreateRecord, now: number): SchedulePlanProposal {
    const byOperation = this.rowByOperation(input.operationId)
    if (byOperation) {
      if (!sameProposalCreate(byOperation, input)) throw operationConflict()
      return proposalFromRow(byOperation)
    }
    try {
      this.db.sqlite
        .query(
          `INSERT INTO schedule_plan_proposals (
        id, revision, operation_id, thread_id, turn_id, tool_call_id, status, horizon, defaults,
        items, created_refs, commit_operation_id, created_at, updated_at, committed_at
      ) VALUES (?, 1, ?, ?, ?, ?, 'pending', ?, ?, ?, '[]', NULL, ?, ?, NULL)`,
        )
        .run(
          input.id,
          input.operationId,
          input.threadId,
          input.turnId,
          input.toolCallId,
          input.horizon,
          stringify(input.defaults),
          stringify(input.items),
          now,
          now,
        )
    } catch {
      const retried = this.rowByOperation(input.operationId)
      if (retried && sameProposalCreate(retried, input)) return proposalFromRow(retried)
      if (retried || this.rowByToolCall(input.toolCallId) || this.row(input.id))
        throw operationConflict()
      throw invalidProposalReference()
    }
    return proposalFromRow(this.row(input.id)!)
  }

  read(id: string): SchedulePlanProposal | null {
    const row = this.row(id)
    return row ? proposalFromRow(row) : null
  }

  findByOperation(operationId: string): SchedulePlanProposal | null {
    const row = this.rowByOperation(operationId)
    return row ? proposalFromRow(row) : null
  }

  findByToolCall(toolCallId: string): SchedulePlanProposal | null {
    const row = this.rowByToolCall(toolCallId)
    return row ? proposalFromRow(row) : null
  }

  findByCommitOperation(operationId: string): SchedulePlanProposal | null {
    const row = this.db.sqlite
      .query('SELECT * FROM schedule_plan_proposals WHERE commit_operation_id = ?')
      .get(operationId) as ProposalRow | null
    return row ? proposalFromRow(row) : null
  }

  commit(
    id: string,
    input: {
      expectedRevision: number
      operationId: string
      createdRefs: readonly CalendarSourceRef[]
      defaults?: SchedulePlanExecutionDefaults
      items?: readonly SchedulePlanItemDraft[]
    },
    now: number,
  ): SchedulePlanProposal {
    const byOperation = this.db.sqlite
      .query('SELECT * FROM schedule_plan_proposals WHERE commit_operation_id = ?')
      .get(input.operationId) as ProposalRow | null
    if (byOperation) {
      if (
        byOperation.id !== id ||
        stringify(input.createdRefs) !== byOperation.created_refs ||
        (input.defaults && stringify(input.defaults) !== byOperation.defaults) ||
        (input.items && stringify(input.items) !== byOperation.items)
      )
        throw operationConflict()
      return proposalFromRow(byOperation)
    }
    const current = this.row(id)
    if (!current) throw missingProposal()
    if (current.revision !== input.expectedRevision || current.status !== 'pending')
      throw conflict()
    try {
      const result = this.db.sqlite
        .query(
          `UPDATE schedule_plan_proposals SET
        status = 'committed', defaults = ?, items = ?, created_refs = ?, commit_operation_id = ?, revision = revision + 1,
        updated_at = ?, committed_at = ?
        WHERE id = ? AND revision = ? AND status = 'pending' AND commit_operation_id IS NULL`,
        )
        .run(
          stringify(input.defaults ?? parse<SchedulePlanExecutionDefaults>(current.defaults)),
          stringify(input.items ?? parse<SchedulePlanItemDraft[]>(current.items)),
          stringify(input.createdRefs),
          input.operationId,
          now,
          now,
          id,
          input.expectedRevision,
        )
      if (result.changes !== 1) throw conflict()
    } catch {
      const retried = this.db.sqlite
        .query('SELECT * FROM schedule_plan_proposals WHERE commit_operation_id = ?')
        .get(input.operationId) as ProposalRow | null
      if (
        retried &&
        retried.id === id &&
        retried.created_refs === stringify(input.createdRefs) &&
        (!input.defaults || retried.defaults === stringify(input.defaults)) &&
        (!input.items || retried.items === stringify(input.items))
      )
        return proposalFromRow(retried)
      if (retried) throw operationConflict()
      throw conflict()
    }
    return proposalFromRow(this.row(id)!)
  }

  private row(id: string): ProposalRow | null {
    return this.db.sqlite
      .query('SELECT * FROM schedule_plan_proposals WHERE id = ?')
      .get(id) as ProposalRow | null
  }

  private rowByOperation(operationId: string): ProposalRow | null {
    return this.db.sqlite
      .query('SELECT * FROM schedule_plan_proposals WHERE operation_id = ?')
      .get(operationId) as ProposalRow | null
  }

  private rowByToolCall(toolCallId: string): ProposalRow | null {
    return this.db.sqlite
      .query('SELECT * FROM schedule_plan_proposals WHERE tool_call_id = ?')
      .get(toolCallId) as ProposalRow | null
  }
}

function sameTaskCreate(row: ScheduledTaskRow, input: ScheduledTaskCreateRecord): boolean {
  return (
    row.id === input.id &&
    row.proposal_id === (input.proposalId ?? null) &&
    row.kind === input.kind &&
    row.name === input.name &&
    row.prompt === input.prompt &&
    row.status === (input.status ?? 'scheduled') &&
    row.project_id === input.projectId &&
    row.target_thread_id === input.targetThreadId &&
    row.execution === (input.execution === null ? null : stringify(input.execution)) &&
    row.model_ref === stringify(input.model) &&
    row.reasoning_effort === input.reasoningEffort &&
    row.permission_config === stringify(input.permissionConfig) &&
    row.scheduled_for === input.scheduledFor &&
    row.time_zone === input.timeZone &&
    row.notification_policy === input.notificationPolicy
  )
}

function sameProposalCreate(row: ProposalRow, input: SchedulePlanProposalCreateRecord): boolean {
  return (
    row.id === input.id &&
    row.thread_id === input.threadId &&
    row.turn_id === input.turnId &&
    row.tool_call_id === input.toolCallId &&
    row.horizon === input.horizon &&
    row.defaults === stringify(input.defaults) &&
    row.items === stringify(input.items)
  )
}

function mergeTaskDefinition(
  current: ScheduledTask,
  patch: ScheduledTaskUpdate,
): ScheduledTaskDefinition {
  return {
    kind: patch.kind ?? current.kind,
    name: patch.name ?? current.name,
    prompt: patch.prompt ?? current.prompt,
    projectId: patch.projectId === undefined ? current.projectId : patch.projectId,
    targetThreadId:
      patch.targetThreadId === undefined ? current.targetThreadId : patch.targetThreadId,
    execution: patch.execution === undefined ? current.execution : patch.execution,
    model: patch.model ?? current.model,
    reasoningEffort:
      patch.reasoningEffort === undefined ? current.reasoningEffort : patch.reasoningEffort,
    permissionConfig: patch.permissionConfig ?? current.permissionConfig,
    scheduledFor: patch.scheduledFor ?? current.scheduledFor,
    timeZone: patch.timeZone ?? current.timeZone,
    notificationPolicy: patch.notificationPolicy ?? current.notificationPolicy,
  }
}
