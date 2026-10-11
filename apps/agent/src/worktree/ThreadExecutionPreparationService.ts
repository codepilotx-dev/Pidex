import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EnvironmentDeltaStore } from '../local-environment/EnvironmentDeltaStore'
import type { TaskExecutionBindingService } from './TaskExecutionBindingService'

export type ProjectThreadExecution = { kind: 'local' } | { kind: 'worktree'; worktreeId: string }

/**
 * Prepares the host-owned execution identity used by project thread creation.
 * Environment copying happens before the database transaction; binding itself
 * remains a synchronous callback so ThreadService can commit it atomically with
 * the new thread and any caller-owned relationship rows.
 */
export class ThreadExecutionPreparationService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly bindings: TaskExecutionBindingService,
    private readonly environmentDeltas: EnvironmentDeltaStore,
  ) {}

  async prepare(projectId: string, execution: ProjectThreadExecution) {
    if (execution.kind === 'local') {
      const bindingId = this.bindings.allocateBindingId()
      const bind = (threadId: string) => {
        const descriptor = this.db.threadWorkspace(threadId)
        if (!descriptor) {
          throw new AgentError('CONFLICT', '项目任务工作区不可用', 409)
        }
        this.bindings.bindLocal({
          threadId,
          projectId,
          cwd: descriptor.cwd,
          bindingId,
          environmentRevision: 0,
        })
      }
      return this.prepared(projectId, execution, bindingId, bind)
    }

    const worktree = this.bindings.validateWorktree(projectId, execution.worktreeId)
    const bindingId = this.bindings.allocateBindingId()
    const environment = await this.environmentDeltas.copy(
      worktree.id,
      bindingId,
      worktree.environmentRevision,
    )
    const bind = (threadId: string) => {
      this.bindings.bindWorktree({
        threadId,
        projectId,
        worktreeId: worktree.id,
        bindingId,
        environmentRevision: environment.revision,
      })
    }
    return this.prepared(projectId, execution, bindingId, bind, true)
  }

  private prepared(
    projectId: string,
    execution: ProjectThreadExecution,
    bindingId: string,
    bind: (threadId: string) => void,
    copiedEnvironment = false,
  ) {
    let released = false
    const releaseCopiedEnvironment = async () => {
      if (!copiedEnvironment || released) return
      released = true
      await this.environmentDeltas.remove(bindingId)
    }
    return {
      bind,
      abort: releaseCopiedEnvironment,
      reconcile: async (threadId: string) => {
        const existing = this.bindings.read(threadId)
        const matches =
          execution.kind === 'local'
            ? existing?.kind === 'local' && existing.projectId === projectId
            : existing?.kind === 'worktree' &&
              existing.projectId === projectId &&
              existing.worktreeId === execution.worktreeId
        if (matches) {
          if (existing?.bindingId !== bindingId) await releaseCopiedEnvironment()
          return existing
        }
        if (existing) {
          await releaseCopiedEnvironment()
          throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已绑定其他执行位置', 409)
        }
        try {
          bind(threadId)
          return this.bindings.read(threadId)
        } catch (cause) {
          await releaseCopiedEnvironment()
          throw cause
        }
      },
    }
  }
}
