import { randomUUID } from 'node:crypto'
import { AgentError } from '../Domain'
import {
  ConversationHistoryForkRepository,
  type ThreadForkResult,
} from '../session/fork/ConversationHistoryForkRepository'
import { SqlitePiSessionRepo } from '../storage/pi-session/SqlitePiSession'
import type { AgentDatabase } from '../storage/database/AgentDatabase'

export type { ThreadForkResult } from '../session/fork/ConversationHistoryForkRepository'

export type ThreadForkOptions = {
  operationID: string
  targetThreadID?: string
  targetWorkspace: {
    cwd: string
    roots: string
    gitBranch: string
  }
}

/** Handoff wrapper around the shared durable conversation history copier. */
export class ThreadForkRepository {
  private readonly history: ConversationHistoryForkRepository
  private readonly inFlight = new Map<
    string,
    { requestKey: string; promise: Promise<ThreadForkResult> }
  >()

  constructor(
    private readonly db: AgentDatabase,
    nextID: () => string = randomUUID,
    sessions?: Pick<SqlitePiSessionRepo, 'fork'>,
  ) {
    this.history = new ConversationHistoryForkRepository(db, nextID, sessions)
  }

  assertForkable(sourceThreadID: string) {
    return this.history.assertFullyForkable(sourceThreadID)
  }

  fork(sourceThreadID: string, options: ThreadForkOptions): Promise<ThreadForkResult> {
    const requestKey = JSON.stringify({
      sourceThreadID,
      targetThreadID: options.targetThreadID,
      targetWorkspace: options.targetWorkspace,
    })
    const existing = this.inFlight.get(options.operationID)
    if (existing) {
      if (existing.requestKey !== requestKey)
        throw new AgentError('CONFLICT', 'Handoff operationId 已绑定其他 fork 请求', 409)
      return existing.promise
    }
    const owned = this.forkOwned(sourceThreadID, options)
    const tracked = owned.finally(() => {
      if (this.inFlight.get(options.operationID)?.promise === tracked)
        this.inFlight.delete(options.operationID)
    })
    this.inFlight.set(options.operationID, { requestKey, promise: tracked })
    return tracked
  }

  private async forkOwned(sourceThreadID: string, options: ThreadForkOptions) {
    const result = await this.history.forkAllForHandoff(sourceThreadID, options)
    this.db.transaction(() => {
      this.db.sqlite
        .query('UPDATE review_comments SET thread_id = ?, updated_at = ? WHERE thread_id = ?')
        .run(result.targetThreadID, Date.now(), sourceThreadID)
    })
    return result
  }

  rollback(operationID: string) {
    const marker = this.db.sqlite
      .query('SELECT source_thread_id, target_thread_id FROM thread_forks WHERE operation_id = ?')
      .get(operationID) as { source_thread_id: string; target_thread_id: string } | null
    const legacyTarget = marker
      ? null
      : (this.db.sqlite
          .query('SELECT id FROM threads WHERE create_operation_id = ?')
          .get(operationID) as { id: string } | null)
    const operation = marker
      ? null
      : (this.db.sqlite
          .query('SELECT source_thread_id FROM thread_handoff_operations WHERE operation_id = ?')
          .get(operationID) as { source_thread_id: string } | null)
    const fork =
      marker ??
      (legacyTarget && operation
        ? { source_thread_id: operation.source_thread_id, target_thread_id: legacyTarget.id }
        : null)
    if (!fork) return
    this.db.transaction(() => {
      this.db.sqlite
        .query('UPDATE review_comments SET thread_id = ?, updated_at = ? WHERE thread_id = ?')
        .run(fork.source_thread_id, Date.now(), fork.target_thread_id)
    })
    this.history.rollbackHandoff(operationID)
  }
}
