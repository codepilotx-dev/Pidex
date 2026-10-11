import type { HandoffErrorCode } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import {
  GitHandoffCoordinator,
  type GitHandoffPlan,
  type GitHandoffResult,
} from './GitHandoffCoordinator'
import { HandoffRepository, type HandoffDirection } from './HandoffRepository'
import { ThreadForkRepository } from './ThreadForkRepository'

export type ExecutionContext = {
  threadID: string
  bindingID: string
  kind: 'local' | 'worktree'
  cwd: string
  workspaceRootsJson: string
  projectID: string
  worktreeID?: string
}

export interface HandoffWorkspacePort {
  source(threadID: string): Promise<ExecutionContext>
  prepareDestination(input: {
    operationID: string
    source: ExecutionContext
    destination: { kind: 'local' } | { kind: 'worktree'; worktreeID: string }
  }): Promise<ExecutionContext & { createdForOperation?: boolean }>
  bindTarget(input: {
    operationID: string
    source: ExecutionContext
    destination: ExecutionContext
    targetThreadID: string
  }): Promise<void>
  recover(input: {
    operationID: string
    sourceThreadID: string
    targetThreadID: string | null
    direction: HandoffDirection
  }): Promise<{ source: ExecutionContext; destination: ExecutionContext }>
  rollbackPreparation(operationID: string): Promise<void>
  finalize(operationID: string): Promise<void>
}

export interface HandoffLifecyclePort {
  /** Rejects queued follow-ups and pending approval/question/checkpoint/subagent state. */
  preflight(threadID: string): Promise<void>
  /** Stops and waits for an active turn to terminalize. No-op when already idle. */
  stopSource(threadID: string): Promise<void>
  /**
   * Waits for the renderer's typed Electron close-before-start handshake. The
   * Agent has no direct Electron authority and must not pretend it killed a PTY.
   */
  closeTerminal(threadID: string): Promise<void>
}

const HANDOFF_CODES = new Set<HandoffErrorCode>([
  'HANDOFF_IN_PROGRESS',
  'SOURCE_ACTIVE',
  'QUEUE_NOT_EMPTY',
  'PENDING_INTERACTION',
  'NOT_GIT',
  'LOCAL_DETACHED',
  'WORKTREE_DETACHED',
  'DEFAULT_BRANCH',
  'BRANCH_IN_USE',
  'DESTINATION_DIRTY',
  'HEAD_MISMATCH',
  'STASH_FAILED',
  'CHECKOUT_FAILED',
  'APPLY_FAILED',
  'HISTORY_UNSUPPORTED',
  'CLIENT_TRANSFER_REQUIRED',
  'ROLLBACK_FAILED',
  'DESTINATION_UNAVAILABLE',
])

const errorCode = (cause: unknown): HandoffErrorCode =>
  cause instanceof AgentError && HANDOFF_CODES.has(cause.code as HandoffErrorCode)
    ? (cause.code as HandoffErrorCode)
    : 'HISTORY_UNSUPPORTED'

export class HandoffService {
  private readonly inFlight = new Map<
    string,
    {
      requestKey: string
      promise: Promise<ReturnType<HandoffRepository['get']>>
    }
  >()

  constructor(
    private readonly operations: HandoffRepository,
    private readonly forks: ThreadForkRepository,
    private readonly workspaces: HandoffWorkspacePort,
    private readonly lifecycle: HandoffLifecyclePort,
    private readonly git: GitHandoffCoordinator = new GitHandoffCoordinator(),
  ) {}

  assertAdmissionOpen(threadID: string) {
    this.operations.assertAdmissionOpen(threadID)
  }

  pending(sourceThreadID: string) {
    return this.operations.pending(sourceThreadID)
  }

  start(input: {
    operationID: string
    sourceThreadID: string
    destination: { kind: 'local' } | { kind: 'worktree'; worktreeID: string }
  }) {
    const requestKey = JSON.stringify({
      sourceThreadID: input.sourceThreadID,
      destination: input.destination,
    })
    const existing = this.inFlight.get(input.operationID)
    if (existing) {
      if (existing.requestKey !== requestKey)
        throw new AgentError('CONFLICT', 'operationId 已用于其他 Handoff 请求', 409)
      return existing.promise
    }
    const owned = this.startOwned(input)
    const tracked = owned.finally(() => {
      if (this.inFlight.get(input.operationID)?.promise === tracked)
        this.inFlight.delete(input.operationID)
    })
    this.inFlight.set(input.operationID, { requestKey, promise: tracked })
    return tracked
  }

  private async startOwned(input: {
    operationID: string
    sourceThreadID: string
    destination: { kind: 'local' } | { kind: 'worktree'; worktreeID: string }
  }) {
    // Request replay is not startup recovery. It must not need the workspace to
    // remain resolvable, and it must never start or roll back a second Git flow.
    const persisted = this.operations.find(input.operationID)
    if (persisted) {
      const requestHash = HandoffRepository.requestHash({
        sourceThreadID: input.sourceThreadID,
        direction: persisted.direction,
        ...(input.destination.kind === 'worktree'
          ? { destinationID: input.destination.worktreeID }
          : {}),
      })
      return this.operations.create({
        operationID: input.operationID,
        sourceThreadID: input.sourceThreadID,
        direction: persisted.direction,
        destination: input.destination,
        requestHash,
      })
    }
    const source = await this.workspaces.source(input.sourceThreadID)
    if (source.kind === input.destination.kind)
      throw new AgentError('CONFLICT', 'Handoff 目标必须与当前执行位置不同', 409)
    const direction: HandoffDirection =
      source.kind === 'local' ? 'local-to-worktree' : 'worktree-to-local'
    const requestHash = HandoffRepository.requestHash({
      sourceThreadID: input.sourceThreadID,
      direction,
      ...(input.destination.kind === 'worktree'
        ? { destinationID: input.destination.worktreeID }
        : {}),
    })
    const request = {
      operationID: input.operationID,
      sourceThreadID: input.sourceThreadID,
      direction,
      destination: input.destination,
      sourceBindingID: source.bindingID,
      requestHash,
    }
    let operation = this.operations.create(request)
    let plan: GitHandoffPlan | null = null
    let transfer: GitHandoffResult | null = null
    let gitPrepared = false
    try {
      await this.lifecycle.preflight(input.sourceThreadID)
      operation = this.operations.advance(input.operationID, 'stop-source')
      await this.lifecycle.stopSource(input.sourceThreadID)
      await this.lifecycle.closeTerminal(input.sourceThreadID)
      this.forks.assertForkable(input.sourceThreadID)

      operation = this.operations.advance(input.operationID, 'prepare-destination')
      const destination = await this.workspaces.prepareDestination({
        operationID: input.operationID,
        source,
        destination: input.destination,
      })
      if (destination.createdForOperation)
        operation = this.operations.advance(input.operationID, 'prepare-destination', {
          journal: { destinationCreated: true },
        })
      plan = await this.git.inspect(direction, source.cwd, destination.cwd)
      const preparedJournal = this.git.createJournal(plan)
      operation = this.operations.checkpointJournal(input.operationID, preparedJournal)
      gitPrepared = true
      transfer = await this.git.transfer(
        plan,
        (step, journal) => {
          operation = this.operations.advance(input.operationID, step, { journal })
        },
        preparedJournal,
      )
      for (const warning of transfer.warnings)
        operation = this.operations.advance(input.operationID, 'apply-source-changes', { warning })

      operation = this.operations.advance(input.operationID, 'fork-conversation')
      const fork = await this.forks.fork(input.sourceThreadID, {
        operationID: input.operationID,
        targetWorkspace: {
          cwd: destination.cwd,
          roots: destination.workspaceRootsJson,
          gitBranch: plan.sourceBranch,
        },
      })
      operation = this.operations.advance(input.operationID, 'transfer-core-state', {
        targetThreadID: fork.targetThreadID,
      })
      await this.workspaces.bindTarget({
        operationID: input.operationID,
        source,
        destination,
        targetThreadID: fork.targetThreadID,
      })
      operation = this.operations.advance(input.operationID, 'await-client-transfer')
      return operation
    } catch (cause) {
      let rollbackFailed = false
      try {
        this.forks.rollback(input.operationID)
      } catch {
        rollbackFailed = true
      }
      if (plan && gitPrepared)
        rollbackFailed =
          !(await this.git.rollback(
            plan,
            transfer?.journal ?? this.operations.journal(input.operationID),
          )) || rollbackFailed
      try {
        await this.workspaces.rollbackPreparation(input.operationID)
      } catch {
        rollbackFailed = true
      }
      this.operations.fail(input.operationID, errorCode(cause), rollbackFailed)
      if (rollbackFailed)
        throw new AgentError('ROLLBACK_FAILED', 'Handoff 回滚未完整完成；所有 stash 均已保留', 500)
      throw cause
    }
  }

  status(operationID: string, afterRevision?: number, waitMs?: number) {
    return this.operations.status(operationID, afterRevision, waitMs)
  }

  async acknowledgeClientTransfer(operationID: string, revision: number) {
    // This transaction is the visibility boundary: target becomes listable and
    // source becomes archived only after renderer-local state was copied.
    const before = this.operations.get(operationID)
    const journal = this.operations.journal(operationID)
    if (before.status !== 'completed')
      this.operations.completeAfterClientTransfer(operationID, revision)
    try {
      const contexts = await this.workspaces.recover({
        operationID,
        sourceThreadID: before.sourceThreadId,
        targetThreadID: before.targetThreadId,
        direction: before.direction,
      })
      for (const warning of await this.git.finalize(contexts.source.cwd, journal))
        this.operations.appendWarning(operationID, warning)
      await this.workspaces.finalize(operationID)
      this.operations.clearJournal(operationID)
    } catch {
      this.operations.appendWarning(operationID, 'Handoff 已完成，但清理状态需要稍后重试')
    }
    return this.operations.get(operationID)
  }

  /**
   * Startup recovery chooses safety over replaying partially completed Git
   * mutations: it rolls them back from the durable journal, removes any hidden
   * fork, and makes the operation terminal. Calling it repeatedly is harmless.
   */
  async recover(operationID: string) {
    const operation = this.operations.get(operationID)
    if (operation.status !== 'running') return operation
    let rollbackFailed = false
    try {
      const contexts = await this.workspaces.recover({
        operationID,
        sourceThreadID: operation.sourceThreadId,
        targetThreadID: operation.targetThreadId,
        direction: operation.direction,
      })
      const journal = this.operations.journal(operationID)
      if (
        journal.sourceHead &&
        !(await this.git.recover({
          direction: operation.direction,
          sourceCwd: contexts.source.cwd,
          destinationCwd: contexts.destination.cwd,
          journal,
        }))
      )
        rollbackFailed = true
      this.forks.rollback(operationID)
      await this.workspaces.rollbackPreparation(operationID)
    } catch {
      rollbackFailed = true
    }
    return this.operations.fail(
      operationID,
      rollbackFailed ? 'ROLLBACK_FAILED' : 'HANDOFF_IN_PROGRESS',
      rollbackFailed,
    )
  }
}
