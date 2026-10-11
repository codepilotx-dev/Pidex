import type { EventEnvelope } from '@pidex/agent-protocol'
import {
  applyThreadEnvelopes,
  canApplyItemDelta,
  createCanonicalThreadState,
  prependOlderThreadPage,
  reconcileLatestThreadPage,
  type CanonicalThreadState,
  type ThreadHistoryPageLike,
} from '@pidex/session-view'

import { countCanonicalCommit, setPendingDeltaCharacters } from '../state/StreamingPerfCounters.js'
import {
  liveItemTailStore,
  type LiveItemTailStore,
  type LiveTailKind,
} from '../state/LiveItemTailStore.js'

export type CanonicalThreadIngestionCoordinatorOptions = {
  threadId: string
  initialState?: CanonicalThreadState | null
  onCommit?: (state: CanonicalThreadState) => void
  /** 未提交 delta 的展示缓冲；默认使用进程级单例。 */
  tailStore?: LiveItemTailStore
  /** 提交调度器；默认以 50ms 窗口合并 live delta。 */
  checkpointScheduler?: CheckpointScheduler
}

/**
 * 返回取消函数。默认实现以固定窗口合并，与显示器刷新率解耦；durable 事件
 * 仍由调用方立即提交。
 */
export type CheckpointScheduler = (flush: () => void) => () => void

/** live delta 最大等待时间，避免提交与 event/ack 被长期拖延。 */
export const CHECKPOINT_MAX_DELAY_MS = 50
/** 有序队列上界：达到任一上限立即提交，避免把积压留在内存里。 */
export const CHECKPOINT_MAX_PENDING_EVENTS = 512
export const CHECKPOINT_MAX_PENDING_DELTA_CHARACTERS = 256 * 1024

function defaultCheckpointScheduler(flush: () => void): () => void {
  const timer = setTimeout(flush, CHECKPOINT_MAX_DELAY_MS)
  return () => clearTimeout(timer)
}

function liveDeltaTarget(envelope: EventEnvelope): { itemId: string; kind: LiveTailKind } | null {
  switch (envelope.type) {
    case 'item/agentMessage/delta':
      return { itemId: envelope.payload.itemId, kind: 'text' }
    case 'reasoning/textDelta':
    case 'reasoning/summaryTextDelta':
      return { itemId: envelope.payload.itemId, kind: 'reasoning' }
    case 'plan/delta':
      return { itemId: envelope.payload.itemId, kind: 'plan' }
    case 'tool/outputDelta':
      return { itemId: envelope.payload.itemId, kind: 'tool' }
    default:
      return null
  }
}

function liveDeltaText(envelope: EventEnvelope): string {
  const payload = envelope.payload as { delta?: unknown }
  return typeof payload.delta === 'string' ? payload.delta : ''
}

/**
 * Owns canonical thread projection commits independently from React render
 * timing. Live deltas are accumulated in one ordered ledger and applied at a
 * checkpoint (50ms-coalesced, bounded); durable and lifecycle events flush
 * immediately so structural state never waits for a frame. A delivered batch
 * resolves only after its checkpoint committed, so the transport may safely
 * acknowledge its positions.
 */
export class CanonicalThreadIngestionCoordinator {
  readonly #threadId: string
  readonly #onCommit: ((state: CanonicalThreadState) => void) | undefined
  readonly #tailStore: LiveItemTailStore
  readonly #scheduler: CheckpointScheduler
  readonly #listeners = new Set<() => void>()
  #state: CanonicalThreadState | null
  #pending: EventEnvelope[] = []
  #pendingDeltaCharacters = 0
  #pendingTailItemIds = new Set<string>()
  #settleWaiters: Array<() => void> = []
  #cancelCheckpoint: (() => void) | null = null

  constructor(options: CanonicalThreadIngestionCoordinatorOptions) {
    this.#threadId = options.threadId
    this.#state = options.initialState ?? null
    this.#onCommit = options.onCommit
    this.#tailStore = options.tailStore ?? liveItemTailStore
    this.#scheduler = options.checkpointScheduler ?? defaultCheckpointScheduler
    this.getSnapshot = this.getSnapshot.bind(this)
    this.subscribe = this.subscribe.bind(this)
  }

  getSnapshot(): CanonicalThreadState | null {
    return this.#state
  }

  get streamId(): string {
    return this.#threadId
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  rehydrate(page: ThreadHistoryPageLike): void {
    this.#assertPageThread(page)
    this.#flushPending()
    const next =
      this.#state?.thread.id === this.#threadId
        ? reconcileLatestThreadPage(this.#state, page)
        : createCanonicalThreadState(page)
    this.#commit(next)
  }

  prependOlder(page: ThreadHistoryPageLike): void {
    this.#assertPageThread(page)
    if (!this.#state || this.#state.thread.id !== this.#threadId) {
      throw new Error('尚未加载当前会话，无法合并更早记录。')
    }
    this.#flushPending()
    this.#commit(prependOlderThreadPage(this.#state, page))
  }

  prependOlderDirectory(page: ThreadHistoryPageLike): void {
    this.#assertPageThread(page)
    this.#flushPending()
    if (!this.#state) return
    // 批量读取期间实时事件可能已创建或更新实体；目录仅补充尚未装载的轮次。
    this.#commit(
      prependOlderThreadPage(this.#state, {
        ...page,
        queue: undefined,
        turns: page.turns.filter((bundle) => !this.#state!.turnsById.has(bundle.turn.id)),
        subagents: page.subagents.filter(
          (projection) => !this.#state!.subagentsByTaskId.has(projection.task.id),
        ),
      }),
    )
  }

  /**
   * 立即提交已入队事件并清空尾部缓冲。线程切换、卸载、历史读取前调用，
   * 保证 canonical 与尾部缓冲之间不残留未提交的 delta。
   */
  flush(): void {
    this.#flushPending()
  }

  /** 提交已入队事件并停止调度；卸载时调用，保证等待提交的批次不会悬空。 */
  dispose(): void {
    this.#flushPending()
  }

  deliverBatch(events: readonly EventEnvelope[]): Promise<void> {
    if (events.length === 0) return Promise.resolve()
    if (!this.#state || this.#state.thread.id !== this.#threadId) {
      return Promise.reject(new Error('尚未加载当前会话，无法提交事件批次。'))
    }
    try {
      this.#assertBatchScope(events)
    } catch (error) {
      return Promise.reject(error)
    }
    const committed = new Promise<void>((resolve) => {
      this.#settleWaiters.push(resolve)
    })
    for (const event of events) this.#enqueue(event)
    if (this.#shouldCommitImmediately(events)) this.#flushPending()
    else this.#scheduleCheckpoint()
    return committed
  }

  #enqueue(event: EventEnvelope): void {
    this.#pending.push(event)
    const target = liveDeltaTarget(event)
    if (!target) return
    const delta = liveDeltaText(event)
    if (!delta) return
    this.#pendingDeltaCharacters += delta.length
    setPendingDeltaCharacters(this.#pendingDeltaCharacters)
    // 只有投影会接受的 delta 才进入展示缓冲，避免尾部出现随后被丢弃的文本。
    if (!this.#state || !canApplyItemDelta(this.#state, target.itemId, target.kind)) {
      return
    }
    this.#pendingTailItemIds.add(target.itemId)
    this.#tailStore.append(this.#threadId, target.itemId, target.kind, delta)
  }

  #shouldCommitImmediately(events: readonly EventEnvelope[]): boolean {
    if (this.#pending.length >= CHECKPOINT_MAX_PENDING_EVENTS) return true
    if (this.#pendingDeltaCharacters >= CHECKPOINT_MAX_PENDING_DELTA_CHARACTERS) return true
    return events.some((event) => event.durability === 'durable')
  }

  #scheduleCheckpoint(): void {
    if (this.#cancelCheckpoint) return
    // 回调不提前清空 #cancelCheckpoint：#flushPending 会用它取消同一轮里另一个
    // 已挂起的句柄（rAF 与兜底定时器）。否则被漏掉的定时器会在稍后补一次提交。
    this.#cancelCheckpoint = this.#scheduler(() => {
      this.#flushPending()
    })
  }

  #flushPending(): void {
    if (this.#cancelCheckpoint) {
      this.#cancelCheckpoint()
      this.#cancelCheckpoint = null
    }
    const events = this.#pending
    if (events.length === 0) {
      this.#settle()
      return
    }
    this.#pending = []
    this.#pendingDeltaCharacters = 0
    setPendingDeltaCharacters(0)
    const tailItemIds = this.#pendingTailItemIds
    this.#pendingTailItemIds = new Set()
    if (this.#state && this.#state.thread.id === this.#threadId) {
      this.#commit(applyThreadEnvelopes(this.#state, events))
    }
    // 先提交再清空：清空时投影已包含这段文本，因此不会出现双份或闪断。
    if (tailItemIds.size > 0) {
      this.#tailStore.clearItems(this.#threadId, tailItemIds)
    }
    this.#settle()
  }

  #settle(): void {
    if (this.#settleWaiters.length === 0) return
    const waiters = this.#settleWaiters
    this.#settleWaiters = []
    for (const resolve of waiters) resolve()
  }

  #commit(next: CanonicalThreadState): void {
    if (next.thread.id !== this.#threadId) {
      throw new Error('canonical projection 返回了不匹配的会话。')
    }
    if (next === this.#state) return
    this.#state = next
    countCanonicalCommit()
    this.#onCommit?.(next)
    for (const listener of this.#listeners) listener()
  }

  #assertBatchScope(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      if (event.streamId !== this.#threadId) {
        throw new Error('事件批次包含不属于当前会话的 stream。')
      }
      if (event.threadId && event.threadId !== this.#threadId) {
        throw new Error('事件批次包含不属于当前会话的 thread。')
      }
    }
  }

  #assertPageThread(page: ThreadHistoryPageLike): void {
    if (page.thread.id !== this.#threadId) {
      throw new Error('历史记录返回了不匹配的会话。')
    }
  }
}
