import { AgentError } from '../../Domain'
import type { ManagedWorktreeService } from '../../worktree/ManagedWorktreeService'
import type { WorktreeRepository } from '../../worktree/WorktreeRepository'
import { ConversationHistoryForkRepository } from './ConversationHistoryForkRepository'
import {
  ThreadMessageForkRepository,
  type MessageForkErrorCode,
  type MessageForkOperation,
} from './ThreadMessageForkRepository'
import { ThreadForkWorkspaceService, type ForkSourceWorkspace } from './ThreadForkWorkspaceService'

const EMPTY_OUTPUT = { cursor: 0, data: '', truncated: false, complete: true }
const ALLOWED_ERRORS = new Set<MessageForkErrorCode>([
  'FORK_OPERATION_NOT_FOUND',
  'FORK_OPERATION_CONFLICT',
  'FORK_POINT_NOT_FOUND',
  'FORK_POINT_IN_PROGRESS',
  'FORK_POINT_UNAVAILABLE',
  'HISTORY_UNSUPPORTED',
  'NOT_GIT',
  'WORKTREE_SETUP_REQUIRED',
  'WORKTREE_OPERATION_CONFLICT',
  'FORK_ABANDON_UNAVAILABLE',
  'INTERNAL_ERROR',
])

const safeError = (cause: unknown): MessageForkErrorCode => {
  if (!(cause instanceof AgentError)) return 'INTERNAL_ERROR'
  if (ALLOWED_ERRORS.has(cause.code as MessageForkErrorCode))
    return cause.code as MessageForkErrorCode
  if (cause.code === 'WORKTREE_SETUP_REQUIRED') return 'WORKTREE_SETUP_REQUIRED'
  if (cause.code.startsWith('WORKTREE_')) return 'WORKTREE_OPERATION_CONFLICT'
  return 'INTERNAL_ERROR'
}

/** Coordinates a non-destructive, message-bounded fork. Source admission stays open. */
export class ThreadMessageForkService {
  private readonly inFlight = new Map<
    string,
    { requestKey: string; promise: Promise<MessageForkOperation> }
  >()

  constructor(
    private readonly operations: ThreadMessageForkRepository,
    private readonly history: ConversationHistoryForkRepository,
    private readonly workspaces: ThreadForkWorkspaceService,
    private readonly worktrees: ManagedWorktreeService,
    private readonly worktreeRepository: WorktreeRepository,
  ) {}

  pending(sourceThreadID: string, sourceTurnID: string, sourceItemID: string) {
    return this.operations.pending(sourceThreadID, sourceTurnID, sourceItemID)
  }

  start(input: {
    operationID: string
    sourceThreadID: string
    sourceTurnID: string
    sourceItemID: string
    destination: { kind: 'same-worktree' } | { kind: 'new-worktree' }
  }) {
    const requestKey = JSON.stringify(input)
    const existing = this.inFlight.get(input.operationID)
    if (existing) {
      if (existing.requestKey !== requestKey)
        throw new AgentError('FORK_OPERATION_CONFLICT', 'operationId 已用于其他分叉请求', 409)
      return Promise.resolve(this.operations.get(input.operationID))
    }
    const persisted = this.operations.find(input.operationID)
    const requestHash = ThreadMessageForkRepository.requestHash({
      sourceThreadID: input.sourceThreadID,
      sourceTurnID: input.sourceTurnID,
      sourceItemID: input.sourceItemID,
      destinationKind: input.destination.kind,
    })
    if (persisted) {
      return Promise.resolve(
        this.operations.create({
          operationID: input.operationID,
          sourceThreadID: input.sourceThreadID,
          sourceTurnID: input.sourceTurnID,
          sourceItemID: input.sourceItemID,
          destinationKind: input.destination.kind,
          requestHash,
        }),
      )
    }
    const preflight = this.operations.preflight(
      input.sourceThreadID,
      input.sourceTurnID,
      input.sourceItemID,
    )
    const operation = this.operations.create({
      operationID: input.operationID,
      sourceThreadID: input.sourceThreadID,
      sourceTurnID: input.sourceTurnID,
      sourceItemID: input.sourceItemID,
      destinationKind: input.destination.kind,
      requestHash,
    })
    if (operation.status !== 'running') return Promise.resolve(operation)
    const owned = this.startOwned(input, operation, preflight)
    const tracked = owned
      .catch(() => this.operations.get(input.operationID))
      .finally(() => {
        if (this.inFlight.get(input.operationID)?.promise === tracked)
          this.inFlight.delete(input.operationID)
      })
    this.inFlight.set(input.operationID, { requestKey, promise: tracked })
    return Promise.resolve(operation)
  }

  private async startOwned(
    input: {
      operationID: string
      sourceThreadID: string
      sourceTurnID: string
      sourceItemID: string
      destination: { kind: 'same-worktree' } | { kind: 'new-worktree' }
    },
    operation: MessageForkOperation,
    preflight: ReturnType<ThreadMessageForkRepository['preflight']>,
  ) {
    try {
      const source = await this.workspaces.source(input.sourceThreadID)
      const worktreeSnapshotMode = preflight.active ? ('head' as const) : ('working-tree' as const)
      const snapshotMode =
        input.destination.kind === 'same-worktree' ? ('shared' as const) : worktreeSnapshotMode
      operation = this.operations.update(input.operationID, operation.revision, {
        snapshotMode,
        step: input.destination.kind === 'same-worktree' ? 'fork-history' : 'prepare-worktree',
      })
      if (input.destination.kind === 'new-worktree') {
        if (source.kind !== 'project' || !source.projectID)
          throw new AgentError('NOT_GIT', '当前任务不是本地 Git 项目', 409)
        const childOperationID = `${input.operationID}:create`
        operation = this.operations.update(input.operationID, operation.revision, {
          step: 'setup',
        })
        const createPromise = this.worktrees.create({
          projectId: source.projectID,
          operationId: childOperationID,
          startingState: { type: 'working-tree' },
          sourceWorkspacePath: source.workspaceRoot,
          snapshotMode: worktreeSnapshotMode,
        })
        operation = this.linkChildOperation(input.operationID, childOperationID) ?? operation
        const created = await createPromise
        operation = this.operations.update(input.operationID, operation.revision, {
          targetWorktreeID: created.worktree.id,
        })
        if (
          created.worktree.status === 'ready-with-setup-error' &&
          !created.worktree.continuedWithoutSetup
        ) {
          return this.operations.update(input.operationID, operation.revision, {
            status: 'awaiting-setup-decision',
            errorCode: 'WORKTREE_SETUP_REQUIRED',
          })
        }
      }
      return await this.finish(input.operationID, source, preflight.gitBranch)
    } catch (cause) {
      this.linkChildOperation(input.operationID, `${input.operationID}:create`)
      this.history.rollback(input.operationID)
      this.operations.fail(input.operationID, safeError(cause))
      throw cause
    }
  }

  private async finish(operationID: string, source?: ForkSourceWorkspace, gitBranch?: string) {
    let operation = this.operations.get(operationID)
    const runtime = source ?? (await this.workspaces.source(operation.sourceThreadId))
    const branch =
      gitBranch ??
      this.operations.preflight(
        operation.sourceThreadId,
        operation.sourceTurnId,
        operation.sourceItemId,
      ).gitBranch
    const worktree = operation.targetWorktreeId
      ? this.worktreeRepository.readWorktree(operation.targetWorktreeId)
      : null
    const targetCwd = worktree?.path ?? runtime.cwd
    if (operation.step !== 'fork-history') {
      operation = this.operations.update(operationID, operation.revision, {
        step: 'fork-history',
        status: 'running',
        errorCode: null,
      })
    }
    const fork = await this.history.forkThrough(operation.sourceThreadId, {
      operationID,
      throughTurnID: operation.sourceTurnId,
      sourceItemID: operation.sourceItemId,
      targetWorkspace: this.workspaces.targetWorkspace(runtime, targetCwd, branch),
      visible: false,
    })
    operation = this.operations.update(operationID, operation.revision, {
      targetThreadID: fork.targetThreadID,
      step: 'bind-target',
    })
    let bindingID: string | null = null
    try {
      bindingID = worktree
        ? await this.workspaces.bindNewWorktree(runtime, fork.targetThreadID, worktree.id)
        : await this.workspaces.bindSame(runtime, fork.targetThreadID)
      await this.history.publishTarget(operationID, fork.targetThreadID)
      return this.operations.update(operationID, operation.revision, {
        status: 'completed',
        step: 'complete',
        errorCode: null,
        completed: true,
      })
    } catch (cause) {
      this.history.rollback(operationID)
      if (bindingID) await this.workspaces.removeEnvironment(bindingID)
      throw cause
    }
  }

  retrySetup(operationID: string, expectedRevision: number) {
    const operation = this.operations.get(operationID)
    if (
      operation.revision !== expectedRevision ||
      operation.status !== 'awaiting-setup-decision' ||
      !operation.targetWorktreeId
    ) {
      throw new AgentError('FORK_OPERATION_CONFLICT', '分叉 setup 状态已变化', 409)
    }
    void this.retrySetupOwned(operationID, expectedRevision).catch(() => undefined)
    return Promise.resolve(this.operations.get(operationID))
  }

  private async retrySetupOwned(operationID: string, expectedRevision: number) {
    let operation = this.operations.get(operationID)
    if (
      operation.revision !== expectedRevision ||
      operation.status !== 'awaiting-setup-decision' ||
      !operation.targetWorktreeId
    ) {
      throw new AgentError('FORK_OPERATION_CONFLICT', '分叉 setup 状态已变化', 409)
    }
    const childOperationID = `${operationID}:retry:${expectedRevision}`
    operation = this.operations.update(operationID, operation.revision, {
      status: 'running',
      step: 'setup',
      errorCode: null,
    })
    const source = await this.workspaces.source(operation.sourceThreadId)
    let result: Awaited<ReturnType<ManagedWorktreeService['retrySetup']>>
    try {
      const retryPromise = this.worktrees.retrySetup({
        worktreeId: operation.targetWorktreeId!,
        operationId: childOperationID,
        sourceWorkspacePath: source.workspaceRoot,
      })
      operation = this.linkChildOperation(operationID, childOperationID) ?? operation
      result = await retryPromise
    } catch (cause) {
      this.linkChildOperation(operationID, childOperationID)
      this.operations.fail(operationID, safeError(cause))
      throw cause
    }
    if (result.worktree.status === 'ready-with-setup-error') {
      return this.operations.update(operationID, operation.revision, {
        status: 'awaiting-setup-decision',
        errorCode: 'WORKTREE_SETUP_REQUIRED',
      })
    }
    return this.finish(operationID, source)
  }

  continueWithoutSetup(operationID: string, expectedRevision: number) {
    const operation = this.operations.get(operationID)
    if (
      operation.revision !== expectedRevision ||
      operation.status !== 'awaiting-setup-decision' ||
      !operation.targetWorktreeId
    ) {
      throw new AgentError('FORK_OPERATION_CONFLICT', '分叉 setup 状态已变化', 409)
    }
    void this.continueWithoutSetupOwned(operationID, expectedRevision).catch(() => undefined)
    return Promise.resolve(this.operations.get(operationID))
  }

  private async continueWithoutSetupOwned(operationID: string, expectedRevision: number) {
    let operation = this.operations.get(operationID)
    if (
      operation.revision !== expectedRevision ||
      operation.status !== 'awaiting-setup-decision' ||
      !operation.targetWorktreeId
    ) {
      throw new AgentError('FORK_OPERATION_CONFLICT', '分叉 setup 状态已变化', 409)
    }
    const childOperationID = `${operationID}:continue:${expectedRevision}`
    operation = this.operations.update(operationID, operation.revision, {
      status: 'running',
      step: 'setup',
      errorCode: null,
    })
    try {
      const continuePromise = Promise.resolve(
        this.worktrees.continueWithoutSetup({
          worktreeId: operation.targetWorktreeId!,
          operationId: childOperationID,
        }),
      )
      operation = this.linkChildOperation(operationID, childOperationID) ?? operation
      await continuePromise
    } catch (cause) {
      this.linkChildOperation(operationID, childOperationID)
      this.operations.fail(operationID, safeError(cause))
      throw cause
    }
    operation = this.operations.update(operationID, operation.revision, {
      warning: '已跳过 worktree setup，环境可能未完整初始化',
    })
    return this.finish(operationID)
  }

  abandon(operationID: string, expectedRevision: number) {
    const operation = this.operations.get(operationID)
    if (
      operation.revision !== expectedRevision ||
      operation.targetThreadId ||
      !operation.targetWorktreeId ||
      (operation.status !== 'awaiting-setup-decision' && operation.status !== 'failed')
    ) {
      throw new AgentError('FORK_ABANDON_UNAVAILABLE', '当前分叉操作不能放弃', 409)
    }
    void this.abandonOwned(operationID, expectedRevision).catch(() => undefined)
    return Promise.resolve(this.operations.get(operationID))
  }

  private async abandonOwned(operationID: string, expectedRevision: number) {
    let operation = this.operations.get(operationID)
    if (
      operation.revision !== expectedRevision ||
      operation.targetThreadId ||
      !operation.targetWorktreeId ||
      (operation.status !== 'awaiting-setup-decision' && operation.status !== 'failed')
    ) {
      throw new AgentError('FORK_ABANDON_UNAVAILABLE', '当前分叉操作不能放弃', 409)
    }
    const worktree = this.worktreeRepository.readWorktree(operation.targetWorktreeId)
    if (!worktree || worktree.boundOnce || worktree.permanent) {
      throw new AgentError('FORK_ABANDON_UNAVAILABLE', '分叉 worktree 已被使用或受保护', 409)
    }
    const childOperationID = `${operationID}:abandon:${expectedRevision}`
    operation = this.operations.update(operationID, operation.revision, {
      status: 'running',
    })
    try {
      const deletePromise = this.worktrees.delete({
        worktreeId: worktree.id,
        operationId: childOperationID,
      })
      operation = this.linkChildOperation(operationID, childOperationID) ?? operation
      await deletePromise
    } catch (cause) {
      this.linkChildOperation(operationID, childOperationID)
      this.operations.fail(operationID, safeError(cause))
      throw cause
    }
    return this.operations.update(operationID, operation.revision, {
      status: 'abandoned',
      errorCode: null,
      completed: true,
    })
  }

  async status(
    operationID: string,
    afterRevision?: number,
    waitMs?: number,
    afterOutputCursor = 0,
  ) {
    const boundedWait = Math.max(0, Math.min(30_000, Math.trunc(waitMs ?? 0)))
    const deadline = Date.now() + boundedWait
    while (true) {
      const status = await this.operations.status(operationID, afterRevision, 0)
      const childOperationID = this.operations.worktreeOperationID(operationID)
      let output = EMPTY_OUTPUT
      if (childOperationID) {
        try {
          output = this.worktrees.operationStatus(childOperationID, afterOutputCursor).output
        } catch {
          // Output is intentionally ephemeral; durable fork state remains readable.
        }
      }
      if (
        status.changed ||
        output.cursor > afterOutputCursor ||
        boundedWait === 0 ||
        Date.now() >= deadline ||
        status.operation.status !== 'running'
      ) {
        return { ...status, output }
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))),
      )
    }
  }

  async recover(operationID: string) {
    let operation = this.operations.get(operationID)
    if (operation.status !== 'running') return operation
    try {
      const linkedChildID = this.operations.worktreeOperationID(operationID)
      if (linkedChildID) this.settleInterruptedChild(linkedChildID)
      if (operation.destinationKind === 'new-worktree' && !operation.targetWorktreeId) {
        const childOperationID = linkedChildID ?? `${operationID}:create`
        const child = this.worktreeRepository.operation(childOperationID)
        if (!child?.worktreeId)
          return this.operations.fail(operationID, 'WORKTREE_OPERATION_CONFLICT')
        operation = this.operations.update(operationID, operation.revision, {
          targetWorktreeID: child.worktreeId,
          worktreeOperationID: childOperationID,
        })
      }
      if (operation.targetWorktreeId) {
        const worktree = this.worktreeRepository.readWorktree(operation.targetWorktreeId)
        if (worktree?.status === 'ready-with-setup-error' && !worktree.continuedWithoutSetup) {
          return this.operations.update(operationID, operation.revision, {
            status: 'awaiting-setup-decision',
            step: 'setup',
            errorCode: 'WORKTREE_SETUP_REQUIRED',
          })
        }
        if (
          !worktree ||
          (worktree.status !== 'ready' && worktree.status !== 'ready-with-setup-error')
        ) {
          return this.operations.fail(operationID, 'WORKTREE_OPERATION_CONFLICT')
        }
      }
      return await this.finish(operationID)
    } catch {
      this.history.rollback(operationID)
      return this.operations.fail(operationID, 'INTERNAL_ERROR')
    }
  }

  private linkChildOperation(operationID: string, childOperationID: string) {
    const child = this.worktreeRepository.operation(childOperationID)
    const current = this.operations.find(operationID)
    if (!child || !current || current.status !== 'running') return current
    return this.operations.update(operationID, current.revision, {
      worktreeOperationID: childOperationID,
      ...(child.worktreeId ? { targetWorktreeID: child.worktreeId } : {}),
    })
  }

  private settleInterruptedChild(childOperationID: string) {
    const child = this.worktreeRepository.operation(childOperationID)
    if (child?.status !== 'running') return child
    return this.worktreeRepository.updateOperation(childOperationID, {
      status: 'failed',
      errorCode: 'WORKTREE_OPERATION_INTERRUPTED',
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
  }
}
