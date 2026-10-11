import type { CalendarSourceRef } from '@pidex/shared/calendar'
import type {
  SchedulePlanExecutionDefaults,
  SchedulePlanHorizon,
  SchedulePlanItemDraft,
  SchedulePlanProposal,
} from '@pidex/shared/schedule-plan'
import type { Automation } from '@pidex/shared/automation'
import type { ScheduledTask } from '@pidex/shared/scheduled-task'
import {
  normalizeScheduledPermission,
  validateAutomationDefinition,
} from '../automation/AutomationService'
import { canonicalizeAutomationSchedule, nextAutomationOccurrence } from '../automation/Schedule'
import { AgentError } from '../Domain'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'
import type {
  ScheduleCalendarDatabase,
  SchedulePlanProposalRepository,
  ScheduledTaskRepository,
} from '../storage/repositories/ScheduledTaskRepository'
import { prepareScheduledTaskDefinition } from './ScheduledTaskService'

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
  now?: () => number
  proposalChanged?: (proposal: SchedulePlanProposal) => void | Promise<void>
  automationChanged?: (automation: Automation) => void | Promise<void>
  scheduledTaskChanged?: (task: ScheduledTask) => void | Promise<void>
  wakeScheduler?: () => void | Promise<void>
}

export class SchedulePlanService {
  private readonly now: () => number

  constructor(
    private readonly db: ScheduleCalendarDatabase,
    private readonly proposals: SchedulePlanProposalRepository,
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
