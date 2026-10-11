import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { globalEventSequence } from '../storage/events/EventPublisher'
import { ThreadProjection } from '../transport/ThreadProjection'

/** Keeps every projection payload and its stream fence in one SQLite read view. */
export class ThreadReadViewRepository {
  private readonly projection: ThreadProjection

  constructor(
    private readonly db: AgentDatabase,
    private readonly faultSeams: {
      afterProjectionRead?: (view: 'snapshot' | 'history' | 'queue') => void
    } = {},
  ) {
    this.projection = new ThreadProjection(db)
  }

  snapshot(threadID: string) {
    return this.db.transaction(() => {
      const snapshot = this.projection.snapshot(threadID)
      if (!snapshot) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      this.faultSeams.afterProjectionRead?.('snapshot')
      const sequence = globalEventSequence(this.db)
      return { snapshot, streamPosition: { streamId: threadID, sequence } }
    })
  }

  history(threadID: string, params: { before?: string; limit?: number }) {
    return this.db.transaction(() => {
      const page = this.projection.historyPage(threadID, params)
      if (!page) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      this.faultSeams.afterProjectionRead?.('history')
      const sequence = globalEventSequence(this.db)
      return { ...page, streamPosition: { streamId: threadID, sequence } }
    })
  }

  queue(threadID: string, eventID?: number) {
    return this.db.transaction(() => {
      const snapshot = this.projection.snapshot(threadID)
      if (!snapshot) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
      const metadata = this.db.queueStateMeta(threadID) ?? { version: 0, pauseReason: null }
      this.faultSeams.afterProjectionRead?.('queue')
      const sequence = Math.max(eventID ?? 0, globalEventSequence(this.db))
      return {
        threadId: threadID,
        version: metadata.version,
        pauseReason: metadata.pauseReason,
        turns: snapshot.turns,
        inputs: snapshot.inputs,
        streamPosition: { streamId: threadID, sequence },
      }
    })
  }
}
