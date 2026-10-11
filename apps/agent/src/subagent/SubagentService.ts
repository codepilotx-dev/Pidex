import type { Model } from '@pidex/model-schema'
import {
  MAX_SUBAGENT_DEPTH,
  type PermissionConfig,
  type SubagentProfile,
} from '@pidex/shared/thread'
import { Effect } from 'effect'
import type { AgentModelCatalog } from '../provider/AgentModelCatalog'
import { AgentError } from '../Domain'
import {
  SafeBoundaryInterrupt,
  type AgentRuntime,
  type AgentRuntimeResult,
  type DelegationController,
  type PendingApproval,
  type PlanCheckpoint,
} from '../orchestration/AgentRuntimeTypes'
import type { ApprovalService } from '../permission/ApprovalService'
import type { QuestionService } from '../session/QuestionService'
import { ResumeCheckpointResolver, toPlanCheckpoint } from '../interaction/ResumeCheckpointResolver'
import { executionPolicyFromV4 } from '../permission/ExecutionPolicy'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { globalEventSequence } from '../storage/events/EventPublisher'
import { WorkspaceService } from '../workspace/WorkspaceService'
import { SubagentCollaborationRepository } from './SubagentCollaborationRepository'
import { SubagentRepository, type SpawnSubagentInput } from './SubagentRepository'
import type { AttachmentService } from './AttachmentService'
import type { LocalContextPathService } from '../local-context/LocalContextPathService'
import {
  InstructionDiscoveryService,
  SkillService,
  createPromptSections,
  type PromptBundle,
} from '../prompt'
import type { SkillManagementService } from '../prompt/SkillManagementService'
import { projectMemoryKey, type MemoryService } from '../memory/MemoryService'
import { ContextManager, type ContextFragment } from '../context/ContextManager'
import type { McpConnectionManager, McpTurnLease } from '../mcp/McpConnectionManager'
import { createMcpInstructionSections } from '../mcp/McpPromptSections'
import type { ProjectSourceService } from '../project/ProjectSourceService'
import { secretScrubber } from '../security/SecretScrubber'

const terminal = new Set(['completed', 'failed', 'stopped', 'interrupted'])
export const pausedSubagentStatus = (kind: PendingApproval['kind'] | null) =>
  kind === 'permission' ? ('waiting_permission' as const) : ('waiting_question' as const)

export interface SubagentWorkspaceProvider {
  prepare(
    taskID: string,
    rootPath: string,
    mode: 'shared' | 'worktree',
  ): Promise<{ rootPath: string; baselineRef: string | null }>
  finalize(taskID: string): Promise<unknown>
  recoverLegacyWorktrees?(): Promise<Array<{ taskID: string; result: unknown }>>
  diff(taskID: string): Promise<unknown>
  apply(taskID: string): Promise<unknown>
  discard(taskID: string): Promise<unknown>
  restore(taskID: string): Promise<unknown>
}

type RootContext = {
  threadID: string
  turnID: string
  agentID: string
  taskMode: 'chat' | 'plan'
  model: Model.Ref
  permissionConfig: PermissionConfig
  allowedTools?: readonly string[]
  workspaceRoot: string
  projectless?: boolean
}
type PromptStorageRoots = { dataRoot: string; userHome: string }

type CanonicalPatchItem = {
  data?: {
    files?: unknown
  }
}

const subagentPathKey = (path: string) => {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export const canonicalSubagentChangedFiles = (
  reported: Array<{ path: string; summary: string }>,
  patchItems: CanonicalPatchItem[],
) => {
  const summaries = new Map(
    reported
      .filter((file) => file.path.trim())
      .map((file) => [subagentPathKey(file.path), file.summary.trim()] as const),
  )
  const files = new Map<string, { path: string; summary: string }>()
  for (const item of patchItems) {
    if (!Array.isArray(item.data?.files)) continue
    for (const candidate of item.data.files) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      const path = (candidate as Record<string, unknown>).path
      if (typeof path !== 'string' || !path.trim()) continue
      const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '')
      const key = subagentPathKey(normalized)
      if (!files.has(key)) {
        files.set(key, {
          path: normalized,
          summary: summaries.get(key) || '由子 Agent 修改',
        })
      }
    }
  }
  return [...files.values()]
}

export class SubagentService {
  readonly repository: SubagentRepository
  private readonly controllers = new Map<string, AbortController>()
  readonly collaboration: SubagentCollaborationRepository
  private readonly executing = new Map<string, Promise<void>>()
  private readonly stoppingThreads = new Set<string>()
  private scheduling = false
  private readonly resumeCheckpoints: ResumeCheckpointResolver

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly providers: AgentModelCatalog,
    private readonly approvals: ApprovalService,
    private readonly questions: QuestionService,
    private readonly orchestrator: AgentRuntime,
    private readonly attachments: AttachmentService,
    private readonly workspaces?: SubagentWorkspaceProvider,
    private readonly promptStorage?: PromptStorageRoots,
    private readonly memory?: MemoryService,
    private readonly skillManagement?: SkillManagementService,
    private readonly mcp?: McpConnectionManager,
    private readonly projectSources?: ProjectSourceService,
    resumeCheckpoints?: ResumeCheckpointResolver,
    recoverOnConstruct = true,
    private readonly localContextPaths?: LocalContextPathService,
  ) {
    this.resumeCheckpoints = resumeCheckpoints ?? new ResumeCheckpointResolver(db, approvals)
    this.resumeCheckpoints.setResolvedSubagentWait((turnID) => this.resolvedWaitCheckpoint(turnID))
    this.repository = new SubagentRepository(db)
    this.collaboration = new SubagentCollaborationRepository(db)
    approvals.setAgentStatusHandler((agentID, status) => {
      void this.onApprovalStatus(agentID, status)
    })
    if (recoverOnConstruct)
      queueMicrotask(() => {
        void this.recoverLegacyWorktrees()
      })
  }

  recoverStartup() {
    return this.recoverLegacyWorktrees()
  }

  private async recoverLegacyWorktrees() {
    try {
      const recovered = await this.workspaces?.recoverLegacyWorktrees?.().catch(() => [])
      for (const entry of recovered ?? []) {
        const task = this.repository.task(entry.taskID)
        if (!task) continue
        await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/workspaceUpdated', {
          taskId: task.id,
          workspace: task.workspace,
          result: entry.result,
        })
        await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
          task,
          run: task.currentRun,
          childThreadId: task.childThreadId,
        })
      }
      const tasks = this.db.sqlite
        .query('SELECT id, current_run_id FROM subagent_tasks')
        .all() as Array<{ id: string; current_run_id: string }>
      for (const task of tasks) {
        await this.notifySettled(task.current_run_id)
        this.repository.promoteFollowup(task.id)
      }
      await this.resumeSatisfiedParents()
    } finally {
      void this.schedule()
    }
  }

  private async onApprovalStatus(agentID: string, status: 'waiting_permission' | 'running') {
    const execution = this.db.getAgentExecution(agentID)
    if (!execution?.subagentRunID) return
    const run =
      status === 'waiting_permission'
        ? this.repository.setWaiting(execution.subagentRunID, 'waiting_permission')
        : this.repository.setRunning(execution.subagentRunID)
    if (!run) return
    const task = this.repository.task(run.taskId)
    if (task)
      await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
        task,
        run,
        childThreadId: task.childThreadId,
      })
  }

  delegationFor(root: RootContext): DelegationController {
    return {
      spawn: ({ agents }, policy) => this.spawn({ ...root, ...(policy ?? {}) }, agents),
      wait: async (input) => {
        this.collaboration.assertRuns(root.threadID, input.runIDs)
        return this.wait(input.runIDs, input.mode)
      },
      isWaitSatisfied: async (input) => {
        this.collaboration.assertRuns(root.threadID, input.runIDs)
        return Promise.resolve(this.isWaitSatisfied(input.runIDs, input.mode))
      },
      send: async (input) => {
        this.collaboration.assertChild(root.threadID, input.taskID)
        return this.send(input.taskID, input.message, input.operationID ?? crypto.randomUUID())
      },
      stop: async (input) => {
        this.collaboration.assertChild(root.threadID, input.taskID)
        return this.stop(input.taskID, input.operationID ?? crypto.randomUUID())
      },
      followup: async (input) => {
        this.collaboration.assertChild(root.threadID, input.taskID)
        return this.followup(input.taskID, input.message, input.operationID)
      },
      report: (input) => this.report(root, input.message, input.operationID),
      list: async () => ({
        agents: this.list(root.threadID),
        notices: this.collaboration.notices(root.threadID),
      }),
    }
  }

  list(parentThreadID: string) {
    return this.repository.projectionForThread(parentThreadID)
  }

  canFollowup(taskID: string) {
    const task = this.requireTask(taskID)
    return (
      this.collaboration.available &&
      ![task.childThreadId, task.parentThreadId].some(
        (threadID) =>
          this.stoppingThreads.has(threadID) ||
          this.collaboration.completions().some((entry) => entry.thread_id === threadID),
      )
    )
  }

  read(taskID: string) {
    const task = this.repository.task(taskID)
    if (!task) throw new AgentError('SUBAGENT_NOT_FOUND', '子 Agent 不存在', 404)
    return { task, currentRun: task.currentRun }
  }

  async worktreeDiff(taskID: string) {
    const task = this.requireTask(taskID)
    if (task.workspace.mode !== 'worktree' || !this.workspaces)
      throw new AgentError('WORKTREE_UNAVAILABLE', '该子 Agent 没有隔离 worktree', 409)
    return this.workspaces.diff(taskID)
  }

  async worktreeApply(taskID: string, requestID: string) {
    return this.workspaceMutation(taskID, requestID, 'worktree-apply', () =>
      this.requireWorkspaces().apply(taskID),
    )
  }

  async worktreeDiscard(taskID: string, requestID: string) {
    return this.workspaceMutation(taskID, requestID, 'worktree-discard', () =>
      this.requireWorkspaces().discard(taskID),
    )
  }

  async workspaceRestore(taskID: string, requestID: string) {
    return this.workspaceMutation(taskID, requestID, 'workspace-restore', () =>
      this.requireWorkspaces().restore(taskID),
    )
  }

  private requireTask(taskID: string) {
    const task = this.repository.task(taskID)
    if (!task) throw new AgentError('SUBAGENT_NOT_FOUND', '子 Agent 不存在', 404)
    return task
  }

  private requireWorkspaces() {
    if (!this.workspaces)
      throw new AgentError('WORKTREE_UNAVAILABLE', '子 Agent workspace 服务未配置', 409)
    return this.workspaces
  }

  private async workspaceMutation(
    taskID: string,
    requestID: string,
    action: string,
    operation: () => Promise<unknown>,
  ) {
    const task = this.requireTask(taskID)
    const replay = this.replayControl(requestID, taskID, action)
    if (replay.hit) return replay.value
    const existing = this.repository.createControl({
      requestID,
      taskID,
      ...(task.currentRun ? { runID: task.currentRun.id } : {}),
      action,
    })
    if (existing.status === 'applied')
      return existing.result == null ? null : JSON.parse(String(existing.result))
    if (existing.status === 'failed')
      throw new AgentError('SUBAGENT_CONTROL_FAILED', String(existing.error ?? '操作失败'), 409)
    try {
      const result = await operation()
      this.repository.completeControl(requestID, result)
      await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/workspaceUpdated', {
        taskId: task.id,
        workspace: this.repository.task(task.id)?.workspace,
        result,
      })
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      this.repository.completeControl(requestID, null, message)
      throw cause
    }
  }

  private replayControl(
    requestID: string,
    taskID: string,
    action: string,
  ): { hit: boolean; value?: unknown } {
    const control = this.repository.control(requestID)
    if (!control) return { hit: false }
    if (control.task_id !== taskID || control.action !== action)
      throw new AgentError('REQUEST_ID_REUSED', 'requestId 已被其他子 Agent 操作使用', 409)
    if (control.status === 'failed')
      throw new AgentError('SUBAGENT_CONTROL_FAILED', String(control.error ?? '操作失败'), 409)
    if (control.status === 'applied')
      return {
        hit: true,
        value: control.result == null ? null : JSON.parse(String(control.result)),
      }
    throw new AgentError('SUBAGENT_CONTROL_IN_PROGRESS', '该 requestId 对应操作仍在执行', 409)
  }

  private async publish(
    events: Array<{
      id: number
      threadId: string | null
      turnId: string | null
      method: string
      params: unknown
      createdAt: number
    }>,
  ) {
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
  }

  private async emit(threadID: string, turnID: string | null, method: string, params: unknown) {
    const events = this.db.transaction(() => [
      this.db.insertEvent(threadID, turnID, method, params),
      ...(method === 'subagent/updated' || method === 'subagent/created'
        ? this.collaboration
            .ancestors(threadID)
            .map((ancestor) => this.db.insertEvent(ancestor, null, method, params))
        : []),
    ])
    await this.publish(events)
  }

  async spawn(
    root: RootContext,
    agents: Array<{
      name?: string
      profile: 'default' | 'explorer' | 'worker'
      task: string
      workspaceMode?: 'shared' | 'worktree'
      model?: Model.Ref
    }>,
  ) {
    if (!agents.length || agents.length > 4)
      throw new AgentError('SUBAGENT_BATCH_LIMIT', '每批只能创建 1 到 4 个子 Agent', 409)
    if (root.taskMode === 'plan' && agents.some((agent) => agent.profile !== 'explorer')) {
      throw new AgentError('PLAN_SUBAGENT_RESTRICTED', 'Plan 模式只能创建 Explorer', 409)
    }
    const parent = this.db.getAgentExecution(root.agentID)
    if (!parent || parent.depth >= MAX_SUBAGENT_DEPTH)
      throw new AgentError('SUBAGENT_DEPTH_EXCEEDED', '子 Agent 已达到最大深度', 409)
    this.assertAdmission(root.threadID)
    if (!this.collaboration.available && parent.depth > 0) this.collaboration.assertAvailable()
    if (agents.some((agent) => !agent.task.trim()))
      throw new AgentError('SUBAGENT_TASK_REQUIRED', '子 Agent 任务不能为空', 400)
    this.collaboration.assertCapacity(root.turnID, agents.length, agents.length)
    await Promise.all(agents.map((requested) => this.resolveModel(requested.model ?? root.model)))
    const parentTools = parent.subagentRunID
      ? this.collaboration.allowedTools(this.repository.run(parent.subagentRunID)!.taskId)
      : undefined
    const allowedTools =
      root.allowedTools && parentTools
        ? root.allowedTools.filter((name) => parentTools.includes(name))
        : (root.allowedTools ?? parentTools)
    const generated = new Map<string, number>()
    const existingCounts = new Map<string, number>()
    const inputs = agents.map((requested): SpawnSubagentInput => {
      const profile = requested.profile as Exclude<SubagentProfile, 'main'>
      const model = requested.model ?? root.model
      const existing =
        existingCounts.get(profile) ??
        (
          this.db.sqlite
            .query(
              'SELECT COUNT(*) AS count FROM subagent_tasks WHERE parent_agent_id = ? AND profile = ?',
            )
            .get(root.agentID, profile) as { count: number }
        ).count
      existingCounts.set(profile, existing)
      const generatedIndex = (generated.get(profile) ?? 0) + 1
      generated.set(profile, generatedIndex)
      const displayName =
        requested.name?.trim() ||
        `${profile === 'explorer' ? 'Explorer' : profile === 'worker' ? 'Worker' : 'Agent'} ${existing + generatedIndex}`
      return {
        parentThreadID: root.threadID,
        parentTurnID: root.turnID,
        parentAgentID: root.agentID,
        displayName,
        profile,
        task: requested.task.trim(),
        model,
        ...(allowedTools ? { allowedTools } : {}),
        permissionCeiling:
          parent.profile === 'explorer'
            ? { ...root.permissionConfig, sandboxMode: 'read-only' }
            : root.permissionConfig,
        // New subagents always share the parent's live workspace. The
        // persisted worktree mode remains readable for legacy tasks only.
        workspaceMode: 'shared',
        workspaceRoot: root.workspaceRoot,
        taskMode: root.taskMode,
      }
    })
    // Repository creation is synchronous; wrapping the complete batch ensures
    // a late constraint failure cannot leave a half-created delegation batch.
    this.assertAdmission(root.threadID)
    if (
      ['interrupted', 'cancelled', 'failed', 'completed'].includes(
        this.db.getAgentExecution(root.agentID)?.status ?? '',
      )
    )
      throw new AgentError('CONFLICT', '父代理本轮已结束', 409)
    const rows = this.db.transaction(() => {
      this.collaboration.assertCapacity(root.turnID, agents.length, agents.length)
      return inputs.map((input) => this.repository.create(input))
    })
    const created = []
    for (const [index, row] of rows.entries()) {
      await this.publish(row.events)
      for (const ancestor of this.collaboration.ancestors(root.threadID))
        await this.emit(ancestor, null, 'subagent/created', { task: row.task, run: row.run })
      const input = inputs[index]!
      created.push({
        taskId: row.task.id,
        runId: row.run.id,
        childThreadId: row.task.childThreadId,
        displayName: input.displayName,
        profile: input.profile,
      })
    }
    void this.schedule()
    return { agents: created }
  }

  isWaitSatisfied(runIDs: string[], mode: 'all' | 'any') {
    const states = runIDs.map((id) => this.repository.run(id)).filter(Boolean)
    if (states.length !== runIDs.length)
      throw new AgentError('SUBAGENT_NOT_FOUND', '等待目标不存在', 404)
    return mode === 'all'
      ? states.every((run) => terminal.has(run!.status))
      : states.some((run) => terminal.has(run!.status))
  }

  async wait(runIDs: string[], mode: 'all' | 'any') {
    if (!this.isWaitSatisfied(runIDs, mode))
      throw new AgentError('SUBAGENTS_NOT_READY', '子 Agent 尚未满足等待条件', 409)
    return { mode, runs: runIDs.map((id) => this.repository.run(id)) }
  }

  async checkpointWait(
    threadID: string,
    turnID: string,
    agentID: string,
    approval: PendingApproval,
  ) {
    const runIDs = approval.runIDs ?? []
    const mode = approval.waitMode ?? 'all'
    const checkpoint = this.db.repositories.subagents.checkpointSubagentWait({
      agentID,
      turnID,
      threadID,
      state: approval.checkpoint.state,
      interruption: approval.checkpoint.interruption,
      runIDs,
      mode,
    })
    await Promise.allSettled(
      checkpoint.events.map((event) => Effect.runPromise(this.hub.publish(event))),
    )
    void this.schedule()
  }

  resolvedWaitCheckpoint(turnID: string): PlanCheckpoint | null {
    const checkpoint = this.db.getAgentTurnCheckpoint(turnID)
    if (!checkpoint) return null
    const resumable =
      checkpoint.state === 'waiting_subagents' ||
      (checkpoint.state === 'ready' && checkpoint.payload.kind === 'subagent-wait')
    if (!resumable) return null
    const runIDs = Array.isArray(checkpoint.payload.runIDs)
      ? checkpoint.payload.runIDs.filter((value): value is string => typeof value === 'string')
      : []
    const mode = checkpoint.payload.mode === 'any' ? 'any' : 'all'
    if (!this.isWaitSatisfied(runIDs, mode)) return null
    if (
      typeof checkpoint.payload.state !== 'string' ||
      checkpoint.payload.interruption === undefined
    )
      return null
    return {
      state: checkpoint.payload.state,
      interruption: checkpoint.payload.interruption,
      answer: null,
    }
  }

  async send(
    taskID: string,
    message: string,
    requestID: string,
    options: {
      model?: Model.Ref
      permissionConfig?: PermissionConfig
      attachmentIDs?: string[]
    } = {},
  ) {
    if (!message.trim()) throw new AgentError('INVALID_PARAMS', '消息不能为空', 400)
    this.assertAdmission(this.requireTask(taskID).childThreadId)
    const previous = this.repository.control(requestID)
    if (previous && JSON.parse(String(previous.payload)).message !== message)
      throw new AgentError('CONFLICT', 'operationId 已用于其他消息', 409)
    const replay = this.replayControl(requestID, taskID, 'send')
    if (replay.hit) return replay.value
    const task = this.repository.task(taskID)
    if (!task?.currentRun) throw new AgentError('SUBAGENT_NOT_FOUND', '子 Agent 不存在', 404)
    const run = task.currentRun
    if (options.model) await this.resolveModel(options.model)
    const permission = options.permissionConfig ?? run.permissionConfig
    this.assertPermissionCeiling(task.permissionCeiling, permission)
    await this.validateAttachments(options.attachmentIDs ?? [], options.model ?? run.model)
    this.repository.createControl({
      requestID,
      taskID,
      runID: run.id,
      action: 'send',
      payload: { message, ...options, permissionConfig: permission },
    })
    if (terminal.has(run.status)) {
      const next = this.repository.continueTask({
        taskID,
        message,
        ...(options.model ? { model: options.model } : {}),
        permission,
        sameRun: false,
      })
      await this.bindAttachments(next.agent.turnID, options.attachmentIDs ?? [])
      const response = { disposition: 'follow-up' as const, run: next.run }
      this.repository.completeControl(requestID, response)
      await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
        task: next.task,
        run: next.run,
      })
      void this.schedule()
      return response
    }
    if (['queued', 'waiting-question', 'waiting-permission'].includes(run.status)) {
      const latest = this.repository.latestExecution(run.id)
      if (latest) {
        this.approvals.cancelTurn(latest.turn_id)
        this.questions.cancelTurn(latest.turn_id)
      }
      const continued = this.repository.continueTask({
        taskID,
        message,
        ...(options.model ? { model: options.model } : {}),
        permission,
        sameRun: true,
      })
      await this.bindAttachments(continued.agent.turnID, options.attachmentIDs ?? [])
      const response = { disposition: 'steering' as const, run: continued.run }
      this.repository.completeControl(requestID, response)
      await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
        task: continued.task,
        run: continued.run,
      })
      void this.schedule()
      return response
    }
    this.repository.markSteering(run.id)
    await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
      task: this.repository.task(taskID),
      run: this.repository.run(run.id),
    })
    return { disposition: 'steering', run: this.repository.run(run.id) }
  }

  async retry(taskID: string, requestID: string) {
    const replay = this.replayControl(requestID, taskID, 'retry')
    if (replay.hit) return replay.value
    const task = this.repository.task(taskID)
    if (!task?.currentRun || !['failed', 'stopped', 'interrupted'].includes(task.currentRun.status))
      throw new AgentError('SUBAGENT_NOT_RETRYABLE', '当前子 Agent 状态不能重试', 409)
    this.repository.createControl({ requestID, taskID, runID: task.currentRun.id, action: 'retry' })
    const next = this.repository.continueTask({ taskID, message: task.task, sameRun: false })
    const input = this.db.getTurnInput(next.agent.turnID)
    if (!input) throw new AgentError('CHECKPOINT_UNAVAILABLE', '子 Agent retry input 尚未建立', 409)
    const sequence = globalEventSequence(this.db)
    const result = {
      task: next.task,
      run: next.run,
      admission: {
        inputId: input.id,
        turnId: next.agent.turnID,
        disposition: 'accepted' as const,
        streamPosition: { streamId: next.task.childThreadId, sequence },
      },
    }
    this.repository.completeControl(requestID, result)
    await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
      task: next.task,
      run: next.run,
    })
    void this.schedule()
    return result
  }

  async stop(taskID: string, requestID: string) {
    const replay = this.replayControl(requestID, taskID, 'stop')
    if (replay.hit) return replay.value
    const task = this.repository.task(taskID)
    if (!task?.currentRun) throw new AgentError('SUBAGENT_NOT_FOUND', '子 Agent 不存在', 404)
    const run = task.currentRun
    this.repository.createControl({ requestID, taskID, runID: run.id, action: 'stop' })
    if (terminal.has(run.status)) {
      const result = { task, run }
      this.repository.completeControl(requestID, result)
      return result
    }
    const subtree = [
      ...this.collaboration.descendants(task.childThreadId).reverse(),
      { id: task.id, child_thread_id: task.childThreadId },
    ]
    for (const node of subtree) this.stoppingThreads.add(node.child_thread_id)
    try {
      const runs = subtree.flatMap(
        (node) =>
          this.db.sqlite
            .query(
              "SELECT id FROM subagent_runs WHERE task_id = ? AND status NOT IN ('completed','failed','stopped','interrupted')",
            )
            .all(node.id) as Array<{ id: string }>,
      )
      for (const candidate of runs) this.controllers.get(candidate.id)?.abort()
      await Promise.all(runs.map((candidate) => this.executing.get(candidate.id)))
      for (const node of subtree) {
        for (const candidate of runs) {
          const pending = this.repository.run(candidate.id)
          if (pending?.taskId !== node.id || terminal.has(pending.status)) continue
          const latest = this.repository.latestExecution(candidate.id)
          if (latest) {
            this.approvals.cancelTurn(latest.turn_id)
            this.questions.cancelTurn(latest.turn_id)
            this.collaboration.clear(latest.turn_id)
          }
          for (const control of this.repository.pendingControls(candidate.id))
            if (control.action === 'send')
              this.repository.completeControl(control.id, null, '子 Agent 已停止，消息未执行')
          const stopped = this.repository.finish(
            candidate.id,
            'stopped',
            null,
            '用户停止了子 Agent 树',
          )
          if (stopped)
            await this.emit(
              stopped.task.parentThreadId,
              stopped.task.parentTurnId,
              'subagent/updated',
              stopped,
            )
          await this.notifySettled(candidate.id)
        }
      }
    } finally {
      for (const node of subtree) this.stoppingThreads.delete(node.child_thread_id)
    }
    const execution = this.repository.latestExecution(run.id)
    if (execution) {
      this.approvals.cancelTurn(execution.turn_id)
      this.questions.cancelTurn(execution.turn_id)
    }
    const finished = { task: this.repository.task(taskID)!, run: this.repository.run(run.id)! }
    this.repository.completeControl(requestID, finished)
    if (finished)
      await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', finished)
    await this.resumeSatisfiedParents()
    void this.schedule()
    return finished
  }

  async stopChildrenForParent(parentAgentID: string) {
    const parent = this.db.getAgentExecution(parentAgentID)
    if (!parent) return
    this.stoppingThreads.add(parent.threadID)
    try {
      for (const child of this.collaboration.children(parent.threadID))
        await this.stop(child.id, crypto.randomUUID())
    } finally {
      this.stoppingThreads.delete(parent.threadID)
    }
    for (const completion of this.collaboration.completions())
      if (completion.thread_id === parent.threadID) this.collaboration.clear(completion.turn_id)
  }

  async schedule() {
    if (this.scheduling) return
    this.scheduling = true
    try {
      for (const runID of this.repository.queuedRunIDs()) {
        if (this.executing.has(runID)) continue
        const candidate = this.repository.run(runID)
        if (candidate && this.stoppingThreads.has(this.requireTask(candidate.taskId).childThreadId))
          continue
        const claim = this.repository.claim(runID)
        if (!claim || 'queued' in claim) continue
        const execution = this.execute(claim.task.id, runID, claim.agent.id).finally(() => {
          this.executing.delete(runID)
          void this.schedule()
        })
        this.executing.set(runID, execution)
      }
    } finally {
      this.scheduling = false
    }
  }

  private async execute(taskID: string, runID: string, agentID: string) {
    const task = this.repository.task(taskID)
    const run = this.repository.run(runID)
    const agent = this.db.getAgentExecution(agentID)
    if (!task || !run || !agent) return
    const controller = new AbortController()
    let isolationPrepared = false
    let mcpLease: McpTurnLease | undefined
    let startupGate: { leaseID: string; requestID: string } | undefined
    let startupGateSafe = false
    let acquiredResumeLeaseID: string | undefined
    this.controllers.set(runID, controller)
    await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', { task, run })
    await this.emit(task.childThreadId, agent.turnID, 'agent/upserted', { agent })
    await this.emit(task.childThreadId, agent.turnID, 'turn/started', {
      turnId: agent.turnID,
      rootAgentId: agent.id,
      startedAt: Date.now(),
    })
    try {
      const saved = this.collaboration.saved(agent.turnID)
      if (saved) {
        if (await this.deferCompletion(task.childThreadId, agent.turnID, saved)) return
        await this.completeChild(taskID, runID, agent.turnID, agent.id, saved, controller.signal)
        return
      }
      const rootPath = task.workspace.rootPath
      if (!rootPath) throw new AgentError('WORKSPACE_REQUIRED', '子 Agent 没有工作区', 409)
      const needsIsolation = task.workspace.mode === 'worktree'
      const prepared =
        this.workspaces && needsIsolation
          ? await this.workspaces.prepare(task.id, rootPath, task.workspace.mode)
          : { rootPath, baselineRef: null }
      isolationPrepared = prepared.baselineRef !== null
      if (task.workspace.mode === 'worktree' && !this.workspaces)
        throw new AgentError('WORKTREE_UNAVAILABLE', 'worktree 服务未配置', 409)
      const parentWorkspace = this.db.threadWorkspace(task.parentThreadId)
      const project =
        parentWorkspace?.kind === 'project' ? this.db.getProject(parentWorkspace.projectID) : null
      const projectFolders =
        project?.folders?.filter((folder) => folder.availability !== 'missing') ?? []
      const primaryFolder =
        projectFolders.find((folder) => folder.id === project?.primaryFolderId) ??
        projectFolders.find((folder) => folder.role === 'primary')
      let workspace = primaryFolder
        ? await WorkspaceService.openRoots({
            primaryRoot: prepared.rootPath,
            roots: projectFolders.map((folder) =>
              folder.id === primaryFolder.id
                ? { folderId: folder.id, path: prepared.rootPath, role: 'primary' as const }
                : {
                    folderId: folder.id,
                    path: folder.path,
                    role: 'secondary' as const,
                    ...(task.workspace.mode === 'worktree' ? { writable: false } : {}),
                  },
            ),
          })
        : await WorkspaceService.open(prepared.rootPath)
      const localContextReferences =
        this.localContextPaths?.repository.listAuthorized(task.parentThreadId) ?? []
      workspace.grantReadOnlyPaths(localContextReferences.map(({ path, kind }) => ({ path, kind })))
      mcpLease = await this.mcp?.acquire(workspace.rootPath)
      const permissionConfig = run.permissionConfig
      for (const ancestor of this.collaboration.ancestors(task.childThreadId)) {
        const active = this.db.activeTurn(ancestor)
        const input = active ? this.db.getTurnInput(active.id) : null
        if (input) this.assertPermissionCeiling(input.permissionConfig, permissionConfig)
      }
      const executionPolicy = executionPolicyFromV4(permissionConfig)
      const input = this.db.getTurnInput(agent.turnID)
      if (!input) throw new Error(`Subagent turn ${agent.turnID} 没有输入`)
      const acquiredResume = this.resumeCheckpoints.acquire(
        agent.turnID,
        'subagent',
        crypto.randomUUID(),
      )
      acquiredResumeLeaseID = acquiredResume?.leaseID
      startupGate =
        acquiredResume?.checkpoint.kind === 'hook-trust'
          ? { leaseID: acquiredResume.leaseID, requestID: acquiredResume.checkpoint.requestID }
          : undefined
      const checkpoint =
        acquiredResume && acquiredResume.checkpoint.kind !== 'hook-trust'
          ? {
              approval: toPlanCheckpoint({
                leaseID: acquiredResume.leaseID,
                checkpoint: acquiredResume.checkpoint,
              }),
            }
          : null
      const parentMode =
        (
          this.db.sqlite.query('SELECT mode FROM turns WHERE id = ?').get(task.parentTurnId) as {
            mode: 'chat' | 'plan'
          } | null
        )?.mode ?? 'chat'
      const instructionSources = await new InstructionDiscoveryService().discover(
        workspace.rootPath,
      )
      const skillService = this.skillManagement?.runtimeService() ?? new SkillService()
      const skillCatalog = this.promptStorage
        ? await skillService.scan({
            workspaceRoot: workspace.rootPath,
            dataRoot: this.promptStorage.dataRoot,
            userHome: this.promptStorage.userHome,
          })
        : { skills: [], shadowed: [] }
      const invokedSkillData = await skillService.invocationData(input.content)
      workspace = workspace.withReadOnlyPaths(
        skillCatalog.skills.map((skill) => ({ path: skill.root, kind: 'directory' as const })),
      )
      const projectSourceCatalog =
        parentWorkspace?.kind === 'project'
          ? ((await this.projectSources?.catalog(parentWorkspace.projectID)) ?? null)
          : null
      const memories =
        this.memory?.recall({
          query: input.content,
          ...(parentWorkspace?.kind === 'project'
            ? { projectKey: projectMemoryKey(parentWorkspace.projectID) }
            : {}),
          subagent: true,
        }) ?? []
      const promptSections = createPromptSections({
        permissionInstructions: `子 Agent resolved file access=${executionPolicy.fileAccess}; Shell environment=${executionPolicy.shellEnvironment}; approval=${JSON.stringify(permissionConfig.approvalPolicy)}; reviewer=${permissionConfig.approvalsReviewer}。只能收紧，不能提升父任务 ceiling。`,
        mode: parentMode,
        profile: task.profile,
        environment: `工作区：${workspace.rootPath}`,
        projectInstructions: instructionSources.sources,
        skills: skillCatalog.skills,
        memories: memories.map((entry) => `可能过期的项目参考记忆：${entry.content}`),
        stableExternalData:
          projectSourceCatalog && projectSourceCatalog.total > 0
            ? [projectSourceCatalog.content]
            : [],
        externalData: [
          ...localContextReferences.map(
            (reference) =>
              `<local_context kind=${JSON.stringify(reference.kind)} path=${JSON.stringify(reference.path)}>${reference.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</local_context>`,
          ),
          ...invokedSkillData,
        ],
        userMessage: input.content,
      })
      const projectSettingsInstructions = project?.settings.instructions.trim()
      if (projectSettingsInstructions) {
        const projectInstructionIndex = promptSections.findIndex(({ id }) =>
          id.startsWith('project-instruction.'),
        )
        promptSections.splice(
          projectInstructionIndex >= 0 ? projectInstructionIndex : promptSections.length - 1,
          0,
          {
            id: 'project.settings.instructions',
            role: 'developer',
            cache: 'session-stable',
            authority: 'user',
            source: { type: 'setting', name: 'projectInstructions' },
            content: projectSettingsInstructions,
          },
        )
      }
      promptSections.splice(
        promptSections.length - 1,
        0,
        ...createMcpInstructionSections(mcpLease?.serverInstructions ?? []),
      )
      await this.resolveModel(run.model)
      const piModel = await this.providers.getModel(run.model)
      const contextManager = new ContextManager(this.db)
      const attachments = await this.agentAttachments(input.id)
      let composedBundle: PromptBundle | null = null
      let pausedKind: PendingApproval['kind'] | null = null
      const result = await this.orchestrator.run({
        threadID: task.childThreadId,
        turnID: agent.turnID,
        agentID: agent.id,
        sessionID: agent.sessionID,
        profile: task.profile,
        depth: agent.depth,
        delegation: this.delegationFor({
          threadID: task.childThreadId,
          turnID: agent.turnID,
          agentID: agent.id,
          taskMode: parentMode,
          model: run.model,
          permissionConfig,
          workspaceRoot: workspace.rootPath,
        }),
        ...(this.collaboration.allowedTools(taskID)
          ? { allowedTools: this.collaboration.allowedTools(taskID)! }
          : {}),
        collaborationEnabled: this.collaboration.available,
        collaborationMessages: () => this.collaboration.notices(task.childThreadId),
        content: input.content,
        taskMode: parentMode,
        fallbackModel: run.model,
        permissionConfig,
        signal: controller.signal,
        workspace,
        promptSections,
        skillService,
        ...(parentWorkspace?.kind === 'project' && this.projectSources
          ? {
              projectSources: {
                list: () => this.projectSources!.list(parentWorkspace.projectID),
                read: (sourceID: string, range?: { offset: number; length: number }) =>
                  this.projectSources!.read(parentWorkspace.projectID, sourceID, range),
              },
            }
          : {}),
        ...(mcpLease ? { toolCatalog: mcpLease.catalog } : {}),
        attachments,
        ...(startupGate ? { startupGateLeaseID: startupGate.leaseID } : {}),
        ...(checkpoint ? { resume: checkpoint.approval } : {}),
        resolveModel: async () => ({ ref: run.model, model: piModel }),
        onPromptComposed: async (bundle) => {
          composedBundle = bundle
          const timestamp = Date.now()
          const previous = contextManager.state(task.childThreadId)
          const fragments: ContextFragment[] = bundle.diagnostics
            .filter((item) => item.included && item.cache !== 'global-stable')
            .map((item, index) => ({
              id: item.id,
              kind: item.id.startsWith('mode.')
                ? 'mode'
                : item.id.startsWith('permission.')
                  ? 'permission'
                  : item.id.startsWith('project-')
                    ? 'project'
                    : item.id.startsWith('skills.')
                      ? 'skill'
                      : item.id.startsWith('memory.')
                        ? 'memory'
                        : 'settings',
              version: (previous?.baselineVersion ?? 0) + index + 1,
              hash: item.hash,
              payload: { source: item.source, cache: item.cache, bytes: item.bytes },
              createdAt: timestamp,
            }))
          if (!previous)
            contextManager.establishBaseline({
              threadID: task.childThreadId,
              promptVersion: 'prompt-engine-v2',
              baseHash: bundle.baseHash,
              contextHash: bundle.contextHash,
              cacheKey: bundle.cacheKey,
              fragments,
            })
          else contextManager.appendFragments(task.childThreadId, fragments, bundle.contextHash)
        },
        onUsage: async (usage) => {
          if (!composedBundle) return
          contextManager.recordMeasuredUsage({
            threadID: task.childThreadId,
            turnID: agent.turnID,
            sessionID: agent.sessionID,
            items: composedBundle.contextItems,
            promptText: composedBundle.instructions,
            contextWindowTokens: Math.max(1, Number(piModel.contextWindow) || 1),
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          })
        },
        pause: async (approval) => {
          pausedKind = approval.kind
          if (approval.kind === 'permission') {
            if (!approval.toolCallID)
              throw new AgentError(
                'APPROVAL_TOOL_CALL_ID_MISSING',
                '权限审批缺少 tool call id',
                500,
              )
            await this.approvals.attachRunState(
              approval.toolCallID,
              approval.checkpoint.state,
              approval.checkpoint.interruption,
            )
          } else if (approval.kind === 'subagents')
            await this.checkpointWait(task.childThreadId, agent.turnID, agent.id, approval)
          else await this.questions.checkpoint(task.childThreadId, agent.turnID, agent.id, approval)
        },
        checkSafeBoundary: async () => {
          return this.repository.pendingControls(runID).some((control) => control.action === 'send')
        },
      })
      if (result.status === 'paused') {
        if (acquiredResumeLeaseID) this.resumeCheckpoints.complete(acquiredResumeLeaseID)
        if (pausedKind !== 'subagents')
          this.repository.setWaiting(runID, pausedSubagentStatus(pausedKind))
        await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
          task: this.repository.task(taskID),
          run: this.repository.run(runID),
        })
        return
      }
      const steer = this.repository
        .pendingControls(runID)
        .find((control) => control.action === 'send')
      if (steer) {
        const payload = JSON.parse(steer.payload) as {
          message?: unknown
          model?: Model.Ref
          permissionConfig?: PermissionConfig
          attachmentIDs?: string[]
        }
        const continued = this.repository.continueTask({
          taskID,
          message: typeof payload.message === 'string' ? payload.message : '继续',
          ...(payload.model ? { model: payload.model } : {}),
          ...(payload.permissionConfig ? { permission: payload.permissionConfig } : {}),
          sameRun: true,
        })
        await this.bindAttachments(continued.agent.turnID, payload.attachmentIDs ?? [])
        this.repository.completeControl(steer.id, { agentId: continued.agent.id })
        startupGateSafe = true
        await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
          task: continued.task,
          run: continued.run,
        })
        void this.schedule()
        return
      }
      if (controller.signal.aborted) return
      if (await this.deferCompletion(task.childThreadId, agent.turnID, result)) return
      await mcpLease?.release()
      mcpLease = undefined
      await this.completeChild(taskID, runID, agent.turnID, agent.id, result, controller.signal)
      startupGateSafe = true
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'HOOK_TRUST_REQUIRED') return
      const steer = this.repository
        .pendingControls(runID)
        .find((control) => control.action === 'send')
      if (cause instanceof SafeBoundaryInterrupt && steer) {
        const payload = JSON.parse(steer.payload) as {
          message?: unknown
          model?: Model.Ref
          permissionConfig?: PermissionConfig
          attachmentIDs?: string[]
        }
        const continued = this.repository.continueTask({
          taskID,
          message: typeof payload.message === 'string' ? payload.message : '继续',
          ...(payload.model ? { model: payload.model } : {}),
          ...(payload.permissionConfig ? { permission: payload.permissionConfig } : {}),
          sameRun: true,
        })
        await this.bindAttachments(continued.agent.turnID, payload.attachmentIDs ?? [])
        this.repository.completeControl(steer.id, { agentId: continued.agent.id })
        startupGateSafe = true
        await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', {
          task: continued.task,
          run: continued.run,
        })
        void this.schedule()
        return
      }
      if (!controller.signal.aborted) {
        await this.stopChildrenForParent(agent.id)
        const error = cause instanceof Error ? cause.message : String(cause)
        if (isolationPrepared) await this.workspaces?.finalize(taskID).catch(() => undefined)
        await mcpLease?.release()
        mcpLease = undefined
        const finished = this.repository.finish(runID, 'failed', null, error)
        startupGateSafe = true
        if (finished)
          await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', finished)
        await this.emit(task.childThreadId, agent.turnID, 'turn/failed', {
          turnId: agent.turnID,
          rootAgentId: agent.id,
          message: error,
          finishedAt: Date.now(),
        })
      }
    } finally {
      const durableRun = this.repository.run(runID)
      const durableTerminal = Boolean(durableRun && terminal.has(durableRun.status))
      if (acquiredResumeLeaseID && (startupGateSafe || durableTerminal))
        this.resumeCheckpoints.complete(acquiredResumeLeaseID)
      if (startupGate) {
        const checkpoint = this.db.getAgentTurnCheckpoint(agent.turnID)
        const stillOwnsGate =
          checkpoint?.state === 'ready' &&
          checkpoint.payload.kind === 'hook-trust' &&
          checkpoint.payload.requestID === startupGate.requestID
        if (startupGateSafe || durableTerminal || !stillOwnsGate)
          this.resumeCheckpoints.complete(startupGate.leaseID)
      }
      await mcpLease?.release()
      this.controllers.delete(runID)
      await this.notifySettled(runID)
      if (!this.stoppingThreads.has(task.childThreadId)) this.repository.promoteFollowup(taskID)
      await this.resumeSatisfiedParents()
      void this.schedule()
    }
  }

  private async completeChild(
    taskID: string,
    runID: string,
    turnID: string,
    agentID: string,
    result: AgentRuntimeResult,
    signal: AbortSignal,
  ) {
    const structured = result.status === 'completed' ? result.result : undefined
    if (!structured)
      throw new AgentError('SUBAGENT_RESULT_INVALID', '子 Agent 未返回合法的结构化结果', 422)
    const task = this.requireTask(taskID)
    if (task.workspace.baselineRef) await this.workspaces?.finalize(taskID)
    if (signal.aborted) return
    const canonicalResult = {
      ...structured,
      changedFiles: this.canonicalChangedFiles(runID, structured.changedFiles),
    }
    const finished = this.repository.finish(runID, 'completed', canonicalResult, null)
    if (finished)
      await this.emit(task.parentThreadId, task.parentTurnId, 'subagent/updated', finished)
    await this.emit(task.childThreadId, turnID, 'turn/completed', {
      turnId: turnID,
      rootAgentId: agentID,
      finishedAt: Date.now(),
    })
  }

  private canonicalChangedFiles(runID: string, reported: Array<{ path: string; summary: string }>) {
    const turns = this.db.sqlite
      .query(
        `
      SELECT turn_id
      FROM agent_executions
      WHERE subagent_run_id = ?
      ORDER BY run_sequence, created_at
    `,
      )
      .all(runID) as Array<{ turn_id: string }>
    const patches = turns.flatMap(({ turn_id }) => {
      const item = this.db.getItem(`patch:${turn_id}`)
      return item?.type === 'patch' ? [item] : []
    })
    return canonicalSubagentChangedFiles(reported, patches)
  }

  async resumeTurn(_threadID: string, turnID: string) {
    const row = this.db.sqlite
      .query('SELECT subagent_run_id, id FROM agent_executions WHERE turn_id = ?')
      .get(turnID) as { subagent_run_id: string | null; id: string } | null
    if (!row?.subagent_run_id) return
    if (this.controllers.has(row.subagent_run_id)) {
      void this.executing.get(row.subagent_run_id)?.then(() => this.resumeTurn(_threadID, turnID))
      return
    }
    this.db.updateTurnStatus(turnID, 'queued')
    this.db.updateAgentStatus(row.id, 'queued')
    this.db.run(
      "UPDATE subagent_runs SET status = 'queued', updated_at = ? WHERE id = ?",
      Date.now(),
      row.subagent_run_id,
    )
    void this.schedule()
  }

  async reconcileCompletions() {
    await this.resumeSatisfiedParents()
  }

  private async resumeSatisfiedParents() {
    for (const completion of this.collaboration.completions()) {
      if (
        this.stoppingThreads.has(completion.thread_id) ||
        this.collaboration.pending(completion.thread_id).length
      )
        continue
      const agent = this.db.agentForTurn(completion.turn_id)
      if (!agent || this.controllers.has(agent.subagentRunID ?? '')) continue
      if (['completed', 'failed', 'interrupted', 'cancelled'].includes(agent.status)) {
        this.collaboration.clear(completion.turn_id)
        continue
      }
      this.db.updateAgentStatus(agent.id, 'queued')
      this.db.updateTurnStatus(completion.turn_id, 'queued')
      if (agent.subagentRunID) {
        this.db.sqlite
          .query("UPDATE subagent_runs SET status = 'queued' WHERE id = ?")
          .run(agent.subagentRunID)
        void this.schedule()
      } else this.parentResumeHandler?.(completion.thread_id, completion.turn_id)
    }
    for (const resumed of this.db.repositories.subagents.resumeSatisfiedSubagentWaits()) {
      await Promise.allSettled(
        resumed.events.map((event) => Effect.runPromise(this.hub.publish(event))),
      )
      const agent = this.db.agentForTurn(resumed.turnID)
      if (agent?.subagentRunID) await this.resumeTurn(resumed.threadID, resumed.turnID)
      else this.parentResumeHandler?.(resumed.threadID, resumed.turnID)
    }
  }

  private parentResumeHandler?: (threadID: string, turnID: string) => void

  setParentResumeHandler(handler: (threadID: string, turnID: string) => void) {
    this.parentResumeHandler = handler
  }

  private assertAdmission(threadID: string) {
    if (
      this.stoppingThreads.has(threadID) ||
      this.collaboration.completions().some((entry) => entry.thread_id === threadID)
    )
      throw new AgentError('CONFLICT', '该 Agent 正在停止或等待后代结算', 409)
  }

  async deferCompletion(threadID: string, turnID: string, result: AgentRuntimeResult) {
    if (!this.collaboration.available) return false
    if (!this.collaboration.pending(threadID).length) return false
    this.db.transaction(() => this.collaboration.save(threadID, turnID, result))
    const agent = this.db.agentForTurn(turnID)
    await this.emit(threadID, turnID, 'agent/upserted', { agent })
    await this.emit(threadID, turnID, 'turn/statusChanged', {
      turnId: turnID,
      status: 'waiting-subagents',
    })
    const task = this.db.sqlite
      .query('SELECT id FROM subagent_tasks WHERE child_thread_id = ?')
      .get(threadID) as { id: string } | null
    if (task) {
      const current = this.requireTask(task.id)
      await this.emit(current.parentThreadId, current.parentTurnId, 'subagent/updated', {
        task: current,
        run: current.currentRun,
      })
    }
    return true
  }

  async followup(taskID: string, message: string, operationID: string) {
    this.collaboration.assertAvailable()
    const replay = this.collaboration.replay(operationID, taskID, 'followup', message)
    if (replay) return replay
    if (!message.trim()) throw new AgentError('INVALID_PARAMS', '消息不能为空', 400)
    const task = this.requireTask(taskID)
    this.assertAdmission(task.childThreadId)
    this.assertAdmission(task.parentThreadId)
    const permission = task.currentRun!.permissionConfig
    const parent = this.db.activeTurn(task.parentThreadId)
    if (parent)
      this.assertPermissionCeiling(
        this.db.getTurnInput(parent.id)?.permissionConfig ?? task.permissionCeiling,
        permission,
      )
    const accepted = this.db.transaction(() => {
      this.collaboration.assertCapacity(task.parentTurnId, 0, 1)
      const queued = this.repository.continueTask({
        taskID,
        message,
        sameRun: false,
        enqueue: !terminal.has(task.currentRun!.status),
      })
      const input = this.db.getTurnInput(queued.agent.turnID)!
      const events = this.repository.eventsForUpdate(taskID)
      const value = { task: this.requireTask(taskID), run: this.requireTask(taskID).currentRun }
      for (const ancestor of this.collaboration.ancestors(task.parentThreadId))
        events.push(this.db.insertEvent(ancestor, null, 'subagent/updated', value))
      const result = {
        inputId: input.id,
        turnId: queued.agent.turnID,
        disposition: 'accepted' as const,
        streamPosition: { streamId: task.childThreadId, sequence: globalEventSequence(this.db) },
      }
      this.collaboration.record(
        operationID,
        taskID,
        'followup',
        message,
        result,
        input.id,
        queued.agent.turnID,
      )
      return { result, events }
    })
    await this.publish(accepted.events)
    void this.schedule()
    return accepted.result
  }

  private async report(root: RootContext, message: string, operationID: string) {
    this.collaboration.assertAvailable()
    if (!message.trim()) throw new AgentError('INVALID_PARAMS', '报告不能为空', 400)
    this.assertAdmission(root.threadID)
    const task = this.db.sqlite
      .query('SELECT id FROM subagent_tasks WHERE child_thread_id = ?')
      .get(root.threadID) as { id: string } | null
    if (!task) throw new AgentError('PERMISSION_DENIED', '只有子 Agent 可以报告', 403)
    const replay = this.collaboration.replay(
      operationID,
      task.id,
      'report',
      secretScrubber.scrubText(message),
    )
    if (replay) return replay
    const safe = secretScrubber.scrubText(message)
    const events = this.db.transaction(() => {
      this.collaboration.record(operationID, task.id, 'report', safe, { messageId: operationID })
      return this.repository.eventsForUpdate(task.id)
    })
    await this.publish(events)
    return { messageId: operationID }
  }

  private async notifySettled(runID: string) {
    if (!this.collaboration.available) return
    const run = this.repository.run(runID)
    if (!run || !terminal.has(run.status)) return
    const id = `settled:${runID}`
    const message = secretScrubber.scrubText(
      JSON.stringify({ runId: runID, status: run.status, result: run.result, error: run.error }),
    )
    if (this.collaboration.replay(id, run.taskId, 'settled', message)) return
    const events = this.db.transaction(() => {
      this.collaboration.record(id, run.taskId, 'settled', message, { messageId: id })
      return this.repository.eventsForUpdate(run.taskId)
    })
    await this.publish(events)
  }

  private async resolveModel(ref: Model.Ref) {
    try {
      return await this.providers.resolve(ref)
    } catch (cause) {
      throw new AgentError('MODEL_UNAVAILABLE', '子 Agent 模型不可用', 409, cause)
    }
  }

  private assertPermissionCeiling(ceiling: PermissionConfig, requested: PermissionConfig) {
    const sandboxRank = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 } as const
    if (sandboxRank[requested.sandboxMode] > sandboxRank[ceiling.sandboxMode]) {
      throw new AgentError('PERMISSION_CEILING_EXCEEDED', '子 Agent 文件系统权限超过任务上限', 403)
    }
    if (requested.approvalsReviewer !== ceiling.approvalsReviewer) {
      throw new AgentError('PERMISSION_CEILING_EXCEEDED', '子 Agent 不能更改任务审批人', 403)
    }
    const ceilingPolicy = ceiling.approvalPolicy
    const requestedPolicy = requested.approvalPolicy
    if (typeof ceilingPolicy === 'object') {
      if (typeof requestedPolicy === 'object') {
        const keys = [
          'sandboxApproval',
          'rules',
          'skillApproval',
          'requestPermissions',
          'mcpTools',
          'mcpElicitations',
        ] as const
        if (keys.some((key) => requestedPolicy[key] && !ceilingPolicy[key])) {
          throw new AgentError(
            'PERMISSION_CEILING_EXCEEDED',
            '子 Agent granular 审批能力超过任务上限',
            403,
          )
        }
      } else if (requestedPolicy !== 'never') {
        throw new AgentError(
          'PERMISSION_CEILING_EXCEEDED',
          '子 Agent 不能扩大 granular 审批策略',
          403,
        )
      }
      return
    }
    const allowed: Record<string, ReadonlySet<string>> = {
      untrusted: new Set(['untrusted', 'never']),
      'on-failure': new Set(['on-failure', 'untrusted', 'never']),
      'on-request': new Set(['on-request', 'untrusted', 'never']),
      never: new Set(['never']),
    }
    if (typeof requestedPolicy === 'object' || !allowed[ceilingPolicy]?.has(requestedPolicy)) {
      throw new AgentError('PERMISSION_CEILING_EXCEEDED', '子 Agent 审批能力超过任务上限', 403)
    }
  }

  private async validateAttachments(ids: string[], model: Model.Ref) {
    if (!ids.length) return
    if (ids.length > 8 || new Set(ids).size !== ids.length)
      throw new AgentError('ATTACHMENT_COUNT_LIMIT', '每个 Turn 最多包含 8 个不重复附件', 413)
    const values = await Promise.all(ids.map((id) => this.attachments.read(id)))
    if (values.some((value) => value.record.binding !== null))
      throw new AgentError('ATTACHMENT_ALREADY_BOUND', '附件已绑定到其他 Turn', 409)
    if (values.some((value) => value.record.kind === 'image')) {
      const info = await this.resolveModel(model)
      if (!info.capabilities.input.includes('image'))
        throw new AgentError('MODEL_IMAGE_UNSUPPORTED', '当前模型不支持图片输入', 409)
    }
  }

  private async bindAttachments(turnID: string, ids: string[]) {
    if (!ids.length) return
    const input = this.db.sqlite
      .query('SELECT id FROM inputs WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(turnID) as { id: string } | null
    if (!input) throw new AgentError('INPUT_NOT_FOUND', '子 Agent 输入不存在', 404)
    await this.attachments.bind(ids, { type: 'input', id: input.id })
  }

  private async agentAttachments(inputID: string) {
    const records = await this.attachments.listByBinding({ type: 'input', id: inputID })
    return Promise.all(
      records.map(async (record) => {
        const value = await this.attachments.read(record.id)
        return record.kind === 'text'
          ? {
              kind: 'text' as const,
              name: record.name,
              text: new TextDecoder('utf-8', { fatal: true }).decode(value.data),
            }
          : {
              kind: 'image' as const,
              name: record.name,
              mediaType: record.mimeType,
              base64: Buffer.from(value.data).toString('base64'),
            }
      }),
    )
  }
}
