import type { ContextBudget, ContextCompactionOperation } from '@pidex/shared/thread'
import type { ContextUsageAnchor } from './ContextBudget'
import { AgentError } from '../Domain'
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
  requestBudget?: ContextBudget | undefined
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
  private publisher: (event: EventEnvelope) => Promise<void> = async () => {}
  private idleRunner?: (threadID: string, signal: AbortSignal) => Promise<unknown>
  private readonly controllers = new Map<string, AbortController>()

  configure(
    publish: (event: EventEnvelope) => Promise<void>,
    runIdle: (threadID: string, signal: AbortSignal) => Promise<unknown>,
  ) {
    this.publisher = publish
    this.idleRunner = runIdle
  }

  private notify(event: EventEnvelope) {
    this.db.onTransactionCommit(() => {
      // Outbox replay survives delivery failure; rolled-back events must never reach clients.
      queueMicrotask(() => {
        void this.publisher(event).catch(() => {})
      })
    })
  }

  state(threadID: string) {
    return this.db.repositories.context.runtimeState(threadID)
  }
  anchor(threadID: string) {
    return this.db.repositories.context.anchor(threadID)
  }
  pending(threadID: string) {
    return this.db.repositories.context.latestOperation(threadID, true)
  }

  budget(
    threadID: string,
    budget: ContextBudget,
    anchor?: ContextUsageAnchor | null,
    completed = false,
  ) {
    if (!this.db.repositories.context.supportsLifecycle()) return
    this.db.transaction(() => {
      this.db.repositories.context.saveRuntimeState(threadID, budget, anchor)
      this.context.recordActiveBudget(threadID, budget, completed)
      this.notify(this.db.insertEvent(threadID, null, 'context/usageUpdated', { budget }))
    })
  }

  request(threadID: string, operationId: string) {
    if (!this.db.repositories.context.supportsLifecycle())
      throw new AgentError('CONFLICT', '当前数据版本不支持上下文压缩状态管理', 409)
    return this.db.transaction(() => {
      const previous =
        this.db.repositories.context.requestedOperation(operationId) ??
        this.db.repositories.context.operation(operationId)
      if (previous) {
        if (previous.threadId !== threadID)
          throw new AgentError('OPERATION_ID_CONFLICT', '压缩操作标识已被使用', 409)
        return previous
      }
      const pending = this.pending(threadID)
      if (pending) {
        this.db.repositories.context.bindRequest(operationId, pending)
        return pending
      }
      const operation = this.begin(threadID, 'manual', 'queued', operationId)
      this.db.repositories.context.bindRequest(operationId, operation)
      return operation
    })
  }

  begin(
    threadID: string,
    trigger: ContextCompactionTrigger,
    status: 'queued' | 'running' = 'running',
    operationId: string = crypto.randomUUID(),
  ): ContextCompactionOperation {
    if (!this.db.repositories.context.supportsLifecycle())
      throw new AgentError('CONFLICT', '当前数据版本不支持上下文压缩状态管理', 409)
    const pending = this.pending(threadID)
    if (pending) return pending
    const timestamp = Date.now()
    return this.transition({
      operationId,
      threadId: threadID,
      sessionId: null,
      agentId: null,
      trigger,
      phase: 'settled',
      status,
      compactionId: null,
      reason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  transition(operation: ContextCompactionOperation): ContextCompactionOperation {
    return this.db.transaction(() => {
      const next = { ...operation, updatedAt: Date.now() }
      this.db.repositories.context.saveOperation(next)
      this.notify(
        this.db.insertEvent(next.threadId, null, 'context/compactionUpdated', { operation: next }),
      )
      return next
    })
  }

  running(
    threadID: string,
    trigger: ContextCompactionTrigger,
    sessionId: string,
    agentId: string | null,
    phase: ContextCompactionOperation['phase'],
  ) {
    const operation = this.pending(threadID) ?? this.begin(threadID, trigger)
    const controller = new AbortController()
    this.controllers.set(operation.operationId, controller)
    return {
      operation: this.transition({ ...operation, status: 'running', sessionId, agentId, phase }),
      signal: controller.signal,
    }
  }

  finish(
    threadID: string,
    status: ContextCompactionOperation['status'],
    reason: ContextCompactionOperation['reason'] = null,
    compactionId: string | null = null,
  ) {
    const operation = this.pending(threadID)
    if (!operation) return
    this.controllers.delete(operation.operationId)
    return this.transition({ ...operation, status, reason, compactionId })
  }

  cancel(threadID: string, operationId: string) {
    const operation = this.db.repositories.context.operation(operationId)
    if (!operation || operation.threadId !== threadID)
      throw new AgentError('CONFLICT', '压缩操作不存在', 409)
    if (!['queued', 'running'].includes(operation.status)) return operation
    const controller = this.controllers.get(operationId)
    if (controller) {
      controller.abort()
      return this.transition({ ...operation, reason: 'stopped' })
    }
    return this.finish(threadID, 'cancelled', 'stopped')!
  }

  startIdle(threadID: string) {
    const operation = this.pending(threadID)
    if (
      !operation ||
      operation.status !== 'queued' ||
      this.db.activeTurn(threadID) ||
      this.db.nextQueuedTurn(threadID) ||
      !this.idleRunner
    )
      return
    const controller = new AbortController()
    this.controllers.set(operation.operationId, controller)
    this.transition({ ...operation, status: 'running' })
    void this.idleRunner?.(threadID, controller.signal)
      .then(() => {
        if (this.pending(threadID)) this.finish(threadID, 'completed')
      })
      .catch((error) => {
        if (!this.pending(threadID)) return
        this.finish(
          threadID,
          controller.signal.aborted
            ? 'cancelled'
            : error?.code === 'nothing_to_compact'
              ? 'skipped'
              : 'failed',
          controller.signal.aborted
            ? 'stopped'
            : error?.code === 'nothing_to_compact'
              ? 'already-compacted'
              : 'provider-failed',
        )
      })
  }

  recover() {
    for (const operation of this.db.repositories.context.unfinishedOperations())
      this.transition({ ...operation, status: 'interrupted', reason: 'restart' })
  }

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
      const actual = input.requestBudget
      if (actual) this.budget(input.threadID, actual, null, true)
      const state = this.context.state(input.threadID)!
      if (!actual && estimate.needsCompaction && input.trigger === 'automatic') {
        this.context.recordCompactionFailure(input.threadID)
      }
      const compaction = {
        id: durableEntry.id,
        beforeCount: input.beforeCount,
        afterCount: input.afterCount,
        beforeTokens: durableEntry.tokensBefore,
        afterTokens: actual?.usedTokens ?? estimate.usedTokens,
        targetTokens: actual?.targetTokens ?? estimate.targetTokens,
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
      this.finish(
        input.threadID,
        'completed',
        compaction.afterTokens > compaction.targetTokens ? 'target-unmet' : null,
        compaction.id,
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
