import { isAbsolute, relative, resolve } from 'node:path'
import { AgentError } from '../../Domain'
import type { EnvironmentDeltaStore } from '../../local-environment/EnvironmentDeltaStore'
import type { ThreadWorkspaceResolver } from '../../workspace/ThreadWorkspaceResolver'
import type { TaskExecutionBindingService } from '../../worktree/TaskExecutionBindingService'
import type { WorktreeRepository } from '../../worktree/WorktreeRepository'

export type ForkSourceWorkspace = Awaited<ReturnType<ThreadWorkspaceResolver['resolve']>>

/** Reuses the same binding/delta rules as Handoff without moving the source task. */
export class ThreadForkWorkspaceService {
  constructor(
    private readonly resolver: ThreadWorkspaceResolver,
    private readonly bindings: TaskExecutionBindingService,
    private readonly worktrees: WorktreeRepository,
    private readonly environmentDeltas: EnvironmentDeltaStore,
  ) {}

  source(threadID: string) {
    return this.resolver.resolve(threadID)
  }

  targetWorkspace(source: ForkSourceWorkspace, cwd: string, gitBranch: string) {
    const roots = source.runtimeWorkspaceRoots.map((root) => {
      if (source.kind !== 'project') return root
      const sourceRelative = relative(source.workspaceRoot, root.path)
      return sourceRelative === '' ||
        (!sourceRelative.startsWith('..') && !isAbsolute(sourceRelative))
        ? { ...root, path: resolve(cwd, sourceRelative) }
        : root
    })
    return { cwd, roots: JSON.stringify(roots), gitBranch }
  }

  async bindSame(source: ForkSourceWorkspace, targetThreadID: string) {
    const existing = this.bindings.read(targetThreadID)
    if (existing) {
      const expectedWorktreeID =
        source.executionBinding.kind === 'worktree' ? source.executionBinding.worktreeId : null
      if (
        existing.kind !== source.executionBinding.kind ||
        existing.worktreeId !== expectedWorktreeID ||
        existing.cwd !== source.cwd
      ) {
        throw new AgentError('WORKTREE_OPERATION_CONFLICT', '分叉目标执行绑定与源工作区不一致', 409)
      }
      return existing.bindingId
    }
    const prepared = await this.prepareSame(source)
    try {
      prepared.bind(targetThreadID)
      return prepared.bindingId
    } catch (cause) {
      await prepared.cleanup()
      throw cause
    }
  }

  /** Prepare filesystem work before the caller's thread/turn transaction. */
  async prepareSame(source: ForkSourceWorkspace) {
    const targetBindingID = this.bindings.allocateBindingId()
    const environment = await this.environmentDeltas.copy(
      source.executionBinding.bindingId,
      targetBindingID,
      source.executionBinding.environmentRevision,
    )
    return {
      bindingId: targetBindingID,
      cleanup: () => this.environmentDeltas.remove(targetBindingID),
      bind: (targetThreadID: string) => {
        if (
          source.executionBinding.kind === 'worktree' &&
          source.executionBinding.projectId &&
          source.executionBinding.worktreeId
        ) {
          this.bindings.bindWorktree({
            threadId: targetThreadID,
            projectId: source.executionBinding.projectId,
            worktreeId: source.executionBinding.worktreeId,
            bindingId: targetBindingID,
            environmentRevision: environment.revision,
          })
        } else {
          this.bindings.bindLocal({
            threadId: targetThreadID,
            projectId: source.executionBinding.projectId,
            cwd: source.cwd,
            bindingId: targetBindingID,
            environmentRevision: environment.revision,
          })
        }
      },
    }
  }

  assertCurrent(source: ForkSourceWorkspace) {
    const current = this.bindings.read(source.executionBinding.threadId)
    if (
      current
        ? JSON.stringify(current) !== JSON.stringify(source.executionBinding)
        : source.executionBinding.createdAt !== 0
    )
      throw new AgentError('CONFLICT', '计划工作区绑定已变化，请刷新后重试', 409)
  }

  async bindNewWorktree(source: ForkSourceWorkspace, targetThreadID: string, worktreeID: string) {
    if (source.kind !== 'project' || !source.projectID)
      throw new AgentError('NOT_GIT', '当前任务不支持托管 worktree', 409)
    const worktree = this.worktrees.readWorktree(worktreeID)
    if (!worktree || worktree.projectId !== source.projectID)
      throw new AgentError('WORKTREE_OPERATION_CONFLICT', '分叉 worktree 不存在', 409)
    const existing = this.bindings.read(targetThreadID)
    if (existing) {
      if (
        existing.kind !== 'worktree' ||
        existing.worktreeId !== worktreeID ||
        existing.cwd !== worktree.path
      ) {
        throw new AgentError(
          'WORKTREE_OPERATION_CONFLICT',
          '分叉目标执行绑定与托管 worktree 不一致',
          409,
        )
      }
      return existing.bindingId
    }
    const targetBindingID = this.bindings.allocateBindingId()
    const environment = await this.environmentDeltas.copy(
      worktreeID,
      targetBindingID,
      worktree.environmentRevision,
    )
    try {
      this.bindings.bindWorktree({
        threadId: targetThreadID,
        projectId: source.projectID,
        worktreeId: worktreeID,
        bindingId: targetBindingID,
        environmentRevision: environment.revision,
      })
      return targetBindingID
    } catch (cause) {
      await this.environmentDeltas.remove(targetBindingID)
      throw cause
    }
  }

  removeEnvironment(bindingID: string) {
    return this.environmentDeltas.remove(bindingID)
  }
}
