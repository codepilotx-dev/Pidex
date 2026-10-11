import { Effect } from 'effect'
import { encodeApprovalPolicy } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import type {
  AgentExecution,
  EventEnvelope,
  Item,
  ModelRef,
  PermissionConfig,
  StoredInputDelivery,
  SubmitMessage,
  TaskMode,
  ToolInvocation,
  TurnStatus,
} from '../../Domain'
import type {
  AgentTurnCheckpoint,
  PermissionColumns,
  QueueMutationMeta,
  QueuePauseReason,
  SideEffectRecoveryPayload,
} from './RepositoryCore'
import { now, parse, permissionConfigFromRow, stringify } from './RepositoryCore'

import { ThreadRepositoryDatabase } from './ThreadRepository'
import { PlanApprovalRepository } from './PlanApprovalRepository'
import { ThreadGoalLedgerRepository } from './ThreadGoalLedgerRepository'
import { ThreadGoalRepository } from './ThreadGoalRepository'
import { ThreadGoalContinuationRepository } from './ThreadGoalContinuationRepository'

export abstract class ExecutionRepositoryDatabase extends ThreadRepositoryDatabase {
  bindInputAttachments(inputID: string, attachmentIDs: readonly string[]) {
    if (attachmentIDs.length === 0) return
    const input = this.sqlite.query('SELECT thread_id FROM inputs WHERE id = ?').get(inputID) as {
      thread_id: string
    } | null
    if (!input) throw new AgentError('INPUT_NOT_FOUND', '附件目标 input 不存在', 404)
    const timestamp = now()
    this.transaction(() => {
      for (const attachmentID of attachmentIDs) {
        const attachment = this.sqlite
          .query('SELECT input_id FROM input_attachments WHERE id = ?')
          .get(attachmentID) as { input_id: string | null } | null
        if (!attachment) throw new AgentError('ATTACHMENT_NOT_FOUND', '一个或多个附件不存在', 404)
        if (attachment.input_id && attachment.input_id !== inputID) {
          throw new AgentError('ATTACHMENT_ALREADY_BOUND', '附件已绑定到其他 input', 409)
        }
        this.sqlite
          .query(
            'UPDATE input_attachments SET thread_id = ?, input_id = ?, bound_at = COALESCE(bound_at, ?) WHERE id = ?',
          )
          .run(input.thread_id, inputID, timestamp, attachmentID)
      }
    })
  }

  recoverInterruptedExecutions(timestamp: number) {
    const interruptedTurns = this.sqlite
      .query(
        `
      SELECT id, thread_id, root_agent_id FROM turns
      WHERE status = 'running'
        OR (status = 'waiting_permission' AND NOT EXISTS (
          SELECT 1 FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id
          WHERE r.turn_id = turns.id AND r.status = 'pending' AND c.version = 1
            AND json_type(c.payload, '$.runState') = 'text' AND json_type(c.payload, '$.interruption') IS NOT NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM hook_trust_waiters AS w JOIN hook_trust_requests AS h ON h.id = w.request_id
          JOIN agent_checkpoints AS c ON c.turn_id = w.turn_id AND c.state = 'waiting_hook_trust'
          WHERE w.turn_id = turns.id AND h.status = 'pending'
        ))
        OR (status = 'waiting_question' AND NOT EXISTS (
          SELECT 1 FROM question_requests AS q LEFT JOIN agent_checkpoints AS c ON c.turn_id = q.turn_id AND c.state = 'waiting_question'
          WHERE q.turn_id = turns.id AND q.status = 'pending'
            AND (c.turn_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)
        ))
    `,
      )
      .all() as Array<{ id: string; thread_id: string; root_agent_id: string }>
    const interruptedItems = this.sqlite
      .query(
        `
      SELECT id FROM items
      WHERE status IN ('pending', 'running') AND type <> 'subagent'
        AND NOT (type = 'question' AND id IN (
          SELECT id FROM question_requests WHERE status = 'pending'
            AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL
              OR turn_id IN (SELECT turn_id FROM agent_checkpoints WHERE state = 'waiting_question'))
        ))
    `,
      )
      .all() as Array<{ id: string }>
    this.sqlite
      .query(
        `UPDATE turns SET status = 'interrupted', finished_at = ?, updated_at = ?
      WHERE status = 'running'
        OR (status = 'waiting_permission' AND NOT EXISTS (
          SELECT 1 FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id
          WHERE r.turn_id = turns.id AND r.status = 'pending' AND c.version = 1
            AND json_type(c.payload, '$.runState') = 'text' AND json_type(c.payload, '$.interruption') IS NOT NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM hook_trust_waiters AS w JOIN hook_trust_requests AS h ON h.id = w.request_id
          JOIN agent_checkpoints AS c ON c.turn_id = w.turn_id AND c.state = 'waiting_hook_trust'
          WHERE w.turn_id = turns.id AND h.status = 'pending'
        ))
        OR (status = 'waiting_question' AND NOT EXISTS (
          SELECT 1 FROM question_requests AS q LEFT JOIN agent_checkpoints AS c ON c.turn_id = q.turn_id AND c.state = 'waiting_question'
          WHERE q.turn_id = turns.id AND q.status = 'pending'
            AND (c.turn_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)
        ))
    `,
      )
      .run(timestamp, timestamp)
    this.sqlite
      .query(
        "UPDATE agent_executions SET status = 'interrupted', updated_at = ? WHERE status = 'running' OR (status IN ('waiting_permission','waiting_question') AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted'))",
      )
      .run(timestamp)
    this.sqlite
      .query(
        "UPDATE tool_calls SET status = 'interrupted', finished_at = ?, error = COALESCE(error, 'Agent 重启时工具执行被中断') WHERE status = 'running' AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted')",
      )
      .run(timestamp)
    this.sqlite
      .query(
        `UPDATE items SET status = 'interrupted', updated_at = ?
      WHERE status IN ('pending', 'running') AND type <> 'subagent'
        AND NOT (type = 'question' AND id IN (
          SELECT id FROM question_requests WHERE status = 'pending'
            AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL
              OR turn_id IN (SELECT turn_id FROM agent_checkpoints WHERE state = 'waiting_question'))
        ))
    `,
      )
      .run(timestamp)
    this.sqlite
      .query(
        `UPDATE threads SET queue_pause_reason = 'interrupted', queue_version = queue_version + 1, updated_at = ?
      WHERE kind = 'main' AND EXISTS (SELECT 1 FROM turns AS q WHERE q.thread_id = threads.id AND q.status = 'queued')
        AND EXISTS (SELECT 1 FROM turns AS stopped WHERE stopped.thread_id = threads.id AND stopped.status = 'interrupted' AND stopped.finished_at = ?)
    `,
      )
      .run(timestamp, timestamp)
    for (const turn of interruptedTurns) {
      const agent = this.getAgentExecution(turn.root_agent_id)
      if (agent) this.insertEvent(turn.thread_id, turn.id, 'agent/upserted', { agent })
      this.insertEvent(turn.thread_id, turn.id, 'turn/interrupted', {
        turnId: turn.id,
        rootAgentId: turn.root_agent_id,
        reason: 'process-restart',
        finishedAt: timestamp,
      })
    }
    for (const row of interruptedItems) {
      const item = this.getItem(row.id)
      if (item?.status !== 'interrupted') continue
      const thread = this.sqlite.query('SELECT thread_id FROM items WHERE id = ?').get(row.id) as {
        thread_id: string
      } | null
      if (thread) this.insertEvent(thread.thread_id, item.turnID, 'item/completed', { item })
    }
    const pausedThreads = this.sqlite
      .query(
        "SELECT id, queue_version, queue_pause_reason FROM threads WHERE queue_pause_reason = 'interrupted' AND updated_at = ?",
      )
      .all(timestamp) as Array<{ id: string; queue_version: number; queue_pause_reason: string }>
    for (const thread of pausedThreads) {
      this.insertEvent(thread.id, null, 'queue/updated', {
        threadId: thread.id,
        version: thread.queue_version,
        pauseReason: thread.queue_pause_reason,
        action: 'paused',
      })
    }
    this.sqlite
      .query(
        "UPDATE memory_jobs SET status = 'queued', started_at = NULL, updated_at = ? WHERE status = 'running'",
      )
      .run(timestamp)
  }

  createTurn(
    threadID: string,
    input: SubmitMessage,
    status: TurnStatus = 'queued',
    ids: { inputID?: string; queueOperation?: QueueMutationMeta } = {},
  ) {
    const turnID = crypto.randomUUID()
    const agentID = crypto.randomUUID()
    const inputID = ids.inputID ?? crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      if (ids.queueOperation) {
        const state = this.queueStateMeta(threadID)
        if (!state) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
        if (
          ids.queueOperation.expectedVersion !== undefined &&
          ids.queueOperation.expectedVersion !== state.version
        ) {
          throw new AgentError('QUEUE_VERSION_CONFLICT', '队列版本已变化，请刷新后重试', 409, {
            expectedVersion: ids.queueOperation.expectedVersion,
            actualVersion: state.version,
          })
        }
      }
      const queuePosition =
        status === 'queued'
          ? (
              this.sqlite
                .query(
                  "SELECT COALESCE(MAX(queue_position), 0) AS position FROM turns WHERE thread_id = ? AND status = 'queued'",
                )
                .get(threadID) as { position: number }
            ).position + 1
          : null
      new PlanApprovalRepository(this).invalidate(threadID)
      const settingsUpdate = this.syncThreadSettings(threadID, {
        taskMode: input.taskMode,
        permissionConfig: input.permissionConfig,
      })
      this.sqlite
        .query(
          `INSERT INTO turns (id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, strategy, queue_position, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          turnID,
          threadID,
          agentID,
          status,
          input.taskMode,
          input.permissionConfig.sandboxMode,
          encodeApprovalPolicy(input.permissionConfig.approvalPolicy),
          input.permissionConfig.approvalsReviewer,
          stringify(input.model),
          input.strategy,
          queuePosition,
          timestamp,
          timestamp,
        )
      this.sqlite
        .query(
          `INSERT INTO agent_executions (id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, status, error, created_at, updated_at) VALUES (?, ?, ?, NULL, 'main', ?, ?, ?, 0, ?, NULL, ?, ?)`,
        )
        .run(
          agentID,
          threadID,
          turnID,
          input.content,
          stringify(input.model),
          `${threadID}:main`,
          status,
          timestamp,
          timestamp,
        )
      this.sqlite
        .query(
          `INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at, origin, skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          inputID,
          threadID,
          turnID,
          input.content,
          stringify(input.model),
          input.permissionConfig.sandboxMode,
          encodeApprovalPolicy(input.permissionConfig.approvalPolicy),
          input.permissionConfig.approvalsReviewer,
          input.strategy,
          input.taskMode,
          status === 'queued' ? 'queued' : 'active',
          timestamp,
          input.origin ?? null,
          input.skills ? stringify(input.skills) : null,
        )
      this.appendUserMessage({
        id: inputID,
        threadID,
        turnID,
        content: input.content,
        createdAt: timestamp,
      })
      const method = status === 'queued' ? 'turn/queued' : 'turn/started'
      const event = this.insertEvent(threadID, turnID, method, {
        turnId: turnID,
        inputID,
        input,
        createdAt: timestamp,
      })
      let queueEvent: EventEnvelope | null = null
      if (status === 'queued') {
        this.sqlite
          .query('UPDATE threads SET queue_version = queue_version + 1 WHERE id = ?')
          .run(threadID)
        if (input.strategy === 'queue') {
          const queue = this.queueStateMeta(threadID)!
          queueEvent = this.insertEvent(threadID, turnID, 'queue/updated', {
            threadId: threadID,
            turnId: turnID,
            inputId: inputID,
            version: queue.version,
            pauseReason: queue.pauseReason,
            action: 'added',
          })
          if (ids.queueOperation) {
            this.sqlite
              .query(
                "INSERT INTO queue_operations (operation_id, thread_id, method, event_id, created_at) VALUES (?, ?, 'queue/add', ?, ?)",
              )
              .run(ids.queueOperation.operationID, threadID, queueEvent.id, timestamp)
          }
        }
      }
      const agentEvent = this.insertEvent(threadID, turnID, 'agent/upserted', {
        agent: this.getAgentExecution(agentID),
      })
      return {
        turnID,
        agentID,
        inputID,
        settingsEvent: settingsUpdate.event,
        event,
        queueEvent,
        agentEvent,
      }
    })
  }

  appendGuide(threadID: string, turnID: string, input: SubmitMessage, inputID?: string) {
    const id = inputID ?? crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      new PlanApprovalRepository(this).invalidate(threadID)
      const settingsUpdate = this.syncThreadSettings(threadID, {
        taskMode: input.taskMode,
        permissionConfig: input.permissionConfig,
      })
      this.sqlite
        .query(
          `INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at, skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'guide', ?, 'mailbox', ?, ?)`,
        )
        .run(
          id,
          threadID,
          turnID,
          input.content,
          stringify(input.model),
          input.permissionConfig.sandboxMode,
          encodeApprovalPolicy(input.permissionConfig.approvalPolicy),
          input.permissionConfig.approvalsReviewer,
          input.taskMode,
          timestamp,
          input.skills ? stringify(input.skills) : null,
        )
      this.appendUserMessage({ id, threadID, turnID, content: input.content, createdAt: timestamp })
      const event = this.insertEvent(threadID, turnID, 'queue/updated', {
        threadId: threadID,
        turnId: turnID,
        inputId: id,
        action: 'steer-accepted',
      })
      return { inputID: id, settingsEvent: settingsUpdate.event, event }
    })
  }

  inputAdmission(inputID: string) {
    return this.sqlite
      .query(
        `
        SELECT id, thread_id, turn_id, content, strategy, skills
        FROM inputs WHERE id = ?
      `,
      )
      .get(inputID) as {
      id: string
      thread_id: string
      turn_id: string
      content: string
      strategy: string
      skills: string | null
    } | null
  }

  takeGuideMailbox(turnID: string) {
    return this.transaction(() => {
      const rows = this.guideMailbox(turnID)
      if (rows.length) {
        const placeholders = rows.map(() => '?').join(',')
        this.sqlite
          .query(`UPDATE inputs SET status = 'consumed' WHERE id IN (${placeholders})`)
          .run(...rows.map((row) => row.id))
      }
      return rows
    })
  }

  guideMailbox(turnID: string) {
    const rows = this.sqlite
      .query(
        "SELECT id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, task_mode, skills FROM inputs WHERE turn_id = ? AND status = 'mailbox' ORDER BY created_at, id",
      )
      .all(turnID) as Array<
      {
        id: string
        content: string
        model_ref: string
        task_mode: TaskMode
        skills: string | null
      } & PermissionColumns
    >
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      model: parse<ModelRef>(row.model_ref),
      permissionConfig: permissionConfigFromRow(row),
      taskMode: row.task_mode,
      ...(row.skills ? { skills: parse<NonNullable<SubmitMessage['skills']>>(row.skills) } : {}),
    }))
  }

  consumeGuideMailbox(turnID: string, inputIDs: readonly string[]) {
    if (inputIDs.length === 0) return []
    return this.transaction(() => {
      const placeholders = inputIDs.map(() => '?').join(',')
      const rows = this.sqlite
        .query(
          `SELECT id FROM inputs WHERE turn_id = ? AND status = 'mailbox' AND id IN (${placeholders})`,
        )
        .all(turnID, ...inputIDs) as Array<{ id: string }>
      if (rows.length) {
        const consumed = rows.map((row) => row.id)
        this.sqlite
          .query(
            `UPDATE inputs SET status = 'consumed' WHERE turn_id = ? AND status = 'mailbox' AND id IN (${consumed.map(() => '?').join(',')})`,
          )
          .run(turnID, ...consumed)
      }
      return rows.map((row) => row.id)
    })
  }

  claimTurnExecution(turnID: string) {
    const timestamp = now()
    return this.transaction(() => {
      const turn = this.sqlite
        .query("SELECT root_agent_id FROM turns WHERE id = ? AND status = 'queued'")
        .get(turnID) as { root_agent_id: string } | null
      if (!turn) return null
      const claimed = this.sqlite
        .query(
          `UPDATE agent_executions SET status = 'running', error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'`,
        )
        .run(timestamp, turn.root_agent_id)
      if (claimed.changes === 0) return null
      const started = this.sqlite
        .query(
          `UPDATE turns SET status = 'running', started_at = COALESCE(started_at, ?), finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'queued'`,
        )
        .run(timestamp, timestamp, turnID)
      if (started.changes === 0) throw new Error(`Turn ${turnID} claim 失败`)
      this.sqlite
        .query(`UPDATE inputs SET status = 'active' WHERE turn_id = ? AND status = 'queued'`)
        .run(turnID)
      this.sqlite
        .query(
          'UPDATE threads SET queue_version = queue_version + 1 WHERE id = (SELECT thread_id FROM turns WHERE id = ?)',
        )
        .run(turnID)
      const claimedThread = this.sqlite
        .query('SELECT thread_id FROM turns WHERE id = ?')
        .get(turnID) as { thread_id: string }
      this.goalLedger().openInterval({
        threadId: claimedThread.thread_id,
        agentId: turn.root_agent_id,
      })
      return this.getAgentExecution(turn.root_agent_id)
    })
  }

  startTurnExecution(turnID: string, input: SubmitMessage & { id: string }) {
    const timestamp = now()
    return this.transaction(() => {
      const row = this.sqlite
        .query("SELECT thread_id, root_agent_id FROM turns WHERE id = ? AND status = 'queued'")
        .get(turnID) as { thread_id: string; root_agent_id: string } | null
      if (!row) return null
      const claimed = this.sqlite
        .query(
          "UPDATE agent_executions SET status = 'running', error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(timestamp, row.root_agent_id)
      if (claimed.changes === 0) return null
      const started = this.sqlite
        .query(
          "UPDATE turns SET status = 'running', started_at = COALESCE(started_at, ?), finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(timestamp, timestamp, turnID)
      if (started.changes === 0) throw new Error(`Turn ${turnID} claim 失败`)
      this.sqlite
        .query("UPDATE inputs SET status = 'active' WHERE turn_id = ? AND status = 'queued'")
        .run(turnID)
      this.sqlite
        .query('UPDATE threads SET queue_version = queue_version + 1 WHERE id = ?')
        .run(row.thread_id)
      const agent = this.getAgentExecution(row.root_agent_id)!
      this.goalLedger().openInterval({ threadId: row.thread_id, agentId: agent.id })
      const events = [
        this.insertEvent(row.thread_id, turnID, 'agent/upserted', { agent }),
        this.insertEvent(row.thread_id, turnID, 'turn/started', {
          turnId: turnID,
          rootAgentId: agent.id,
          startedAt: timestamp,
          input,
        }),
      ]
      return { agent, events }
    })
  }

  finalizeTurn(input: {
    threadID: string
    turnID: string
    agentID: string
    status: 'completed' | 'failed' | 'interrupted'
    message?: string
    pauseReason?: Exclude<QueuePauseReason, null>
  }) {
    const timestamp = now()
    return this.transaction(() => {
      const interruptedMailbox =
        input.status === 'interrupted'
          ? (this.sqlite
              .query(
                `
              SELECT id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, task_mode, created_at
              FROM inputs
              WHERE thread_id = ? AND turn_id = ? AND status = 'mailbox'
              ORDER BY created_at, id
            `,
              )
              .all(input.threadID, input.turnID) as Array<{
              id: string
              content: string
              model_ref: string
              sandbox_mode: PermissionConfig['sandboxMode']
              approval_policy: string
              approvals_reviewer: PermissionConfig['approvalsReviewer']
              task_mode: TaskMode
              created_at: number
            }>)
          : []
      const requeuedSteers: Array<{ turnID: string; agentID: string; inputID: string }> = []
      if (interruptedMailbox.length > 0) {
        this.sqlite
          .query(
            "UPDATE turns SET queue_position = queue_position + ?, updated_at = ? WHERE thread_id = ? AND status = 'queued'",
          )
          .run(interruptedMailbox.length, timestamp, input.threadID)
        interruptedMailbox.forEach((mailbox, index) => {
          const nextTurnID = crypto.randomUUID()
          const nextAgentID = crypto.randomUUID()
          this.sqlite
            .query(
              `INSERT INTO turns (
              id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
              approvals_reviewer, model_ref, strategy, queue_position, started_at, finished_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, 'queue', ?, NULL, NULL, ?, ?)`,
            )
            .run(
              nextTurnID,
              input.threadID,
              nextAgentID,
              mailbox.task_mode,
              mailbox.sandbox_mode,
              mailbox.approval_policy,
              mailbox.approvals_reviewer,
              mailbox.model_ref,
              index + 1,
              mailbox.created_at,
              timestamp,
            )
          this.sqlite
            .query(
              `INSERT INTO agent_executions (
              id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id,
              depth, status, error, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, 'main', ?, ?, ?, 0, 'queued', NULL, ?, ?)`,
            )
            .run(
              nextAgentID,
              input.threadID,
              nextTurnID,
              mailbox.content,
              mailbox.model_ref,
              `${input.threadID}:main`,
              mailbox.created_at,
              timestamp,
            )
          this.sqlite
            .query(
              "UPDATE inputs SET turn_id = ?, strategy = 'queue', status = 'queued' WHERE id = ? AND status = 'mailbox'",
            )
            .run(nextTurnID, mailbox.id)
          this.sqlite
            .query('UPDATE messages SET turn_id = ? WHERE id = ?')
            .run(nextTurnID, mailbox.id)
          requeuedSteers.push({ turnID: nextTurnID, agentID: nextAgentID, inputID: mailbox.id })
        })
        this.sqlite
          .query(
            'UPDATE threads SET queue_version = queue_version + ?, updated_at = ? WHERE id = ?',
          )
          .run(interruptedMailbox.length, timestamp, input.threadID)
      }
      this.deleteAgentTurnCheckpoint(input.turnID)
      this.updateTurnStatus(input.turnID, input.status)
      const agent = this.updateAgentStatus(input.agentID, input.status, input.message ?? null)
      if (input.status === 'completed' || input.status === 'failed') {
        this.markThreadUnread(input.threadID, timestamp)
      }
      const terminalItemRows = (
        input.status === 'interrupted'
          ? this.sqlite.query(
              "SELECT id FROM items WHERE turn_id = ? AND status IN ('pending', 'running') ORDER BY ordinal",
            )
          : this.sqlite.query(
              "SELECT id FROM items WHERE turn_id = ? AND type = 'execution-plan' AND status IN ('pending', 'running') ORDER BY ordinal",
            )
      ).all(input.turnID) as Array<{ id: string }>
      if (input.status === 'interrupted') {
        this.sqlite
          .query(
            "UPDATE items SET status = 'interrupted', updated_at = ? WHERE turn_id = ? AND status IN ('pending', 'running')",
          )
          .run(timestamp, input.turnID)
        this.sqlite
          .query(
            "UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status IN ('preparing', 'pending', 'resolved', 'claimed')",
          )
          .run(timestamp, input.turnID)
        this.sqlite
          .query(
            "UPDATE question_requests SET status = 'cancelled', answer = COALESCE(answer, '__stopped__'), resolved_at = ? WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')",
          )
          .run(timestamp, input.turnID)
      }
      if (terminalItemRows.length && input.status !== 'interrupted') {
        this.sqlite
          .query(
            "UPDATE items SET status = ?, updated_at = ? WHERE turn_id = ? AND type = 'execution-plan' AND status IN ('pending', 'running')",
          )
          .run(input.status === 'completed' ? 'completed' : 'interrupted', timestamp, input.turnID)
      }
      if (input.status === 'completed') new PlanApprovalRepository(this).recover(input.threadID)
      const visibleGoal = new ThreadGoalRepository(this).get(input.threadID)
      const goalMeasurement = visibleGoal
        ? new ThreadGoalLedgerRepository(this).measureTurnForGoal({
            threadId: input.threadID,
            turnId: input.turnID,
            goal: { id: visibleGoal.id, createdAt: visibleGoal.createdAt },
          })
        : null
      const continuationRepository = new ThreadGoalContinuationRepository(this)
      const settledGoal = new ThreadGoalRepository(this).get(input.threadID)
      let continuation: ReturnType<ExecutionRepositoryDatabase['createTurn']> | null = null
      if (
        input.status === 'completed' &&
        settledGoal?.status === 'active' &&
        continuationRepository.available() &&
        !continuationRepository.hasSourceTurn(input.turnID) &&
        !this.sqlite
          .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
          .get(input.threadID) &&
        Boolean(
          this.sqlite
            .query(
              'SELECT 1 FROM threads WHERE id = ? AND archived_at IS NULL AND queue_pause_reason IS NULL',
            )
            .get(input.threadID),
        )
      ) {
        const previous = this.getTurnInput(input.turnID)
        if (previous) {
          const continuationInputId = crypto.randomUUID()
          continuation = this.createTurn(
            input.threadID,
            {
              content: `继续推进当前 Goal，基于已有任务上下文自主完成下一步。不要重复已完成的工作。\n\nGoal：${settledGoal.objective}`,
              model: previous.model,
              permissionConfig: previous.permissionConfig,
              strategy: 'queue',
              taskMode: previous.taskMode,
              origin: 'goal-continuation',
            },
            'queued',
            { inputID: continuationInputId },
          )
          continuationRepository.record({
            sourceTurnId: input.turnID,
            threadId: input.threadID,
            goalId: settledGoal.id,
            continuationTurnId: continuation.turnID,
            continuationInputId,
            triggerReason: 'turn-completed-goal-active',
            timestamp,
          })
        }
      }
      const events: EventEnvelope[] = [
        this.insertEvent(input.threadID, input.turnID, 'agent/upserted', { agent }),
        ...requeuedSteers.flatMap((queued) => [
          this.insertEvent(input.threadID, queued.turnID, 'turn/queued', {
            turnId: queued.turnID,
            inputId: queued.inputID,
            createdAt: timestamp,
          }),
          this.insertEvent(input.threadID, queued.turnID, 'agent/upserted', {
            agent: this.getAgentExecution(queued.agentID),
          }),
        ]),
        ...terminalItemRows.flatMap(({ id }) => {
          const item = this.getItem(id)
          return item
            ? [this.insertEvent(input.threadID, input.turnID, 'item/completed', { item })]
            : []
        }),
        this.insertEvent(input.threadID, input.turnID, `turn/${input.status}`, {
          turnId: input.turnID,
          rootAgentId: input.agentID,
          ...(input.message ? { message: input.message } : {}),
          finishedAt: timestamp,
        }),
        ...(goalMeasurement ? [goalMeasurement.event] : []),
        ...(continuation
          ? [continuation.event, continuation.queueEvent, continuation.agentEvent].filter(
              (event): event is EventEnvelope => event !== null,
            )
          : []),
      ]
      if (
        input.pauseReason &&
        this.sqlite
          .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
          .get(input.threadID)
      ) {
        const current = this.queueStateMeta(input.threadID)
        if (current?.pauseReason !== input.pauseReason) {
          this.sqlite
            .query(
              'UPDATE threads SET queue_pause_reason = ?, queue_version = queue_version + 1, updated_at = ? WHERE id = ?',
            )
            .run(input.pauseReason, timestamp, input.threadID)
          const next = this.queueStateMeta(input.threadID)!
          events.push(
            this.insertEvent(input.threadID, null, 'queue/updated', {
              threadId: input.threadID,
              version: next.version,
              pauseReason: next.pauseReason,
              action: 'paused',
            }),
          )
        }
      }
      return { agent, events }
    })
  }

  prepareSteerContinuation(turnID: string) {
    const timestamp = now()
    return this.transaction(() => {
      const row = this.sqlite
        .query("SELECT thread_id, root_agent_id FROM turns WHERE id = ? AND status = 'running'")
        .get(turnID) as { thread_id: string; root_agent_id: string } | null
      if (!row) return null
      this.sqlite
        .query(
          "UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ?",
        )
        .run(timestamp, turnID)
      this.sqlite
        .query(
          "UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?",
        )
        .run(timestamp, row.root_agent_id)
      return { threadID: row.thread_id, agent: this.getAgentExecution(row.root_agent_id)! }
    })
  }

  updateTurnStatus(turnID: string, status: TurnStatus) {
    const timestamp = now()
    const terminal = ['completed', 'failed', 'interrupted', 'cancelled'].includes(status)
    this.sqlite
      .query(
        `UPDATE turns SET status = ?, finished_at = CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE finished_at END, updated_at = ? WHERE id = ?`,
      )
      .run(status, terminal ? 1 : 0, timestamp, status === 'queued' ? 1 : 0, timestamp, turnID)
    if (terminal)
      this.sqlite
        .query("UPDATE inputs SET status = 'completed' WHERE turn_id = ? AND status = 'active'")
        .run(turnID)
  }

  getAgentExecution(agentID: string): AgentExecution | null {
    const row = this.sqlite
      .query(
        'SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, status, error, subagent_run_id, run_sequence, created_at, updated_at FROM agent_executions WHERE id = ?',
      )
      .get(agentID) as Record<string, string | number | null> | null
    return row
      ? {
          id: String(row.id),
          threadID: String(row.thread_id),
          turnID: String(row.turn_id),
          parentAgentID: row.parent_agent_id == null ? null : String(row.parent_agent_id),
          profile: String(row.profile),
          task: String(row.task),
          model: parse<ModelRef>(String(row.model_ref)),
          sessionID: String(row.session_id),
          depth: Number(row.depth),
          status: String(row.status) as AgentExecution['status'],
          error: row.error == null ? null : String(row.error),
          subagentRunID: row.subagent_run_id == null ? null : String(row.subagent_run_id),
          runSequence: Number(row.run_sequence ?? 0),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }
      : null
  }

  agentForTurn(turnID: string) {
    const row = this.sqlite.query('SELECT root_agent_id FROM turns WHERE id = ?').get(turnID) as {
      root_agent_id: string | null
    } | null
    return row?.root_agent_id ? this.getAgentExecution(row.root_agent_id) : null
  }

  private goalLedger() {
    return new ThreadGoalLedgerRepository(this)
  }

  updateAgentStatus(
    agentID: string,
    status: AgentExecution['status'],
    error: string | null = null,
  ) {
    const result = this.sqlite
      .query('UPDATE agent_executions SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error, now(), agentID)
    if (result.changes === 0) throw new Error(`Agent ${agentID} 不存在`)
    // Waiting, paused and terminal states all stop counting as active run time.
    if (status !== 'running') this.goalLedger().closeAgentIntervals(agentID)
    return this.getAgentExecution(agentID)!
  }

  upsertToolCall(
    invocation: ToolInvocation,
    status: 'running' | 'completed' | 'error' | 'interrupted',
    output: unknown = null,
    error: string | null = null,
    startedAt = now(),
  ) {
    const finishedAt = status === 'running' ? null : now()
    this.sqlite
      .query(
        `INSERT INTO tool_calls (id, thread_id, turn_id, agent_id, tool_name, input, output, status, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET output = excluded.output, status = excluded.status, finished_at = excluded.finished_at, error = excluded.error`,
      )
      .run(
        invocation.id,
        invocation.threadID,
        invocation.turnID,
        invocation.agentID,
        invocation.name,
        stringify(invocation.input),
        output == null ? null : stringify(output),
        status,
        startedAt,
        finishedAt,
        error,
      )
  }

  completedToolCall(toolCallID: string) {
    const row = this.sqlite
      .query(
        "SELECT tool_name, input, output FROM tool_calls WHERE id = ? AND status = 'completed'",
      )
      .get(toolCallID) as { tool_name: string; input: string; output: string | null } | null
    return row
      ? {
          name: row.tool_name,
          input: parse<Record<string, unknown>>(row.input),
          output: row.output == null ? null : parse<unknown>(row.output),
        }
      : null
  }

  completedToolEvidenceForTurn(turnID: string) {
    const rows = this.sqlite
      .query(
        `
        SELECT id, tool_name
        FROM tool_calls
        WHERE turn_id = ? AND status = 'completed'
        ORDER BY COALESCE(finished_at, started_at, 0), id
        LIMIT 100
    `,
      )
      .all(turnID) as Array<{ id: string; tool_name: string }>
    return rows.map((row) => ({
      toolCallID: row.id,
      tool: row.tool_name,
      summary: '工具调用已完成，结果保存在会话历史中',
    }))
  }

  hasPersistedToolResult(turnID: string, toolCallID: string) {
    return Boolean(
      this.sqlite
        .query(
          `
        SELECT 1
        FROM pi_session_entries AS entry
        JOIN agent_executions AS execution ON execution.session_id = entry.session_id
        WHERE execution.turn_id = ?
          AND json_extract(entry.payload, '$.type') = 'message'
          AND json_extract(entry.payload, '$.message.role') = 'toolResult'
          AND json_extract(entry.payload, '$.message.toolCallId') = ?
        LIMIT 1
      `,
        )
        .get(turnID, toolCallID),
    )
  }

  nextQueuedTurn(threadID: string) {
    const state = this.queueStateMeta(threadID)
    if (!state || state.pauseReason) return null
    return this.sqlite
      .query(
        "SELECT id FROM turns WHERE thread_id = ? AND status = 'queued' ORDER BY queue_position, created_at, id LIMIT 1",
      )
      .get(threadID) as { id: string } | null
  }

  queueStateMeta(threadID: string) {
    const row = this.sqlite
      .query('SELECT queue_version, queue_pause_reason FROM threads WHERE id = ?')
      .get(threadID) as { queue_version: number; queue_pause_reason: QueuePauseReason } | null
    return row ? { version: row.queue_version, pauseReason: row.queue_pause_reason } : null
  }

  hasGuideMailbox(turnID: string) {
    return Boolean(
      this.sqlite
        .query("SELECT 1 FROM inputs WHERE turn_id = ? AND status = 'mailbox' LIMIT 1")
        .get(turnID),
    )
  }

  queuedInput(inputID: string) {
    return this.sqlite
      .query(
        `
        SELECT i.id, i.thread_id, i.turn_id, i.content, i.model_ref, i.sandbox_mode, i.approval_policy,
          i.approvals_reviewer, i.strategy, i.task_mode, t.queue_position
        FROM inputs AS i JOIN turns AS t ON t.id = i.turn_id
        WHERE i.id = ? AND i.status = 'queued' AND t.status = 'queued'
      `,
      )
      .get(inputID) as
      | ({
          id: string
          thread_id: string
          turn_id: string
          content: string
          model_ref: string
          strategy: StoredInputDelivery
          task_mode: TaskMode
          queue_position: number | null
        } & PermissionColumns)
      | null
  }

  private eventByID(id: number): EventEnvelope | null {
    const row = this.sqlite
      .query('SELECT id, thread_id, turn_id, method, params, created_at FROM events WHERE id = ?')
      .get(id) as {
      id: number
      thread_id: string | null
      turn_id: string | null
      method: string
      params: string
      created_at: number
    } | null
    return row
      ? {
          id: row.id,
          threadId: row.thread_id,
          turnId: row.turn_id,
          method: row.method,
          params: parse(row.params),
          createdAt: row.created_at,
        }
      : null
  }

  lookupQueueOperation(threadID: string, method: string, operationID: string) {
    const existing = this.sqlite
      .query('SELECT thread_id, method, event_id FROM queue_operations WHERE operation_id = ?')
      .get(operationID) as { thread_id: string; method: string; event_id: number | null } | null
    if (!existing) return null
    if (existing.thread_id !== threadID || existing.method !== method)
      throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他队列操作', 409)
    return {
      duplicate: true as const,
      event: existing.event_id == null ? null : this.eventByID(existing.event_id),
      details: {},
      ...this.queueStateMeta(threadID)!,
    }
  }

  private mutateQueue<T extends Record<string, unknown>>(
    threadID: string,
    method: 'queue/update' | 'queue/remove' | 'queue/resume',
    action: 'edited' | 'removed' | 'resumed',
    meta: QueueMutationMeta,
    mutate: () => T,
  ) {
    return this.transaction(() => {
      const state = this.queueStateMeta(threadID)
      if (!state) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      const existing = this.sqlite
        .query('SELECT thread_id, method, event_id FROM queue_operations WHERE operation_id = ?')
        .get(meta.operationID) as {
        thread_id: string
        method: string
        event_id: number | null
      } | null
      if (existing) {
        if (existing.thread_id !== threadID || existing.method !== method)
          throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他队列操作', 409)
        return {
          duplicate: true as const,
          event: existing.event_id == null ? null : this.eventByID(existing.event_id),
          details: {} as T,
          ...this.queueStateMeta(threadID)!,
        }
      }
      if (meta.expectedVersion !== undefined && meta.expectedVersion !== state.version) {
        throw new AgentError('QUEUE_VERSION_CONFLICT', '队列版本已变化，请刷新后重试', 409, {
          expectedVersion: meta.expectedVersion,
          actualVersion: state.version,
        })
      }
      const details = mutate()
      this.sqlite
        .query('UPDATE threads SET queue_version = queue_version + 1, updated_at = ? WHERE id = ?')
        .run(now(), threadID)
      const next = this.queueStateMeta(threadID)!
      const event = this.insertEvent(threadID, null, 'queue/updated', {
        threadId: threadID,
        version: next.version,
        pauseReason: next.pauseReason,
        action,
        ...details,
      })
      this.sqlite
        .query(
          'INSERT INTO queue_operations (operation_id, thread_id, method, event_id, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(meta.operationID, threadID, method, event.id, now())
      return { duplicate: false as const, event, details, ...next }
    })
  }

  updateQueuedInput(
    threadID: string,
    inputID: string,
    content: string,
    meta: QueueMutationMeta,
    skills?: SubmitMessage['skills'],
  ) {
    return this.mutateQueue(threadID, 'queue/update', 'edited', meta, () => {
      const input = this.queuedInput(inputID)
      if (!input || input.thread_id !== threadID)
        throw new AgentError('QUEUED_INPUT_NOT_FOUND', '排队消息不存在或已开始执行', 409)
      const timestamp = now()
      this.sqlite.query('UPDATE inputs SET content = ? WHERE id = ?').run(content, inputID)
      if (skills !== undefined)
        this.sqlite
          .query('UPDATE inputs SET skills = ? WHERE id = ?')
          .run(stringify(skills), inputID)
      this.sqlite.query('UPDATE messages SET content = ? WHERE id = ?').run(content, inputID)
      this.sqlite
        .query(
          'UPDATE threads SET preview = (SELECT substr(content, 1, 180) FROM messages WHERE thread_id = ? ORDER BY ordinal DESC, created_at DESC, id DESC LIMIT 1) WHERE id = ?',
        )
        .run(threadID, threadID)
      this.sqlite
        .query('UPDATE agent_executions SET task = ?, updated_at = ? WHERE turn_id = ?')
        .run(content, timestamp, input.turn_id)
      this.sqlite
        .query('UPDATE turns SET updated_at = ? WHERE id = ?')
        .run(timestamp, input.turn_id)
      return { inputId: inputID, turnId: input.turn_id }
    })
  }

  removeQueuedInput(threadID: string, inputID: string, meta: QueueMutationMeta) {
    return this.mutateQueue(threadID, 'queue/remove', 'removed', meta, () => {
      const input = this.queuedInput(inputID)
      if (!input || input.thread_id !== threadID)
        throw new AgentError('QUEUED_INPUT_NOT_FOUND', '排队消息不存在或已开始执行', 409)
      const timestamp = now()
      this.sqlite.query("UPDATE inputs SET status = 'cancelled' WHERE id = ?").run(inputID)
      this.sqlite
        .query(
          "UPDATE turns SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(timestamp, timestamp, input.turn_id)
      this.sqlite
        .query("UPDATE agent_executions SET status = 'cancelled', updated_at = ? WHERE turn_id = ?")
        .run(timestamp, input.turn_id)
      this.sqlite.query('DELETE FROM messages WHERE id = ?').run(inputID)
      if (
        !this.sqlite
          .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
          .get(threadID)
      ) {
        this.sqlite.query('UPDATE threads SET queue_pause_reason = NULL WHERE id = ?').run(threadID)
      }
      this.sqlite
        .query(
          `UPDATE threads SET
          message_count = (SELECT COUNT(*) FROM messages WHERE thread_id = ?),
          first_user_message = (SELECT content FROM messages WHERE thread_id = ? AND role = 'user' ORDER BY ordinal, created_at, id LIMIT 1),
          preview = (SELECT substr(content, 1, 180) FROM messages WHERE thread_id = ? ORDER BY ordinal DESC, created_at DESC, id DESC LIMIT 1)
          WHERE id = ?`,
        )
        .run(threadID, threadID, threadID, threadID)
      return { inputId: inputID, turnId: input.turn_id }
    })
  }

  resumeQueue(threadID: string, meta: QueueMutationMeta) {
    return this.mutateQueue(threadID, 'queue/resume', 'resumed', meta, () => {
      this.sqlite.query('UPDATE threads SET queue_pause_reason = NULL WHERE id = ?').run(threadID)
      return { resumed: true }
    })
  }

  pauseQueue(threadID: string, reason: Exclude<QueuePauseReason, null>) {
    return this.transaction(() => {
      if (
        !this.sqlite
          .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
          .get(threadID)
      )
        return null
      const current = this.queueStateMeta(threadID)
      if (!current || current.pauseReason === reason) return null
      this.sqlite
        .query(
          'UPDATE threads SET queue_pause_reason = ?, queue_version = queue_version + 1, updated_at = ? WHERE id = ?',
        )
        .run(reason, now(), threadID)
      const next = this.queueStateMeta(threadID)!
      return this.insertEvent(threadID, null, 'queue/updated', {
        threadId: threadID,
        version: next.version,
        pauseReason: next.pauseReason,
        action: 'paused',
      })
    })
  }

  getTurnInput(turnID: string) {
    const row = this.sqlite
      .query(
        'SELECT id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, skills FROM inputs WHERE turn_id = ? ORDER BY created_at LIMIT 1',
      )
      .get(turnID) as
      | ({
          id: string
          content: string
          model_ref: string
          strategy: StoredInputDelivery
          task_mode: TaskMode
          skills: string | null
        } & PermissionColumns)
      | null
    if (!row) return null
    return {
      id: row.id,
      content: row.content,
      model: parse(row.model_ref),
      permissionConfig: permissionConfigFromRow(row),
      strategy: row.strategy,
      taskMode: row.task_mode,
      ...(row.skills ? { skills: parse(row.skills) } : {}),
    } as SubmitMessage & { id: string }
  }

  getTurnStatus(turnID: string): TurnStatus | null {
    const row = this.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turnID) as {
      status: TurnStatus
    } | null
    return row?.status ?? null
  }

  saveAgentTurnCheckpoint(input: Omit<AgentTurnCheckpoint, 'createdAt' | 'updatedAt'>) {
    const timestamp = now()
    this.sqlite
      .query(
        `INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`,
      )
      .run(
        input.agentID,
        input.turnID,
        input.threadID,
        input.state,
        stringify(input.payload),
        input.version,
        timestamp,
        timestamp,
      )
    return this.getAgentTurnCheckpoint(input.turnID)!
  }

  getAgentTurnCheckpoint(turnID: string): AgentTurnCheckpoint | null {
    const row = this.sqlite
      .query(
        'SELECT agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at FROM agent_checkpoints WHERE turn_id = ?',
      )
      .get(turnID) as {
      agent_id: string
      turn_id: string
      thread_id: string
      state: AgentTurnCheckpoint['state']
      payload: string
      version: number
      created_at: number
      updated_at: number
    } | null
    return row
      ? {
          agentID: row.agent_id,
          turnID: row.turn_id,
          threadID: row.thread_id,
          state: row.state,
          payload: parse<Record<string, unknown>>(row.payload),
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null
  }

  interruptForSideEffectRecovery(input: {
    threadID: string
    turnID: string
    agentID: string
    payload: SideEffectRecoveryPayload
  }) {
    const timestamp = now()
    const events: EventEnvelope[] = []
    const checkpoint = this.transaction(() => {
      this.sqlite
        .query(
          `INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, 1, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`,
        )
        .run(
          input.agentID,
          input.turnID,
          input.threadID,
          stringify(input.payload),
          timestamp,
          timestamp,
        )
      this.updateTurnStatus(input.turnID, 'interrupted')
      this.updateAgentStatus(input.agentID, 'interrupted', '模型上下文超限；已保存副作用恢复证据')
      events.push(
        this.insertEvent(input.threadID, input.turnID, 'agent/upserted', {
          agent: this.getAgentExecution(input.agentID),
        }),
      )
      events.push(
        this.insertEvent(input.threadID, input.turnID, 'turn/interrupted', {
          turnId: input.turnID,
          rootAgentId: input.agentID,
          reason: 'side-effect-prompt-recovery',
          completedSideEffects: input.payload.completed,
          finishedAt: timestamp,
        }),
      )
      events.push(
        this.insertEvent(input.threadID, input.turnID, 'context/recoveryRequired', {
          turnId: input.turnID,
          agentId: input.agentID,
          attemptOrdinal: input.payload.attemptOrdinal,
          completedSideEffects: input.payload.completed,
          checkpointVersion: 1,
        }),
      )
      return this.getAgentTurnCheckpoint(input.turnID)!
    })
    return { checkpoint, events }
  }

  queueSideEffectRecovery(turnID: string) {
    const checkpoint = this.getAgentTurnCheckpoint(turnID)
    if (checkpoint?.state !== 'ready' || checkpoint.payload.kind !== 'side-effect-prompt-recovery')
      return false
    return this.transaction(() => {
      const turn = this.sqlite
        .query(
          "UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'interrupted'",
        )
        .run(now(), turnID)
      if (turn.changes !== 1) return false
      this.sqlite
        .query(
          "UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'interrupted'",
        )
        .run(now(), checkpoint.agentID)
      return true
    })
  }

  deleteAgentTurnCheckpoint(turnID: string) {
    this.sqlite.query('DELETE FROM agent_checkpoints WHERE turn_id = ?').run(turnID)
  }

  upsertItem(threadID: string, item: Item) {
    const existing = this.sqlite.query('SELECT ordinal FROM items WHERE id = ?').get(item.id) as {
      ordinal: number
    } | null
    const ordinal =
      item.ordinal ??
      existing?.ordinal ??
      Number(
        (
          this.sqlite
            .query('SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM items WHERE turn_id = ?')
            .get(item.turnID) as { ordinal: number }
        ).ordinal,
      )
    this.sqlite
      .query(
        `INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(
        item.id,
        threadID,
        item.turnID,
        item.agentID,
        item.type,
        item.status,
        stringify(item.data),
        ordinal,
        item.createdAt,
        item.updatedAt,
      )
  }

  updateExecutionPlan(input: {
    threadID: string
    turnID: string
    agentID: string
    explanation?: string
    plan: Array<{ step: string; status: 'pending' | 'in_progress' | 'completed' }>
  }) {
    const timestamp = now()
    const itemID = `${input.turnID}:execution-plan`
    return this.transaction(() => {
      const existing = this.getItem(itemID)
      const item: Item = {
        id: itemID,
        turnID: input.turnID,
        agentID: input.agentID,
        type: 'execution-plan',
        status: 'running',
        data: {
          ...(input.explanation ? { explanation: input.explanation } : {}),
          steps: input.plan,
        },
        ...(existing?.ordinal === undefined ? {} : { ordinal: existing.ordinal }),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      this.upsertItem(input.threadID, item)
      const persisted = this.getItem(itemID) ?? item
      const events: EventEnvelope[] = []
      if (!existing)
        events.push(
          this.insertEvent(input.threadID, input.turnID, 'item/started', { item: persisted }),
        )
      events.push(
        this.insertEvent(input.threadID, input.turnID, 'turn/plan/updated', { item: persisted }),
      )
      return { item: persisted, events }
    })
  }

  upsertItemWithEvent(
    threadID: string,
    item: Item,
    method: string,
    params?: unknown | ((item: Item) => unknown),
  ) {
    return this.transaction(() => {
      this.upsertItem(threadID, item)
      const persisted = this.getItem(item.id) ?? item
      return {
        item: persisted,
        event: this.insertEvent(
          threadID,
          item.turnID,
          method,
          typeof params === 'function' ? params(persisted) : (params ?? { item: persisted }),
        ),
      }
    })
  }

  getItem(itemID: string) {
    const row = this.sqlite
      .query(
        'SELECT id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at FROM items WHERE id = ?',
      )
      .get(itemID) as {
      id: string
      turn_id: string
      agent_id: string
      type: Item['type']
      status: Item['status']
      data: string
      ordinal: number
      created_at: number
      updated_at: number
    } | null
    return row
      ? ({
          id: row.id,
          turnID: row.turn_id,
          agentID: row.agent_id,
          type: row.type,
          status: row.status,
          data: parse<Record<string, unknown>>(row.data),
          ordinal: row.ordinal,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        } satisfies Item)
      : null
  }

  insertEvent(
    threadId: string | null,
    turnId: string | null,
    method: string,
    params: unknown,
  ): EventEnvelope {
    const createdAt = now()
    const result = this.sqlite
      .query(
        'INSERT INTO events (thread_id, turn_id, method, params, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(threadId, turnId, method, stringify(params), createdAt)
    return { id: Number(result.lastInsertRowid), threadId, turnId, method, params, createdAt }
  }

  eventsAfter(after: number, threadID?: string, limit = 1000): EventEnvelope[] {
    const rows = threadID
      ? this.sqlite
          .query(
            'SELECT id, thread_id, turn_id, method, params, created_at FROM events WHERE id > ? AND (thread_id = ? OR thread_id IS NULL) ORDER BY id LIMIT ?',
          )
          .all(after, threadID, limit)
      : this.sqlite
          .query(
            'SELECT id, thread_id, turn_id, method, params, created_at FROM events WHERE id > ? ORDER BY id LIMIT ?',
          )
          .all(after, limit)
    return (
      rows as Array<{
        id: number
        thread_id: string | null
        turn_id: string | null
        method: string
        params: string
        created_at: number
      }>
    ).map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      method: row.method,
      params: parse(row.params),
      createdAt: row.created_at,
    }))
  }

  effect<T>(operation: () => T) {
    return Effect.try({
      try: operation,
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
  }
}

export type ExecutionRepository = ExecutionRepositoryDatabase
export const executionRepository = (database: ExecutionRepositoryDatabase): ExecutionRepository =>
  database
