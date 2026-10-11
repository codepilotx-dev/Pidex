import { Effect } from 'effect'
import type { EventEnvelope } from '../Domain'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { ThreadBookmarkList } from '../storage/repositories/ThreadBookmarkRepository'
import type { EventHub } from '../storage/events/EventHub'

type InputRow = { thread_id: string; origin: string | null }

/**
 * Owns the per-thread bookmark set bound to `(threadId, inputId)`. Mutations are
 * idempotent via an operation replay log, guarded by a per-thread collection
 * version, and publish a durable `thread/bookmarks/updated` event from the same
 * transaction that commits the bookmark change.
 */
export class ThreadBookmarkService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
  ) {}

  private repository() {
    return this.db.repositories.threadBookmarks
  }

  private requireThread(threadId: string) {
    if (!this.db.getThread(threadId)) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
  }

  /** A partial schema must not accept mutations it cannot replay idempotently. */
  private requireWritableStorage() {
    if (!this.repository().available()) {
      throw new AgentError('PERMISSION_DENIED', '当前存储不支持书签写入', 403)
    }
  }

  private requireBookmarkableInput(threadId: string, inputId: string): void {
    const row = this.db.sqlite
      .query('SELECT thread_id, origin FROM inputs WHERE id = ?')
      .get(inputId) as InputRow | undefined
    if (!row || row.thread_id !== threadId) {
      throw new AgentError('INPUT_NOT_FOUND', '书签目标输入不存在或不属于该会话', 404)
    }
    if (row.origin === 'goal-continuation') {
      throw new AgentError('INVALID_REQUEST', '系统续跑输入不支持书签', 400)
    }
  }

  private async publishStored(events: readonly EventEnvelope[]) {
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
  }

  list(input: { threadId: string }): ThreadBookmarkList {
    this.requireThread(input.threadId)
    return this.repository().list(input.threadId)
  }

  async set(input: {
    threadId: string
    inputId: string
    bookmarked: boolean
    expectedVersion: number
    operationId: string
  }): Promise<ThreadBookmarkList> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    this.requireBookmarkableInput(input.threadId, input.inputId)
    const request = {
      threadId: input.threadId,
      inputId: input.inputId,
      bookmarked: input.bookmarked,
      expectedVersion: input.expectedVersion,
    }
    const replay = this.repository().completedOperation(
      input.operationId,
      'thread/bookmarks/set',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result as ThreadBookmarkList
    }
    const { result, event } = this.db.transaction(() => {
      const applied = this.repository().set({
        threadId: input.threadId,
        inputId: input.inputId,
        bookmarked: input.bookmarked,
        expectedVersion: input.expectedVersion,
      })
      if (!applied) throw new AgentError('CONFLICT', '书签已被其他窗口更新，请刷新后重试', 409)
      // 状态未改变时不写幂等记录、不发事件；重放同一请求仍是确定性无操作。
      if (!applied.changed) return { result: applied.list, event: null }
      this.repository().recordOperation(
        input.operationId,
        'thread/bookmarks/set',
        request,
        applied.list,
      )
      const stored = this.db.insertEvent(input.threadId, null, 'thread/bookmarks/updated', {
        threadId: input.threadId,
        inputIds: applied.list.inputIds,
        version: applied.list.version,
      })
      return { result: applied.list, event: stored }
    })
    if (event) await this.publishStored([event])
    return result
  }
}
