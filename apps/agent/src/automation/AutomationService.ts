import type { Automation, AutomationRun, AutomationSchedule } from '@pidex/shared/automation'
import type { ModelRef } from '@pidex/shared/model'
import type { PermissionConfig } from '@pidex/shared/thread'
import { AgentError } from '../Domain'
import type {
  AutomationRepository,
  AutomationUpdateRecord,
} from '../storage/repositories/AutomationRepository'
import {
  canonicalizeAutomationSchedule,
  nextAutomationOccurrence,
  previewAutomationSchedule,
} from './Schedule'

export type AutomationDefinition = Pick<
  Automation,
  | 'kind'
  | 'name'
  | 'prompt'
  | 'projectId'
  | 'targetThreadId'
  | 'execution'
  | 'reasoningEffort'
  | 'timeZone'
  | 'notificationPolicy'
> & {
  model: ModelRef
  permissionConfig: PermissionConfig
  schedule: AutomationSchedule
}
export type AutomationPatch = Partial<AutomationDefinition> & {
  expectedRevision: number
  status?: Exclude<Automation['status'], 'deleted'>
}

export type AutomationServiceOptions = {
  now?: () => number
  changed?: (automation: Automation) => void | Promise<void>
  wakeScheduler?: () => void | Promise<void>
  claimed?: (run: AutomationRun) => void | Promise<void>
}

export const normalizeScheduledPermission = (
  permissionConfig: PermissionConfig,
): PermissionConfig => ({
  ...permissionConfig,
  approvalPolicy: 'never',
})

type AutomationTargetLookup = Pick<
  AutomationRepository,
  'projectAvailable' | 'targetThreadAvailable'
>
export type ScheduledWorkTargetDefinition = Pick<
  AutomationDefinition,
  | 'kind'
  | 'name'
  | 'prompt'
  | 'projectId'
  | 'targetThreadId'
  | 'execution'
  | 'model'
  | 'reasoningEffort'
  | 'permissionConfig'
>

export const validateAutomationDefinition = (
  repository: AutomationTargetLookup,
  input: ScheduledWorkTargetDefinition,
) => {
  if (!input.name.trim() || input.name.trim().length > 200)
    throw new AgentError('INVALID_REQUEST', '自动化名称不能为空且不能超过 200 字符', 400)
  if (!input.prompt.trim() || input.prompt.length > 100_000)
    throw new AgentError('INVALID_REQUEST', '自动化 Prompt 不能为空且不能超过 100000 字符', 400)
  if (input.kind === 'standalone') {
    if (!input.projectId || input.targetThreadId || !input.execution)
      throw new AgentError('INVALID_REQUEST', '独立自动化必须绑定单一项目和执行位置', 400)
    if (!repository.projectAvailable(input.projectId))
      throw new AgentError('PROJECT_NOT_FOUND', '自动化项目不存在或已移除', 404)
    if (input.execution.kind === 'new-worktree' && !input.execution.branchName.trim())
      throw new AgentError('INVALID_REQUEST', '新 Worktree 必须指定基准分支', 400)
  } else if (!input.targetThreadId || input.projectId || input.execution) {
    throw new AgentError('INVALID_REQUEST', '聊天自动化必须只绑定一个目标聊天', 400)
  } else if (!repository.targetThreadAvailable(input.targetThreadId)) {
    throw new AgentError('THREAD_NOT_FOUND', '自动化目标聊天不存在或已归档', 404)
  }
}

export class AutomationService {
  private readonly now: () => number

  constructor(
    private readonly repository: AutomationRepository,
    private readonly options: AutomationServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  list(input?: Parameters<AutomationRepository['list']>[0]) {
    return this.repository.list(input)
  }
  read(id: string) {
    const value = this.repository.read(id)
    if (!value) throw new AgentError('AUTOMATION_NOT_FOUND', '自动化不存在', 404)
    return value
  }
  listRuns(input?: Parameters<AutomationRepository['listRuns']>[0]) {
    return this.repository.listRuns(input)
  }
  preview(schedule: AutomationSchedule, timeZone: string, count = 5) {
    return previewAutomationSchedule(schedule, timeZone, this.now(), count)
  }

  async create(input: AutomationDefinition & { operationId: string }) {
    this.validateDefinition(input)
    const now = this.now()
    const canonicalRrule = canonicalizeAutomationSchedule(input.schedule)
    const automation = this.repository.create(
      {
        ...input,
        id: `automation:${input.operationId}`,
        name: input.name.trim(),
        prompt: input.prompt.trim(),
        permissionConfig: normalizeScheduledPermission(input.permissionConfig),
        canonicalRrule,
        nextRunAt: nextAutomationOccurrence(input.schedule, input.timeZone, now),
      },
      now,
    )
    await this.changed(automation)
    await this.options.wakeScheduler?.()
    return automation
  }

  async update(id: string, input: AutomationPatch) {
    const existing = this.read(id)
    const definition: AutomationDefinition = {
      kind: input.kind ?? existing.kind,
      name: input.name ?? existing.name,
      prompt: input.prompt ?? existing.prompt,
      projectId: input.projectId === undefined ? existing.projectId : input.projectId,
      targetThreadId:
        input.targetThreadId === undefined ? existing.targetThreadId : input.targetThreadId,
      execution: input.execution === undefined ? existing.execution : input.execution,
      model: input.model ?? existing.model,
      reasoningEffort:
        input.reasoningEffort === undefined ? existing.reasoningEffort : input.reasoningEffort,
      permissionConfig: input.permissionConfig ?? existing.permissionConfig,
      schedule: input.schedule ?? existing.schedule,
      timeZone: input.timeZone ?? existing.timeZone,
      notificationPolicy: input.notificationPolicy ?? existing.notificationPolicy,
    }
    this.validateDefinition(definition)
    const now = this.now()
    const canonicalRrule = canonicalizeAutomationSchedule(definition.schedule)
    const status = input.status ?? (existing.status === 'deleted' ? 'paused' : existing.status)
    const scheduleChanged = input.schedule !== undefined || input.timeZone !== undefined
    const nextRunAt =
      status === 'paused'
        ? null
        : existing.status !== 'active' || scheduleChanged
          ? nextAutomationOccurrence(definition.schedule, definition.timeZone, now)
          : existing.nextRunAt
    const record: AutomationUpdateRecord = {
      ...definition,
      expectedRevision: input.expectedRevision,
      status,
      name: definition.name.trim(),
      prompt: definition.prompt.trim(),
      permissionConfig: normalizeScheduledPermission(definition.permissionConfig),
      canonicalRrule,
      nextRunAt,
    }
    const automation = this.repository.update(id, record, now)
    await this.changed(automation)
    await this.options.wakeScheduler?.()
    return automation
  }

  async pause(id: string, expectedRevision: number) {
    const value = this.repository.pause(id, expectedRevision, this.now())
    await this.changed(value)
    await this.options.wakeScheduler?.()
    return value
  }

  async resume(id: string, expectedRevision: number) {
    const existing = this.read(id)
    const now = this.now()
    const value = this.repository.resume(
      id,
      expectedRevision,
      nextAutomationOccurrence(existing.schedule, existing.timeZone, now),
      now,
    )
    await this.changed(value)
    await this.options.wakeScheduler?.()
    return value
  }

  async removeThreadSchedules(threadId: string) {
    for (const item of this.repository.forThread(threadId))
      await this.delete(item.id, item.revision)
  }

  async delete(id: string, expectedRevision: number) {
    const value = this.repository.softDelete(id, expectedRevision, this.now())
    await this.changed(value)
    await this.options.wakeScheduler?.()
    return value
  }

  async runNow(id: string, operationId: string) {
    const run = this.repository.claimManual(id, operationId, this.now())
    await this.options.claimed?.(run)
    await this.options.wakeScheduler?.()
    return run
  }

  markRunRead(id: string) {
    return this.repository.markRunRead(id, this.now())
  }
  markAllRunsRead(automationId?: string) {
    return this.repository.markAllRunsRead(this.now(), automationId)
  }

  private async changed(automation: Automation) {
    await this.options.changed?.(automation)
  }

  private validateDefinition(input: AutomationDefinition) {
    validateAutomationDefinition(this.repository, input)
  }
}
