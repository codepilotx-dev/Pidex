import { randomUUID } from 'node:crypto'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { ThreadWorkspaceResolver } from '../workspace/ThreadWorkspaceResolver'
import type { TaskExecutionBindingService } from '../worktree/TaskExecutionBindingService'
import type { WorktreeRepository } from '../worktree/WorktreeRepository'
import type { HandoffRepository } from './HandoffRepository'
import type { ExecutionContext, HandoffWorkspacePort } from './HandoffService'
import type { EnvironmentDeltaStore } from '../local-environment/EnvironmentDeltaStore'

type RuntimeProject = {
  id: string
  rootPath?: string
  primaryFolderId?: string
  folders?: Array<{
    id: string
    path: string
    role: 'primary' | 'secondary'
    availability?: string
  }>
}

const projectRoot = (project: RuntimeProject | null) => {
  if (!project) return null
  const folders = project.folders?.filter((folder) => folder.availability !== 'missing') ?? []
  return (
    folders.find((folder) => folder.id === project.primaryFolderId)?.path ??
    folders.find((folder) => folder.role === 'primary')?.path ??
    project.rootPath ??
    null
  )
}

/** Adapts durable execution bindings to the Handoff domain without changing thread cwd in place. */
export class BindingHandoffWorkspace implements HandoffWorkspacePort {
  constructor(
    private readonly db: AgentDatabase,
    private readonly resolver: ThreadWorkspaceResolver,
    private readonly bindings: TaskExecutionBindingService,
    private readonly worktreeRepository: WorktreeRepository,
    private readonly operations: HandoffRepository,
    private readonly environmentDeltas: EnvironmentDeltaStore,
  ) {}

  async source(threadID: string) {
    return this.fromResolved(threadID, await this.resolver.resolve(threadID))
  }

  async prepareDestination(input: Parameters<HandoffWorkspacePort['prepareDestination']>[0]) {
    if (input.destination.kind === 'local') {
      const root = projectRoot(this.db.getProject(input.source.projectID) as RuntimeProject | null)
      if (!root) throw new AgentError('DESTINATION_UNAVAILABLE', '项目本地工作目录不可用', 409)
      return this.destinationContext(input.source, 'local', root)
    }
    const worktree = this.worktreeRepository.readWorktree(input.destination.worktreeID)
    if (
      !worktree ||
      worktree.projectId !== input.source.projectID ||
      worktree.status === 'cleaned'
    ) {
      throw new AgentError('DESTINATION_UNAVAILABLE', 'Handoff 目标 worktree 不存在', 409)
    }
    if (worktree.status === 'ready-with-setup-error' && !worktree.continuedWithoutSetup) {
      throw new AgentError('DESTINATION_UNAVAILABLE', 'Handoff 目标 setup 尚未成功或明确跳过', 409)
    }
    if (worktree.status !== 'ready' && worktree.status !== 'ready-with-setup-error') {
      throw new AgentError('DESTINATION_UNAVAILABLE', 'Handoff 目标 worktree 尚未就绪', 409)
    }
    return this.destinationContext(input.source, 'worktree', worktree.path, worktree.id)
  }

  async bindTarget(input: Parameters<HandoffWorkspacePort['bindTarget']>[0]) {
    if (input.destination.kind === 'worktree' && input.destination.worktreeID) {
      const worktree = this.worktreeRepository.readWorktree(input.destination.worktreeID)
      if (!worktree) throw new AgentError('WORKTREE_NOT_FOUND', 'Handoff 目标 worktree 不存在', 404)
      const bindingId = this.bindings.allocateBindingId()
      const environment = await this.environmentDeltas.copy(
        input.destination.worktreeID,
        bindingId,
        worktree.environmentRevision,
      )
      try {
        this.bindings.bindWorktree({
          threadId: input.targetThreadID,
          projectId: input.source.projectID,
          worktreeId: input.destination.worktreeID,
          bindingId,
          environmentRevision: environment.revision,
        })
        this.operations.recordTargetBinding(input.operationID, bindingId)
      } catch (cause) {
        await this.environmentDeltas.remove(bindingId)
        throw cause
      }
      return
    }
    const bindingId = this.bindings.allocateBindingId()
    // A worktree setup delta is cwd-specific and must never cross back into the
    // repository's local checkout. The local target starts with a safe empty
    // environment; its own trusted setup can populate this binding later.
    const environment =
      input.source.kind === 'worktree'
        ? { revision: 0 }
        : await this.environmentDeltas.copy(input.source.bindingID, bindingId)
    try {
      this.bindings.bindLocal({
        threadId: input.targetThreadID,
        projectId: input.source.projectID,
        cwd: input.destination.cwd,
        bindingId,
        environmentRevision: environment.revision,
      })
      this.operations.recordTargetBinding(input.operationID, bindingId)
    } catch (cause) {
      await this.environmentDeltas.remove(bindingId)
      throw cause
    }
  }

  async recover(input: Parameters<HandoffWorkspacePort['recover']>[0]) {
    const source = await this.source(input.sourceThreadID)
    const intended = this.operations.destination(input.operationID)
    if (input.targetThreadID && this.bindings.read(input.targetThreadID)) {
      try {
        const destination = await this.source(input.targetThreadID)
        const matches =
          intended.kind === 'local'
            ? destination.kind === 'local'
            : destination.kind === 'worktree' && destination.worktreeID === intended.worktreeID
        if (matches) return { source, destination }
      } catch {
        // A crash can happen after the hidden fork is inserted but before its binding is written.
      }
    }
    const destination = await this.prepareDestination({
      operationID: input.operationID,
      source,
      destination: intended,
    })
    return { source, destination }
  }

  async rollbackPreparation(operationID: string) {
    // Handoff only consumes an already managed worktree. It never owns or deletes
    // a user-selected destination during rollback. The hidden target row is
    // deleted by ThreadForkRepository; remove its non-durable env file here.
    const bindingID = this.operations.targetBindingID(operationID)
    if (bindingID) await this.environmentDeltas.remove(bindingID)
  }

  async finalize(_operationID: string) {
    // Stash finalization belongs to GitHandoffCoordinator; binding state is durable.
  }

  private fromResolved(
    threadID: string,
    runtime: Awaited<ReturnType<ThreadWorkspaceResolver['resolve']>>,
  ): ExecutionContext {
    if (runtime.kind !== 'project' || !runtime.projectID) {
      throw new AgentError('NOT_GIT', '无项目任务不支持 Handoff', 409)
    }
    return {
      threadID,
      bindingID: runtime.executionBinding.bindingId,
      kind: runtime.executionBinding.kind,
      cwd: runtime.cwd,
      workspaceRootsJson: JSON.stringify(runtime.runtimeWorkspaceRoots),
      projectID: runtime.projectID,
      ...(runtime.executionBinding.worktreeId
        ? { worktreeID: runtime.executionBinding.worktreeId }
        : {}),
    }
  }

  private destinationContext(
    source: ExecutionContext,
    kind: 'local' | 'worktree',
    cwd: string,
    worktreeID?: string,
  ): ExecutionContext {
    const roots = JSON.parse(source.workspaceRootsJson) as Array<{
      folderId: string
      path: string
      role: 'primary' | 'secondary'
    }>
    const mapped = roots.map((root) => (root.role === 'primary' ? { ...root, path: cwd } : root))
    return {
      threadID: source.threadID,
      bindingID: `handoff:${randomUUID()}`,
      kind,
      cwd,
      workspaceRootsJson: JSON.stringify(mapped),
      projectID: source.projectID,
      ...(worktreeID ? { worktreeID } : {}),
    }
  }
}
