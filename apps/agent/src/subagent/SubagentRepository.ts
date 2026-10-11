import type { Model } from '@pidex/model-schema'
import type {
  PermissionConfig,
  SubagentProfile,
  SubagentProjection,
  SubagentResult,
  SubagentRun,
  SubagentStatus,
  SubagentTask,
} from '@pidex/shared/thread'
import { encodeApprovalPolicy } from '@pidex/shared/thread'
import { AgentError, type AgentExecution, type EventEnvelope } from '../Domain'
import { subagentCollaborationAvailable } from './SubagentCollaborationRepository'
import type { AgentDatabase } from '../storage/database/AgentDatabase'

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value ?? null)
const now = () => Date.now()
const terminalStatuses = new Set<SubagentStatus>(['completed', 'failed', 'stopped', 'interrupted'])
const activeStatuses = [
  'preparing',
  'running',
  'steering',
  'waiting_question',
  'waiting_permission',
] as const

export type SpawnSubagentInput = {
  parentThreadID: string
  parentTurnID: string
  parentAgentID: string
  displayName: string
  profile: Exclude<SubagentProfile, 'main'>
  task: string
  model: Model.Ref
  permissionCeiling: PermissionConfig
  allowedTools?: readonly string[]
  workspaceMode: 'shared' | 'worktree'
  workspaceRoot: string
  taskMode?: 'chat' | 'plan'
}

export type SubagentClaim = {
  task: SubagentTask
  run: SubagentRun
  agent: AgentExecution
}

export class SubagentRepository {
  constructor(private readonly db: AgentDatabase) {}
  private get collaborationAvailable() {
    return subagentCollaborationAvailable(this.db)
  }

  create(input: SpawnSubagentInput) {
    const taskID = crypto.randomUUID()
    const runID = crypto.randomUUID()
    const childThreadID = crypto.randomUUID()
    const turnID = crypto.randomUUID()
    const agentID = crypto.randomUUID()
    const inputID = crypto.randomUUID()
    const itemID = crypto.randomUUID()
    const timestamp = now()
    const permission =
      input.profile === 'explorer'
        ? { ...input.permissionCeiling, sandboxMode: 'read-only' as const }
        : input.permissionCeiling
    return this.db.transaction(() => {
      const parent = this.db.sqlite
        .query('SELECT project_id FROM threads WHERE id = ?')
        .get(input.parentThreadID) as { project_id: string | null } | null
      if (!parent) throw new Error(`Parent thread ${input.parentThreadID} 不存在`)
      this.db.sqlite
        .query(
          `INSERT INTO threads (id, title, kind, parent_thread_id, project_id, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at) VALUES (?, ?, 'subagent', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          childThreadID,
          input.displayName,
          input.parentThreadID,
          parent.project_id,
          input.taskMode ?? 'chat',
          permission.sandboxMode,
          encodeApprovalPolicy(permission.approvalPolicy),
          permission.approvalsReviewer,
          timestamp,
          timestamp,
        )
      this.db.sqlite
        .query(
          `INSERT INTO subagent_tasks (id, parent_thread_id, parent_turn_id, parent_agent_id, child_thread_id, display_name, profile, task, permission_ceiling, workspace_mode, workspace_state, current_run_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        )
        .run(
          taskID,
          input.parentThreadID,
          input.parentTurnID,
          input.parentAgentID,
          childThreadID,
          input.displayName,
          input.profile,
          input.task,
          stringify(input.permissionCeiling),
          input.workspaceMode,
          stringify({
            mode: input.workspaceMode,
            state: input.workspaceMode === 'worktree' ? 'preparing' : 'ready',
            rootPath: input.workspaceRoot,
            baselineRef: null,
          }),
          runID,
          timestamp,
          timestamp,
        )
      if (this.collaborationAvailable)
        this.db.sqlite
          .query('INSERT INTO subagent_task_policies (task_id, allowed_tools) VALUES (?, ?)')
          .run(taskID, input.allowedTools ? stringify(input.allowedTools) : null)
      this.db.sqlite
        .query(
          `INSERT INTO subagent_runs (id, task_id, generation, status, queue_reason, model_ref, permission_config, result, error, created_at, started_at, finished_at, updated_at) VALUES (?, ?, 1, 'queued', NULL, ?, ?, NULL, NULL, ?, NULL, NULL, ?)`,
        )
        .run(runID, taskID, stringify(input.model), stringify(permission), timestamp, timestamp)
      this.insertExecution({
        childThreadID,
        turnID,
        agentID,
        inputID,
        runID,
        parentAgentID: input.parentAgentID,
        profile: input.profile,
        task: input.task,
        content: [
          `子 Agent 任务：\n${input.task}`,
          `工作区：${input.workspaceRoot}`,
          `工作区模式：${input.workspaceMode}`,
          `权限上限：${stringify(input.permissionCeiling)}`,
          '只返回与任务直接相关的结构化结论，不要假设主对话中未显式提供的上下文。',
          '任务收尾时必须单独调用 finalize_result 提交结构化结果：summary 非空并说明做了什么与结果如何，没有内容的列表提交空数组。outcome 如实陈述（succeeded/partial/blocked），受阻或部分完成也是合法交付，不得编造验证成功。',
          '结构化结果包含结论、变更或证据引用、必要验证与未解决事项；长日志留在本任务记录中，不要复制进摘要。',
        ].join('\n\n'),
        model: input.model,
        permission,
        taskMode: input.taskMode ?? 'chat',
        sequence: 0,
        timestamp,
      })
      const itemOrdinal = (
        this.db.sqlite
          .query('SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM items WHERE turn_id = ?')
          .get(input.parentTurnID) as { ordinal: number }
      ).ordinal
      this.db.sqlite
        .query(
          `INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at) VALUES (?, ?, ?, ?, 'subagent', 'pending', ?, ?, ?, ?)`,
        )
        .run(
          itemID,
          input.parentThreadID,
          input.parentTurnID,
          input.parentAgentID,
          stringify({
            subagentTaskId: taskID,
            runId: runID,
            childThreadId: childThreadID,
            displayName: input.displayName,
            profile: input.profile,
            task: input.task,
            status: 'queued',
            queueReason: null,
            result: null,
          }),
          itemOrdinal,
          timestamp,
          timestamp,
        )
      const events = [
        this.db.insertEvent(input.parentThreadID, input.parentTurnID, 'subagent/created', {
          task: this.task(taskID),
          run: this.run(runID),
          itemId: itemID,
        }),
        this.db.insertEvent(input.parentThreadID, input.parentTurnID, 'item/started', {
          item: this.db.getItem(itemID),
        }),
        this.db.insertEvent(childThreadID, turnID, 'turn/queued', {
          turnId: turnID,
          inputID,
          createdAt: timestamp,
        }),
        this.db.insertEvent(childThreadID, turnID, 'agent/upserted', {
          agent: this.db.getAgentExecution(agentID),
        }),
      ]
      return {
        task: this.task(taskID)!,
        run: this.run(runID)!,
        agent: this.db.getAgentExecution(agentID)!,
        events,
      }
    })
  }

  private insertExecution(input: {
    childThreadID: string
    turnID: string
    agentID: string
    inputID: string
    runID: string
    parentAgentID: string
    profile: Exclude<SubagentProfile, 'main'>
    task: string
    content?: string
    model: Model.Ref
    permission: PermissionConfig
    taskMode: 'chat' | 'plan'
    sequence: number
    timestamp: number
  }) {
    this.db.repositories.planApprovals.invalidate(input.childThreadID)
    this.db.sqlite
      .query(
        `INSERT INTO turns (id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, strategy, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, 'queue', NULL, NULL, ?, ?)`,
      )
      .run(
        input.turnID,
        input.childThreadID,
        input.agentID,
        input.taskMode,
        input.permission.sandboxMode,
        encodeApprovalPolicy(input.permission.approvalPolicy),
        input.permission.approvalsReviewer,
        stringify(input.model),
        input.timestamp,
        input.timestamp,
      )
    this.db.sqlite
      .query(
        `INSERT INTO agent_executions (id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, subagent_run_id, run_sequence, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?)`,
      )
      .run(
        input.agentID,
        input.childThreadID,
        input.turnID,
        input.parentAgentID,
        input.profile,
        input.task,
        stringify(input.model),
        `subagent:${this.taskIDForRun(input.runID)}`,
        (this.db.getAgentExecution(input.parentAgentID)?.depth ?? 0) + 1,
        input.runID,
        input.sequence,
        input.timestamp,
        input.timestamp,
      )
    this.db.sqlite
      .query(
        `INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queue', ?, 'queued', ?)`,
      )
      .run(
        input.inputID,
        input.childThreadID,
        input.turnID,
        input.content ?? input.task,
        stringify(input.model),
        input.permission.sandboxMode,
        encodeApprovalPolicy(input.permission.approvalPolicy),
        input.permission.approvalsReviewer,
        input.taskMode,
        input.timestamp,
      )
    const ordinal = (
      this.db.sqlite
        .query('SELECT COALESCE(MAX(ordinal), -1) + 1 AS value FROM messages WHERE thread_id = ?')
        .get(input.childThreadID) as { value: number }
    ).value
    this.db.sqlite
      .query(
        "INSERT INTO messages (id, thread_id, turn_id, role, content, ordinal, created_at) VALUES (?, ?, ?, 'user', ?, ?, ?)",
      )
      .run(
        input.inputID,
        input.childThreadID,
        input.turnID,
        input.content ?? input.task,
        ordinal,
        input.timestamp,
      )
  }

  private taskIDForRun(runID: string) {
    const row = this.db.sqlite
      .query('SELECT task_id FROM subagent_runs WHERE id = ?')
      .get(runID) as { task_id: string } | null
    if (!row) throw new Error(`Subagent run ${runID} 不存在`)
    return row.task_id
  }

  task(taskID: string): SubagentTask | null {
    const row = this.db.sqlite
      .query(
        'SELECT id, parent_thread_id, parent_turn_id, parent_agent_id, child_thread_id, display_name, profile, task, permission_ceiling, workspace_mode, workspace_state, current_run_id, created_at, updated_at FROM subagent_tasks WHERE id = ?',
      )
      .get(taskID) as Record<string, string | number | null> | null
    if (!row) return null
    const workspace = parse<SubagentTask['workspace']>(String(row.workspace_state))
    return {
      id: String(row.id),
      parentThreadId: String(row.parent_thread_id),
      parentTurnId: String(row.parent_turn_id),
      parentAgentId: String(row.parent_agent_id),
      childThreadId: String(row.child_thread_id),
      notices: this.collaborationAvailable
        ? (this.db.sqlite
            .query(
              "SELECT id, kind, message, created_at AS createdAt FROM subagent_messages WHERE task_id = ? AND kind IN ('report','settled') ORDER BY created_at, id",
            )
            .all(String(row.id)) as Array<{
            id: string
            kind: 'report' | 'settled'
            message: string
            createdAt: number
          }>)
        : [],
      parentTaskId:
        (
          this.db.sqlite
            .query('SELECT id FROM subagent_tasks WHERE child_thread_id = ?')
            .get(String(row.parent_thread_id)) as { id: string } | null
        )?.id ?? null,
      depth:
        this.db.getAgentExecution(this.latestExecution(String(row.current_run_id))?.id ?? '')
          ?.depth ?? 1,
      waitingForDescendants:
        this.collaborationAvailable &&
        Boolean(
          this.db.sqlite
            .query('SELECT 1 FROM subagent_completions WHERE thread_id = ?')
            .get(String(row.child_thread_id)),
        ),
      queuedFollowups: (
        this.db.sqlite
          .query(
            "SELECT COUNT(*) AS count FROM subagent_runs WHERE task_id = ? AND status = 'queued' AND id != ?",
          )
          .get(String(row.id), String(row.current_run_id)) as { count: number }
      ).count,
      displayName: String(row.display_name),
      profile: String(row.profile) as SubagentTask['profile'],
      task: String(row.task),
      permissionCeiling: parse(String(row.permission_ceiling)),
      workspace,
      currentRun: row.current_run_id ? this.run(String(row.current_run_id)) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  run(runID: string): SubagentRun | null {
    const row = this.db.sqlite
      .query(
        'SELECT id, task_id, generation, status, queue_reason, model_ref, permission_config, result, error, created_at, started_at, finished_at, updated_at FROM subagent_runs WHERE id = ?',
      )
      .get(runID) as Record<string, string | number | null> | null
    if (!row) return null
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      generation: Number(row.generation),
      status: String(row.status).replaceAll('_', '-') as SubagentRun['status'],
      queueReason:
        row.queue_reason == null
          ? null
          : (String(row.queue_reason).replaceAll('_', '-') as SubagentRun['queueReason']),
      model: parse(String(row.model_ref)),
      permissionConfig: parse(String(row.permission_config)),
      result: row.result == null ? null : parse(String(row.result)),
      error: row.error == null ? null : String(row.error),
      createdAt: Number(row.created_at),
      startedAt: row.started_at == null ? null : Number(row.started_at),
      finishedAt: row.finished_at == null ? null : Number(row.finished_at),
      updatedAt: Number(row.updated_at),
    }
  }

  latestExecution(runID: string): { id: string; turn_id: string; run_sequence: number } | null {
    return this.db.sqlite
      .query(
        'SELECT id, turn_id, run_sequence FROM agent_executions WHERE subagent_run_id = ? ORDER BY run_sequence DESC LIMIT 1',
      )
      .get(runID) as { id: string; turn_id: string; run_sequence: number } | null
  }

  projectionForThread(threadID: string, includeDescendants = false): SubagentProjection[] {
    const rows = this.db.sqlite
      .query(
        includeDescendants
          ? `WITH RECURSIVE tree AS (SELECT id, child_thread_id FROM subagent_tasks WHERE parent_thread_id = ? UNION ALL SELECT t.id, t.child_thread_id FROM subagent_tasks t JOIN tree p ON t.parent_thread_id = p.child_thread_id) SELECT id FROM tree`
          : 'SELECT id FROM subagent_tasks WHERE parent_thread_id = ? ORDER BY created_at',
      )
      .all(threadID) as Array<{ id: string }>
    return rows.flatMap(({ id }) => {
      const task = this.task(id)
      return task ? [{ task, currentRun: task.currentRun }] : []
    })
  }

  projectionForTask(taskID: string): SubagentProjection | null {
    const task = this.task(taskID)
    return task ? { task, currentRun: task.currentRun } : null
  }

  queuedRunIDs() {
    return (
      this.db.sqlite
        .query(
          "SELECT r.id FROM subagent_runs r JOIN subagent_tasks t ON t.current_run_id = r.id WHERE r.status = 'queued' ORDER BY r.created_at, r.generation, r.id",
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id)
  }

  claim(runID: string): SubagentClaim | { queued: true } | null {
    return this.db.transaction(() => {
      const run = this.run(runID)
      if (!run || run.status !== 'queued') return null
      const task = this.task(run.taskId)
      if (!task) return null
      const global = this.db.sqlite
        .query(
          `SELECT COUNT(*) AS count FROM subagent_runs r WHERE r.status IN (${activeStatuses.map(() => '?').join(',')}) AND EXISTS (SELECT 1 FROM agent_executions a WHERE a.subagent_run_id = r.id AND a.status = 'running')`,
        )
        .get(...activeStatuses) as { count: number }
      if (global.count >= 6) return this.keepQueued(task.id, runID, 'global_limit')
      const parent = this.db.sqlite
        .query(
          `SELECT COUNT(*) AS count FROM subagent_tasks t WHERE parent_thread_id = ? AND status IN (${activeStatuses.map(() => '?').join(',')}) AND EXISTS (SELECT 1 FROM agent_executions a WHERE a.subagent_run_id = t.current_run_id AND a.status = 'running')`,
        )
        .get(task.parentThreadId, ...activeStatuses) as { count: number }
      if (parent.count >= 4) return this.keepQueued(task.id, runID, 'parent_limit')
      const agentRow = this.latestExecution(runID)
      if (!agentRow) throw new Error(`Subagent run ${runID} 没有 AgentExecution`)
      const timestamp = now()
      this.db.sqlite
        .query(
          "UPDATE subagent_runs SET status = 'running', queue_reason = NULL, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(timestamp, timestamp, runID)
      this.db.sqlite
        .query("UPDATE subagent_tasks SET status = 'running', updated_at = ? WHERE id = ?")
        .run(timestamp, task.id)
      this.updateParentItem(task.id, runID, 'running', null, null, timestamp)
      this.db.sqlite
        .query(
          "UPDATE agent_executions SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(timestamp, agentRow.id)
      this.db.sqlite
        .query(
          "UPDATE turns SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(timestamp, timestamp, agentRow.turn_id)
      this.db.sqlite
        .query("UPDATE inputs SET status = 'active' WHERE turn_id = ? AND status = 'queued'")
        .run(agentRow.turn_id)
      this.db.repositories.threadGoalLedger.openInterval({
        threadId: task.parentThreadId,
        agentId: agentRow.id,
      })
      return {
        task: this.task(task.id)!,
        run: this.run(runID)!,
        agent: this.db.getAgentExecution(agentRow.id)!,
      }
    })
  }

  markSteering(runID: string) {
    const run = this.run(runID)
    if (!run || terminalStatuses.has(run.status)) return null
    const timestamp = now()
    this.db.sqlite
      .query("UPDATE subagent_runs SET status = 'steering', updated_at = ? WHERE id = ?")
      .run(timestamp, runID)
    this.db.sqlite
      .query("UPDATE subagent_tasks SET status = 'steering', updated_at = ? WHERE id = ?")
      .run(timestamp, run.taskId)
    this.updateParentItem(run.taskId, runID, 'steering', null, null, timestamp)
    return this.run(runID)
  }

  setWaiting(runID: string, status: 'waiting_question' | 'waiting_permission') {
    const run = this.run(runID)
    if (!run || terminalStatuses.has(run.status)) return null
    const waitingAgent = this.latestExecution(runID)
    if (waitingAgent) this.db.repositories.threadGoalLedger.closeAgentIntervals(waitingAgent.id)
    const timestamp = now()
    this.db.sqlite
      .query('UPDATE subagent_runs SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, timestamp, runID)
    this.db.sqlite
      .query('UPDATE subagent_tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, timestamp, run.taskId)
    this.updateParentItem(run.taskId, runID, status, null, null, timestamp)
    return this.run(runID)
  }

  setRunning(runID: string) {
    const run = this.run(runID)
    if (!run || terminalStatuses.has(run.status)) return null
    const resumedAgent = this.latestExecution(runID)
    const resumedTask = this.task(run.taskId)
    if (resumedAgent && resumedTask) {
      this.db.repositories.threadGoalLedger.openInterval({
        threadId: resumedTask.parentThreadId,
        agentId: resumedAgent.id,
      })
    }
    const timestamp = now()
    this.db.sqlite
      .query("UPDATE subagent_runs SET status = 'running', updated_at = ? WHERE id = ?")
      .run(timestamp, runID)
    this.db.sqlite
      .query("UPDATE subagent_tasks SET status = 'running', updated_at = ? WHERE id = ?")
      .run(timestamp, run.taskId)
    this.updateParentItem(run.taskId, runID, 'running', null, null, timestamp)
    return this.run(runID)
  }

  continueTask(input: {
    taskID: string
    message: string
    model?: Model.Ref
    permission?: PermissionConfig
    sameRun: boolean
    enqueue?: boolean
  }) {
    const task = this.task(input.taskID)
    if (!task?.currentRun) throw new Error(`Subagent task ${input.taskID} 不存在`)
    const previousRun = task.currentRun
    const previousAgent = this.latestExecution(previousRun.id)
    if (!previousAgent) throw new Error(`Subagent run ${previousRun.id} 没有 AgentExecution`)
    const runID = input.sameRun ? previousRun.id : crypto.randomUUID()
    const generation = input.sameRun
      ? previousRun.generation
      : (
          this.db.sqlite
            .query('SELECT MAX(generation) AS value FROM subagent_runs WHERE task_id = ?')
            .get(task.id) as { value: number }
        ).value + 1
    const timestamp = now()
    const model = input.model ?? previousRun.model
    const permission = input.permission ?? previousRun.permissionConfig
    const taskMode =
      (
        this.db.sqlite
          .query('SELECT task_mode FROM threads WHERE id = ?')
          .get(task.childThreadId) as { task_mode: 'chat' | 'plan' } | null
      )?.task_mode ?? 'chat'
    const turnID = crypto.randomUUID()
    const agentID = crypto.randomUUID()
    const inputID = crypto.randomUUID()
    return this.db.transaction(() => {
      if (input.sameRun) {
        this.db.updateAgentStatus(
          previousAgent.id,
          'interrupted',
          '收到用户补充要求，在安全边界继续',
        )
        this.db.updateTurnStatus(previousAgent.turn_id, 'interrupted')
        this.db.sqlite
          .query(
            "UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, error = NULL, finished_at = NULL, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, runID)
      } else {
        this.db.sqlite
          .query(
            `INSERT INTO subagent_runs (id, task_id, generation, status, queue_reason, model_ref, permission_config, result, error, created_at, started_at, finished_at, updated_at) VALUES (?, ?, ?, 'queued', NULL, ?, ?, NULL, NULL, ?, NULL, NULL, ?)`,
          )
          .run(
            runID,
            task.id,
            generation,
            stringify(model),
            stringify(permission),
            timestamp,
            timestamp,
          )
        if (!input.enqueue)
          this.db.sqlite
            .query(
              "UPDATE subagent_tasks SET current_run_id = ?, status = 'queued', updated_at = ? WHERE id = ?",
            )
            .run(runID, timestamp, task.id)
      }
      this.insertExecution({
        childThreadID: task.childThreadId,
        turnID,
        agentID,
        inputID,
        runID,
        parentAgentID: task.parentAgentId,
        profile: task.profile,
        task: input.message,
        model,
        permission,
        taskMode,
        sequence: input.sameRun ? previousAgent.run_sequence + 1 : 0,
        timestamp,
      })
      if (!input.enqueue)
        this.db.sqlite
          .query(
            "UPDATE items SET status = 'pending', data = json_set(data, '$.runId', ?, '$.status', 'queued', '$.queueReason', NULL, '$.result', NULL), updated_at = ? WHERE thread_id = ? AND type = 'subagent' AND json_extract(data, '$.subagentTaskId') = ?",
          )
          .run(runID, timestamp, task.parentThreadId, task.id)
      return {
        task: this.task(task.id)!,
        run: this.run(runID)!,
        agent: this.db.getAgentExecution(agentID)!,
      }
    })
  }

  private keepQueued(
    taskID: string,
    runID: string,
    reason: 'global_limit' | 'parent_limit' | 'workspace_writer',
  ) {
    const timestamp = now()
    this.db.sqlite
      .query('UPDATE subagent_runs SET queue_reason = ?, updated_at = ? WHERE id = ?')
      .run(reason, timestamp, runID)
    this.db.sqlite
      .query("UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE id = ?")
      .run(timestamp, taskID)
    this.updateParentItem(taskID, runID, 'queued', reason, null, timestamp)
    return { queued: true as const }
  }

  private updateParentItem(
    taskID: string,
    runID: string,
    status: string,
    queueReason: string | null,
    result: SubagentResult | null,
    timestamp: number,
  ) {
    const task = this.task(taskID)
    if (!task) return
    this.db.sqlite
      .query(
        "UPDATE items SET status = ?, data = json_set(data, '$.runId', ?, '$.status', ?, '$.queueReason', ?, '$.result', json(?)), updated_at = ? WHERE thread_id = ? AND type = 'subagent' AND json_extract(data, '$.subagentTaskId') = ?",
      )
      .run(
        status === 'completed'
          ? 'completed'
          : status === 'failed'
            ? 'error'
            : status === 'stopped' || status === 'interrupted'
              ? 'interrupted'
              : 'running',
        runID,
        status,
        queueReason,
        stringify(result),
        timestamp,
        task.parentThreadId,
        task.id,
      )
  }

  finish(
    runID: string,
    status: Extract<SubagentStatus, 'completed' | 'failed' | 'stopped' | 'interrupted'>,
    result: SubagentResult | null,
    error: string | null,
  ) {
    return this.db.transaction(() => {
      const run = this.run(runID)
      if (!run) return null
      const task = this.task(run.taskId)
      if (!task) return null
      const timestamp = now()
      this.db.sqlite
        .query(
          'UPDATE subagent_runs SET status = ?, result = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(status, result ? stringify(result) : null, error, timestamp, timestamp, runID)
      this.db.sqlite
        .query('UPDATE subagent_tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, timestamp, task.id)
      this.db.sqlite.query('DELETE FROM workspace_writer_leases WHERE run_id = ?').run(runID)
      const latestAgent = this.latestExecution(runID)
      if (latestAgent) {
        if (this.collaborationAvailable)
          this.db.sqlite
            .query('DELETE FROM subagent_completions WHERE turn_id = ?')
            .run(latestAgent.turn_id)
        this.db.updateAgentStatus(latestAgent.id, status === 'stopped' ? 'interrupted' : status)
        this.db.updateTurnStatus(latestAgent.turn_id, status === 'stopped' ? 'interrupted' : status)
        if (status === 'stopped')
          this.db.sqlite
            .query("UPDATE inputs SET status = 'cancelled' WHERE turn_id = ? AND status = 'queued'")
            .run(latestAgent.turn_id)
        if (status === 'completed') this.db.repositories.planApprovals.recover(task.childThreadId)
      }
      const itemStatus =
        status === 'completed'
          ? 'completed'
          : status === 'interrupted' || status === 'stopped'
            ? 'interrupted'
            : 'error'
      this.db.sqlite
        .query(
          "UPDATE items SET status = ?, data = json_set(data, '$.status', ?, '$.queueReason', NULL, '$.result', json(?)), updated_at = ? WHERE thread_id = ? AND type = 'subagent' AND json_extract(data, '$.subagentTaskId') = ?",
        )
        .run(itemStatus, status, stringify(result), timestamp, task.parentThreadId, task.id)
      return { task: this.task(task.id)!, run: this.run(runID)! }
    })
  }

  promoteFollowup(taskID: string) {
    const task = this.task(taskID)
    if (!task?.currentRun || !terminalStatuses.has(task.currentRun.status)) return false
    const next = this.db.sqlite
      .query(
        "SELECT id FROM subagent_runs WHERE task_id = ? AND status = 'queued' ORDER BY generation, created_at, id LIMIT 1",
      )
      .get(taskID) as { id: string } | null
    if (!next) return false
    this.db.sqlite
      .query(
        "UPDATE subagent_tasks SET current_run_id = ?, status = 'queued', updated_at = ? WHERE id = ?",
      )
      .run(next.id, now(), taskID)
    this.updateParentItem(taskID, next.id, 'queued', null, null, now())
    return true
  }

  createControl(input: {
    requestID: string
    taskID: string
    runID?: string | null
    action: string
    payload?: unknown
  }) {
    const timestamp = now()
    this.db.sqlite
      .query(
        "INSERT OR IGNORE INTO subagent_controls (id, task_id, run_id, action, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(
        input.requestID,
        input.taskID,
        input.runID ?? null,
        input.action,
        stringify(input.payload ?? {}),
        timestamp,
      )
    const control = this.control(input.requestID)!
    if (control.task_id !== input.taskID || control.action !== input.action) {
      throw new AgentError('REQUEST_ID_REUSED', 'requestId 已被其他子 Agent 操作使用', 409)
    }
    return control
  }

  control(id: string) {
    return this.db.sqlite
      .query(
        'SELECT id, task_id, run_id, action, payload, status, result, error, created_at, applied_at FROM subagent_controls WHERE id = ?',
      )
      .get(id) as Record<string, string | number | null> | null
  }

  pendingControls(runID: string) {
    return this.db.sqlite
      .query(
        "SELECT id, action, payload FROM subagent_controls WHERE run_id = ? AND status = 'pending' ORDER BY created_at",
      )
      .all(runID) as Array<{ id: string; action: string; payload: string }>
  }

  completeControl(id: string, result: unknown = null, error: string | null = null) {
    this.db.sqlite
      .query(
        'UPDATE subagent_controls SET status = ?, result = ?, error = ?, applied_at = ? WHERE id = ?',
      )
      .run(
        error ? 'failed' : 'applied',
        result == null ? null : stringify(result),
        error,
        now(),
        id,
      )
  }

  isTerminal(runID: string) {
    const run = this.run(runID)
    return Boolean(run && terminalStatuses.has(run.status))
  }

  eventsForUpdate(taskID: string): EventEnvelope[] {
    const task = this.task(taskID)
    if (!task || !task.currentRun) return []
    const event = this.db.insertEvent(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
      task,
      run: task.currentRun,
    })
    return [event]
  }
}
