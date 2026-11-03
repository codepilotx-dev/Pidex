import type { CalendarSourceRef } from '@pidex/shared/calendar'
import type {
  SchedulePlanExecutionDefaults,
  SchedulePlanHorizon,
  SchedulePlanItemDraft,
  SchedulePlanProposal,
} from '@pidex/shared/schedule-plan'
import type {
  ScheduleAcceptance,
  ScheduleConditionFallback,
  ScheduleConditions,
  ScheduleDraft,
  ScheduleExecution,
  ScheduleMissedRunPolicy,
  ScheduleTaskPlan,
  ScheduleTaskPlanSource,
  ScheduleTrigger,
} from '@pidex/shared/schedule-draft'
import type { Automation, AutomationNotificationPolicy } from '@pidex/shared/automation'
import type { ModelRef } from '@pidex/shared/model'
import type { PermissionConfig } from '@pidex/shared/thread'
import type { ScheduledTask } from '@pidex/shared/scheduled-task'
import { formatStructuredPlanMarkdown, type StructuredPlan } from '@pidex/shared/thread'
import { createHash } from 'node:crypto'
import {
  normalizeScheduledPermission,
  validateAutomationDefinition,
} from '../automation/AutomationService'
import { canonicalizeAutomationSchedule, nextAutomationOccurrence } from '../automation/Schedule'
import { AgentError } from '../Domain'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'
import type { ScheduleDraftRepository } from '../storage/repositories/ScheduleDraftRepository'
import type {
  ScheduleCalendarDatabase,
  SchedulePlanProposalRepository,
  ScheduledTaskRepository,
} from '../storage/repositories/ScheduledTaskRepository'
import { prepareScheduledTaskDefinition } from './ScheduledTaskService'
import { defaultTaskSchedule } from '@pidex/shared/task-schedule'
import type { TaskScheduleService } from './TaskScheduleService'

export type SchedulePlanProposalInput = {
  threadId: string
  turnId: string
  toolCallId: string
  horizon: SchedulePlanHorizon
  defaults: SchedulePlanExecutionDefaults
  items: SchedulePlanItemDraft[]
}

export type SchedulePlanCommitInput = {
  id: string
  expectedRevision: number
  operationId: string
  defaults: SchedulePlanExecutionDefaults
  items: readonly SchedulePlanItemDraft[]
}

export type SchedulePlanServiceOptions = {
  taskSchedules?: TaskScheduleService
  now?: () => number
  proposalChanged?: (proposal: SchedulePlanProposal) => void | Promise<void>
  draftChanged?: (draft: ScheduleDraft) => void | Promise<void>
  automationChanged?: (automation: Automation) => void | Promise<void>
  scheduledTaskChanged?: (task: ScheduledTask) => void | Promise<void>
  wakeScheduler?: () => void | Promise<void>
  /** 草案反馈沿用 Plan 回合的一般准入路径，不另建执行入口。 */
  threads?: DraftAdmission
  /** 反馈回合沿用会话当前权限；模型沿用草案提交时的选择。 */
  threadSettings?: (threadId: string) => { permissionConfig: PermissionConfig } | null
}

/** 只声明草案反馈需要的准入能力，日历层不依赖整个 ThreadService。 */
export type DraftAdmission = {
  withPlanAdmission<T>(
    threadID: string,
    operation: (
      start: (
        input: {
          content: string
          model: ModelRef
          permissionConfig: PermissionConfig
          taskMode: 'plan' | 'chat'
          strategy: 'start'
        },
        inputID: string,
        transition: { beforeCreate: () => void; afterCreate: (turnID: string) => void },
      ) => Promise<{ turnID: string }>,
      assertIdle: () => void,
    ) => Promise<T>,
  ): Promise<T>
}

/** 任务计划 + 执行安排草案：模型提交的待审阅内容，不激活任何调度。 */
export type ScheduleDraftSubmitInput = {
  threadId: string
  turnId: string
  toolCallId: string
  name: string
  prompt: string
  taskPlan: {
    source: ScheduleTaskPlanSource
    sourceRef: string | null
    structured: StructuredPlan
  }
  trigger: ScheduleTrigger
  conditions: ScheduleConditions
  conditionFallback: ScheduleConditionFallback
  acceptance: ScheduleAcceptance
  notificationPolicy: AutomationNotificationPolicy
  missedRuns: ScheduleMissedRunPolicy
  execution: ScheduleExecution
}

export type ScheduleDraftCommitInput = {
  requireManualAcceptance?: boolean | undefined
  id: string
  expectedRevision: number
  operationId: string
  name?: string | undefined
  prompt?: string | undefined
  trigger: ScheduleTrigger
  conditions: ScheduleConditions
  conditionFallback: ScheduleConditionFallback
  acceptance: ScheduleAcceptance
  notificationPolicy: AutomationNotificationPolicy
  missedRuns: ScheduleMissedRunPolicy
  execution: ScheduleExecution
}

/** 自动验收标准的可读描述：只描述宿主真正会检查的内容。 */
function describeAutomaticCheck(
  check: Extract<ScheduleAcceptance, { kind: 'automatic' }>['checks'][number],
): string {
  switch (check.kind) {
    case 'file-exists':
      return `- 文件存在且非空：${check.path}`
    case 'document-section':
      return `- 文档包含章节「${check.section}」：${check.path}`
    case 'command-exit-code':
      return `- 命令退出码为 ${check.expectedExitCode}：${check.command}`
  }
}

export function summarizeAcceptance(acceptance: ScheduleAcceptance): string {
  return acceptance.kind === 'manual'
    ? '人工验收：执行结束后等待用户在结果摘要上确认通过或提出返工意见。'
    : ['自动验收：', ...acceptance.checks.map(describeAutomaticCheck)].join('\n')
}

/**
 * 固定的执行提示：任务提示 + 已确认计划 + 验收标准 + 执行要求。
 * 计划在确认时固定，运行实例不再重新规划，只重新确认仓库事实。
 */
export function composeExecutionPrompt(draft: {
  prompt: string
  taskPlan: { structured: StructuredPlan }
  acceptance: ScheduleAcceptance
}): string {
  return [
    draft.prompt.trim(),
    '',
    '## 已确认的任务计划（固定上下文，不要重新规划）',
    formatStructuredPlanMarkdown(draft.taskPlan.structured),
    '',
    '## 验收标准',
    summarizeAcceptance(draft.acceptance),
    '',
    '## 执行要求',
    '先简短重述用户目标和试图解决的问题，然后重新读取相关代码确认事实，再完成实施与必要验证。',
  ].join('\n')
}

/**
 * 草案的执行设置映射为既有 scheduled task / automation 定义字段：
 * `environment` 是草案里的执行环境，旧定义里对应 `execution`。
 */
function scheduledWorkDefaults(execution: ScheduleExecution) {
  return {
    kind: execution.kind,
    projectId: execution.projectId,
    targetThreadId: execution.targetThreadId,
    execution: execution.environment,
    model: execution.model,
    reasoningEffort: execution.reasoningEffort,
    permissionConfig: execution.permissionConfig,
  }
}

export class SchedulePlanService {
  private readonly now: () => number

  constructor(
    private readonly db: ScheduleCalendarDatabase,
    private readonly proposals: SchedulePlanProposalRepository,
    private readonly drafts: ScheduleDraftRepository,
    private readonly scheduledTasks: ScheduledTaskRepository,
    private readonly automations: AutomationRepository,
    private readonly options: SchedulePlanServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  async propose(input: SchedulePlanProposalInput) {
    if (!input.items.length || input.items.length > 100)
      throw new AgentError('INVALID_REQUEST', '规划草案必须包含 1 到 100 个任务', 400)
    const items = this.prepareItems(input.items, input.defaults)
    const proposal = this.proposals.create(
      {
        ...input,
        id: `schedule-plan:${input.toolCallId}`,
        operationId: `schedule-plan-propose:${input.toolCallId}`,
        defaults: this.prepareDefaults(input.defaults),
        items,
      },
      this.now(),
    )
    await this.options.proposalChanged?.(proposal)
    return proposal
  }

  read(id: string) {
    const proposal = this.proposals.read(id)
    if (!proposal) throw new AgentError('SCHEDULE_PLAN_NOT_FOUND', '规划草案不存在', 404)
    return proposal
  }

  async commit(input: SchedulePlanCommitInput) {
    const existing = this.proposals.findByCommitOperation(input.operationId)
    if (existing) {
      if (
        existing.id !== input.id ||
        JSON.stringify(existing.defaults) !== JSON.stringify(input.defaults) ||
        JSON.stringify(existing.items) !== JSON.stringify(input.items)
      )
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他规划确认请求', 409)
      return existing
    }
    const proposal = this.read(input.id)
    if (proposal.status !== 'pending' || proposal.revision !== input.expectedRevision) {
      throw new AgentError('CONFLICT', '规划草案版本或状态已变化', 409)
    }
    const defaults = this.prepareDefaults(input.defaults)
    const items = this.prepareItems(input.items, defaults)
    const enabled = items.filter((item) => item.enabled)
    if (!enabled.length) throw new AgentError('INVALID_REQUEST', '请至少启用一个任务', 400)
    const now = this.now()
    const changedAutomations: Automation[] = []
    const changedTasks: ScheduledTask[] = []
    const createdRefs: CalendarSourceRef[] = []
    const committed = this.db.transaction(() => {
      for (const item of enabled) {
        const childOperation = `schedule-plan:${proposal.id}:${item.key}`
        if (item.kind === 'one-off') {
          const task = this.scheduledTasks.create(
            {
              ...prepareScheduledTaskDefinition(this.automations, {
                ...defaults,
                name: item.name,
                prompt: item.prompt,
                scheduledFor: item.scheduledFor,
              }),
              id: `scheduled-task:${childOperation}`,
              operationId: childOperation,
              proposalId: proposal.id,
            },
            now,
          )
          createdRefs.push({ kind: 'scheduled-task', id: task.id })
          changedTasks.push(task)
          continue
        }
        const definition = {
          ...defaults,
          name: item.name.trim(),
          prompt: item.prompt.trim(),
          schedule: item.schedule,
          timeZone: item.timeZone,
          permissionConfig: normalizeScheduledPermission(defaults.permissionConfig),
        }
        validateAutomationDefinition(this.automations, definition)
        const automation = this.automations.create(
          {
            ...definition,
            id: `automation:${childOperation}`,
            canonicalRrule: canonicalizeAutomationSchedule(item.schedule),
            nextRunAt: nextAutomationOccurrence(item.schedule, item.timeZone, now),
          },
          now,
        )
        createdRefs.push({ kind: 'automation', id: automation.id })
        changedAutomations.push(automation)
      }
      return this.proposals.commit(
        proposal.id,
        {
          expectedRevision: proposal.revision,
          operationId: input.operationId,
          defaults,
          items,
          createdRefs,
        },
        now,
      )
    })
    await Promise.all([
      ...changedAutomations.map((value) => this.options.automationChanged?.(value)),
      ...changedTasks.map((value) => this.options.scheduledTaskChanged?.(value)),
      this.options.proposalChanged?.(committed),
    ])
    await this.options.wakeScheduler?.()
    return committed
  }

  // ---------------------------------------------------------------------------
  // 任务计划 + 执行安排草案（schema 60 扩展表，独立于旧 proposal 流）
  //
  // 同一个服务负责草案与安排：`submitDraft` 只落盘待审阅内容，绝不激活调度；
  // 只有 `commitDraft` 在一个事务里创建任务并标记草案已确认。旧的
  // `schedule_plan_propose` 保留其已落盘数据与工具语义，作为同一服务的适配入口。
  // ---------------------------------------------------------------------------

  async submitDraft(input: ScheduleDraftSubmitInput): Promise<ScheduleDraft> {
    const prepared = this.prepareDraft({
      ...input,
      execution: {
        ...input.execution,
        // Plan 调查的只读上限不替代用户确认后执行任务的会话权限配置。
        permissionConfig:
          this.options.threadSettings?.(input.threadId)?.permissionConfig ??
          input.execution.permissionConfig,
      },
    })
    const draft = this.drafts.create(
      {
        ...prepared,
        id: `schedule-draft:${input.toolCallId}`,
        operationId: `schedule-draft-submit:${input.toolCallId}`,
        threadId: input.threadId,
        turnId: input.turnId,
        toolCallId: input.toolCallId,
      },
      this.now(),
    )
    await this.options.draftChanged?.(draft)
    return draft
  }

  readDraft(id: string): ScheduleDraft {
    this.drafts.recover()
    const draft = this.drafts.get(id)
    if (!draft) throw new AgentError('SCHEDULE_PLAN_NOT_FOUND', '任务规划草案不存在', 404)
    return draft
  }

  pendingDraft(threadId: string): ScheduleDraft | null {
    this.drafts.recover(threadId)
    return this.drafts.pending(threadId)
  }

  /** 草案反馈轮次的源草案；ThreadService 据此重建固定计划上下文。 */
  draftFeedbackSource(turnId: string): ScheduleDraft | null {
    return this.drafts.feedbackSource(turnId)
  }

  linkDraftFeedbackTurn(id: string, turnId: string): void {
    this.drafts.linkFeedbackTurn(id, turnId)
  }

  async cancelDraft(id: string, expectedRevision: number): Promise<ScheduleDraft> {
    const draft = this.drafts.cancel(id, expectedRevision, this.now())
    await this.options.draftChanged?.(draft)
    return draft
  }

  /**
   * 草案反馈：用户意见作为真实用户消息开启新的 Plan 回合，源草案由
   * feedback_turn_id 关联重建为固定上下文；旧草案立即失效，模型重新提交草案。
   * 重试同一个 operationId 只开启一个回合。
   */
  async feedbackDraft(input: {
    id: string
    expectedRevision: number
    operationId: string
    feedback: string
  }): Promise<ScheduleDraft> {
    const feedback = input.feedback.trim()
    if (!feedback) throw new AgentError('INVALID_REQUEST', '草案修改意见不能为空', 400)
    const requestHash = createHash('sha256')
      .update(JSON.stringify([input.id, input.expectedRevision, feedback]))
      .digest('hex')
    const existing = this.drafts.lookupOperation(input.operationId)
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他草案反馈请求', 409)
      return this.readDraft(existing.draftId)
    }
    const admission = this.options.threads
    if (!admission) throw new AgentError('TOOL_NOT_AVAILABLE', '当前 Agent 不支持草案反馈', 409)
    const draft = this.readDraft(input.id)
    if (draft.status !== 'pending' || draft.revision !== input.expectedRevision)
      throw new AgentError('CONFLICT', '任务规划草案版本或状态已变化', 409)
    const settings = this.options.threadSettings?.(draft.threadId)
    if (!settings) throw new AgentError('CONFLICT', '会话设置不可用', 409)
    const cancelled = await admission.withPlanAdmission(
      draft.threadId,
      async (start, assertIdle) => {
        assertIdle()
        // 旧草案先失效，避免带着未提交意见确认旧安排。
        const invalidated = this.drafts.cancel(draft.id, draft.revision, this.now())
        await start(
          {
            content: feedback,
            model: draft.execution.model,
            permissionConfig: settings.permissionConfig,
            taskMode: 'plan',
            strategy: 'start',
          },
          crypto.randomUUID(),
          {
            beforeCreate: () => undefined,
            afterCreate: (turnId) => this.drafts.linkFeedbackTurn(draft.id, turnId),
          },
        )
        return invalidated
      },
    )
    this.drafts.recordOperation({
      operationId: input.operationId,
      draftId: draft.id,
      method: 'schedule-draft/feedback',
      requestHash,
      result: { draftId: draft.id },
    })
    await this.options.draftChanged?.(cancelled)
    return cancelled
  }

  /**
   * 原子确认：校验版本、条件与触发，创建任务并把草案标记为已确认。
   * 重试同一个 operationId 只会返回同一份已确认结果，不会产生第二组任务。
   */
  async commitDraft(input: ScheduleDraftCommitInput): Promise<ScheduleDraft> {
    const duplicate = this.drafts.findByCommitOperation(input.operationId)
    if (duplicate) {
      if (duplicate.id !== input.id)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他确认请求', 409)
      return duplicate
    }
    const draft = this.readDraft(input.id)
    if (draft.status !== 'pending' || draft.revision !== input.expectedRevision)
      throw new AgentError('CONFLICT', '任务规划草案版本或状态已变化', 409)

    const prepared = this.prepareDraft({
      ...draft,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      trigger: input.trigger,
      conditions: input.conditions,
      conditionFallback: input.conditionFallback,
      acceptance: input.acceptance,
      notificationPolicy: input.notificationPolicy,
      missedRuns: input.missedRuns,
      execution: input.execution,
      taskPlan: draft.taskPlan,
    })
    if (this.options.taskSchedules?.available()) {
      const service = this.options.taskSchedules
      const now = this.now()
      const committed = this.db.transaction(() => {
        const content = composeExecutionPrompt(prepared)
        const task = service.save({
          name: prepared.name,
          operationId: `draft-task:${input.operationId}`,
          definition: {
            ...defaultTaskSchedule(prepared.name),
            trigger: prepared.trigger,
            conditions: prepared.conditions,
            conditionFallback: prepared.conditionFallback,
            missedRuns: prepared.missedRuns,
            notificationPolicy: prepared.notificationPolicy,
            plan: {
              content,
              contentHash: prepared.taskPlan.contentHash,
              threadId: draft.threadId,
              itemId: null,
            },
            execution: prepared.execution,
            autoExecute: true,
            requireManualAcceptance:
              input.requireManualAcceptance ?? prepared.acceptance.kind === 'manual',
            checks: prepared.acceptance.kind === 'automatic' ? prepared.acceptance.checks : [],
          },
        })
        return this.drafts.commit(
          draft.id,
          {
            ...prepared,
            expectedRevision: draft.revision,
            operationId: input.operationId,
            createdRefs: [{ kind: 'task-schedule', id: task.id }],
          },
          now,
        )
      })
      await this.options.draftChanged?.(committed)
      await this.options.wakeScheduler?.()
      return committed
    }
    this.assertSupportedTrigger(prepared.trigger)
    this.assertSupportedAcceptance(prepared.acceptance)
    const conditions = prepared.conditions
    if (
      conditions.dependsOn.length > 0 ||
      conditions.requireEnvironment ||
      conditions.notBefore !== null ||
      conditions.deadline !== null ||
      prepared.conditionFallback === 'wait'
    )
      throw new AgentError(
        'INVALID_REQUEST',
        '当前版本还不支持执行依赖、环境条件、时间窗口或条件等待；请保留草案不确认。',
        400,
      )
    if (prepared.missedRuns === 'skip')
      throw new AgentError(
        'INVALID_REQUEST',
        '当前版本还不支持跳过错过的执行；请改为补跑，或保留草案不确认。',
        400,
      )
    const now = this.now()
    const prompt = composeExecutionPrompt(prepared)
    const createdRefs: CalendarSourceRef[] = []
    const changedAutomations: Automation[] = []
    const changedTasks: ScheduledTask[] = []
    const committed = this.db.transaction(() => {
      if (prepared.trigger.kind === 'once') {
        const task = this.scheduledTasks.create(
          {
            ...prepareScheduledTaskDefinition(this.automations, {
              ...scheduledWorkDefaults(prepared.execution),
              name: prepared.name,
              prompt,
              scheduledFor: prepared.trigger.at,
              timeZone: prepared.trigger.timeZone,
              notificationPolicy: prepared.notificationPolicy,
            }),
            id: `scheduled-task:schedule-draft:${draft.id}`,
            operationId: `schedule-draft-task:${draft.id}`,
          },
          now,
        )
        createdRefs.push({ kind: 'scheduled-task', id: task.id })
        changedTasks.push(task)
      } else if (prepared.trigger.kind === 'recurring') {
        const definition = {
          ...scheduledWorkDefaults(prepared.execution),
          name: prepared.name,
          prompt,
          schedule: prepared.trigger.schedule,
          timeZone: prepared.trigger.timeZone,
          notificationPolicy: prepared.notificationPolicy,
          permissionConfig: normalizeScheduledPermission(prepared.execution.permissionConfig),
        }
        validateAutomationDefinition(this.automations, definition)
        const automation = this.automations.create(
          {
            ...definition,
            id: `automation:schedule-draft:${draft.id}`,
            canonicalRrule: canonicalizeAutomationSchedule(prepared.trigger.schedule),
            nextRunAt: nextAutomationOccurrence(
              prepared.trigger.schedule,
              prepared.trigger.timeZone,
              now,
            ),
          },
          now,
        )
        createdRefs.push({ kind: 'automation', id: automation.id })
        changedAutomations.push(automation)
      }
      return this.drafts.commit(
        draft.id,
        {
          expectedRevision: draft.revision,
          operationId: input.operationId,
          name: prepared.name,
          prompt: prepared.prompt,
          trigger: prepared.trigger,
          conditions: prepared.conditions,
          conditionFallback: prepared.conditionFallback,
          acceptance: prepared.acceptance,
          notificationPolicy: prepared.notificationPolicy,
          missedRuns: prepared.missedRuns,
          execution: prepared.execution,
          createdRefs,
        },
        now,
      )
    })
    await Promise.all([
      ...changedAutomations.map((value) => this.options.automationChanged?.(value)),
      ...changedTasks.map((value) => this.options.scheduledTaskChanged?.(value)),
      this.options.draftChanged?.(committed),
    ])
    await this.options.wakeScheduler?.()
    return committed
  }

  private prepareDraft(input: {
    threadId: string
    name: string
    prompt: string
    taskPlan: {
      source: ScheduleTaskPlanSource
      sourceRef: string | null
      structured: StructuredPlan
    }
    trigger: ScheduleTrigger
    conditions: ScheduleConditions
    conditionFallback: ScheduleConditionFallback
    acceptance: ScheduleAcceptance
    notificationPolicy: AutomationNotificationPolicy
    missedRuns: ScheduleMissedRunPolicy
    execution: ScheduleExecution
  }) {
    const name = input.name.trim()
    const prompt = input.prompt.trim()
    if (!name || !prompt) throw new AgentError('INVALID_REQUEST', '任务名称与执行提示不能为空', 400)
    const execution = {
      ...input.execution,
      permissionConfig: normalizeScheduledPermission(input.execution.permissionConfig),
    }
    if (!execution.model.providerID || !execution.model.id)
      throw new AgentError('MODEL_UNAVAILABLE', '任务规划草案缺少可用模型', 409)
    if (execution.kind === 'standalone' && !execution.projectId)
      throw new AgentError('PROJECT_NOT_FOUND', '独立任务需要有效的项目', 404)
    if (execution.kind === 'thread' && !execution.targetThreadId)
      throw new AgentError('THREAD_NOT_FOUND', '会话内任务需要目标会话', 404)
    validateAutomationDefinition(this.automations, {
      ...scheduledWorkDefaults(execution),
      name,
      prompt,
    })
    const timeZone =
      input.trigger.kind === 'once' || input.trigger.kind === 'recurring'
        ? input.trigger.timeZone
        : null
    if (timeZone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
      } catch {
        throw new AgentError('INVALID_REQUEST', '任务规划草案时区无效', 400)
      }
    }
    if (input.trigger.kind === 'once' && !Number.isFinite(input.trigger.at))
      throw new AgentError('INVALID_REQUEST', '一次性执行时间无效', 400)
    if (input.trigger.kind === 'recurring') canonicalizeAutomationSchedule(input.trigger.schedule)
    const markdown = formatStructuredPlanMarkdown(input.taskPlan.structured)
    return {
      name,
      prompt,
      taskPlan: {
        source: input.taskPlan.source,
        sourceRef: input.taskPlan.sourceRef,
        contentHash: createHash('sha256').update(markdown).digest('hex'),
        structured: input.taskPlan.structured,
      } satisfies ScheduleTaskPlan,
      trigger: input.trigger,
      conditions: input.conditions,
      conditionFallback: input.conditionFallback,
      acceptance: input.acceptance,
      notificationPolicy: input.notificationPolicy,
      missedRuns: input.missedRuns,
      execution,
    }
  }

  /**
   * 阶段能力边界：条件等待、事件触发与自动验收分别在后续阶段接入宿主检查。
   * 在接入之前一律拒绝确认，而不是剥掉这些字段后创建普通自动化。
   */
  private assertSupportedTrigger(trigger: ScheduleTrigger): void {
    if (trigger.kind === 'task-succeeded' || trigger.kind === 'acceptance-passed')
      throw new AgentError(
        'INVALID_REQUEST',
        '当前版本还不支持按任务成功或验收通过触发执行；请改为一次性时间或周期规则。',
        400,
      )
  }

  private assertSupportedAcceptance(acceptance: ScheduleAcceptance): void {
    if (acceptance.kind === 'automatic')
      throw new AgentError(
        'INVALID_REQUEST',
        '当前版本还不支持自动验收；请改为人工验收，或先保留草案不确认。',
        400,
      )
  }

  private prepareDefaults(input: SchedulePlanExecutionDefaults): SchedulePlanExecutionDefaults {
    const defaults = {
      ...input,
      permissionConfig: normalizeScheduledPermission(input.permissionConfig),
    }
    validateAutomationDefinition(this.automations, {
      ...defaults,
      name: '规划任务',
      prompt: '执行规划任务',
    })
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: defaults.timeZone }).format(0)
    } catch {
      throw new AgentError('INVALID_REQUEST', '规划草案时区无效', 400)
    }
    return defaults
  }

  private prepareItems(
    items: readonly SchedulePlanItemDraft[],
    defaults: SchedulePlanExecutionDefaults,
  ) {
    const keys = new Set<string>()
    return items.map((item) => {
      const key = item.key.trim()
      if (!key || keys.has(key))
        throw new AgentError('INVALID_REQUEST', '规划草案任务 key 不能为空或重复', 400)
      keys.add(key)
      if (item.kind === 'one-off') {
        const prepared = prepareScheduledTaskDefinition(this.automations, {
          ...defaults,
          name: item.name,
          prompt: item.prompt,
          scheduledFor: item.scheduledFor,
        })
        return { ...item, key, name: prepared.name, prompt: prepared.prompt }
      }
      const prepared = {
        ...defaults,
        name: item.name.trim(),
        prompt: item.prompt.trim(),
        schedule: item.schedule,
        timeZone: item.timeZone,
      }
      validateAutomationDefinition(this.automations, prepared)
      canonicalizeAutomationSchedule(item.schedule)
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: item.timeZone }).format(0)
      } catch {
        throw new AgentError('INVALID_REQUEST', '自动化时区无效', 400)
      }
      return { ...item, key, name: prepared.name, prompt: prepared.prompt }
    })
  }
}
