import type {
  Automation,
  AutomationExecution,
  AutomationRun,
  AutomationRunStatus,
} from '@pidex/shared/automation'
import type { ModelRef } from '@pidex/shared/model'
import type { PermissionConfig } from '@pidex/shared/thread'
import { AgentError } from '../Domain'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'

type TerminalStatus = Extract<AutomationRunStatus, 'completed' | 'failed' | 'interrupted'>
type RecoverableTurnStatus = 'queued' | 'running' | 'waiting' | TerminalStatus

export type AutomationExecutionBinding = {
  threadId: string
  turnId: string
  worktreeId?: string | null
}
export type ScheduledWorkDefinition = {
  kind: Automation['kind']
  name: string
  prompt: string
  projectId: string | null
  targetThreadId: string | null
  execution: AutomationExecution | null
  model: ModelRef
  reasoningEffort: string | null
  permissionConfig: PermissionConfig
}
export type AutomationRunExecutor = {
  start(
    work: ScheduledWorkDefinition,
    run: { id: string },
  ): Promise<AutomationExecutionBinding | null>
}
export type AutomationRunCoordinatorOptions = {
  now?: () => number
  runChanged?: (run: AutomationRun) => void | Promise<void>
  getTurnStatus?: (turnId: string) => RecoverableTurnStatus | null
}

export class AutomationRunCoordinator {
  private readonly now: () => number

  constructor(
    private readonly repository: AutomationRepository,
    private readonly executor: AutomationRunExecutor,
    private readonly options: AutomationRunCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  async startRuns(runs: AutomationRun[]) {
    await Promise.allSettled(runs.map((run) => this.startRun(run)))
  }

  async startRun(run: AutomationRun) {
    const automation = this.repository.read(run.automationId)
    if (!automation) {
      await this.finish(run.id, 'failed', 'AUTOMATION_NOT_FOUND')
      return
    }
    try {
      const preparing = this.repository.markPreparing(run.id, this.now())
      await this.changed(preparing)
      const binding = await this.executor.start(automation, preparing)
      if (!binding) {
        await this.finish(run.id, 'completed', null)
        return
      }
      const queued = this.repository.bindExecution(run.id, binding, this.now())
      await this.changed(queued)
      const turnStatus = this.options.getTurnStatus?.(binding.turnId)
      if (turnStatus === 'running') await this.handleTurnRunning(binding.turnId)
      else if (
        turnStatus === 'completed' ||
        turnStatus === 'failed' ||
        turnStatus === 'interrupted'
      ) {
        await this.finish(
          run.id,
          turnStatus,
          turnStatus === 'completed' ? null : 'AUTOMATION_TURN_TERMINATED',
        )
      }
    } catch (cause) {
      const current = this.repository.readRun(run.id)
      if (
        cause instanceof AgentError &&
        cause.code === 'CONFLICT' &&
        current &&
        current.status !== 'claimed'
      )
        return
      await this.finish(
        run.id,
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
    const run = this.repository.findRunByTurn(turnId)
    if (!run) return null
    return this.finish(run.id, status, safeErrorCode)
  }

  async handleTurnRunning(turnId: string) {
    const run = this.repository.findRunByTurn(turnId)
    if (!run || run.status === 'running') return run
    const running = this.repository.markRunning(run.id, this.now())
    await this.changed(running)
    return running
  }

  async recover() {
    const resumed: AutomationRun[] = []
    for (const run of this.repository.listActiveRuns()) {
      if (!run.turnId || !this.options.getTurnStatus) {
        await this.finish(run.id, 'interrupted', 'AUTOMATION_RECOVERY_INTERRUPTED')
        continue
      }
      const status = this.options.getTurnStatus(run.turnId)
      if (status === 'completed' || status === 'failed' || status === 'interrupted') {
        await this.finish(
          run.id,
          status,
          status === 'completed' ? null : 'AUTOMATION_TURN_TERMINATED',
        )
      } else if (status) resumed.push(run)
      else await this.finish(run.id, 'interrupted', 'AUTOMATION_TURN_NOT_FOUND')
    }
    const catchUps = this.repository.claimDue(this.now(), 'startup-catch-up')
    await this.startRuns(catchUps)
    return { resumed, catchUps }
  }

  private async finish(runId: string, status: TerminalStatus, safeErrorCode: string | null) {
    const result = this.repository.completeRun(runId, status, this.now(), safeErrorCode)
    if (status === 'completed' && !result.run.threadId)
      result.run = this.repository.markRunRead(runId, this.now())
    await this.changed(result.run)
    if (result.catchUpRun) {
      await this.changed(result.catchUpRun)
      await this.startRun(result.catchUpRun)
    }
    return result.run
  }

  private async changed(run: AutomationRun) {
    await this.options.runChanged?.(run)
  }
}
