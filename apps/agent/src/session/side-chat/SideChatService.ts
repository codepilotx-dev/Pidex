import { AgentError } from '../../Domain'
import type { ThreadService } from '../ThreadService'
import type { ConversationHistoryForkRepository } from '../fork/ConversationHistoryForkRepository'
import type { ThreadForkWorkspaceService } from '../fork/ThreadForkWorkspaceService'
import type {
  SideChatRepository,
  StoredSideChat,
} from '../../storage/repositories/SideChatRepository'
import type { TaskExecutionBindingService } from '../../worktree/TaskExecutionBindingService'

export class SideChatService {
  private readonly inFlight = new Map<
    string,
    { requestKey: string; promise: Promise<ReturnType<SideChatService['descriptor']>> }
  >()

  constructor(
    private readonly repository: SideChatRepository,
    private readonly history: ConversationHistoryForkRepository,
    private readonly workspaces: ThreadForkWorkspaceService,
    private readonly threads: ThreadService,
    private readonly executionBindings: TaskExecutionBindingService,
    private readonly prepareThreadCleanup?: (threadID: string) => () => Promise<void>,
  ) {}

  create(input: { sourceThreadID: string; referenceText?: string; operationID: string }) {
    const requestKey = JSON.stringify({
      sourceThreadID: input.sourceThreadID,
      referenceText: input.referenceText ?? null,
    })
    const existing = this.repository.findByOperation(input.operationID)
    if (existing) {
      if (
        existing.sourceThreadID !== input.sourceThreadID ||
        existing.referenceText !== (input.referenceText ?? null)
      ) {
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他侧边聊天', 409)
      }
      return Promise.resolve(this.descriptor(existing))
    }

    const inFlight = this.inFlight.get(input.operationID)
    if (inFlight) {
      if (inFlight.requestKey !== requestKey)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他侧边聊天', 409)
      return inFlight.promise
    }
    const owned = this.createOwned(input)
    const tracked = owned.finally(() => {
      if (this.inFlight.get(input.operationID)?.promise === tracked)
        this.inFlight.delete(input.operationID)
    })
    this.inFlight.set(input.operationID, { requestKey, promise: tracked })
    return tracked
  }

  private async createOwned(input: {
    sourceThreadID: string
    referenceText?: string
    operationID: string
  }) {
    const source = await this.workspaces.source(input.sourceThreadID)
    const fork = await this.history.forkLatestForSideChat(
      input.sourceThreadID,
      {
        operationID: input.operationID,
        ...(input.referenceText === undefined ? {} : { referenceText: input.referenceText }),
        targetWorkspace: this.workspaces.targetWorkspace(
          source,
          source.cwd,
          this.repository.threadGitBranch(input.sourceThreadID),
        ),
      },
      this.repository,
    )
    let bindingID: string | null = null
    try {
      bindingID = await this.workspaces.bindSame(source, fork.threadID)
      return this.descriptor(fork)
    } catch (cause) {
      this.repository.deleteThread(fork.threadID)
      if (bindingID) await this.workspaces.removeEnvironment(bindingID).catch(() => undefined)
      throw cause
    }
  }

  get(threadID: string) {
    return this.repository.findByThread(threadID)
  }

  async discard(threadID: string) {
    const sideChat = this.repository.findByThread(threadID)
    if (!sideChat) return
    const active = this.activeTurn(threadID)
    if (active) {
      try {
        await this.threads.stop(threadID, active.id)
      } catch (cause) {
        if (
          !(cause instanceof AgentError) ||
          !['NO_ACTIVE_TURN', 'TURN_ID_MISMATCH'].includes(cause.code)
        )
          throw cause
      }
    }
    if (this.activeTurn(threadID)) throw new AgentError('CONFLICT', '侧边聊天仍在停止中', 409)
    const cleanup = this.prepareThreadCleanup?.(threadID)
    const bindingID = this.executionBindings.read(threadID)?.bindingId ?? null
    if (bindingID) await this.workspaces.removeEnvironment(bindingID)
    this.repository.deleteThread(threadID)
    await cleanup?.()
  }

  async discardAll(bestEffort = false) {
    for (const sideChat of this.repository.list()) {
      if (bestEffort) await this.discard(sideChat.threadID).catch(() => undefined)
      else await this.discard(sideChat.threadID)
    }
  }

  private activeTurn(threadID: string) {
    return this.threads.activeTurn(threadID)
  }

  private descriptor(sideChat: StoredSideChat) {
    return {
      threadId: sideChat.threadID,
      sourceThreadId: sideChat.sourceThreadID,
      inheritedThroughTurnId: sideChat.inheritedThroughTurnID,
      createdAt: sideChat.createdAt,
    }
  }
}
