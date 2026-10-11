import type { RpcResult } from '@pidex/agent-protocol'
import type { CompactionEntry } from '../orchestration/harness/Types'
import type { EventEnvelope } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { StoredContextCompaction } from '../storage/repositories/ContextRepository'
import type { AgentInputItem } from './ContextManager'
import { ContextManager } from './ContextManager'

export type ContextCompactionTrigger = 'manual' | 'automatic' | 'reactive'

export type CompleteContextCompactionInput = {
  threadID: string
  turnID?: string | null
  sessionID: string
  trigger: ContextCompactionTrigger
  piEntry: CompactionEntry
  summary: string
  firstKeptEntryID: string | null
  beforeCount: number
  afterCount: number
  items: AgentInputItem[]
  promptText?: string
  contextWindowTokens?: number
}

export type ContextCompaction = RpcResult<'thread/compact'>['compaction'] & {
  trigger: ContextCompactionTrigger
  afterTokensSource: 'compaction-estimate'
}

export type CompleteContextCompactionResult = {
  compaction: ContextCompaction
  event: EventEnvelope
}

const nonNegativeInteger = (name: string, value: number) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`)
  }
}

/** Coordinates durable product metadata after Pi has created and flushed its entry. */
export class ContextCompactionService {
  private readonly context: ContextManager

  constructor(
    private readonly db: AgentDatabase,
    context?: ContextManager,
  ) {
    this.context = context ?? new ContextManager(db)
  }

  shouldAutoCompact(threadID: string) {
    return this.context.shouldAutoCompact(threadID)
  }

  byID(id: string): ContextCompaction | null {
    const stored = this.db.repositories.context.compactionByID(id)
    return stored ? this.fromStored(stored) : null
  }

  latest(threadID: string): ContextCompaction | null {
    const stored = this.db.repositories.context.latestCompaction(threadID)
    return stored ? this.fromStored(stored) : null
  }

  recordFailure(threadID: string, trigger: ContextCompactionTrigger) {
    const state = this.context.state(threadID)
    if (!state) throw new Error(`Thread ${threadID} 尚未建立 prompt baseline`)
    // A user-requested compaction failure must not disable automatic recovery.
    if (trigger !== 'manual') this.context.recordCompactionFailure(threadID)
  }

  complete(input: CompleteContextCompactionInput): CompleteContextCompactionResult {
    nonNegativeInteger('beforeCount', input.beforeCount)
    nonNegativeInteger('afterCount', input.afterCount)
    if (input.piEntry.type !== 'compaction') {
      throw new Error('piEntry 必须是 compaction entry')
    }
    if (!input.summary.trim()) throw new Error('summary 不能为空')
    if (
      input.piEntry.summary !== input.summary ||
      (input.piEntry.firstKeptEntryId ?? null) !== input.firstKeptEntryID
    ) {
      throw new Error('压缩摘要或保留边界与 Pi entry 不一致')
    }

    return this.db.transaction(() => {
      const persisted = this.db.repositories.context.persistedPiCompaction(
        input.sessionID,
        input.piEntry.id,
      )
      if (!persisted) {
        throw new Error('Pi compaction entry 尚未持久化')
      }
      if (persisted.threadID !== input.threadID) {
        throw new Error('Pi compaction entry 不属于目标 thread')
      }
      const durableEntry = JSON.parse(persisted.payload) as CompactionEntry
      if (
        durableEntry.type !== 'compaction' ||
        durableEntry.id !== input.piEntry.id ||
        durableEntry.summary !== input.summary ||
        (durableEntry.firstKeptEntryId ?? null) !== input.firstKeptEntryID
      ) {
        throw new Error('已持久化的 Pi compaction entry 与完成请求不一致')
      }
      nonNegativeInteger('tokensBefore', durableEntry.tokensBefore)

      const estimate = this.context.recordCompactionEstimate({
        threadID: input.threadID,
        ...(input.turnID ? { turnID: input.turnID } : {}),
        sessionID: input.sessionID,
        items: input.items,
        ...(input.promptText === undefined ? {} : { promptText: input.promptText }),
        ...(input.contextWindowTokens === undefined
          ? {}
          : { contextWindowTokens: input.contextWindowTokens }),
      })
      const state = this.context.state(input.threadID)!
      if (estimate.needsCompaction && input.trigger === 'automatic') {
        this.context.recordCompactionFailure(input.threadID)
      }
      const compaction = {
        id: durableEntry.id,
        beforeCount: input.beforeCount,
        afterCount: input.afterCount,
        beforeTokens: durableEntry.tokensBefore,
        afterTokens: estimate.usedTokens,
        targetTokens: estimate.targetTokens,
        usageSampleId: estimate.sampleID,
        baselineVersion: state.baselineVersion,
        trigger: input.trigger,
        afterTokensSource: 'compaction-estimate' as const,
      } satisfies ContextCompaction
      const createdAt = Date.now()
      this.db.repositories.context.insertCompaction({
        id: compaction.id,
        threadID: input.threadID,
        turnID: input.turnID ?? null,
        baselineVersion: compaction.baselineVersion,
        beforeCount: compaction.beforeCount,
        afterCount: compaction.afterCount,
        summary: durableEntry.summary,
        reference: {
          version: 1,
          kind: 'pi-compaction-reference',
          sessionID: input.sessionID,
          entryID: durableEntry.id,
          firstKeptEntryID: durableEntry.firstKeptEntryId ?? null,
          trigger: input.trigger,
          afterTokensSource: 'compaction-estimate',
        },
        beforeTokens: compaction.beforeTokens,
        afterTokens: compaction.afterTokens,
        targetTokens: compaction.targetTokens,
        usageSampleID: compaction.usageSampleId,
        createdAt,
      })
      const event = this.db.repositories.context.insertCompactedEvent(
        input.threadID,
        input.turnID ?? null,
        {
          compactionId: compaction.id,
          beforeCount: compaction.beforeCount,
          afterCount: compaction.afterCount,
          beforeTokens: compaction.beforeTokens,
          afterTokens: compaction.afterTokens,
          targetTokens: compaction.targetTokens,
          baselineVersion: compaction.baselineVersion,
          usageSampleId: compaction.usageSampleId,
          trigger: compaction.trigger,
          afterTokensSource: compaction.afterTokensSource,
        },
      )
      return { compaction, event }
    })
  }

  private fromStored(stored: StoredContextCompaction) {
    return {
      id: stored.id,
      beforeCount: stored.beforeCount,
      afterCount: stored.afterCount,
      beforeTokens: stored.beforeTokens,
      afterTokens: stored.afterTokens,
      targetTokens: stored.targetTokens,
      usageSampleId: stored.usageSampleID,
      baselineVersion: stored.baselineVersion,
      trigger: stored.reference.trigger,
      afterTokensSource: stored.reference.afterTokensSource,
    } satisfies ContextCompaction
  }
}
