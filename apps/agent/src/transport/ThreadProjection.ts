import { AgentError } from '../Domain'
import type {
  ApprovalRequest,
  AgentExecution as WireAgentExecution,
  Attachment,
  ContextUsageBreakdownEntry,
  LocalContextReference,
  Input,
  Item,
  Message,
  SubagentProjection,
  Thread,
  ThreadExecutionEnvironment,
  ThreadListItem,
  ThreadSnapshot,
  PlanApproval,
  ThreadTurnBundle,
  Turn,
} from '@pidex/shared/thread'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ContextUsageBreakdownSourceSchema,
  decodeApprovalPolicy,
  decodeStructuredPlan,
  InteractionQuestionSchema,
  InteractionQuestionAnswerSchema,
  WorktreeStatusSchema,
} from '@pidex/shared/thread'
import { Schema } from 'effect'
import type { AgentExecution, EventEnvelope, Item as StoredItem } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { probeThreadsStorageCapabilities } from '../storage/database/StorageCapabilities'
import { THREAD_ORIGIN_PROJECTION_SQL } from '../storage/repositories/ThreadRepository'
import { SubagentRepository } from '../subagent/SubagentRepository'
import { classifyToolActivity, storedToolActivity } from '../tool/ToolActivityClassifier'

const parse = <T>(value: string): T => JSON.parse(value) as T
const isQuestionGroup = Schema.is(Schema.Array(InteractionQuestionSchema))
const isQuestionAnswers = Schema.is(Schema.Array(InteractionQuestionAnswerSchema))
const localContextStatus = (path: string): LocalContextReference['status'] => {
  try {
    const canonical = realpathSync(resolve(path))
    const expected = resolve(path)
    return (
      process.platform === 'win32'
        ? canonical.toLowerCase() === expected.toLowerCase()
        : canonical === expected
    )
      ? 'available'
      : 'missing'
  } catch {
    return 'missing'
  }
}

const turnStatus = (status: string): Turn['status'] => {
  if (status === 'waiting_permission') return 'waiting-permission'
  if (status === 'waiting_question') return 'waiting-question'
  if (status === 'waiting_subagents') return 'waiting-subagents'
  if (status === 'interrupted') return 'interrupted'
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  )
    return status
  return 'stopped'
}

const inputState = (status: string): Input['state'] => {
  if (status === 'queued') return 'queued'
  if (status === 'mailbox' || status === 'consumed') return 'merged'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed') return 'completed'
  return 'active'
}

const inputDelivery = (strategy: string | number | null | undefined): Input['delivery'] =>
  strategy === 'guide' ? 'steer' : strategy === 'queue' ? 'follow-up' : 'start'

const asText = (value: unknown) =>
  typeof value === 'string' ? value : value == null ? null : JSON.stringify(value, null, 2)
const modelUsage = (value: unknown): Extract<Item, { type: 'text' }>['usage'] => {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  if (
    typeof usage.provider !== 'string' ||
    typeof usage.model !== 'string' ||
    typeof usage.contextWindow !== 'number' ||
    !Number.isFinite(usage.contextWindow)
  )
    return undefined
  const token = (key: string) => {
    const current = usage[key]
    return typeof current === 'number' && Number.isFinite(current)
      ? Math.max(0, Math.trunc(current))
      : 0
  }
  const breakdown = contextUsageBreakdown(usage.breakdown)
  return {
    provider: usage.provider,
    model: usage.model,
    contextWindow: Math.max(1, Math.trunc(usage.contextWindow)),
    input: token('input'),
    output: token('output'),
    cacheRead: token('cacheRead'),
    cacheWrite: token('cacheWrite'),
    reasoning: token('reasoning'),
    ...(breakdown ? { breakdown } : {}),
  }
}
const isBreakdownSource = Schema.is(ContextUsageBreakdownSourceSchema)
/** 逐条校验来源分类，未知分类或非法字符量直接丢弃，而不是让整条 usage 失败。 */
const contextUsageBreakdown = (value: unknown): ContextUsageBreakdownEntry[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const entries: ContextUsageBreakdownEntry[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as { source?: unknown; chars?: unknown }
    if (!isBreakdownSource(candidate.source)) continue
    if (typeof candidate.chars !== 'number' || !Number.isFinite(candidate.chars)) continue
    if (candidate.chars <= 0) continue
    entries.push({ source: candidate.source, chars: Math.trunc(candidate.chars) })
  }
  return entries.length > 0 ? entries : undefined
}
const activityCommandStatus = (
  value: unknown,
): 'success' | 'running' | 'error' | 'interrupted' | undefined =>
  value === 'success' || value === 'running' || value === 'error' || value === 'interrupted'
    ? value
    : undefined
const toolLeaf = (tool: string) => tool.toLowerCase().split('.').at(-1) ?? tool.toLowerCase()

const completionMetadata = (value: unknown): Extract<Item, { type: 'text' }>['completion'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const completion = value as Record<string, unknown>
  const projected: Record<string, unknown> = {}
  const stopReason =
    typeof completion.stopReason === 'string' && completion.stopReason
      ? completion.stopReason
      : undefined
  if (stopReason) projected.stopReason = stopReason
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    const number = completion[key]
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) {
      projected[key] = Math.trunc(number)
    }
  }
  return Object.keys(projected).length
    ? (projected as Extract<Item, { type: 'text' }>['completion'])
    : undefined
}

const toolResultBlock = (
  value: unknown,
): Extract<Item, { type: 'tool' }>['resultBlocks'] extends readonly (infer B)[] | undefined
  ? B
  : never => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null as never
  const block = value as Record<string, unknown>
  const type = block.type
  if (type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text } as never
  }
  if (type === 'citation' && typeof block.url === 'string' && block.url.trim()) {
    const title =
      typeof block.title === 'string' && block.title.trim() ? block.title.trim() : undefined
    return { type: 'citation', ...(title ? { title } : {}), url: block.url } as never
  }
  if (type === 'json') {
    try {
      const valueJSON = JSON.parse(JSON.stringify(block.value)) as unknown
      return { type: 'json', value: valueJSON } as never
    } catch {
      return null as never
    }
  }
  if (
    type === 'artifact' &&
    typeof block.artifactId === 'string' &&
    typeof block.name === 'string' &&
    typeof block.mimeType === 'string'
  ) {
    const size =
      typeof block.size === 'number' && Number.isFinite(block.size) && block.size >= 0
        ? Math.trunc(block.size)
        : undefined
    return {
      type: 'artifact',
      artifactId: block.artifactId,
      name: block.name,
      mimeType: block.mimeType,
      ...(size === undefined ? {} : { size }),
    } as never
  }
  return null as never
}

const toolResultBlocks = (value: unknown): Extract<Item, { type: 'tool' }>['resultBlocks'] => {
  if (!Array.isArray(value)) return undefined
  const blocks = value.flatMap((raw) => {
    const block = toolResultBlock(raw)
    return block === null ? [] : [block]
  })
  return blocks.length ? (blocks as Extract<Item, { type: 'tool' }>['resultBlocks']) : undefined
}
const isFileMutationTool = (tool: string) =>
  ['edit', 'write', 'apply_patch'].includes(toolLeaf(tool))
const activityCommands = (value: unknown): Extract<Item, { type: 'activity' }>['commands'] => {
  if (!Array.isArray(value)) return undefined
  const commands = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    if (typeof item.command !== 'string' || typeof item.output !== 'string') return []
    const status = activityCommandStatus(item.status)
    return [
      {
        command: item.command,
        output: item.output,
        ...(status ? { status } : {}),
        ...(typeof item.truncated === 'boolean' ? { truncated: item.truncated } : {}),
      },
    ]
  })
  return commands.length ? commands : undefined
}

type HistoryCursor = { v: 1; createdAt: number; id: string }

const encodeHistoryCursor = (cursor: HistoryCursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

const decodeHistoryCursor = (value: string): HistoryCursor => {
  try {
    const cursor = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<HistoryCursor>
    if (
      cursor.v !== 1 ||
      !Number.isSafeInteger(cursor.createdAt) ||
      typeof cursor.id !== 'string' ||
      !cursor.id
    )
      throw new Error('invalid cursor')
    return cursor as HistoryCursor
  } catch {
    throw new InvalidThreadHistoryCursorError()
  }
}

export class InvalidThreadHistoryCursorError extends Error {
  constructor() {
    super('Turn 历史游标无效')
    this.name = 'InvalidThreadHistoryCursorError'
  }
}

export type ThreadHistoryPage = {
  pendingPlanApproval?: PlanApproval | null
  thread: Thread
  subagents: SubagentProjection[]
  turns: ThreadTurnBundle[]
  queue: {
    version: number
    pauseReason: 'interrupted' | 'turn_failed' | null
    turns: Turn[]
    inputs: Input[]
  }
  olderCursor: string | null
  hasOlder: boolean
}

/** Raw binding projection row; every column is unvalidated storage input. */
type ExecutionBindingRow = {
  thread_id: string
  kind: string
  cwd: string
  revision: number
  worktree_id: string | null
  branch_name: string | null
  status: string | null
}

export class ThreadProjection {
  private readonly subagents: SubagentRepository
  private executionBindingsAvailable: boolean | null = null
  private managedWorktreesAvailable: boolean | null = null

  constructor(private readonly db: AgentDatabase) {
    this.subagents = new SubagentRepository(db)
  }

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  /**
   * Bindings and worktrees are probed separately. A store with bindings but no
   * worktree table still resolves local bindings authoritatively; only worktree
   * bindings need the join partner.
   */
  private hasExecutionBindings(): boolean {
    if (this.executionBindingsAvailable === null) {
      this.executionBindingsAvailable = this.hasTable('thread_execution_bindings')
    }
    return this.executionBindingsAvailable
  }

  private hasManagedWorktrees(): boolean {
    if (this.managedWorktreesAvailable === null) {
      this.managedWorktreesAvailable = this.hasTable('managed_worktrees')
    }
    return this.managedWorktreesAvailable
  }

  /**
   * Runtime-validated projection. Unknown enum values or malformed revisions from a
   * newer schema omit the environment instead of failing the whole thread read.
   */
  private toExecutionEnvironment(row: ExecutionBindingRow): ThreadExecutionEnvironment | null {
    const revision = Number(row.revision)
    if (!Number.isInteger(revision) || revision < 1) return null
    if (row.kind === 'local') return { kind: 'local', cwd: row.cwd, revision }
    if (row.kind !== 'worktree' || !row.worktree_id) return null
    if (!Schema.is(WorktreeStatusSchema)(row.status)) return null
    return {
      kind: 'worktree',
      worktreeId: row.worktree_id,
      cwd: row.cwd,
      branchName: row.branch_name,
      status: row.status,
      revision,
    }
  }

  /** Authoritative workspace fallback for threads that predate execution bindings. */
  private workspaceExecutionEnvironment(
    workspace: { readonly cwd: string } | null | undefined,
  ): ThreadExecutionEnvironment | undefined {
    if (!workspace?.cwd) return undefined
    return { kind: 'local', cwd: workspace.cwd, revision: 1 }
  }

  /**
   * Batch-loads bindings. A present-but-unreadable row maps to `null` so callers can
   * tell it apart from a thread that has no binding at all. Without the worktree
   * table the join columns are NULL, which makes every worktree binding unresolvable
   * while local bindings still project from the binding row itself.
   */
  private executionEnvironments(
    threadIds: readonly string[],
  ): Map<string, ThreadExecutionEnvironment | null> {
    const environments = new Map<string, ThreadExecutionEnvironment | null>()
    if (threadIds.length === 0 || !this.hasExecutionBindings()) return environments
    const worktreesAvailable = this.hasManagedWorktrees()
    const placeholders = threadIds.map(() => '?').join(',')
    const rows = this.db.sqlite
      .query(
        `
      SELECT binding.thread_id, binding.kind, binding.cwd, binding.revision, binding.worktree_id,
        ${worktreesAvailable ? 'worktree.branch_name, worktree.status' : 'NULL AS branch_name, NULL AS status'}
      FROM thread_execution_bindings AS binding
      ${worktreesAvailable ? 'LEFT JOIN managed_worktrees AS worktree ON worktree.id = binding.worktree_id' : ''}
      WHERE binding.thread_id IN (${placeholders})
    `,
      )
      .all(...threadIds) as ExecutionBindingRow[]
    for (const row of rows) {
      environments.set(String(row.thread_id), this.toExecutionEnvironment(row))
    }
    return environments
  }

  /**
   * A thread with a binding always uses it, even when its stored values are
   * unreadable — falling back to the workspace there would misreport the actual
   * execution environment. Only threads with no binding row use the workspace.
   */
  private resolveExecutionEnvironment(
    bindings: ReadonlyMap<string, ThreadExecutionEnvironment | null>,
    threadId: string,
    workspace: { readonly cwd: string } | null | undefined,
  ): ThreadExecutionEnvironment | undefined {
    if (bindings.has(threadId)) return bindings.get(threadId) ?? undefined
    return this.workspaceExecutionEnvironment(workspace)
  }

  private projectAgent(row: Record<string, string | number | null>): WireAgentExecution {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      parentAgentId: row.parent_agent_id == null ? null : String(row.parent_agent_id),
      profile: String(row.profile),
      task: String(row.task),
      model: JSON.parse(String(row.model_ref)),
      sessionId: String(row.session_id),
      depth: Number(row.depth),
      subagentRunId: row.subagent_run_id == null ? null : String(row.subagent_run_id),
      runSequence: Number(row.run_sequence ?? 0),
      status: String(row.status).replaceAll('_', '-') as WireAgentExecution['status'],
      error: row.error == null ? null : String(row.error),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private projectDomainAgent(agent: AgentExecution): WireAgentExecution {
    return {
      id: agent.id,
      threadId: agent.threadID,
      turnId: agent.turnID,
      parentAgentId: agent.parentAgentID ?? null,
      profile: agent.profile,
      task: agent.task,
      model: agent.model,
      sessionId: agent.sessionID,
      depth: agent.depth,
      subagentRunId: agent.subagentRunID ?? null,
      runSequence: agent.runSequence,
      status: String(agent.status).replaceAll('_', '-') as WireAgentExecution['status'],
      error: agent.error ?? null,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }
  }

  private projectThreadRow(
    row: Record<string, string | number | null>,
    workspace: Thread['workspace'] | undefined,
  ): Thread {
    const threadId = String(row.id)
    const sessionGroupId = this.db.repositories.sessionGroups.membership(threadId)?.group_id ?? null
    const executionEnvironment = this.resolveExecutionEnvironment(
      this.executionEnvironments([threadId]),
      threadId,
      workspace,
    )
    return {
      id: String(row.id),
      title: String(row.title),
      projectID: row.project_id == null ? null : String(row.project_id),
      gitBranch: row.git_branch == null ? null : String(row.git_branch),
      sessionGroupId,
      workflowId: sessionGroupId,
      ...(executionEnvironment ? { executionEnvironment } : {}),
      hasScheduledRun: Boolean(row.has_scheduled_run),
      isScheduledSession: Boolean(row.is_scheduled_session),
      isFork: Boolean(row.is_fork),
      ...(row.creation_surface
        ? { creationSurface: row.creation_surface as Thread['creationSurface'] }
        : {}),
      ...(workspace ? { workspace } : {}),
      settings: {
        taskMode: String(row.task_mode) as Thread['settings']['taskMode'],
        permissionConfig: {
          sandboxMode: String(
            row.sandbox_mode,
          ) as Thread['settings']['permissionConfig']['sandboxMode'],
          approvalPolicy: decodeApprovalPolicy(String(row.approval_policy)),
          approvalsReviewer: String(
            row.approvals_reviewer,
          ) as Thread['settings']['permissionConfig']['approvalsReviewer'],
        },
      },
      archivedAt: row.archived_at == null ? null : Number(row.archived_at),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  private projectThread(threadId: string): Thread | null {
    const { creationSurface: columnExists } = probeThreadsStorageCapabilities(this.db.sqlite)
    const sql = `SELECT t.id, t.title, ${this.db.projectMembershipSql()} AS project_id, t.git_branch,
      ${columnExists ? 't.creation_surface' : 'NULL AS creation_surface'},
      t.task_mode, t.sandbox_mode, t.approval_policy, t.approvals_reviewer,
      t.archived_at, t.created_at, t.updated_at, ${THREAD_ORIGIN_PROJECTION_SQL}
      FROM threads AS t WHERE t.id = ?`
    const threadRow = this.db.sqlite.query(sql).get(threadId) as Record<
      string,
      string | number | null
    > | null
    if (!threadRow) return null
    return this.projectThreadRow(threadRow, this.db.threadWorkspace(threadId) ?? undefined)
  }

  private projectInput(row: Record<string, string | number | null>): Input {
    const attachmentIds = (
      this.db.sqlite
        .query('SELECT id FROM input_attachments WHERE input_id = ? ORDER BY created_at, id')
        .all(String(row.id)) as Array<{ id: string }>
    ).map(({ id }) => id)
    const contextReferenceIds = (
      this.db.sqlite
        .query(
          'SELECT context_path_id AS id FROM input_context_paths WHERE input_id = ? ORDER BY sort_order, created_at, context_path_id',
        )
        .all(String(row.id)) as Array<{ id: string }>
    ).map(({ id }) => id)
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id == null ? null : String(row.turn_id),
      content: String(row.content),
      ...(row.skills ? { skills: parse(String(row.skills)) } : {}),
      delivery: inputDelivery(row.strategy),
      ...(row.origin ? { origin: String(row.origin) as Input['origin'] } : {}),
      mode: String(row.task_mode) as Input['mode'],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input['permissionConfig']['sandboxMode'],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(
          row.approvals_reviewer,
        ) as Input['permissionConfig']['approvalsReviewer'],
      },
      attachmentIds,
      contextReferenceIds,
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }
  }

  private projectTurn(
    row: Record<string, string | number | null>,
    inputs: Input[],
    status = String(row.status),
  ): Turn {
    const startedAt = row.started_at == null ? null : Number(row.started_at)
    const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
    const turnError = status === 'failed' ? this.turnErrorForRow(row) : null
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      sourceInputID: inputs[0]?.id ?? '',
      status: turnStatus(status),
      mode: String(row.mode) as Turn['mode'],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Turn['permissionConfig']['sandboxMode'],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(
          row.approvals_reviewer,
        ) as Turn['permissionConfig']['approvalsReviewer'],
      },
      rootAgentId: String(row.root_agent_id),
      mergedInputIDs: inputs.slice(1).map((input) => input.id),
      queuePosition: row.queue_position == null ? null : Number(row.queue_position),
      startedAt,
      finishedAt,
      elapsedSeconds:
        startedAt == null
          ? 0
          : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
      error: turnError,
    }
  }

  private turnErrorForRow(row: Record<string, string | number | null>): string | null {
    const rootAgentId = row.root_agent_id
    if (!rootAgentId) return null
    const agentRow = this.db.sqlite
      .query('SELECT error FROM agent_executions WHERE id = ?')
      .get(String(rootAgentId)) as { error: string | null } | null
    return agentRow?.error ?? null
  }

  private lifecyclePayload(
    event: EventEnvelope,
    source: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (
      !event.method.startsWith('turn/') ||
      ![
        'turn/queued',
        'turn/started',
        'turn/completed',
        'turn/failed',
        'turn/interrupted',
      ].includes(event.method)
    )
      return null
    const turnID = event.turnId ?? (typeof source.turnId === 'string' ? source.turnId : null)
    if (!turnID) return null
    const turnRow = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
        approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at
      FROM turns WHERE id = ?
    `,
      )
      .get(turnID) as Record<string, string | number | null> | null
    if (!turnRow) return null
    const inputRows = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy,
        approvals_reviewer, strategy, task_mode, status, created_at, origin
      FROM inputs WHERE turn_id = ? ORDER BY created_at, id
    `,
      )
      .all(turnID) as Array<Record<string, string | number | null>>
    const inputs = inputRows.map((row) => this.projectInput(row))
    const eventStatus =
      event.method === 'turn/queued'
        ? 'queued'
        : event.method === 'turn/started'
          ? 'running'
          : event.method === 'turn/completed'
            ? 'completed'
            : event.method === 'turn/failed'
              ? 'failed'
              : 'interrupted'
    const turn = this.projectTurn(turnRow, inputs, eventStatus)
    if (event.method === 'turn/queued' || event.method === 'turn/started') {
      const input = inputs[0]
      return input ? { turn, input } : null
    }
    if (event.method === 'turn/failed') {
      const rawError =
        source.error && typeof source.error === 'object'
          ? (source.error as Record<string, unknown>)
          : null
      return {
        turn,
        error: {
          code: typeof rawError?.code === 'string' ? rawError.code : 'TURN_FAILED',
          message:
            typeof rawError?.message === 'string'
              ? rawError.message
              : typeof source.message === 'string'
                ? source.message
                : 'Agent turn failed',
          retryable: typeof rawError?.retryable === 'boolean' ? rawError.retryable : false,
        },
      }
    }
    if (event.method === 'turn/interrupted') {
      const checkpointVersion =
        typeof source.checkpointVersion === 'number' ? source.checkpointVersion : undefined
      return {
        turn,
        reason: typeof source.reason === 'string' && source.reason ? source.reason : 'interrupted',
        recoveryAvailable: checkpointVersion !== undefined,
        ...(checkpointVersion === undefined ? {} : { checkpointVersion }),
      }
    }
    return { turn }
  }

  snapshot(threadId: string): ThreadSnapshot | null {
    const thread = this.projectThread(threadId)
    if (!thread) return null
    const attachmentRows = this.db.sqlite
      .query(
        'SELECT id, input_id FROM input_attachments WHERE thread_id = ? AND input_id IS NOT NULL ORDER BY created_at, id',
      )
      .all(threadId) as Array<{ id: string; input_id: string }>
    const attachmentIDsByInput = new Map<string, string[]>()
    for (const attachment of attachmentRows)
      attachmentIDsByInput.set(attachment.input_id, [
        ...(attachmentIDsByInput.get(attachment.input_id) ?? []),
        attachment.id,
      ])
    const contextRows = this.db.sqlite
      .query(
        `
      SELECT binding.input_id, context.id, context.name, context.path, context.kind, context.created_at
      FROM input_context_paths AS binding
      JOIN thread_context_paths AS context ON context.id = binding.context_path_id
      JOIN inputs ON inputs.id = binding.input_id
      WHERE inputs.thread_id = ?
      ORDER BY binding.sort_order, binding.created_at, context.id
    `,
      )
      .all(threadId) as Array<{
      input_id: string
      id: string
      name: string
      path: string
      kind: LocalContextReference['kind']
      created_at: number
    }>
    const contextIDsByInput = new Map<string, string[]>()
    for (const row of contextRows)
      contextIDsByInput.set(row.input_id, [...(contextIDsByInput.get(row.input_id) ?? []), row.id])
    const inputs = (
      this.db.sqlite
        .query(
          'SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at, origin, skills FROM inputs WHERE thread_id = ? ORDER BY created_at',
        )
        .all(threadId) as Array<Record<string, string | number | null>>
    ).map((row): Input => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id ? String(row.turn_id) : null,
      content: String(row.content),
      ...(row.skills ? { skills: parse(String(row.skills)) } : {}),
      delivery: inputDelivery(row.strategy),
      ...(row.origin ? { origin: String(row.origin) as Input['origin'] } : {}),
      mode: String(row.task_mode) as Input['mode'],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input['permissionConfig']['sandboxMode'],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(
          row.approvals_reviewer,
        ) as Input['permissionConfig']['approvalsReviewer'],
      },
      attachmentIds: attachmentIDsByInput.get(String(row.id)) ?? [],
      contextReferenceIds: contextIDsByInput.get(String(row.id)) ?? [],
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }))
    const turns = (
      this.db.sqlite
        .query(
          "SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at FROM turns WHERE thread_id = ? ORDER BY CASE WHEN status = 'queued' THEN 1 ELSE 0 END, CASE WHEN status = 'queued' THEN queue_position END, created_at, id",
        )
        .all(threadId) as Array<Record<string, string | number | null>>
    ).map((row): Turn => {
      const turnInputs = inputs.filter((input) => input.turnId === row.id)
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      const turnStatusStr = String(row.status)
      const turnError = turnStatusStr === 'failed' ? this.turnErrorForRow(row) : null
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        sourceInputID: turnInputs[0]?.id ?? '',
        status: turnStatus(turnStatusStr),
        mode: String(row.mode) as Turn['mode'],
        model: parse(String(row.model_ref)),
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as Turn['permissionConfig']['sandboxMode'],
          approvalPolicy: decodeApprovalPolicy(row.approval_policy),
          approvalsReviewer: String(
            row.approvals_reviewer,
          ) as Turn['permissionConfig']['approvalsReviewer'],
        },
        rootAgentId: String(row.root_agent_id),
        mergedInputIDs: turnInputs.slice(1).map((input) => input.id),
        queuePosition: row.queue_position == null ? null : Number(row.queue_position),
        startedAt,
        finishedAt,
        elapsedSeconds:
          startedAt == null
            ? 0
            : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
        error: turnError,
      }
    })
    const agents = (
      this.db.sqlite
        .query(
          'SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, subagent_run_id, run_sequence, status, error, created_at, updated_at FROM agent_executions WHERE thread_id = ? ORDER BY created_at',
        )
        .all(threadId) as Array<Record<string, string | number | null>>
    ).map((row) => this.projectAgent(row))
    const messages = (
      this.db.sqlite
        .query(
          'SELECT id, thread_id, turn_id, role, created_at FROM messages WHERE thread_id = ? ORDER BY ordinal, created_at, id',
        )
        .all(threadId) as Array<Record<string, string | number | null>>
    ).map((row): Message => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id ? String(row.turn_id) : null,
      role: String(row.role) as Message['role'],
      createdAt: Number(row.created_at),
    }))
    const items = (
      this.db.sqlite
        .query(
          'SELECT id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at FROM items WHERE thread_id = ? ORDER BY ordinal, created_at, id',
        )
        .all(threadId) as Array<Record<string, string | number | null>>
    )
      .map((row) =>
        this.item({
          id: String(row.id),
          turnID: String(row.turn_id),
          agentID: String(row.agent_id),
          type: String(row.type) as StoredItem['type'],
          status: String(row.status) as StoredItem['status'],
          data: parse(String(row.data)),
          ...(row.ordinal == null ? {} : { ordinal: Number(row.ordinal) }),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }),
      )
      .filter((item): item is Item => item !== null)
    const approvals = (
      this.db.sqlite
        .query(
          "SELECT id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, review_payload, created_at FROM approval_requests WHERE thread_id = ? AND status <> 'preparing' ORDER BY created_at",
        )
        .all(threadId) as Array<Record<string, string | number | null>>
    ).map((row) => this.approval(row))
    for (const payload of this.db.repositories.interactions.pendingMcpElicitations(threadId)) {
      approvals.push({
        id: String(payload.interactionId),
        threadId,
        turnId: String(payload.turnId),
        agentId: String(payload.agentId),
        toolCallID: String(payload.toolCallId),
        tool: 'McpElicitation',
        command: null,
        cwd: null,
        paths: [],
        requestedPermissions: {},
        review: null,
        risk: 'medium',
        reason: String((payload.request as Record<string, unknown>).message ?? 'MCP 请求输入'),
        status: 'pending',
        createdAt: Number(payload.createdAt),
        input: { serverName: payload.server, request: payload.request },
        toolIdentity: { server: String(payload.server), tool: String(payload.tool) },
      })
    }
    return {
      thread,
      turns,
      agents,
      subagents: this.subagents.projectionForThread(threadId, true),
      inputs,
      messages,
      items,
      approvals,
      goal: this.db.repositories.threadGoals.get(threadId),
      pendingPlanApproval: this.db.repositories.planApprovals.pending(threadId),
      contextReferences: contextRows.map((row) => ({
        id: row.id,
        name: row.name,
        path: row.path,
        kind: row.kind,
        status: localContextStatus(row.path),
        createdAt: row.created_at,
      })),
      queue: this.db.queueStateMeta(threadId) ?? { version: 0, pauseReason: null },
    }
  }

  historyPage(
    threadId: string,
    params: { before?: string; limit?: number } = {},
  ): ThreadHistoryPage | null {
    const thread = this.projectThread(threadId)
    if (!thread) return null
    const limit = Math.min(50, Math.max(1, params.limit ?? 10))
    const cursor = params.before ? decodeHistoryCursor(params.before) : null
    const turnRows = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
        approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at
      FROM turns
      WHERE thread_id = ? AND status <> 'queued'
        ${cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
      )
      .all(
        ...(cursor
          ? [threadId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
          : [threadId, limit + 1]),
      ) as Array<Record<string, string | number | null>>
    const hasOlder = turnRows.length > limit
    const selectedTurnRows = turnRows.slice(0, limit)
    const selectedTurnIDs = selectedTurnRows.map((row) => String(row.id))

    const queueTurnRows = this.db.sqlite
      .query(
        `
      SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
        approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at
      FROM turns
      WHERE thread_id = ? AND status = 'queued'
      ORDER BY queue_position, created_at, id
    `,
      )
      .all(threadId) as Array<Record<string, string | number | null>>
    const queueTurnIDs = queueTurnRows.map((row) => String(row.id))
    const allTurnIDs = [...selectedTurnIDs, ...queueTurnIDs]
    const placeholders = allTurnIDs.map(() => '?').join(',')

    const inputRows = allTurnIDs.length
      ? (this.db.sqlite
          .query(
            `SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at, origin, skills FROM inputs WHERE turn_id IN (${placeholders}) ORDER BY created_at, id`,
          )
          .all(...allTurnIDs) as Array<Record<string, string | number | null>>)
      : []
    const inputIDs = inputRows.map((row) => String(row.id))
    const inputPlaceholders = inputIDs.map(() => '?').join(',')
    const attachmentRows = inputIDs.length
      ? (this.db.sqlite
          .query(
            `SELECT id, input_id, kind, name, media_type, size_bytes, sha256, created_at FROM input_attachments WHERE input_id IN (${inputPlaceholders}) ORDER BY created_at, id`,
          )
          .all(...inputIDs) as Array<Record<string, string | number | null>>)
      : []
    const contextRows = inputIDs.length
      ? (this.db.sqlite
          .query(
            `
          SELECT binding.input_id, context.id, context.name, context.path, context.kind, context.created_at
          FROM input_context_paths AS binding
          JOIN thread_context_paths AS context ON context.id = binding.context_path_id
          WHERE binding.input_id IN (${inputPlaceholders})
          ORDER BY binding.sort_order, binding.created_at, context.id
        `,
          )
          .all(...inputIDs) as Array<Record<string, string | number | null>>)
      : []
    const attachmentIDsByInput = new Map<string, string[]>()
    const attachmentsByInput = new Map<string, Attachment[]>()
    const contextIDsByInput = new Map<string, string[]>()
    const contextByInput = new Map<string, LocalContextReference[]>()
    for (const row of contextRows) {
      const inputID = String(row.input_id)
      contextIDsByInput.set(inputID, [...(contextIDsByInput.get(inputID) ?? []), String(row.id)])
      contextByInput.set(inputID, [
        ...(contextByInput.get(inputID) ?? []),
        {
          id: String(row.id),
          name: String(row.name),
          path: String(row.path),
          kind: String(row.kind) as LocalContextReference['kind'],
          status: localContextStatus(String(row.path)),
          createdAt: Number(row.created_at),
        },
      ])
    }
    for (const row of attachmentRows) {
      const inputID = String(row.input_id)
      attachmentIDsByInput.set(inputID, [
        ...(attachmentIDsByInput.get(inputID) ?? []),
        String(row.id),
      ])
      attachmentsByInput.set(inputID, [
        ...(attachmentsByInput.get(inputID) ?? []),
        {
          id: String(row.id),
          kind: String(row.kind) as Attachment['kind'],
          name: String(row.name),
          mediaType: String(row.media_type),
          sizeBytes: Number(row.size_bytes),
          sha256: String(row.sha256),
          createdAt: Number(row.created_at),
        },
      ])
    }
    const inputs = inputRows.map((row): Input => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id == null ? null : String(row.turn_id),
      content: String(row.content),
      ...(row.skills ? { skills: parse(String(row.skills)) } : {}),
      delivery: inputDelivery(row.strategy),
      ...(row.origin ? { origin: String(row.origin) as Input['origin'] } : {}),
      mode: String(row.task_mode) as Input['mode'],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input['permissionConfig']['sandboxMode'],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(
          row.approvals_reviewer,
        ) as Input['permissionConfig']['approvalsReviewer'],
      },
      attachmentIds: attachmentIDsByInput.get(String(row.id)) ?? [],
      contextReferenceIds: contextIDsByInput.get(String(row.id)) ?? [],
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }))
    const inputsByTurn = new Map<string, Input[]>()
    for (const input of inputs) {
      if (!input.turnId) continue
      inputsByTurn.set(input.turnId, [...(inputsByTurn.get(input.turnId) ?? []), input])
    }
    const mapTurn = (row: Record<string, string | number | null>): Turn => {
      const turnInputs = inputsByTurn.get(String(row.id)) ?? []
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      const turnStatusStr = String(row.status)
      const turnError = turnStatusStr === 'failed' ? this.turnErrorForRow(row) : null
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        sourceInputID: turnInputs[0]?.id ?? '',
        status: turnStatus(turnStatusStr),
        mode: String(row.mode) as Turn['mode'],
        model: parse(String(row.model_ref)),
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as Turn['permissionConfig']['sandboxMode'],
          approvalPolicy: decodeApprovalPolicy(row.approval_policy),
          approvalsReviewer: String(
            row.approvals_reviewer,
          ) as Turn['permissionConfig']['approvalsReviewer'],
        },
        rootAgentId: String(row.root_agent_id),
        mergedInputIDs: turnInputs.slice(1).map((input) => input.id),
        queuePosition: row.queue_position == null ? null : Number(row.queue_position),
        startedAt,
        finishedAt,
        elapsedSeconds:
          startedAt == null
            ? 0
            : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
        error: turnError,
      }
    }

    const selectedPlaceholders = selectedTurnIDs.map(() => '?').join(',')
    const agentRows = selectedTurnIDs.length
      ? (this.db.sqlite
          .query(
            `SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, subagent_run_id, run_sequence, status, error, created_at, updated_at FROM agent_executions WHERE turn_id IN (${selectedPlaceholders}) ORDER BY created_at, id`,
          )
          .all(...selectedTurnIDs) as Array<Record<string, string | number | null>>)
      : []
    const agents = agentRows.map((row) => this.projectAgent(row))
    const messageRows = selectedTurnIDs.length
      ? (this.db.sqlite
          .query(
            `SELECT id, thread_id, turn_id, role, created_at FROM messages WHERE turn_id IN (${selectedPlaceholders}) ORDER BY ordinal, created_at, id`,
          )
          .all(...selectedTurnIDs) as Array<Record<string, string | number | null>>)
      : []
    const messages = messageRows.map((row): Message => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id == null ? null : String(row.turn_id),
      role: String(row.role) as Message['role'],
      createdAt: Number(row.created_at),
    }))
    const itemRows = selectedTurnIDs.length
      ? (this.db.sqlite
          .query(
            `SELECT id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at FROM items WHERE turn_id IN (${selectedPlaceholders}) ORDER BY turn_id, ordinal, created_at, id`,
          )
          .all(...selectedTurnIDs) as Array<Record<string, string | number | null>>)
      : []
    const items = itemRows
      .map((row) =>
        this.item({
          id: String(row.id),
          turnID: String(row.turn_id),
          agentID: String(row.agent_id),
          type: String(row.type) as StoredItem['type'],
          status: String(row.status) as StoredItem['status'],
          data: parse(String(row.data)),
          ...(row.ordinal == null ? {} : { ordinal: Number(row.ordinal) }),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }),
      )
      .filter((item): item is Item => item !== null)
    const approvalRows = selectedTurnIDs.length
      ? (this.db.sqlite
          .query(
            `SELECT id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, review_payload, created_at FROM approval_requests WHERE turn_id IN (${selectedPlaceholders}) AND status <> 'preparing' ORDER BY created_at, id`,
          )
          .all(...selectedTurnIDs) as Array<Record<string, string | number | null>>)
      : []
    const approvals = approvalRows.map((row) => this.approval(row))

    const bundles = selectedTurnRows
      .slice()
      .reverse()
      .map((row): ThreadTurnBundle => {
        const turnId = String(row.id)
        const turnInputs = inputsByTurn.get(turnId) ?? []
        return {
          turn: mapTurn(row),
          inputs: turnInputs,
          messages: messages.filter((message) => message.turnId === turnId),
          agents: agents.filter((agent) => agent.turnId === turnId),
          items: items.filter((item) => item.turnId === turnId),
          approvals: approvals.filter((approval) => approval.turnId === turnId),
          attachments: turnInputs.flatMap((input) => attachmentsByInput.get(input.id) ?? []),
          contextReferences: turnInputs.flatMap((input) => contextByInput.get(input.id) ?? []),
        }
      })
    const oldest = selectedTurnRows.at(-1)
    const queueMetadata = this.db.queueStateMeta(threadId) ?? { version: 0, pauseReason: null }
    return {
      thread,
      subagents: this.subagents.projectionForThread(threadId, true),
      turns: bundles,
      pendingPlanApproval: this.db.repositories.planApprovals.pending(threadId),
      queue: {
        ...queueMetadata,
        turns: queueTurnRows.map(mapTurn),
        inputs: inputs.filter(
          (input) => input.turnId != null && queueTurnIDs.includes(input.turnId),
        ),
      },
      olderCursor:
        hasOlder && oldest
          ? encodeHistoryCursor({
              v: 1,
              createdAt: Number(oldest.created_at),
              id: String(oldest.id),
            })
          : null,
      hasOlder,
    }
  }

  listPage(
    params: { projectID?: string; archived?: boolean; limit?: number; cursor?: string } = {},
  ) {
    const limit = Math.min(500, Math.max(1, params.limit ?? 100))
    const rows = this.list({ ...params, limit: limit + 1 })
    const threads = rows.slice(0, limit)
    const last = threads.at(-1)
    return {
      threads,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, id: last.id })).toString(
              'base64url',
            )
          : null,
    }
  }

  list(params: { projectID?: string; archived?: boolean; limit?: number; cursor?: string } = {}) {
    const where: string[] = [
      "t.kind = 'main'",
      '(t.archived_at IS NULL OR t.archived_at <> -1)',
      `NOT EXISTS (
        SELECT 1
        FROM thread_forks AS pending_fork
        JOIN thread_handoff_operations AS pending_handoff
          ON pending_handoff.operation_id = pending_fork.operation_id
        WHERE pending_fork.target_thread_id = t.id
          AND pending_handoff.status <> 'completed'
      )`,
    ]
    const values: Array<string | number | null> = []
    if (params.cursor) {
      let cursor: { updatedAt: number; id: string }
      try {
        cursor = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8'))
        if (
          !Number.isSafeInteger(cursor.updatedAt) ||
          cursor.updatedAt < 0 ||
          typeof cursor.id !== 'string' ||
          !cursor.id ||
          cursor.id.length > 500
        )
          throw new Error()
      } catch {
        throw new AgentError('INVALID_REQUEST', '聊天列表 cursor 无效', 400)
      }
      where.push('(t.updated_at < ? OR (t.updated_at = ? AND t.id < ?))')
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
    }
    if (params.projectID !== undefined) {
      where.push(`${this.db.projectMembershipSql()} = ?`)
      values.push(params.projectID)
    }
    if (params.archived !== undefined) {
      where.push(params.archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL')
    }
    const { creationSurface: columnExists } = probeThreadsStorageCapabilities(this.db.sqlite)
    const creationSurfaceExpr = columnExists ? 't.creation_surface' : 'NULL AS creation_surface'
    const sql = `
      SELECT t.id, ${this.db.projectMembershipSql()} AS project_id, t.git_branch, ${creationSurfaceExpr}, t.title, t.preview, t.first_user_message, t.message_count,
        t.archived_at, t.task_mode, t.sandbox_mode, t.approval_policy, t.approvals_reviewer, t.created_at, t.updated_at,
        read_state.unread_at, ${THREAD_ORIGIN_PROJECTION_SQL},
        (SELECT status FROM turns AS u WHERE u.thread_id = t.id
          ORDER BY CASE WHEN u.status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_subagents') THEN 0 ELSE 1 END,
            u.created_at DESC LIMIT 1) AS latest_turn_status,
        ${this.db.repositories.planApprovals.available() ? "EXISTS (SELECT 1 FROM plan_approvals WHERE thread_id = t.id AND status = 'pending')" : '0'} AS pending_plan_approval
      FROM threads AS t
      LEFT JOIN thread_read_state AS read_state ON read_state.thread_id = t.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ?
    `
    values.push(params.limit ?? 100)
    const rows = this.db.sqlite.query(sql).all(...values) as Array<
      Record<string, string | number | null>
    >
    const bindings = this.executionEnvironments(rows.map((row) => String(row.id)))
    return rows.map((row): ThreadListItem => {
      const id = String(row.id)
      const workspace = this.db.threadWorkspace(id)
      const sessionGroupId = this.db.repositories.sessionGroups.membership(id)?.group_id ?? null
      const executionEnvironment = this.resolveExecutionEnvironment(bindings, id, workspace)
      return {
        id,
        storageSource: 'local',
        projectID: row.project_id == null ? null : String(row.project_id),
        gitBranch: row.git_branch == null ? null : String(row.git_branch),
        sessionGroupId,
        workflowId: sessionGroupId,
        ...(executionEnvironment ? { executionEnvironment } : {}),
        hasScheduledRun: Boolean(row.has_scheduled_run),
        isScheduledSession: Boolean(row.is_scheduled_session),
        isFork: Boolean(row.is_fork),
        ...(row.creation_surface
          ? { creationSurface: row.creation_surface as ThreadListItem['creationSurface'] }
          : {}),
        ...(workspace ? { workspace } : {}),
        title: String(row.title),
        preview: row.preview == null ? null : String(row.preview),
        firstUserMessage: row.first_user_message == null ? null : String(row.first_user_message),
        messageCount: Number(row.message_count ?? 0),
        latestTurnStatus:
          row.latest_turn_status == null ? null : turnStatus(String(row.latest_turn_status)),
        archivedAt: row.archived_at == null ? null : Number(row.archived_at),
        unreadAt: row.unread_at == null ? null : Number(row.unread_at),
        pendingPlanApproval: Number(row.pending_plan_approval) === 1,
        settings: {
          taskMode: String(row.task_mode) as ThreadListItem['settings']['taskMode'],
          permissionConfig: {
            sandboxMode: String(
              row.sandbox_mode,
            ) as ThreadListItem['settings']['permissionConfig']['sandboxMode'],
            approvalPolicy: decodeApprovalPolicy(row.approval_policy),
            approvalsReviewer: String(
              row.approvals_reviewer,
            ) as ThreadListItem['settings']['permissionConfig']['approvalsReviewer'],
          },
        },
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }
    })
  }

  item(item: StoredItem): Item | null {
    const messageID = item.turnID
    const agentId = item.agentID
    const order = item.ordinal === undefined ? {} : { ordinal: item.ordinal }
    const status =
      item.status === 'running' || item.status === 'pending'
        ? 'streaming'
        : item.status === 'interrupted'
          ? 'interrupted'
          : 'completed'
    if (item.type === 'reasoning')
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'reasoning',
        text: asText(item.data.text) ?? '',
        status,
        ...order,
        createdAt: item.createdAt,
      }
    if (item.type === 'text' || (item.type === 'activity' && typeof item.data.text === 'string')) {
      const usage = modelUsage(item.data.usage)
      const completion = completionMetadata(item.data.completion)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'text',
        placement: item.data.placement === 'process' ? 'process' : 'result',
        text: asText(item.data.text) ?? '',
        status,
        ...(usage ? { usage } : {}),
        ...(completion ? { completion } : {}),
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'activity') {
      const activity = ['context-compression', 'file-edit', 'build', 'notice'].includes(
        String(item.data.activity),
      )
        ? (item.data.activity as 'context-compression' | 'file-edit' | 'build' | 'notice')
        : 'notice'
      const commands = activityCommands(item.data.commands)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'activity',
        activity,
        title: asText(item.data.title) ?? '执行活动',
        ...(typeof item.data.detail === 'string' ? { detail: item.data.detail } : {}),
        ...(commands ? { commands } : {}),
        status:
          item.status === 'error'
            ? 'error'
            : item.status === 'interrupted'
              ? 'interrupted'
              : item.status === 'completed'
                ? 'completed'
                : 'running',
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'tool') {
      const toolName = asText(item.data.tool ?? item.data.toolName) ?? 'tool'
      const input = item.data.input ?? item.data.inputText ?? null
      const terminal =
        item.status === 'completed' || item.status === 'error' || item.status === 'interrupted'
      const callID = asText(item.data.callID) ?? item.id
      const execution =
        item.status === 'completed' && isFileMutationTool(toolName)
          ? this.db.getAgentExecution(item.agentID)
          : null
      const mutationDiffPaths = execution
        ? this.db.repositories.turnPatches.diffPathsForToolCall(execution.threadID, callID)
        : []
      const resultBlocks = toolResultBlocks(item.data.resultBlocks)
      const command = asText(item.data.command)
      const activity =
        storedToolActivity(item.data.activity) ??
        classifyToolActivity({
          tool: toolName,
          input,
          command,
        })
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'tool',
        callID,
        tool: toolName,
        title: asText(item.data.title) ?? `运行了 ${toolName}`,
        state:
          item.status === 'pending'
            ? 'pending'
            : item.status === 'running'
              ? 'running'
              : item.status === 'error'
                ? 'error'
                : item.status === 'interrupted'
                  ? 'interrupted'
                  : 'completed',
        input,
        command,
        output: asText(item.data.output),
        error: asText(item.data.error),
        startedAt: typeof item.data.startedAt === 'number' ? item.data.startedAt : item.createdAt,
        finishedAt:
          typeof item.data.finishedAt === 'number'
            ? item.data.finishedAt
            : terminal
              ? item.updatedAt
              : null,
        durationMs:
          typeof item.data.durationMs === 'number'
            ? item.data.durationMs
            : terminal
              ? item.updatedAt - item.createdAt
              : null,
        activity,
        ...(mutationDiffPaths.length ? { mutationDiffPaths } : {}),
        ...(resultBlocks ? { resultBlocks } : {}),
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'plan') {
      // 未经验证或旧数据只回退到 Markdown，不向客户端透传任意对象。
      const structured = decodeStructuredPlan(item.data.structured)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'plan',
        title: asText(item.data.title) ?? '实施计划',
        markdown: asText(item.data.markdown ?? item.data.text) ?? '',
        ...(structured ? { structured } : {}),
        status,
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'execution-plan') {
      const steps = Array.isArray(item.data.steps)
        ? item.data.steps.flatMap((raw) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
            const step = raw as Record<string, unknown>
            const text = asText(step.step)?.trim()
            const stepStatus = String(step.status)
            if (!text || !['pending', 'in_progress', 'completed'].includes(stepStatus)) return []
            return [{ step: text, status: stepStatus as 'pending' | 'in_progress' | 'completed' }]
          })
        : []
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'execution-plan',
        ...(typeof item.data.explanation === 'string'
          ? { explanation: item.data.explanation }
          : {}),
        steps,
        status,
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'question') {
      const options = Array.isArray(item.data.options)
        ? item.data.options.filter((value): value is string => typeof value === 'string')
        : []
      const questions = isQuestionGroup(item.data.questions) ? item.data.questions : undefined
      const rawAnswer = item.data.answer
      const rawAnswers =
        rawAnswer && typeof rawAnswer === 'object' && 'answers' in rawAnswer
          ? rawAnswer.answers
          : rawAnswer
      const answers = isQuestionAnswers(rawAnswers) ? rawAnswers : undefined
      const first = questions?.[0]
      const firstAnswer = answers?.find((answer) => answer.questionId === first?.id)
      const toolCallId =
        typeof item.data.toolCallId === 'string'
          ? item.data.toolCallId
          : this.db.repositories.interactions.questionToolCallID(item.id)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'question',
        version: this.db.repositories.interactions.pendingQuestionVersion(item.id)?.version,
        prompt: first?.prompt ?? asText(item.data.question) ?? '需要你的选择',
        choices:
          first?.choices ??
          options.map((label, index) => ({ id: String(index), label, recommended: index === 0 })),
        status:
          item.status === 'pending'
            ? 'pending'
            : item.status === 'interrupted'
              ? 'cancelled'
              : item.data.ignored === true
                ? 'ignored'
                : 'answered',
        answer:
          firstAnswer?.text ??
          firstAnswer?.choiceIds
            .map((id) => first?.choices.find((choice) => choice.id === id)?.label ?? id)
            .join(', ') ??
          asText(rawAnswer),
        ...(questions ? { questions } : {}),
        ...(answers ? { answers } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'patch') {
      const patchState = this.db.repositories.turnPatches.getByTurn(item.turnID)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'patch',
        files: Array.isArray(item.data.files)
          ? (item.data.files as Extract<Item, { type: 'patch' }>['files'])
          : [],
        totalAdditions: Number(item.data.totalAdditions ?? item.data.additions ?? 0),
        totalDeletions: Number(item.data.totalDeletions ?? item.data.deletions ?? 0),
        ...(patchState
          ? patchState.evidenceComplete
            ? { reversible: true }
            : {}
          : item.data.reversible === true
            ? { reversible: true }
            : {}),
        ...(patchState
          ? { applyState: patchState.applyState }
          : item.data.applyState === 'applied' || item.data.applyState === 'undone'
            ? { applyState: item.data.applyState }
            : {}),
        ...(patchState
          ? { actionVersion: patchState.actionVersion }
          : typeof item.data.actionVersion === 'number'
            ? { actionVersion: item.data.actionVersion }
            : {}),
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === 'subagent') {
      const rawStatus = String(item.data.status).replaceAll('_', '-')
      const subagentStatus = [
        'queued',
        'preparing',
        'running',
        'steering',
        'waiting-question',
        'waiting-permission',
        'completed',
        'failed',
        'stopped',
        'interrupted',
      ].includes(rawStatus)
        ? (rawStatus as Extract<Item, { type: 'subagent' }>['status'])
        : 'interrupted'
      const rawQueueReason =
        item.data.queueReason == null ? null : String(item.data.queueReason).replaceAll('_', '-')
      const queueReason =
        rawQueueReason === 'parent-limit' ||
        rawQueueReason === 'global-limit' ||
        rawQueueReason === 'workspace-writer'
          ? rawQueueReason
          : null
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: 'subagent',
        subagentTaskId: String(item.data.subagentTaskId),
        runId: String(item.data.runId),
        childThreadId: String(item.data.childThreadId),
        displayName: String(item.data.displayName),
        profile: String(item.data.profile) as Extract<Item, { type: 'subagent' }>['profile'],
        task: String(item.data.task),
        status: subagentStatus,
        queueReason,
        result:
          item.data.result && typeof item.data.result === 'object'
            ? (item.data.result as Extract<Item, { type: 'subagent' }>['result'])
            : null,
        ...order,
        createdAt: item.createdAt,
      }
    }
    return null
  }

  approval(row: Record<string, string | number | null>): ApprovalRequest {
    const tool = this.db.sqlite
      .query('SELECT tool_name, input FROM tool_calls WHERE id = ?')
      .get(String(row.tool_call_id)) as { tool_name: string; input: string } | null
    const input = tool ? parse<Record<string, unknown>>(tool.input) : {}
    const request =
      typeof row.request_payload === 'string'
        ? parse<Record<string, unknown>>(row.request_payload)
        : {}
    const rawComputerApp = request.computerApp as Record<string, unknown> | undefined
    const computerApp =
      rawComputerApp &&
      typeof rawComputerApp.name === 'string' &&
      typeof rawComputerApp.allowPersistentApproval === 'boolean'
        ? {
            name: rawComputerApp.name,
            allowPersistentApproval: rawComputerApp.allowPersistentApproval,
          }
        : undefined
    const requestKind = request.kind
    const rawPermissions = request.requestedPermissions
    const permissions =
      rawPermissions && typeof rawPermissions === 'object' && !Array.isArray(rawPermissions)
        ? (rawPermissions as Record<string, unknown>)
        : {}
    const list = (name: string) =>
      Array.isArray(permissions[name])
        ? permissions[name].filter((value): value is string => typeof value === 'string')
        : []
    // 动态权限请求把读路径、写路径和网络域名纳入可展示范围；普通审批保持原状。
    const paths =
      requestKind === 'permission'
        ? [...list('readPaths'), ...list('writePaths'), ...list('networkDomains')]
        : [input.path, input.cwd].filter((value): value is string => typeof value === 'string')
    const command = typeof input.command === 'string' ? input.command : null
    const rawRequestedScope = request.requestedScope
    const rawAllowedScopes = request.allowedScopes
    const permissionGrant =
      requestKind === 'permission' &&
      (rawRequestedScope === 'tool-call' ||
        rawRequestedScope === 'turn' ||
        rawRequestedScope === 'session') &&
      Array.isArray(rawAllowedScopes) &&
      rawAllowedScopes.length > 0 &&
      rawAllowedScopes.every(
        (scope) => scope === 'tool-call' || scope === 'turn' || scope === 'session',
      )
        ? {
            requestedScope: rawRequestedScope as 'tool-call' | 'turn' | 'session',
            allowedScopes: rawAllowedScopes as Array<'tool-call' | 'turn' | 'session'>,
          }
        : undefined
    const review =
      typeof row.review_payload === 'string'
        ? parse<ApprovalRequest['review']>(row.review_payload)
        : null
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      agentId: String(row.agent_id),
      toolCallID: String(row.tool_call_id),
      tool: tool?.tool_name ?? 'tool',
      command,
      cwd: typeof input.cwd === 'string' ? input.cwd : null,
      paths,
      requestedPermissions: {
        readPaths: list('readPaths'),
        writePaths: list('writePaths'),
        networkDomains: list('networkDomains'),
      },
      review,
      risk: String(row.risk) as ApprovalRequest['risk'],
      reason: String(row.reason),
      status:
        row.status === 'pending'
          ? 'pending'
          : row.status === 'cancelled'
            ? 'cancelled'
            : row.reply === 'allow'
              ? 'allowed'
              : 'denied',
      createdAt: Number(row.created_at),
      ...(permissionGrant ? { permissionGrant } : {}),
      ...(computerApp ? { computerApp } : {}),
      ...(Array.isArray(request.grantOptions)
        ? { grantOptions: request.grantOptions as ApprovalRequest['grantOptions'] }
        : {}),
      ...(request.toolIdentity
        ? { toolIdentity: request.toolIdentity as ApprovalRequest['toolIdentity'] }
        : {}),
      ...(request.input ? { input: request.input as ApprovalRequest['input'] } : {}),
      ...(request.affectedPaths
        ? { affectedPaths: request.affectedPaths as ApprovalRequest['affectedPaths'] }
        : {}),
      ...(request.reviewSummary
        ? { reviewSummary: request.reviewSummary as ApprovalRequest['reviewSummary'] }
        : {}),
    }
  }

  private projectEventPayload(
    event: EventEnvelope,
    source: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const threadId =
      event.threadId ?? (typeof source.threadId === 'string' ? source.threadId : null)
    if (event.method === 'thread/updated') {
      const thread = threadId ? this.projectThread(threadId) : null
      return thread ? { thread, version: thread.updatedAt } : null
    }
    if (event.method === 'thread/settings/updated') {
      const thread = threadId ? this.projectThread(threadId) : null
      return thread ? { threadId, settings: source.settings, version: thread.updatedAt } : null
    }
    if (event.method === 'agent/upserted') {
      const agent =
        source.agent && typeof source.agent === 'object'
          ? this.projectDomainAgent(source.agent as AgentExecution)
          : null
      return agent ? { agent } : null
    }
    if (event.method === 'subagent/created' || event.method === 'subagent/updated') {
      return { projection: { task: source.task, currentRun: source.run } }
    }
    if (event.method === 'subagent/workspaceUpdated') {
      const taskId = String(source.taskId)
      const projection = this.subagents.projectionForTask(taskId)
      return projection ? { projection } : null
    }
    if (event.method === 'turn/statusChanged') {
      return {
        turnId: String(source.turnId),
        status: String(source.status).replaceAll('_', '-'),
        changedAt: typeof source.changedAt === 'number' ? source.changedAt : event.createdAt,
        ...(source.reason
          ? { reason: String(source.reason) }
          : source.resumedFrom
            ? { reason: String(source.resumedFrom) }
            : {}),
      }
    }
    const lifecyclePayload = this.lifecyclePayload(event, source)
    if (lifecyclePayload) return lifecyclePayload

    const storedItem =
      source.item && typeof source.item === 'object' ? (source.item as Partial<StoredItem>) : null
    const item =
      storedItem &&
      typeof storedItem.id === 'string' &&
      typeof storedItem.turnID === 'string' &&
      typeof storedItem.agentID === 'string' &&
      typeof storedItem.type === 'string' &&
      typeof storedItem.status === 'string' &&
      storedItem.data &&
      typeof storedItem.data === 'object' &&
      typeof storedItem.createdAt === 'number' &&
      typeof storedItem.updatedAt === 'number'
        ? this.item(storedItem as StoredItem)
        : source.item

    return {
      ...source,
      ...(item === undefined ? {} : { item }),
    }
  }

  notification(event: EventEnvelope) {
    const source =
      event.params && typeof event.params === 'object'
        ? (event.params as Record<string, unknown>)
        : {}
    const payload = this.projectEventPayload(event, source) ?? source
    const params: Record<string, unknown> = {
      ...payload,
      ...(event.threadId === null ? {} : { threadId: event.threadId }),
      ...(event.turnId === null ? {} : { turnId: event.turnId }),
    }
    return {
      id: event.id,
      threadId: event.threadId,
      notification: {
        jsonrpc: '2.0' as const,
        method: event.method as never,
        params,
      },
      createdAt: event.createdAt,
    }
  }
}
