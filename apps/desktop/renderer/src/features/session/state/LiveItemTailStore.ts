import { countTailNotification } from './StreamingPerfCounters.js'

/**
 * 流式尾部缓冲：保存"本帧新增、尚未提交到 canonical projection"的 live delta
 * 后缀。
 *
 * canonical projection 始终是唯一事实来源；这里只把提交间隔内新增的那一段
 * 单独暴露给正在流式的那个 item，让尾部显示频率与投影提交频率解耦，避免
 * 为了显示最新文本而全量重算投影。提交完成后由调用方清空对应条目，因此
 * 同一段文本不会同时存在于两处。
 *
 * 内存上界由提交方（CanonicalThreadIngestionCoordinator）的 ledger 上限保证：
 * 达到上限就立即提交并清空，本模块自身不设第二套容量策略。
 */

export type LiveTailKind = 'text' | 'reasoning' | 'plan' | 'tool'
export interface LiveItemTailStore {
  append(threadId: string, itemId: string, kind: LiveTailKind, delta: string): void
  read(threadId: string, itemId: string): string
  subscribe(threadId: string, itemId: string, listener: () => void): () => void
  /** 投影提交完成之后清空这些条目的未提交后缀。 */
  clearItems(threadId: string, itemIds: Iterable<string>): void
  clearThread(threadId: string): void
  clearAll(): void
}

/**
 * 通知调度器：返回取消函数。生产环境按 50ms 合并，避免高刷新率屏幕上
 * 每帧都触发 React 重渲染；测试可注入同步调度器。
 */
export type TailNotificationScheduler = (notify: () => void) => () => void

function keyOf(threadId: string, itemId: string): string {
  return `${threadId}\u0000${itemId}`
}

function threadPrefixOf(threadId: string): string {
  return `${threadId}\u0000`
}

function defaultNotificationScheduler(notify: () => void): () => void {
  const timer = setTimeout(notify, 50)
  return () => clearTimeout(timer)
}

class LiveItemTailStoreImpl implements LiveItemTailStore {
  readonly #buffers = new Map<string, { kind: LiveTailKind; text: string }>()
  readonly #listeners = new Map<string, Set<() => void>>()
  readonly #lastNotified = new Map<string, string>()
  readonly #scheduler: TailNotificationScheduler
  #dirtyKeys: string[] = []
  #cancelNotification: (() => void) | null = null

  constructor(scheduler: TailNotificationScheduler = defaultNotificationScheduler) {
    this.#scheduler = scheduler
  }

  append(threadId: string, itemId: string, kind: LiveTailKind, delta: string): void {
    if (!delta || !threadId || !itemId) return
    const key = keyOf(threadId, itemId)
    const existing = this.#buffers.get(key)
    if (!existing) {
      this.#buffers.set(key, { kind, text: delta })
    } else if (existing.kind === kind) {
      existing.text += delta
    } else {
      // 同一 item 的 kind 不会改变；真出现时以最新的为准，避免把不同类型
      // 的文本拼在一起。
      this.#buffers.set(key, { kind, text: delta })
    }
    if (this.#listeners.has(key)) this.#markDirty(key)
  }

  read(threadId: string, itemId: string): string {
    if (!threadId || !itemId) return ''
    return this.#buffers.get(keyOf(threadId, itemId))?.text ?? ''
  }

  subscribe(threadId: string, itemId: string, listener: () => void): () => void {
    if (!threadId || !itemId) return () => undefined
    const key = keyOf(threadId, itemId)
    let listeners = this.#listeners.get(key)
    if (!listeners) {
      listeners = new Set()
      this.#listeners.set(key, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = this.#listeners.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.#listeners.delete(key)
    }
  }

  clearItems(threadId: string, itemIds: Iterable<string>): void {
    for (const itemId of itemIds) {
      const key = keyOf(threadId, itemId)
      this.#buffers.delete(key)
      this.#lastNotified.delete(key)
      if (this.#listeners.has(key)) this.#markDirty(key)
    }
    this.#flushNotifications()
  }

  clearThread(threadId: string): void {
    const prefix = threadPrefixOf(threadId)
    this.#dropMatching((key) => key.startsWith(prefix))
  }

  clearAll(): void {
    this.#dropMatching(() => true)
  }

  #dropMatching(matches: (key: string) => boolean): void {
    const removedKeys: string[] = []
    for (const key of this.#buffers.keys()) {
      if (matches(key)) removedKeys.push(key)
    }
    for (const key of removedKeys) this.#buffers.delete(key)
    for (const key of removedKeys) {
      this.#lastNotified.delete(key)
      if (this.#listeners.has(key)) this.#markDirty(key)
    }
    if (removedKeys.length > 0) this.#flushNotifications()
  }

  #markDirty(key: string): void {
    if (!this.#dirtyKeys.includes(key)) this.#dirtyKeys.push(key)
    if (this.#cancelNotification) return
    this.#cancelNotification = this.#scheduler(() => {
      this.#cancelNotification = null
      this.#flushNotifications()
    })
  }

  #flushNotifications(): void {
    if (this.#cancelNotification) {
      this.#cancelNotification()
      this.#cancelNotification = null
    }
    const keys = this.#dirtyKeys
    if (keys.length === 0) return
    this.#dirtyKeys = []
    // 每个 key 缓存已通知过的文本，避免同一帧内重复渲染。
    const notified = this.#lastNotified
    for (const key of keys) {
      const listeners = this.#listeners.get(key)
      if (!listeners || listeners.size === 0) continue
      const text = this.#buffers.get(key)?.text ?? ''
      if (notified.get(key) === text) continue
      notified.set(key, text)
      countTailNotification()
      for (const listener of [...listeners]) listener()
    }
  }
}

export const liveItemTailStore: LiveItemTailStore = new LiveItemTailStoreImpl()

export function createLiveItemTailStore(scheduler?: TailNotificationScheduler): LiveItemTailStore {
  return new LiveItemTailStoreImpl(scheduler)
}
