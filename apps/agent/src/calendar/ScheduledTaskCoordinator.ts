import type { ScheduledTask, ScheduledTaskStatus } from '@pidex/shared/scheduled-task'
import { AgentError } from '../Domain'
import type { ScheduledTaskRepository } from '../storage/repositories/ScheduledTaskRepository'
import type {
  AutomationExecutionBinding,
  AutomationRunExecutor,
} from '../automation/AutomationRunCoordinator'

type TerminalStatus = Extract<ScheduledTaskStatus, 'completed' | 'failed' | 'interrupted'>
type RecoverableTurnStatus = 'queued' | 'running' | 'waiting' | TerminalStatus

export type ScheduledTaskCoordinatorOptions = {
  now?: () => number
  taskChanged?: (task: ScheduledTask) => void | Promise<void>
  getTurnStatus?: (turnId: string) => RecoverableTurnStatus | null
}

export class ScheduledTaskCoordinator {
  private readonly now: () => number

  constructor(
    private readonly repository: ScheduledTaskRepository,
    private readonly executor: AutomationRunExecutor,
    private readonly options: ScheduledTaskCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  async startTasks(tasks: ScheduledTask[]) {
    await Promise.allSettled(tasks.map((task) => this.startTask(task)))
  }

  async startTask(task: ScheduledTask) {
    try {
      const preparing = this.repository.markPreparing(task.id, this.now())
      await this.changed(preparing)
      const binding = await this.executor.start(preparing, preparing)
      if (!binding) {
        await this.finish(task.id, 'completed', null)
        return
      }
      const queued = this.repository.bindExecution(task.id, binding, this.now())
      await this.changed(queued)
      const turnStatus = this.options.getTurnStatus?.(binding.turnId)
      if (turnStatus === 'running') await this.handleTurnRunning(binding.turnId)
      else if (
        turnStatus === 'completed' ||
        turnStatus === 'failed' ||
        turnStatus === 'interrupted'
      ) {
        await this.finish(
          task.id,
          turnStatus,
          turnStatus === 'completed' ? null : 'SCHEDULED_TASK_TURN_TERMINATED',
        )
      }
    } catch (cause) {
      const current = this.repository.read(task.id, true)
      if (
        cause instanceof AgentError &&
        cause.code === 'CONFLICT' &&
        current &&
        current.status !== 'claimed'
      )
        return
      await this.finish(
        task.id,
        'failed',
        cause instanceof AgentError ? cause.code : 'INTERNAL_ERROR',
      )
    }
  }

  async handleTurnTerminal(
    turnId: string,
    status: TerminalStatus,
    safeErrorCode: string | null = null,
  ) {
    const task = this.repository.findByTurn(turnId)
    if (!task) return null
    return this.finish(task.id, status, safeErrorCode)
  }

  async handleTurnRunning(turnId: string) {
    const task = this.repository.findByTurn(turnId)
    if (!task || task.status === 'running') return task
    const running = this.repository.markRunning(task.id, this.now())
    await this.changed(running)
    return running
  }

  async recover() {
    const resumed: ScheduledTask[] = []
    for (const task of this.repository.listActive()) {
      if (!task.turnId || !this.options.getTurnStatus) {
        await this.finish(task.id, 'interrupted', 'SCHEDULED_TASK_RECOVERY_INTERRUPTED')
        continue
      }
      const status = this.options.getTurnStatus(task.turnId)
      if (status === 'completed' || status === 'failed' || status === 'interrupted') {
        await this.finish(
          task.id,
          status,
          status === 'completed' ? null : 'SCHEDULED_TASK_TURN_TERMINATED',
        )
      } else if (status) resumed.push(task)
      else await this.finish(task.id, 'interrupted', 'SCHEDULED_TASK_TURN_NOT_FOUND')
    }
    const catchUps = this.repository.claimDue(this.now())
    await this.startTasks(catchUps)
    return { resumed, catchUps }
  }

  private async finish(id: string, status: TerminalStatus, safeErrorCode: string | null) {
    const task = this.repository.complete(id, status, this.now(), safeErrorCode)
    await this.changed(task)
    return task
  }

  private async changed(task: ScheduledTask) {
    await this.options.taskChanged?.(task)
  }
}
