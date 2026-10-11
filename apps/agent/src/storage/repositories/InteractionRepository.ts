import type { ThreadSettings } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import type { ServerRequestResponse } from '@pidex/agent-protocol'
import type { EventEnvelope, ModelRef, PermissionConfig, ToolInvocation } from '../../Domain'
import {
  approvalCancelledPayload,
  interactionResolvedPayload,
} from '../events/InteractionEventPayloads'
import type {
  RecoveryLeaseSummary,
  ResolvedResumeCheckpoint,
  ResumeCheckpointConsumer,
  ResumeCheckpointKind,
  ResumeCheckpointLeaseStatus,
} from '../../interaction/Types'
import {
  hookTrustRequestedPayload,
  hookTrustResolvedPayload,
} from '../../interaction/HookTrustPayloads'

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
}

export type StoredEncryptedCredential = {
  id: string
  integrationID: string
  kind: 'api-key' | 'oauth'
  methodID: string | null
  label: string
  keySuffix: string | null
  fingerprint: string | null
  enabled: boolean
  priority: number
  ciphertext: string
  nonce: string
  keyVersion: number
  createdAt: number
  updatedAt: number
}

export type CredentialHealthStatus =
  'untested' | 'healthy' | 'auth-failed' | 'rate-limited' | 'error'
export type CredentialErrorCategory = 'authentication' | 'rate-limit' | 'network' | 'unknown'

export type StoredCredentialHealth = {
  credentialID: string
  status: CredentialHealthStatus
  lastTestedAt: number | null
  lastUsedAt: number | null
  lastErrorCategory: CredentialErrorCategory | null
  cooldownUntil: number | null
  updatedAt: number
}

export type StoredProject = {
  id: string
  name: string
  rootPath: string
  lastOpenedAt: number
  createdAt: number
  updatedAt: number
  settings: ProjectModelSettings
}

export type AgentTurnCheckpoint = {
  agentID: string
  turnID: string
  threadID: string
  state: 'waiting_question' | 'waiting_hook_trust' | 'waiting_subagents' | 'ready'
  payload: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
}

export type SideEffectRecoveryPayload = {
  kind: 'side-effect-prompt-recovery'
  attemptOrdinal: number
  completed: Array<{ toolCallID: string; tool: string; summary: string }>
  error: string
}

export type ResumableQuestion = {
  id: string
  threadID: string
  turnID: string
  toolCallID: string | null
  payload: Record<string, unknown>
  payloadVersion: number
  createdAt: number
}

export type ApprovalCheckpointPayload = {
  kind: 'tool-approval'
  invocation: ToolInvocation
  invocationHash: string
  permissionSnapshot: PermissionConfig
  sandbox: Record<string, unknown>
  reviewer: PermissionConfig['approvalsReviewer']
  review: Record<string, unknown>
  runState?: string
  interruption?: unknown
  resolution?: {
    decision: 'allow' | 'deny'
    feedback?: string
    resolvedAt: number
    computerGrant?: 'chat' | 'persistent'
    grantRule?: import('../../permission/ApprovalRules').ApprovalRule
  }
  claimedAt?: number
}

export type StoredApprovalCheckpoint = {
  approvalID: string
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  status: 'preparing' | 'pending' | 'resolved' | 'claimed' | 'cancelled'
  decision: 'allow' | 'deny' | null
  risk: string
  reason: string
  payload: ApprovalCheckpointPayload
  version: number
  createdAt: number
  updatedAt: number
}

export type SandboxEscalation = {
  token: string
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  invocation: ToolInvocation
  invocationHash: string
  failure: string
  status: 'awaiting_request' | 'claimed' | 'completed' | 'cancelled'
  createdAt: number
}

export type HookTrustRequest = {
  id: string
  threadID: string | null
  turnID: string | null
  workspacePath: string
  configPath: string
  configHash: string
  status: 'pending' | 'allowed' | 'blocked'
  auditSummary: Record<string, unknown>
  createdAt: number
  resolvedAt: number | null
}

const stringify = (value: unknown) => JSON.stringify(value ?? null)
const parse = <T>(value: string): T => JSON.parse(value) as T
const now = () => Date.now()
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const permissionGrantPrefix = '__permission_grant_v1__:'
const approvalInteractionResult = (
  checkpoint: StoredApprovalCheckpoint,
  decision: 'allow' | 'deny',
  feedback: string | undefined,
  operation: InteractionOperationInput | undefined,
): ServerRequestResponse => {
  if (operation) return operation.response as ServerRequestResponse
  if (checkpoint.payload.invocation.name !== 'request_permissions') {
    return {
      kind: 'approval',
      decision: decision === 'allow' ? 'allow-once' : 'deny',
      ...(feedback ? { feedback } : {}),
    }
  }
  if (decision === 'deny') return { kind: 'permission', decision: 'deny' }
  if (feedback?.startsWith(permissionGrantPrefix)) {
    const grant = record(parse<unknown>(feedback.slice(permissionGrantPrefix.length)))
    return {
      kind: 'permission',
      decision: 'grant',
      scope: grant.scope as 'tool-call' | 'turn' | 'session',
      grantedPermissions: record(grant.grantedPermissions),
    }
  }
  return {
    kind: 'permission',
    decision: 'grant',
    scope: 'tool-call',
    grantedPermissions: {},
  }
}
const questionInteractionResult = (
  interactionID: string,
  payload: Record<string, unknown>,
  answer: unknown,
  ignored: boolean,
  operation: InteractionOperationInput | undefined,
): ServerRequestResponse => {
  if (operation) return operation.response as ServerRequestResponse
  if (ignored) return { kind: 'question', status: 'ignored' }
  const stored = record(answer)
  if (
    (stored.resolution === 'user' || stored.resolution === 'auto') &&
    Array.isArray(stored.answers)
  ) {
    return {
      kind: 'question',
      status: 'answered',
      resolution: stored.resolution,
      answers: stored.answers as Array<{
        questionId: string
        choiceIds: string[]
        text?: string
        skipped?: true
      }>,
    }
  }
  const firstQuestion = Array.isArray(payload.questions) ? record(payload.questions[0]) : {}
  const questionID = typeof firstQuestion.id === 'string' ? firstQuestion.id : interactionID
  const matchingChoice = Array.isArray(firstQuestion.choices)
    ? firstQuestion.choices
        .map(record)
        .find((choice) => choice.label === answer && typeof choice.id === 'string')
    : undefined
  return {
    kind: 'question',
    status: 'answered',
    resolution: 'user',
    answers: [
      {
        questionId: questionID,
        choiceIds: typeof matchingChoice?.id === 'string' ? [matchingChoice.id] : [],
        ...(matchingChoice
          ? {}
          : { text: typeof answer === 'string' ? answer : stringify(answer) }),
      },
    ],
  }
}
export type QueuePauseReason = 'interrupted' | 'turn_failed' | null
export type QueueMutationMeta = { operationID: string; expectedVersion?: number }
export type InteractionOperationInput = {
  operationID: string
  interactionID: string
  response: Record<string, unknown>
  result: Record<string, unknown>
}

export type StoredThreadWorkspace =
  | {
      kind: 'project'
      projectID: string
      cwd: string
      runtimeWorkspaceRoots: Array<{
        folderId: string
        path: string
        role: 'primary' | 'secondary'
      }>
      instructionSources: string[]
      outputDirectory: null
    }
  | {
      kind: 'projectless'
      projectID: null
      workspaceRoot: string
      cwd: string
      outputDirectory: string
    }

export type CreateThreadInput = {
  id?: string
  title?: string | undefined
  settings?: ThreadSettings | undefined
  workspace:
    | { kind: 'project'; projectID: string }
    | { kind: 'projectless'; workspaceRoot: string; cwd: string; outputDirectory: string }
  operationID?: string | undefined
  requestHash?: string | undefined
}

export type CreatedThreadRecord = {
  id: string
  title: string
  projectID: string | null
  workspace: StoredThreadWorkspace | null
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  event: EventEnvelope
}

import { ExecutionRepositoryDatabase } from './ExecutionRepository'

export abstract class InteractionRepositoryDatabase extends ExecutionRepositoryDatabase {
  interactionTableAvailable(table: 'mcp_elicitations' | 'approval_reviews') {
    const columns = this.sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{
      name: string
    }>
    const required =
      table === 'mcp_elicitations'
        ? [
            'id',
            'thread_id',
            'turn_id',
            'agent_id',
            'tool_call_id',
            'connection_id',
            'payload',
            'version',
            'status',
            'response',
            'created_at',
          ]
        : [
            'id',
            'thread_id',
            'tool_call_id',
            'invocation',
            'fingerprint',
            'decision',
            'risk',
            'reason',
            'retry_operation_id',
            'retry_consumed_at',
            'created_at',
          ]
    return required.every((name) => columns.some((column) => column.name === name))
  }
  recoverInterruptedInteractions(timestamp: number) {
    const invalidApprovals = this.sqlite
      .query(
        `
      SELECT r.id, r.thread_id, r.turn_id
      FROM approval_requests AS r
      LEFT JOIN approval_checkpoints AS c ON c.approval_id = r.id
      WHERE r.status = 'preparing' OR (r.status = 'pending'
        AND (c.approval_id IS NULL OR c.version <> 1
          OR json_type(c.payload, '$.runState') <> 'text'
          OR json_type(c.payload, '$.interruption') IS NULL))
    `,
      )
      .all() as Array<{ id: string; thread_id: string; turn_id: string }>
    const recoverable = this.sqlite
      .query(
        `
      SELECT r.id, r.thread_id, r.turn_id, r.agent_id
      FROM approval_requests AS r
      JOIN turns AS t ON t.id = r.turn_id AND t.status = 'running'
      WHERE r.status IN ('resolved', 'claimed') AND (
        r.reply = 'deny'
        OR EXISTS (SELECT 1 FROM tool_calls AS tc WHERE tc.id = r.tool_call_id AND tc.status = 'completed')
        OR NOT EXISTS (SELECT 1 FROM tool_calls AS tc WHERE tc.id = r.tool_call_id)
      )
    `,
      )
      .all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string }>
    for (const approval of recoverable) {
      this.sqlite
        .query(
          "UPDATE approval_requests SET status = 'resolved' WHERE id = ? AND status = 'claimed'",
        )
        .run(approval.id)
      this.sqlite
        .query(
          "UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(timestamp, approval.turn_id)
      this.sqlite
        .query(
          "UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(timestamp, approval.agent_id)
      this.insertEvent(approval.thread_id, approval.turn_id, 'agent/upserted', {
        agent: this.getAgentExecution(approval.agent_id),
      })
    }
    const ambiguous = this.sqlite
      .query(
        `
      SELECT r.id, r.thread_id, r.turn_id
      FROM approval_requests AS r
      JOIN tool_calls AS tc ON tc.id = r.tool_call_id
      JOIN turns AS t ON t.id = r.turn_id AND t.status = 'running'
      WHERE r.status = 'claimed' AND r.reply = 'allow' AND tc.status IN ('running', 'error', 'interrupted')
    `,
      )
      .all() as Array<{ id: string; thread_id: string; turn_id: string }>
    for (const approval of ambiguous) {
      this.sqlite
        .query("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE id = ?")
        .run(timestamp, approval.id)
      this.insertEvent(
        approval.thread_id,
        approval.turn_id,
        'approval/cancelled',
        approvalCancelledPayload(
          approval.id,
          '审批后的工具执行结果不确定，已按 fail-closed 中断',
          timestamp,
        ),
      )
    }
    const questions = this.sqlite
      .query(
        `
      SELECT q.id, q.thread_id, q.turn_id, q.agent_id
      FROM question_requests AS q
      JOIN turns AS t ON t.id = q.turn_id AND t.status = 'running'
      WHERE q.status IN ('resolved', 'resuming')
    `,
      )
      .all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string }>
    for (const question of questions) {
      this.sqlite
        .query(
          "UPDATE question_requests SET status = 'resolved' WHERE id = ? AND status = 'resuming'",
        )
        .run(question.id)
      this.sqlite
        .query(
          "UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(timestamp, question.turn_id)
      this.sqlite
        .query(
          "UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(timestamp, question.agent_id)
      this.insertEvent(question.thread_id, question.turn_id, 'agent/upserted', {
        agent: this.getAgentExecution(question.agent_id),
      })
    }
    for (const approval of invalidApprovals) {
      this.insertEvent(
        approval.thread_id,
        approval.turn_id,
        'approval/cancelled',
        approvalCancelledPayload(
          approval.id,
          '审批缺少完整且可恢复的 SDK checkpoint，已安全取消',
          timestamp,
        ),
      )
    }
    this.sqlite
      .query(
        `UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'preparing' OR id IN (
      SELECT r.id FROM approval_requests AS r LEFT JOIN approval_checkpoints AS c ON c.approval_id = r.id
      WHERE r.status = 'pending' AND (c.approval_id IS NULL OR c.version <> 1 OR json_type(c.payload, '$.runState') <> 'text' OR json_type(c.payload, '$.interruption') IS NULL)
    )`,
      )
      .run(timestamp)
    this.sqlite
      .query(
        "UPDATE sandbox_escalations SET status = 'cancelled', completed_at = ? WHERE status = 'claimed'",
      )
      .run(timestamp)
  }

  finalizeInterruptedQuestions(timestamp: number) {
    this.sqlite
      .query(
        "UPDATE question_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'pending' AND turn_id IN (SELECT id FROM turns WHERE status <> 'waiting_question')",
      )
      .run(timestamp)
  }

  acquiredResumeCheckpointLease(turnID: string, leaseID: string) {
    const row = this.sqlite
      .query(
        `
      SELECT checkpoint_payload FROM resume_checkpoint_leases
      WHERE turn_id = ? AND lease_id = ? AND status = 'acquired'
    `,
      )
      .get(turnID, leaseID) as { checkpoint_payload: string } | null
    return row
      ? { leaseID, checkpoint: parse<ResolvedResumeCheckpoint>(row.checkpoint_payload) }
      : null
  }

  resolvedApprovalForResume(turnID: string) {
    return this.sqlite
      .query(
        `
      SELECT id FROM approval_requests
      WHERE turn_id = ? AND status = 'resolved'
      ORDER BY resolved_at, created_at LIMIT 1
    `,
      )
      .get(turnID) as { id: string } | null
  }

  resolvedQuestionForResume(turnID: string) {
    const row = this.sqlite
      .query(
        `
      SELECT id, agent_id, tool_call_id, payload, answer
      FROM question_requests
      WHERE turn_id = ? AND status = 'resolved'
      ORDER BY resolved_at, created_at LIMIT 1
    `,
      )
      .get(turnID) as {
      id: string
      agent_id: string
      tool_call_id: string | null
      payload: string
      answer: string | null
    } | null
    return row
      ? {
          id: row.id,
          agentID: row.agent_id,
          toolCallID: row.tool_call_id,
          payload: parse<Record<string, unknown>>(row.payload),
          answer: row.answer ? parse<Record<string, unknown>>(row.answer) : {},
        }
      : null
  }

  claimResolvedQuestionLegacy(turnID: string) {
    return this.transaction(() => {
      const row = this.sqlite
        .query(
          `
        SELECT id, payload, answer FROM question_requests
        WHERE turn_id = ? AND status = 'resolved'
        ORDER BY resolved_at LIMIT 1
      `,
        )
        .get(turnID) as { id: string; payload: string; answer: string | null } | null
      if (!row) return null
      const updated = this.sqlite
        .query(
          "UPDATE question_requests SET status = 'resuming' WHERE id = ? AND status = 'resolved'",
        )
        .run(row.id)
      return updated.changes === 1
        ? {
            id: row.id,
            payload: parse<Record<string, unknown>>(row.payload),
            answer: row.answer ? parse<Record<string, unknown>>(row.answer) : {},
          }
        : null
    })
  }

  resolvedHookTrustForResume(turnID: string) {
    const row = this.sqlite
      .query(
        `
      SELECT c.agent_id, c.payload, h.id, h.status
      FROM agent_checkpoints AS c
      JOIN hook_trust_requests AS h ON h.id = json_extract(c.payload, '$.requestID')
      WHERE c.turn_id = ? AND c.state = 'ready'
        AND json_extract(c.payload, '$.kind') = 'hook-trust'
        AND h.status IN ('allowed', 'blocked')
      LIMIT 1
    `,
      )
      .get(turnID) as {
      agent_id: string
      payload: string
      id: string
      status: 'allowed' | 'blocked'
    } | null
    return row
      ? {
          agentID: row.agent_id,
          requestID: row.id,
          decision: row.status === 'allowed' ? ('allow' as const) : ('deny' as const),
        }
      : null
  }

  pendingAutoResolutionQuestions() {
    const rows = this.sqlite
      .query(
        `
      SELECT id, payload, created_at FROM question_requests WHERE status = 'pending'
    `,
      )
      .all() as Array<{ id: string; payload: string; created_at: number }>
    return rows.map((row) => ({
      id: row.id,
      payload: parse<Record<string, unknown>>(row.payload),
      createdAt: row.created_at,
    }))
  }

  isQuestionPending(id: string) {
    return Boolean(
      this.sqlite
        .query("SELECT 1 FROM question_requests WHERE id = ? AND status = 'pending'")
        .get(id),
    )
  }
  pauseQuestionAutoResolution(id: string, version: number) {
    const row = this.pendingQuestions().find((question) => question.id === id)
    if (!row || row.payloadVersion !== version) return null
    const events: EventEnvelope[] = []
    this.transaction(() => {
      this.sqlite
        .query(
          "UPDATE question_requests SET payload = ? WHERE id = ? AND status = 'pending' AND payload_version = ?",
        )
        .run(stringify({ ...row.payload, autoResolutionPaused: true }), id, version)
      events.push(
        this.insertEvent(row.threadID, row.turnID, 'question/requested', {
          interactionId: id,
          threadId: row.threadID,
          turnId: row.turnID,
          agentId: row.agentID,
          createdAt: row.createdAt,
          version,
          kind: 'question',
          questions: row.payload.questions,
          autoResolutionPaused: true,
        }),
      )
    })
    return events
  }

  pendingApprovalIDs(threadID?: string) {
    return this.sqlite
      .query(
        `
      SELECT id FROM approval_requests
      WHERE status = 'pending' AND (? IS NULL OR thread_id = ?)
      ORDER BY created_at, id
    `,
      )
      .all(threadID ?? null, threadID ?? null) as Array<{ id: string }>
  }
  pendingMcpElicitations(threadID?: string): Array<Record<string, unknown>> {
    if (!this.interactionTableAvailable('mcp_elicitations')) return []
    const rows = this.sqlite
      .query(
        "SELECT payload FROM mcp_elicitations WHERE status = 'pending' AND (? IS NULL OR thread_id = ?) ORDER BY created_at, id",
      )
      .all(threadID ?? null, threadID ?? null) as Array<{ payload: string }>
    return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>)
  }
  recordApprovalReview(
    invocation: ToolInvocation,
    fingerprint: string,
    review: import('../../Domain').PermissionDecision,
  ) {
    if (!this.interactionTableAvailable('approval_reviews')) return null
    const id = crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      this.sqlite
        .query(
          'INSERT INTO approval_reviews (id, thread_id, tool_call_id, invocation, fingerprint, decision, risk, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          invocation.threadID,
          invocation.id,
          stringify(invocation),
          fingerprint,
          review.decision,
          review.risk,
          review.reason,
          timestamp,
        )
      const item: import('../../Domain').Item = {
        id: `approval-review:${id}`,
        turnID: invocation.turnID,
        agentID: invocation.agentID,
        type: 'activity',
        status: review.decision === 'deny' ? 'error' : 'completed',
        data: {
          activity: 'notice',
          title: `自动审查${review.decision === 'allow' ? '已允许' : review.decision === 'deny' ? '已拒绝' : '转人工确认'} · ${invocation.name}`,
          detail: review.reason,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const { event } = this.upsertItemWithEvent(invocation.threadID, item, 'item/completed')
      return event
    })
  }
  approvalReviewState(threadID: string) {
    const rows = this.interactionTableAvailable('approval_reviews')
      ? (this.sqlite
          .query(
            "SELECT id, invocation, reason, retry_operation_id, created_at FROM approval_reviews WHERE thread_id = ? AND decision = 'deny' AND retry_consumed_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 20",
          )
          .all(threadID) as Array<{
          id: string
          invocation: string
          reason: string
          retry_operation_id: string | null
          created_at: number
        }>)
      : []
    const count = this.sqlite
      .query(
        "SELECT count(*) AS count FROM approval_requests WHERE thread_id = ? AND reply = 'allow' AND status IN ('resolved', 'claimed')",
      )
      .get(threadID) as { count: number }
    return {
      manualAllows: count.count,
      denials: rows.map((row) => {
        const invocation = JSON.parse(row.invocation) as ToolInvocation
        return {
          id: row.id,
          tool: invocation.name,
          input: invocation.input,
          reason: row.reason,
          ...(row.retry_operation_id ? { retryOperationId: row.retry_operation_id } : {}),
          createdAt: row.created_at,
        }
      }),
    }
  }
  authorizeApprovalRetry(threadID: string, reviewID: string, operationID: string) {
    if (!this.interactionTableAvailable('approval_reviews'))
      throw new AgentError('CAPABILITY_REQUIRED', '自动审查重试存储不可用', 409)
    return this.transaction(() => {
      const row = this.sqlite
        .query(
          "SELECT invocation, retry_operation_id, retry_consumed_at FROM approval_reviews WHERE id = ? AND thread_id = ? AND decision = 'deny'",
        )
        .get(reviewID, threadID) as {
        invocation: string
        retry_operation_id: string | null
        retry_consumed_at: number | null
      } | null
      if (
        !row ||
        row.retry_consumed_at !== null ||
        (row.retry_operation_id !== null && row.retry_operation_id !== operationID)
      )
        throw new AgentError('REQUEST_NOT_PENDING', '此自动审查拒绝已经失效或已授权重试', 409)
      const invocation = JSON.parse(row.invocation) as ToolInvocation
      if (row.retry_operation_id === null) {
        this.sqlite
          .query(
            'UPDATE approval_reviews SET retry_operation_id = ? WHERE id = ? AND retry_operation_id IS NULL',
          )
          .run(operationID, reviewID)
        this.upsertItemWithEvent(
          threadID,
          {
            id: `approval-retry:${reviewID}`,
            turnID: invocation.turnID,
            agentID: invocation.agentID,
            type: 'activity',
            status: 'completed',
            data: {
              activity: 'notice',
              title: `已授权一次重试 · ${invocation.name}`,
              detail: '仍须经过 Guardian 审查；仅匹配原工具、参数和范围。',
            },
            createdAt: now(),
            updatedAt: now(),
          },
          'item/completed',
        )
      }
      return {
        input: `请重试刚才被自动审查拒绝的 ${invocation.name} 操作，保持工具、参数和申请范围不变。用户已为这一次重试提供授权；仍须经过 Guardian 审查。\n操作参数：${stringify(invocation.input)}`,
      }
    })
  }
  claimApprovalRetry(threadID: string, fingerprint: string) {
    if (!this.interactionTableAvailable('approval_reviews')) return undefined
    return this.transaction(() => {
      const row = this.sqlite
        .query(
          'SELECT id FROM approval_reviews WHERE thread_id = ? AND fingerprint = ? AND retry_operation_id IS NOT NULL AND retry_consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
        .get(threadID, fingerprint) as { id: string } | null
      if (!row) return undefined
      this.sqlite
        .query(
          'UPDATE approval_reviews SET retry_consumed_at = ? WHERE id = ? AND retry_consumed_at IS NULL',
        )
        .run(now(), row.id)
      return { reviewId: row.id, fingerprint }
    })
  }
  createMcpElicitation(payload: Record<string, unknown>, connectionID: string) {
    let event!: EventEnvelope
    this.transaction(() => {
      this.sqlite
        .query(
          'INSERT INTO mcp_elicitations (id, thread_id, turn_id, agent_id, tool_call_id, connection_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          String(payload.interactionId),
          String(payload.threadId),
          String(payload.turnId),
          String(payload.agentId),
          String(payload.toolCallId),
          connectionID,
          stringify(payload),
          Number(payload.createdAt),
        )
      event = this.insertEvent(
        String(payload.threadId),
        String(payload.turnId),
        'mcp/elicitationRequested',
        payload,
      )
    })
    return event
  }
  resolveMcpElicitation(
    id: string,
    version: number,
    response: Record<string, unknown>,
    operation?: InteractionOperationInput,
  ) {
    const row = this.sqlite
      .query(
        "SELECT thread_id, turn_id FROM mcp_elicitations WHERE id = ? AND version = ? AND status = 'pending'",
      )
      .get(id, version) as { thread_id: string; turn_id: string } | null
    if (!row) throw new AgentError('REQUEST_NOT_PENDING', 'MCP 表单已失效或版本已变化', 409)
    let event!: EventEnvelope
    this.transaction(() => {
      const result = this.sqlite
        .query(
          "UPDATE mcp_elicitations SET status = 'resolved', response = ? WHERE id = ? AND version = ? AND status = 'pending'",
        )
        .run(stringify(response), id, version)
      if (result.changes !== 1) throw new AgentError('REQUEST_NOT_PENDING', 'MCP 表单已经处理', 409)
      if (operation) this.saveInteractionOperation(operation)
      event = this.insertEvent(row.thread_id, row.turn_id, 'interaction/resolved', {
        interactionId: id,
        result: response,
        resolvedAt: now(),
      })
    })
    return event
  }

  resolvedApprovalGrantRules(threadID: string): unknown[] {
    const rows = this.sqlite
      .query(
        `SELECT c.payload FROM approval_checkpoints c
      JOIN approval_requests r ON r.id = c.approval_id
      WHERE r.thread_id = ? AND r.reply = 'allow' AND r.status IN ('resolved', 'claimed')`,
      )
      .all(threadID) as Array<{ payload: string }>
    return rows.flatMap((row) => {
      const payload = JSON.parse(row.payload) as ApprovalCheckpointPayload
      return payload.resolution?.grantRule?.scope === 'session'
        ? [payload.resolution.grantRule]
        : []
    })
  }

  pendingQuestions(threadID?: string) {
    const rows = this.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, agent_id, payload, payload_version, created_at
      FROM question_requests
      WHERE status = 'pending' AND (? IS NULL OR thread_id = ?)
      ORDER BY created_at, id
    `,
      )
      .all(threadID ?? null, threadID ?? null) as Array<{
      id: string
      thread_id: string
      turn_id: string
      agent_id: string
      payload: string
      payload_version: number
      created_at: number
    }>
    return rows.map((row) => ({
      id: row.id,
      threadID: row.thread_id,
      turnID: row.turn_id,
      agentID: row.agent_id,
      payload: parse<Record<string, unknown>>(row.payload),
      payloadVersion: row.payload_version,
      createdAt: row.created_at,
    }))
  }

  pendingHookTrustWaiters(threadID?: string) {
    return this.sqlite
      .query(
        `
      SELECT request.id, waiter.thread_id, waiter.turn_id, waiter.agent_id
      FROM hook_trust_waiters AS waiter
      JOIN hook_trust_requests AS request ON request.id = waiter.request_id
      WHERE request.status = 'pending'
        AND (? IS NULL OR waiter.thread_id = ?)
      ORDER BY request.created_at, request.id, waiter.created_at, waiter.turn_id
    `,
      )
      .all(threadID ?? null, threadID ?? null) as Array<{
      id: string
      thread_id: string
      turn_id: string
      agent_id: string
    }>
  }

  pendingQuestionVersion(id: string) {
    const row = this.sqlite
      .query('SELECT payload_version, status FROM question_requests WHERE id = ?')
      .get(id) as { payload_version: number; status: string } | null
    return row ? { version: row.payload_version, status: row.status } : null
  }

  questionToolCallID(id: string): string | null {
    const row = this.sqlite
      .query('SELECT tool_call_id FROM question_requests WHERE id = ?')
      .get(id) as { tool_call_id: string | null } | null
    return row?.tool_call_id ?? null
  }

  pendingQuestionPayload(id: string) {
    const row = this.sqlite
      .query("SELECT payload FROM question_requests WHERE id = ? AND status = 'pending'")
      .get(id) as { payload: string } | null
    return row ? parse<Record<string, unknown>>(row.payload) : null
  }

  cancelQuestionsForTurn(turnID: string) {
    return this.transaction(() => {
      const rows = this.sqlite
        .query(
          "SELECT id FROM question_requests WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')",
        )
        .all(turnID) as Array<{ id: string }>
      this.sqlite
        .query(
          "UPDATE question_requests SET status = 'cancelled', answer = '__stopped__', resolved_at = ? WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')",
        )
        .run(now(), turnID)
      return rows.map((row) => row.id)
    })
  }

  subagentTaskID(runID: string) {
    const row = this.sqlite.query('SELECT task_id FROM subagent_runs WHERE id = ?').get(runID) as {
      task_id: string
    } | null
    return row?.task_id ?? null
  }

  interactionResumeTargets(
    interactionID: string,
    kind: 'approval' | 'permission' | 'question' | 'hookTrust',
  ) {
    if (kind === 'approval' || kind === 'permission') {
      const row = this.sqlite
        .query(
          "SELECT thread_id, turn_id, agent_id FROM approval_requests WHERE id = ? AND status IN ('resolved','claimed')",
        )
        .get(interactionID) as { thread_id: string; turn_id: string; agent_id: string } | null
      return row ? [{ threadID: row.thread_id, turnID: row.turn_id, agentID: row.agent_id }] : []
    }
    if (kind === 'question') {
      const row = this.sqlite
        .query(
          "SELECT thread_id, turn_id, agent_id FROM question_requests WHERE id = ? AND status IN ('resolved','resuming')",
        )
        .get(interactionID) as { thread_id: string; turn_id: string; agent_id: string } | null
      return row ? [{ threadID: row.thread_id, turnID: row.turn_id, agentID: row.agent_id }] : []
    }
    return (
      this.sqlite
        .query('SELECT thread_id, turn_id, agent_id FROM hook_trust_waiters WHERE request_id = ?')
        .all(interactionID) as Array<{ thread_id: string; turn_id: string; agent_id: string }>
    ).map((row) => ({ threadID: row.thread_id, turnID: row.turn_id, agentID: row.agent_id }))
  }

  interactionStopTarget(interactionID: string) {
    const row = this.sqlite
      .query('SELECT thread_id, turn_id, agent_id FROM approval_requests WHERE id = ?')
      .get(interactionID) as {
      thread_id: string
      turn_id: string
      agent_id: string
    } | null
    return row ? { threadID: row.thread_id, turnID: row.turn_id, agentID: row.agent_id } : null
  }

  resolveStopInteraction(input: {
    interactionID: string
    threadID: string
    turnID: string
    agentID: string
    operation: InteractionOperationInput
  }) {
    return this.transaction(() => {
      const pending = this.sqlite
        .query(
          `
        SELECT 1 FROM approval_requests
        WHERE id = ? AND thread_id = ? AND turn_id = ? AND agent_id = ? AND status = 'pending'
      `,
        )
        .get(input.interactionID, input.threadID, input.turnID, input.agentID)
      if (!pending) throw new AgentError('REQUEST_NOT_PENDING', '审批请求不存在或已处理', 409)
      const terminal = this.finalizeTurn({
        threadID: input.threadID,
        turnID: input.turnID,
        agentID: input.agentID,
        status: 'interrupted',
        pauseReason: 'interrupted',
      })
      const operation = this.saveInteractionOperation(input.operation)
      return { ...terminal, operation }
    })
  }

  convergeHookTrustDecisions() {
    const pending = this.sqlite
      .query(
        "SELECT id, workspace_path, config_hash FROM hook_trust_requests WHERE status = 'pending'",
      )
      .all() as Array<{ id: string; workspace_path: string; config_hash: string }>
    for (const request of pending) {
      const row = this.profileSqlite
        .query(
          'SELECT decision FROM hook_trust_decisions WHERE workspace_path = ? AND config_hash = ?',
        )
        .get(request.workspace_path, request.config_hash) as { decision: 'allow' | 'block' } | null
      if (row) this.resolveHookTrustRequest(request.id, row.decision)
    }
  }

  acquireResumeCheckpointLease(input: {
    turnID: string
    agentID: string
    kind: ResumeCheckpointKind
    checkpoint: ResolvedResumeCheckpoint
    permissionGrant?: Record<string, unknown>
    consumer: ResumeCheckpointConsumer
    leaseID: string
  }) {
    return this.transaction(() => {
      const timestamp = now()
      this.sqlite
        .query(
          `
        INSERT INTO resume_checkpoint_leases (
          turn_id, agent_id, checkpoint_kind, checkpoint_payload,
          permission_grant, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'available', ?, ?)
        ON CONFLICT(turn_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          checkpoint_kind = excluded.checkpoint_kind,
          checkpoint_payload = excluded.checkpoint_payload,
          permission_grant = excluded.permission_grant,
          consumer = NULL,
          lease_id = NULL,
          status = 'available',
          created_at = excluded.created_at,
          acquired_at = NULL,
          completed_at = NULL,
          updated_at = excluded.updated_at
        WHERE resume_checkpoint_leases.status = 'completed'
          AND resume_checkpoint_leases.checkpoint_payload <> excluded.checkpoint_payload
      `,
        )
        .run(
          input.turnID,
          input.agentID,
          input.kind,
          stringify(input.checkpoint),
          input.permissionGrant ? stringify(input.permissionGrant) : null,
          timestamp,
          timestamp,
        )
      const existing = this.sqlite
        .query(
          `
        SELECT lease_id, status, checkpoint_payload
        FROM resume_checkpoint_leases WHERE turn_id = ?
      `,
        )
        .get(input.turnID) as {
        lease_id: string | null
        status: ResumeCheckpointLeaseStatus
        checkpoint_payload: string
      } | null
      if (!existing || existing.status === 'completed' || existing.status === 'interrupted')
        return null
      if (existing.status === 'acquired') {
        return existing.lease_id === input.leaseID
          ? {
              leaseID: input.leaseID,
              checkpoint: parse<ResolvedResumeCheckpoint>(existing.checkpoint_payload),
            }
          : null
      }
      const acquired = this.sqlite
        .query(
          `
        UPDATE resume_checkpoint_leases
        SET consumer = ?, lease_id = ?, status = 'acquired', acquired_at = ?, updated_at = ?
        WHERE turn_id = ? AND status = 'available'
      `,
        )
        .run(input.consumer, input.leaseID, timestamp, timestamp, input.turnID)
      if (acquired.changes !== 1) return null
      if (input.kind === 'permission') {
        const checkpoint = input.checkpoint as Extract<
          ResolvedResumeCheckpoint,
          { kind: 'permission' }
        >
        const claimed = this.sqlite
          .query(
            "UPDATE approval_requests SET status = 'claimed' WHERE id = ? AND status = 'resolved'",
          )
          .run(checkpoint.approvalID)
        if (claimed.changes !== 1)
          throw new Error(`审批 ${checkpoint.approvalID} 无法获取恢复 lease`)
      } else if (input.kind === 'question') {
        const checkpoint = input.checkpoint as Extract<
          ResolvedResumeCheckpoint,
          { kind: 'question' }
        >
        const claimed = this.sqlite
          .query(
            "UPDATE question_requests SET status = 'resuming' WHERE id = ? AND status = 'resolved'",
          )
          .run(checkpoint.questionID)
        if (claimed.changes !== 1)
          throw new Error(`问题 ${checkpoint.questionID} 无法获取恢复 lease`)
      }
      return { leaseID: input.leaseID, checkpoint: input.checkpoint }
    })
  }

  completeResumeCheckpointLease(leaseID: string) {
    return this.transaction(() => {
      const row = this.sqlite
        .query(
          `
        SELECT checkpoint_kind, checkpoint_payload, status
        FROM resume_checkpoint_leases
        WHERE lease_id = ? AND status IN ('acquired', 'completed')
      `,
        )
        .get(leaseID) as {
        checkpoint_kind: ResumeCheckpointKind
        checkpoint_payload: string
        status: ResumeCheckpointLeaseStatus
      } | null
      if (!row) return false
      if (row.status === 'completed') return true
      const checkpoint = parse<ResolvedResumeCheckpoint>(row.checkpoint_payload)
      const timestamp = now()
      this.sqlite
        .query(
          `
        UPDATE resume_checkpoint_leases
        SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE lease_id = ? AND status = 'acquired'
      `,
        )
        .run(timestamp, timestamp, leaseID)
      if (checkpoint.kind === 'question') {
        this.sqlite
          .query(
            "UPDATE question_requests SET status = 'consumed' WHERE id = ? AND status = 'resuming'",
          )
          .run(checkpoint.questionID)
        this.sqlite
          .query(
            `
          DELETE FROM agent_checkpoints
          WHERE turn_id = (SELECT turn_id FROM resume_checkpoint_leases WHERE lease_id = ?)
            AND json_extract(payload, '$.questionID') = ?
        `,
          )
          .run(leaseID, checkpoint.questionID)
      } else if (checkpoint.kind === 'hook-trust') {
        this.sqlite
          .query(
            `
          DELETE FROM agent_checkpoints
          WHERE turn_id = (SELECT turn_id FROM resume_checkpoint_leases WHERE lease_id = ?)
            AND state = 'ready'
            AND json_extract(payload, '$.kind') = 'hook-trust'
            AND json_extract(payload, '$.requestID') = ?
        `,
          )
          .run(leaseID, checkpoint.requestID)
      } else if (checkpoint.kind === 'subagent-wait') {
        this.sqlite
          .query(
            `
          DELETE FROM agent_checkpoints
          WHERE turn_id = (SELECT turn_id FROM resume_checkpoint_leases WHERE lease_id = ?)
            AND state = 'ready'
            AND json_extract(payload, '$.kind') = 'subagent-wait'
        `,
          )
          .run(leaseID)
      }
      return true
    })
  }

  recoverResumeCheckpointLeases(timestamp = now()): RecoveryLeaseSummary {
    return this.transaction(() => {
      const summary: RecoveryLeaseSummary = { available: [], completed: [], interrupted: [] }
      const rows = this.sqlite
        .query(
          `
        SELECT turn_id, lease_id, checkpoint_kind, checkpoint_payload
        FROM resume_checkpoint_leases WHERE status = 'acquired'
      `,
        )
        .all() as Array<{
        turn_id: string
        lease_id: string
        checkpoint_kind: ResumeCheckpointKind
        checkpoint_payload: string
      }>
      for (const row of rows) {
        const checkpoint = parse<ResolvedResumeCheckpoint>(row.checkpoint_payload)
        let status: 'available' | 'completed' | 'interrupted' = 'available'
        if (checkpoint.kind === 'permission') {
          const tool = this.sqlite
            .query('SELECT status FROM tool_calls WHERE id = ?')
            .get(checkpoint.toolCallID) as { status: string } | null
          if (tool && ['running', 'error', 'interrupted'].includes(tool.status))
            status = 'interrupted'
        }
        if (status === 'available') {
          this.sqlite
            .query(
              `
            UPDATE resume_checkpoint_leases
            SET status = 'available', consumer = NULL, lease_id = NULL,
              acquired_at = NULL, updated_at = ?
            WHERE turn_id = ? AND status = 'acquired'
          `,
            )
            .run(timestamp, row.turn_id)
          if (checkpoint.kind === 'permission') {
            this.sqlite
              .query(
                "UPDATE approval_requests SET status = 'resolved' WHERE id = ? AND status = 'claimed'",
              )
              .run(checkpoint.approvalID)
          } else if (checkpoint.kind === 'question') {
            this.sqlite
              .query(
                "UPDATE question_requests SET status = 'resolved' WHERE id = ? AND status = 'resuming'",
              )
              .run(checkpoint.questionID)
          }
          const queued = this.sqlite
            .query(
              "UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status IN ('running','interrupted')",
            )
            .run(timestamp, row.turn_id)
          this.sqlite
            .query(
              "UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE turn_id = ? AND status IN ('running','interrupted')",
            )
            .run(timestamp, row.turn_id)
          if (queued.changes === 1) {
            const execution = this.agentForTurn(row.turn_id)
            if (execution)
              this.insertEvent(execution.threadID, row.turn_id, 'agent/upserted', {
                agent: execution,
              })
          }
        } else {
          this.sqlite
            .query(
              `
            UPDATE resume_checkpoint_leases
            SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
              updated_at = ?
            WHERE turn_id = ? AND status = 'acquired'
          `,
            )
            .run(status, status, timestamp, timestamp, row.turn_id)
        }
        summary[status].push(row.turn_id)
      }
      return summary
    })
  }

  interactionOperation(operationID: string) {
    const row = this.sqlite
      .query(
        'SELECT interaction_id, response, result FROM interaction_operations WHERE operation_id = ?',
      )
      .get(operationID) as {
      interaction_id: string
      response: string
      result: string
    } | null
    return row
      ? {
          interactionID: row.interaction_id,
          response: parse<Record<string, unknown>>(row.response),
          result: parse<Record<string, unknown>>(row.result),
        }
      : null
  }

  saveInteractionOperation(input: InteractionOperationInput) {
    const existing = this.interactionOperation(input.operationID)
    if (existing) return existing
    this.sqlite
      .query(
        `
        INSERT INTO interaction_operations (
          operation_id, interaction_id, response, result, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(
        input.operationID,
        input.interactionID,
        stringify(input.response),
        stringify(input.result),
        now(),
      )
    return this.interactionOperation(input.operationID)!
  }

  persistApprovalCheckpoint(input: {
    approvalID: string
    invocation: ToolInvocation
    risk: string
    reason: string
    requestPayload: Record<string, unknown>
    reviewPayload: Record<string, unknown> | null
    checkpoint: ApprovalCheckpointPayload
    version: number
    createdAt?: number
  }) {
    const timestamp = input.createdAt ?? now()
    this.transaction(() => {
      this.sqlite
        .query(
          `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, review_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?, ?)`,
        )
        .run(
          input.approvalID,
          input.invocation.threadID,
          input.invocation.turnID,
          input.invocation.agentID,
          input.invocation.id,
          input.risk,
          input.reason,
          stringify(input.requestPayload),
          input.reviewPayload ? stringify(input.reviewPayload) : null,
          timestamp,
        )
      this.sqlite
        .query(
          `INSERT INTO approval_checkpoints (approval_id, thread_id, turn_id, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.approvalID,
          input.invocation.threadID,
          input.invocation.turnID,
          stringify(input.checkpoint),
          input.version,
          timestamp,
          timestamp,
        )
    })
    return this.getApprovalCheckpoint(input.approvalID)!
  }

  getApprovalCheckpoint(approvalID: string): StoredApprovalCheckpoint | null {
    const row = this.sqlite
      .query(
        `SELECT r.id, r.thread_id, r.turn_id, r.agent_id, r.tool_call_id, r.status, r.reply, r.risk, r.reason, r.created_at, c.payload, c.version, c.updated_at FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.id = ?`,
      )
      .get(approvalID) as {
      id: string
      thread_id: string
      turn_id: string
      agent_id: string
      tool_call_id: string
      status: StoredApprovalCheckpoint['status']
      reply: 'allow' | 'deny' | null
      risk: string
      reason: string
      created_at: number
      payload: string
      version: number
      updated_at: number
    } | null
    if (!row) return null
    return {
      approvalID: row.id,
      threadID: row.thread_id,
      turnID: row.turn_id,
      agentID: row.agent_id,
      toolCallID: row.tool_call_id,
      status: row.status,
      decision: row.reply,
      risk: row.risk,
      reason: row.reason,
      payload: parse<ApprovalCheckpointPayload>(row.payload),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  approvalCheckpointForToolCall(toolCallID: string): StoredApprovalCheckpoint | null {
    const row = this.sqlite
      .query(
        'SELECT id FROM approval_requests WHERE tool_call_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(toolCallID) as { id: string } | null
    return row ? this.getApprovalCheckpoint(row.id) : null
  }

  updateApprovalCheckpointPayload(approvalID: string, payload: ApprovalCheckpointPayload) {
    const result = this.sqlite
      .query('UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?')
      .run(stringify(payload), now(), approvalID)
    if (result.changes !== 1) throw new Error(`审批 ${approvalID} checkpoint 不存在`)
    return this.getApprovalCheckpoint(approvalID)!
  }

  activateApprovalCheckpoint(
    approvalID: string,
    payload: ApprovalCheckpointPayload,
    requestedParams: Record<string, unknown>,
  ) {
    const row = this.sqlite
      .query('SELECT turn_id, agent_id, status FROM approval_requests WHERE id = ?')
      .get(approvalID) as { turn_id: string; agent_id: string; status: string } | null
    if (!row) throw new Error(`审批 ${approvalID} 不存在`)
    if (row.status === 'pending')
      return { checkpoint: this.getApprovalCheckpoint(approvalID)!, events: [] as EventEnvelope[] }
    if (row.status !== 'preparing') throw new Error(`审批 ${approvalID} 不能从 ${row.status} 激活`)
    const timestamp = now()
    const events: EventEnvelope[] = []
    this.transaction(() => {
      const updated = this.sqlite
        .query(
          "UPDATE approval_requests SET status = 'pending' WHERE id = ? AND status = 'preparing'",
        )
        .run(approvalID)
      if (updated.changes !== 1) throw new Error(`审批 ${approvalID} 已被并发处理`)
      this.sqlite
        .query('UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?')
        .run(stringify(payload), timestamp, approvalID)
      this.updateTurnStatus(row.turn_id, 'waiting_permission')
      this.updateAgentStatus(row.agent_id, 'waiting_permission')
      events.push(
        this.insertEvent(payload.invocation.threadID, row.turn_id, 'agent/upserted', {
          agent: this.getAgentExecution(row.agent_id),
        }),
      )
      events.push(
        this.insertEvent(
          payload.invocation.threadID,
          row.turn_id,
          payload.invocation.name === 'request_permissions'
            ? 'permission/requested'
            : 'approval/requested',
          requestedParams,
        ),
      )
    })
    return { checkpoint: this.getApprovalCheckpoint(approvalID)!, events }
  }

  resolveApprovalCheckpoint(
    approvalID: string,
    decision: 'allow' | 'deny',
    feedback?: string,
    operation?: InteractionOperationInput,
    computerGrant?: 'chat' | 'persistent',
    grantRule?: import('../../permission/ApprovalRules').ApprovalRule,
  ):
    | { state: 'resolved'; checkpoint: StoredApprovalCheckpoint; events: EventEnvelope[] }
    | {
        state: 'missing' | 'not-ready' | 'already-resolved'
        threadID?: string
        turnID?: string
        agentID?: string
      }
    | {
        state: 'invalid-checkpoint'
        threadID: string
        turnID: string
        agentID: string
        events: EventEnvelope[]
      } {
    const request = this.sqlite
      .query('SELECT thread_id, turn_id, agent_id, status FROM approval_requests WHERE id = ?')
      .get(approvalID) as {
      thread_id: string
      turn_id: string
      agent_id: string
      status: string
    } | null
    if (!request) return { state: 'missing' }
    if (request.status === 'preparing')
      return {
        state: 'not-ready',
        threadID: request.thread_id,
        turnID: request.turn_id,
        agentID: request.agent_id,
      }
    if (request.status !== 'pending')
      return {
        state: 'already-resolved',
        threadID: request.thread_id,
        turnID: request.turn_id,
        agentID: request.agent_id,
      }
    const checkpoint = this.getApprovalCheckpoint(approvalID)
    if (
      !checkpoint ||
      checkpoint.version !== 1 ||
      checkpoint.payload.kind !== 'tool-approval' ||
      !checkpoint.payload.invocationHash
    ) {
      const invalidated = this.invalidateApprovalCheckpoint(approvalID, '审批缺少可恢复 checkpoint')
      return {
        state: 'invalid-checkpoint',
        threadID: request.thread_id,
        turnID: request.turn_id,
        agentID: request.agent_id,
        events: invalidated?.events ?? [],
      }
    }
    const timestamp = now()
    const events: EventEnvelope[] = []
    this.transaction(() => {
      const updated = this.sqlite
        .query(
          "UPDATE approval_requests SET status = 'resolved', reply = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(decision, timestamp, approvalID)
      if (updated.changes !== 1) throw new Error(`审批 ${approvalID} 已被并发处理`)
      const resolution = {
        decision,
        ...(feedback ? { feedback } : {}),
        ...(computerGrant ? { computerGrant } : {}),
        ...(grantRule ? { grantRule } : {}),
        resolvedAt: timestamp,
      }
      this.sqlite
        .query('UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?')
        .run(stringify({ ...checkpoint.payload, resolution }), timestamp, approvalID)
      this.updateTurnStatus(request.turn_id, 'queued')
      this.updateAgentStatus(request.agent_id, 'queued')
      events.push(
        this.insertEvent(request.thread_id, request.turn_id, 'agent/upserted', {
          agent: this.getAgentExecution(request.agent_id),
        }),
      )
      events.push(
        this.insertEvent(
          request.thread_id,
          request.turn_id,
          'interaction/resolved',
          interactionResolvedPayload(
            approvalInteractionResult(checkpoint, decision, feedback, operation),
            timestamp,
            approvalID,
          ),
        ),
      )
      if (operation) this.saveInteractionOperation(operation)
    })
    return { state: 'resolved', checkpoint: this.getApprovalCheckpoint(approvalID)!, events }
  }

  claimResolvedApproval(turnID: string): StoredApprovalCheckpoint | null {
    const row = this.sqlite
      .query(
        `SELECT r.id FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.turn_id = ? AND r.status = 'resolved' ORDER BY r.resolved_at, r.created_at LIMIT 1`,
      )
      .get(turnID) as { id: string } | null
    if (!row) return null
    const checkpoint = this.getApprovalCheckpoint(row.id)
    if (!checkpoint || !checkpoint.payload.resolution) return null
    const timestamp = now()
    return this.transaction(() => {
      const updated = this.sqlite
        .query(
          "UPDATE approval_requests SET status = 'claimed' WHERE id = ? AND status = 'resolved'",
        )
        .run(row.id)
      if (updated.changes !== 1) return null
      this.sqlite
        .query('UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?')
        .run(stringify({ ...checkpoint.payload, claimedAt: timestamp }), timestamp, row.id)
      return this.getApprovalCheckpoint(row.id)
    })
  }

  cancelApprovalsForTurn(turnID: string) {
    const timestamp = now()
    this.sqlite
      .query(
        "UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status IN ('preparing', 'pending', 'resolved')",
      )
      .run(timestamp, turnID)
  }

  getPendingInteractionCounts(threadID: string): { approvals: number; questions: number } {
    const approvals = this.sqlite
      .query(
        "SELECT COUNT(*) AS count FROM approval_requests WHERE thread_id = ? AND status = 'pending'",
      )
      .get(threadID) as { count: number } | null
    const questions = this.sqlite
      .query(
        "SELECT COUNT(*) AS count FROM question_requests WHERE thread_id = ? AND status = 'pending'",
      )
      .get(threadID) as { count: number } | null
    return {
      approvals: Number(approvals?.count ?? 0) + this.pendingMcpElicitations(threadID).length,
      questions: Number(questions?.count ?? 0),
    }
  }

  invalidateApprovalCheckpoint(approvalID: string, reason: string) {
    const row = this.sqlite
      .query('SELECT thread_id, turn_id, agent_id FROM approval_requests WHERE id = ?')
      .get(approvalID) as { thread_id: string; turn_id: string; agent_id: string } | null
    if (!row) return null
    const events: EventEnvelope[] = []
    this.transaction(() => {
      const timestamp = now()
      const updated = this.sqlite
        .query(
          "UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE id = ? AND status IN ('preparing', 'pending', 'resolved')",
        )
        .run(timestamp, approvalID)
      if (updated.changes !== 1) return
      this.updateTurnStatus(row.turn_id, 'interrupted')
      this.updateAgentStatus(row.agent_id, 'interrupted', reason)
      events.push(
        this.insertEvent(
          row.thread_id,
          row.turn_id,
          'approval/cancelled',
          approvalCancelledPayload(approvalID, reason, timestamp),
        ),
      )
      events.push(
        this.insertEvent(row.thread_id, row.turn_id, 'agent/upserted', {
          agent: this.getAgentExecution(row.agent_id),
        }),
      )
      events.push(
        this.insertEvent(row.thread_id, row.turn_id, 'turn/interrupted', {
          turnId: row.turn_id,
          rootAgentId: row.agent_id,
          reason: 'invalid-approval-checkpoint',
          finishedAt: timestamp,
        }),
      )
    })
    return { events }
  }

  hookTrustDecision(workspacePath: string, configHash: string): 'allow' | 'block' | null {
    const row = this.profileSqlite
      .query(
        'SELECT decision FROM hook_trust_decisions WHERE workspace_path = ? AND config_hash = ?',
      )
      .get(workspacePath, configHash) as { decision: 'allow' | 'block' } | null
    return row?.decision ?? null
  }

  ensureHookTrustRequest(
    input: Omit<HookTrustRequest, 'id' | 'status' | 'createdAt' | 'resolvedAt'>,
  ) {
    return this.transaction(() => {
      const existing = this.sqlite
        .query(
          "SELECT id FROM hook_trust_requests WHERE workspace_path = ? AND config_hash = ? AND status = 'pending'",
        )
        .get(input.workspacePath, input.configHash) as { id: string } | null
      const id = existing?.id ?? crypto.randomUUID()
      const createdAt = now()
      let waiterAdded = false
      if (!existing)
        this.sqlite
          .query(
            "INSERT INTO hook_trust_requests (id, thread_id, turn_id, workspace_path, config_path, config_hash, status, audit_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
          )
          .run(
            id,
            input.threadID,
            input.turnID,
            input.workspacePath,
            input.configPath,
            input.configHash,
            stringify(input.auditSummary),
            createdAt,
          )
      if (input.threadID && input.turnID) {
        const execution = this.sqlite
          .query('SELECT id, subagent_run_id FROM agent_executions WHERE turn_id = ?')
          .get(input.turnID) as { id: string; subagent_run_id: string | null } | null
        if (execution) {
          waiterAdded =
            this.sqlite
              .query(
                'INSERT OR IGNORE INTO hook_trust_waiters (request_id, agent_id, turn_id, thread_id, created_at) VALUES (?, ?, ?, ?, ?)',
              )
              .run(id, execution.id, input.turnID, input.threadID, createdAt).changes === 1
          this.sqlite
            .query(
              `INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'waiting_hook_trust', ?, 1, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`,
            )
            .run(
              execution.id,
              input.turnID,
              input.threadID,
              stringify({ kind: 'hook-trust', requestID: id }),
              createdAt,
              createdAt,
            )
          this.updateTurnStatus(input.turnID, 'waiting_permission')
          this.updateAgentStatus(execution.id, 'waiting_permission')
          if (execution.subagent_run_id) {
            this.sqlite
              .query(
                "UPDATE subagent_runs SET status = 'waiting_permission', updated_at = ? WHERE id = ?",
              )
              .run(createdAt, execution.subagent_run_id)
            this.sqlite
              .query(
                "UPDATE subagent_tasks SET status = 'waiting_permission', updated_at = ? WHERE current_run_id = ?",
              )
              .run(createdAt, execution.subagent_run_id)
            this.sqlite
              .query(
                `UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'waiting_permission', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') = ?`,
              )
              .run(createdAt, execution.subagent_run_id)
          }
        }
      }
      const request = this.getHookTrustRequest(id)!
      // Every newly-added waiter gets one durable notification, even when the
      // workspace/hash request was deduplicated against another turn.
      const event =
        (!existing || waiterAdded) && input.threadID && input.turnID
          ? this.insertEvent(
              input.threadID,
              input.turnID,
              'hook/trust/requested',
              hookTrustRequestedPayload(request, {
                threadID: input.threadID,
                turnID: input.turnID,
                agentID: this.agentForTurn(input.turnID)?.id ?? `hook:${input.turnID}`,
              }),
            )
          : null
      return { request, event }
    })
  }

  getHookTrustRequest(id: string): HookTrustRequest | null {
    const row = this.sqlite
      .query(
        'SELECT id, thread_id, turn_id, workspace_path, config_path, config_hash, status, audit_summary, created_at, resolved_at FROM hook_trust_requests WHERE id = ?',
      )
      .get(id) as Record<string, string | number | null> | null
    return row
      ? {
          id: String(row.id),
          threadID: row.thread_id == null ? null : String(row.thread_id),
          turnID: row.turn_id == null ? null : String(row.turn_id),
          workspacePath: String(row.workspace_path),
          configPath: String(row.config_path),
          configHash: String(row.config_hash),
          status: String(row.status) as HookTrustRequest['status'],
          auditSummary: parse<Record<string, unknown>>(String(row.audit_summary)),
          createdAt: Number(row.created_at),
          resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
        }
      : null
  }

  resolveHookTrustRequest(
    id: string,
    decision: 'allow' | 'block',
    operation?: InteractionOperationInput,
  ) {
    const pending = this.getHookTrustRequest(id)
    if (pending?.status === 'pending') {
      const timestamp = now()
      this.profileSqlite
        .query(
          `INSERT INTO hook_trust_decisions (workspace_path, config_hash, config_path, decision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_path, config_hash) DO UPDATE SET config_path = excluded.config_path, decision = excluded.decision, updated_at = excluded.updated_at`,
        )
        .run(
          pending.workspacePath,
          pending.configHash,
          pending.configPath,
          decision,
          timestamp,
          timestamp,
        )
    }
    return this.transaction(() => {
      const request = this.getHookTrustRequest(id)
      if (!request) return { state: 'missing' as const, request: null, events: [], resumed: [] }
      if (request.status !== 'pending')
        return { state: 'resolved' as const, request, events: [], resumed: [] }
      const timestamp = now()
      this.sqlite
        .query(
          "UPDATE hook_trust_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(decision === 'allow' ? 'allowed' : 'blocked', timestamp, id)
      const resolved = this.getHookTrustRequest(id)!
      const waiters = this.sqlite
        .query('SELECT agent_id, turn_id, thread_id FROM hook_trust_waiters WHERE request_id = ?')
        .all(id) as Array<{ agent_id: string; turn_id: string; thread_id: string }>
      const resumed = waiters.map((waiter) => ({
        agentID: waiter.agent_id,
        turnID: waiter.turn_id,
        threadID: waiter.thread_id,
      }))
      const events = resumed.length
        ? resumed.map((waiter) => {
            this.updateTurnStatus(waiter.turnID, 'queued')
            this.updateAgentStatus(waiter.agentID, 'queued')
            this.sqlite
              .query(
                `
            UPDATE agent_checkpoints
            SET state = 'ready', payload = json_set(payload, '$.decision', ?), updated_at = ?
            WHERE agent_id = ? AND state = 'waiting_hook_trust'
          `,
              )
              .run(decision, timestamp, waiter.agentID)
            const execution = this.getAgentExecution(waiter.agentID)
            if (execution?.subagentRunID) {
              this.sqlite
                .query(
                  "UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, updated_at = ? WHERE id = ?",
                )
                .run(timestamp, execution.subagentRunID)
              this.sqlite
                .query(
                  "UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE current_run_id = ?",
                )
                .run(timestamp, execution.subagentRunID)
              this.sqlite
                .query(
                  `UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'queued', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') = ?`,
                )
                .run(timestamp, execution.subagentRunID)
            }
            return this.insertEvent(
              waiter.threadID,
              waiter.turnID,
              'hook/trust/resolved',
              hookTrustResolvedPayload(resolved, decision, true, timestamp),
            )
          })
        : [
            this.insertEvent(
              resolved.threadID,
              resolved.turnID,
              'hook/trust/resolved',
              hookTrustResolvedPayload(resolved, decision, false, timestamp),
            ),
          ]
      if (operation) this.saveInteractionOperation(operation)
      return { state: 'resolved' as const, request: resolved, events, resumed }
    })
  }

  createSandboxEscalation(input: Omit<SandboxEscalation, 'status' | 'createdAt'>) {
    const createdAt = now()
    this.sqlite
      .query(
        "INSERT INTO sandbox_escalations (token, thread_id, turn_id, agent_id, tool_call_id, invocation, invocation_hash, failure, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_request', ?)",
      )
      .run(
        input.token,
        input.threadID,
        input.turnID,
        input.agentID,
        input.toolCallID,
        stringify(input.invocation),
        input.invocationHash,
        input.failure,
        createdAt,
      )
    return { ...input, status: 'awaiting_request' as const, createdAt }
  }

  getSandboxEscalation(token: string): SandboxEscalation | null {
    const row = this.sqlite
      .query(
        'SELECT token, thread_id, turn_id, agent_id, tool_call_id, invocation, invocation_hash, failure, status, created_at FROM sandbox_escalations WHERE token = ?',
      )
      .get(token) as {
      token: string
      thread_id: string
      turn_id: string
      agent_id: string
      tool_call_id: string
      invocation: string
      invocation_hash: string
      failure: string
      status: SandboxEscalation['status']
      created_at: number
    } | null
    return row
      ? {
          token: row.token,
          threadID: row.thread_id,
          turnID: row.turn_id,
          agentID: row.agent_id,
          toolCallID: row.tool_call_id,
          invocation: parse<ToolInvocation>(row.invocation),
          invocationHash: row.invocation_hash,
          failure: row.failure,
          status: row.status,
          createdAt: row.created_at,
        }
      : null
  }

  claimSandboxEscalation(
    token: string,
    scope: { threadID: string; turnID: string; agentID: string },
  ) {
    const escalation = this.getSandboxEscalation(token)
    if (
      !escalation ||
      escalation.threadID !== scope.threadID ||
      escalation.turnID !== scope.turnID ||
      escalation.agentID !== scope.agentID ||
      escalation.status !== 'awaiting_request'
    )
      return null
    const updated = this.sqlite
      .query(
        "UPDATE sandbox_escalations SET status = 'claimed', claimed_at = ? WHERE token = ? AND status = 'awaiting_request'",
      )
      .run(now(), token)
    return updated.changes === 1 ? { ...escalation, status: 'claimed' as const } : null
  }

  completeSandboxEscalation(token: string, output: unknown) {
    this.sqlite
      .query(
        "UPDATE sandbox_escalations SET status = 'completed', output = ?, completed_at = ? WHERE token = ? AND status = 'claimed'",
      )
      .run(stringify(output), now(), token)
  }

  cancelSandboxEscalation(token: string, reason: string) {
    this.sqlite
      .query(
        "UPDATE sandbox_escalations SET status = 'cancelled', output = ?, completed_at = ? WHERE token = ? AND status IN ('awaiting_request', 'claimed')",
      )
      .run(stringify({ error: reason }), now(), token)
  }

  createResumableQuestion(
    input: Omit<ResumableQuestion, 'id' | 'createdAt'> & {
      agentID: string
      id?: string
      createdAt?: number
      checkpoint: Omit<
        AgentTurnCheckpoint,
        'agentID' | 'turnID' | 'threadID' | 'state' | 'createdAt' | 'updatedAt'
      >
    },
  ) {
    const id = input.id ?? crypto.randomUUID()
    const createdAt = input.createdAt ?? now()
    return this.transaction(() => {
      this.sqlite
        .query(
          "INSERT INTO question_requests (id, thread_id, turn_id, agent_id, tool_call_id, payload, payload_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        )
        .run(
          id,
          input.threadID,
          input.turnID,
          input.agentID,
          input.toolCallID,
          stringify(input.payload),
          input.payloadVersion,
          createdAt,
        )
      this.sqlite
        .query(
          `INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'waiting_question', ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`,
        )
        .run(
          input.agentID,
          input.turnID,
          input.threadID,
          stringify(input.checkpoint.payload),
          input.checkpoint.version,
          createdAt,
          createdAt,
        )
      this.updateTurnStatus(input.turnID, 'waiting_question')
      this.updateAgentStatus(input.agentID, 'waiting_question')
      const item = {
        id,
        turnID: input.turnID,
        agentID: input.agentID,
        type: 'question' as const,
        status: 'pending' as const,
        data: { ...input.payload, toolCallId: input.toolCallID },
        createdAt,
        updatedAt: createdAt,
      }
      this.upsertItem(input.threadID, item)
      const question = {
        id,
        threadID: input.threadID,
        turnID: input.turnID,
        toolCallID: input.toolCallID,
        payload: input.payload,
        payloadVersion: input.payloadVersion,
        createdAt,
      } satisfies ResumableQuestion
      const events = [
        this.insertEvent(input.threadID, input.turnID, 'agent/upserted', {
          agent: this.getAgentExecution(input.agentID),
        }),
        this.insertEvent(input.threadID, input.turnID, 'question/requested', {
          interactionId: id,
          threadId: input.threadID,
          turnId: input.turnID,
          agentId: input.agentID,
          createdAt,
          version: input.payloadVersion,
          kind: 'question',
          toolCallId: input.toolCallID,
          questions: input.payload.questions,
          ...(typeof input.payload.autoResolutionMs === 'number'
            ? { autoResolutionMs: input.payload.autoResolutionMs }
            : {}),
        }),
      ]
      return { question, events }
    })
  }

  resolveResumableQuestion(
    id: string,
    answer: unknown,
    ignored = false,
    operation?: InteractionOperationInput,
  ) {
    return this.transaction(() => {
      const row = this.sqlite
        .query('SELECT thread_id, turn_id, payload, status FROM question_requests WHERE id = ?')
        .get(id) as { thread_id: string; turn_id: string; payload: string; status: string } | null
      if (!row || row.status !== 'pending') return null
      const timestamp = now()
      const checkpoint = this.getAgentTurnCheckpoint(row.turn_id)
      if (!checkpoint || checkpoint.state !== 'waiting_question')
        throw new Error(`问题 ${id} 没有可恢复 checkpoint`)
      const resolved = this.sqlite
        .query(
          "UPDATE question_requests SET status = 'resolved', answer = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(stringify({ value: answer, ignored }), timestamp, id)
      if (resolved.changes !== 1) return null
      this.saveAgentTurnCheckpoint({
        ...checkpoint,
        state: 'ready',
        payload: { ...checkpoint.payload, questionID: id, answer },
      })
      this.updateTurnStatus(row.turn_id, 'queued')
      this.updateAgentStatus(checkpoint.agentID, 'queued')
      const item = this.getItem(id)
      if (item)
        this.upsertItem(row.thread_id, {
          ...item,
          status: 'completed',
          data: { ...item.data, answer, ignored },
          updatedAt: timestamp,
        })
      const events = [
        this.insertEvent(row.thread_id, row.turn_id, 'agent/upserted', {
          agent: this.getAgentExecution(checkpoint.agentID),
        }),
        this.insertEvent(
          row.thread_id,
          row.turn_id,
          'interaction/resolved',
          interactionResolvedPayload(
            questionInteractionResult(id, parse(row.payload), answer, ignored, operation),
            timestamp,
            id,
          ),
        ),
      ]
      if (operation) this.saveInteractionOperation(operation)
      return { threadID: row.thread_id, turnID: row.turn_id, events }
    })
  }

  completeQuestionResume(id: string) {
    this.sqlite
      .query(
        "UPDATE question_requests SET status = 'consumed' WHERE id = ? AND status = 'resuming'",
      )
      .run(id)
    this.sqlite
      .query(
        'DELETE FROM agent_checkpoints WHERE turn_id = (SELECT turn_id FROM question_requests WHERE id = ?)',
      )
      .run(id)
  }
}

export type InteractionRepository = InteractionRepositoryDatabase
export const interactionRepository = (
  database: InteractionRepositoryDatabase,
): InteractionRepository => database
