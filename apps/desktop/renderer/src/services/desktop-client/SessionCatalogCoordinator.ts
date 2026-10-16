import type { EventEnvelope } from '@pidex/agent-protocol'
import type { Turn } from '@pidex/shared/thread'

/**
 * 书签集合变更通过窗口事件广播给导轨 hook：书签不属于会话目录投影，
 * 事件负载本身已携带最新集合，无需触发目录刷新。
 */
export const THREAD_BOOKMARKS_UPDATED_EVENT = 'pidex-thread-bookmarks-updated'

const THREAD_CATALOG_EVENT_TYPES: ReadonlySet<EventEnvelope['type']> = new Set([
  'thread/created',
  'thread/updated',
  'thread/history/edited',
  'thread/settings/updated',
  // Goal state is part of the canonical thread projection, so a goal change must
  // refresh the catalog on its own rather than waiting for an unrelated event.
  'thread/goal/updated',
  'thread/goal/cleared',
  'turn/queued',
  'queue/updated',
  'turn/started',
  'turn/statusChanged',
  'turn/completed',
  'turn/failed',
  'turn/interrupted',
  'item/completed',
  'turn/plan/updated',
  'approval/requested',
  'permission/requested',
  'interaction/resolved',
  'question/requested',
  'hook/trust/requested',
  'hook/trust/resolved',
])

export type SessionCatalogCoordinatorHandlers = {
  onCatalogUpdated: () => void
  onProviderCredentialUpdated: () => void
  onConfigUpdated: (payload: unknown) => void
  onWorkspaceFileChanged: (payload: unknown) => void
  onWorkspaceGitChanged: (payload: unknown) => void
  onLifecycleUpdated: (update: SessionLifecycleUpdate) => void
  refreshThreads: (threadIds: readonly string[]) => Promise<void>
}

export type SessionLifecycleUpdate = {
  threadId: string
  turnId: string
  status: Turn['status']
  sequence: number
}

/**
 * Routes global events to catalog reconciliation without retaining timeline,
 * message, tool, or interaction bodies. Active thread content is owned by the
 * canonical projection coordinator.
 */
export class SessionCatalogCoordinator {
  readonly #handlers: SessionCatalogCoordinatorHandlers

  constructor(handlers: SessionCatalogCoordinatorHandlers) {
    this.#handlers = handlers
  }

  async deliverBatch(events: readonly EventEnvelope[]): Promise<void> {
    const threadIds = new Set<string>()
    let scheduleChanged = false
    const lifecycleUpdates = new Map<string, SessionLifecycleUpdate>()
    for (const event of events) {
      switch (event.type) {
        case 'automation/runChanged':
        case 'scheduled-task/changed':
          scheduleChanged = true
          break
        case 'catalog/updated':
          this.#handlers.onCatalogUpdated()
          break
        case 'provider/credential/updated':
          this.#handlers.onProviderCredentialUpdated()
          break
        case 'config/updated':
          this.#handlers.onConfigUpdated(event.payload)
          break
        case 'workspace/file/changed':
          this.#handlers.onWorkspaceFileChanged(event.payload)
          break
        case 'workspace/git/changed':
          this.#handlers.onWorkspaceGitChanged(event.payload)
          break
        case 'thread/bookmarks/updated':
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent(THREAD_BOOKMARKS_UPDATED_EVENT, { detail: event.payload }),
            )
          }
          break
      }
      if (THREAD_CATALOG_EVENT_TYPES.has(event.type)) {
        const threadId = catalogThreadId(event)
        if (threadId) threadIds.add(threadId)
      }
      const lifecycleUpdate = sessionLifecycleUpdate(event)
      if (lifecycleUpdate) {
        const previous = lifecycleUpdates.get(lifecycleUpdate.threadId)
        if (!previous || lifecycleUpdate.sequence > previous.sequence) {
          lifecycleUpdates.set(lifecycleUpdate.threadId, lifecycleUpdate)
        }
      }
    }
    for (const update of lifecycleUpdates.values()) {
      this.#handlers.onLifecycleUpdated(update)
    }
    if (scheduleChanged || threadIds.size > 0) {
      await this.#handlers.refreshThreads([...threadIds])
    }
  }
}

function sessionLifecycleUpdate(event: EventEnvelope): SessionLifecycleUpdate | null {
  switch (event.type) {
    case 'turn/queued':
    case 'turn/started':
    case 'turn/completed':
    case 'turn/failed':
    case 'turn/interrupted':
      return event.threadId
        ? {
            threadId: event.threadId,
            turnId: event.payload.turn.id,
            status: event.payload.turn.status,
            sequence: event.sequence,
          }
        : null
    case 'turn/statusChanged':
      return event.threadId
        ? {
            threadId: event.threadId,
            turnId: event.payload.turnId,
            status: event.payload.status,
            sequence: event.sequence,
          }
        : null
    default:
      return null
  }
}

function catalogThreadId(event: EventEnvelope): string | null {
  switch (event.type) {
    case 'thread/created':
    case 'thread/updated':
      return event.payload.thread.id
    case 'thread/settings/updated':
      return event.payload.threadId
    default:
      return event.threadId ?? null
  }
}
