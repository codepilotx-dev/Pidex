import { AgentError } from '../Domain'
import type { ThreadService } from '../session/ThreadService'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'
import type { ManagedWorktreeService } from '../worktree/ManagedWorktreeService'
import type { ThreadExecutionPreparationService } from '../worktree/ThreadExecutionPreparationService'
import type {
  AutomationExecutionBinding,
  AutomationRunExecutor,
  ScheduledWorkDefinition,
} from './AutomationRunCoordinator'
type ScheduledWorkRun = { id: string }
type ThreadAvailability = { targetThreadAvailable(id: string): boolean }

/** Concrete adapter that reuses the normal thread/worktree admission and binding lifecycle. */
export class ThreadAutomationRunExecutor implements AutomationRunExecutor {
  constructor(
    private readonly repository:
      Pick<AutomationRepository, 'targetThreadAvailable'> | ThreadAvailability,
    private readonly threads: ThreadService,
    private readonly worktrees: ManagedWorktreeService,
    private readonly threadExecutions: ThreadExecutionPreparationService,
  ) {}

  async start(
    automation: ScheduledWorkDefinition,
    run: ScheduledWorkRun,
  ): Promise<AutomationExecutionBinding> {
    return automation.kind === 'thread'
      ? this.continueThread(automation, run)
      : this.startStandalone(automation, run)
  }

  private async startStandalone(automation: ScheduledWorkDefinition, run: ScheduledWorkRun) {
    if (!automation.projectId || !automation.execution)
      throw new AgentError('INVALID_REQUEST', '独立自动化缺少项目或执行位置', 400)
    let worktreeId: string | null = null
    let threadCreated = false
    let prepared: Awaited<ReturnType<ThreadExecutionPreparationService['prepare']>> | null = null
    try {
      if (automation.execution.kind === 'new-worktree') {
        const result = await this.worktrees.create({
          projectId: automation.projectId,
          operationId: `automation-run:${run.id}:worktree:create`,
          startingState: { type: 'branch', branchName: automation.execution.branchName },
          snapshotMode: 'head',
        })
        worktreeId = result.worktree.id
        if (
          result.worktree.status === 'ready-with-setup-error' &&
          !result.worktree.continuedWithoutSetup
        ) {
          throw new AgentError('CONFLICT', '自动化 Worktree 环境准备失败', 409)
        }
      }
      const execution = worktreeId
        ? { kind: 'worktree' as const, worktreeId }
        : { kind: 'local' as const }
      prepared = await this.threadExecutions.prepare(automation.projectId, execution)
      let created
      try {
        created = await this.threads.create({
          title: automation.name,
          operationID: `automation-run:${run.id}:thread`,
          workspace: { kind: 'project', projectID: automation.projectId },
          settings: { taskMode: 'chat', permissionConfig: automation.permissionConfig },
          bindExecution: prepared.bind,
          creationSurface: 'working',
        })
      } catch (cause) {
        await prepared.abort()
        prepared = null
        throw cause
      }
      await prepared.reconcile(created.id)
      threadCreated = true
      prepared = null
      const turn = await this.threads.startTurn(
        created.id,
        {
          content: automation.prompt,
          model: this.model(automation),
          strategy: 'start',
          taskMode: 'chat',
          permissionConfig: automation.permissionConfig,
        },
        `automation-run:${run.id}:turn`,
      )
      return { threadId: created.id, turnId: turn.turnID, worktreeId }
    } catch (cause) {
      await prepared?.abort().catch(() => undefined)
      if (worktreeId && !threadCreated) {
        await this.worktrees
          .delete({
            worktreeId,
            operationId: `automation-run:${run.id}:worktree:rollback`,
          })
          .catch(() => undefined)
      }
      throw cause
    }
  }

  private async continueThread(automation: ScheduledWorkDefinition, run: ScheduledWorkRun) {
    const threadId = automation.targetThreadId
    if (!threadId || !this.repository.targetThreadAvailable(threadId))
      throw new AgentError('THREAD_NOT_FOUND', '自动化目标聊天不存在或已归档', 404)
    const turn = await this.threads.enqueueFollowUp(
      threadId,
      {
        content: automation.prompt,
        model: this.model(automation),
        strategy: 'queue',
        taskMode: 'chat',
        permissionConfig: automation.permissionConfig,
      },
      `automation-run:${run.id}:turn`,
    )
    return { threadId, turnId: turn.turnID, worktreeId: null }
  }

  private model(automation: ScheduledWorkDefinition): ScheduledWorkDefinition['model'] {
    return automation.reasoningEffort
      ? ({
          ...automation.model,
          variant: automation.reasoningEffort,
        } as ScheduledWorkDefinition['model'])
      : automation.model
  }
}
