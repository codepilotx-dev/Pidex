import type { ScheduledTask, ScheduledTaskDefinition } from '@pidex/shared/scheduled-task'
import {
  normalizeScheduledPermission,
  validateAutomationDefinition,
} from '../automation/AutomationService'
import { AgentError } from '../Domain'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'
import type {
  ScheduledTaskRepository,
  ScheduledTaskUpdate,
} from '../storage/repositories/ScheduledTaskRepository'

export type ScheduledTaskServiceOptions = {
  now?: () => number
  changed?: (task: ScheduledTask) => void | Promise<void>
  claimed?: (task: ScheduledTask) => void | Promise<void>
  wakeScheduler?: () => void | Promise<void>
}

type ScheduledTaskTargetLookup = Pick<
  AutomationRepository,
  'projectAvailable' | 'targetThreadAvailable'
>

export const prepareScheduledTaskDefinition = (
  targets: ScheduledTaskTargetLookup,
  input: ScheduledTaskDefinition,
): ScheduledTaskDefinition => {
  const definition = {
    ...input,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    permissionConfig: normalizeScheduledPermission(input.permissionConfig),
  }
  if (!definition.name || definition.name.length > 200)
    throw new AgentError('INVALID_REQUEST', '计划任务名称不能为空且不能超过 200 字符', 400)
  if (!definition.prompt || definition.prompt.length > 100_000)
    throw new AgentError('INVALID_REQUEST', '计划任务 Prompt 不能为空且不能超过 100000 字符', 400)
  if (!Number.isFinite(definition.scheduledFor))
    throw new AgentError('INVALID_REQUEST', '计划任务执行时间无效', 400)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: definition.timeZone }).format(0)
  } catch {
    throw new AgentError('INVALID_REQUEST', '计划任务时区无效', 400)
  }
  validateAutomationDefinition(targets, definition)
  return definition
}

export class ScheduledTaskService {
  private readonly now: () => number

  constructor(
    private readonly repository: ScheduledTaskRepository,
    private readonly targets: Pick<
      AutomationRepository,
      'projectAvailable' | 'targetThreadAvailable'
    >,
    private readonly options: ScheduledTaskServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  listRange(input: Parameters<ScheduledTaskRepository['listRange']>[0]) {
    return this.repository.listRange(input)
  }

  read(id: string) {
    const task = this.repository.read(id)
    if (!task) throw new AgentError('SCHEDULED_TASK_NOT_FOUND', '计划任务不存在', 404)
    return task
  }

  async create(
    input: ScheduledTaskDefinition & { operationId: string; proposalId?: string | null },
  ) {
    const definition = prepareScheduledTaskDefinition(this.targets, input)
    const task = this.repository.create(
      {
        ...definition,
        id: `scheduled-task:${input.operationId}`,
        operationId: input.operationId,
        proposalId: input.proposalId,
      },
      this.now(),
    )
    await this.changed(task)
    await this.options.wakeScheduler?.()
    return task
  }

  async update(id: string, input: ScheduledTaskUpdate) {
    const existing = this.read(id)
    const definition = prepareScheduledTaskDefinition(this.targets, {
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
      scheduledFor: input.scheduledFor ?? existing.scheduledFor,
      timeZone: input.timeZone ?? existing.timeZone,
      notificationPolicy: input.notificationPolicy ?? existing.notificationPolicy,
    })
    const task = this.repository.update(
      id,
      {
        ...definition,
        expectedRevision: input.expectedRevision,
        status: input.status,
      },
      this.now(),
    )
    await this.changed(task)
    await this.options.wakeScheduler?.()
    return task
  }

  async removeThreadSchedules(threadId: string) {
    for (const item of this.repository.forThread(threadId))
      await this.delete(item.id, item.revision)
  }

  async delete(id: string, expectedRevision: number) {
    const task = this.repository.cancel(id, expectedRevision, this.now())
    await this.changed(task)
    await this.options.wakeScheduler?.()
    return task
  }

  async runNow(id: string, operationId: string) {
    const task = this.repository.claimManual(id, operationId, this.now())
    await this.changed(task)
    await this.options.claimed?.(task)
    await this.options.wakeScheduler?.()
    return task
  }

  private async changed(task: ScheduledTask) {
    await this.options.changed?.(task)
  }
}
