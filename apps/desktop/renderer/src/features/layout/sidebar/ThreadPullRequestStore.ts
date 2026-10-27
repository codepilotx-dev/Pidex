import type { ThreadPullRequestList, ThreadPullRequestSummary } from '@pidex/shared/thread'
import { useEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand/react'
import { useShallow } from 'zustand/react/shallow'
import { createStore } from 'zustand/vanilla'
import { desktopClient } from '../../../services/desktop-client/index.js'

/**
 * 后台刷新间隔：首次 5 分钟，无业务变化依次退避到 10、20、30 分钟，
 * 有变化立即回到 5 分钟。
 */
export const THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS: readonly number[] = [
  5 * 60_000,
  10 * 60_000,
  20 * 60_000,
  30 * 60_000,
]
/** 与 Agent 端远端状态请求窗口一致：窗口内悬浮卡、聚焦恢复与轮询都不重复请求。 */
export const THREAD_PULL_REQUEST_REQUEST_WINDOW_MS = 60_000
const BATCH_DELAY_MS = 40
const LAST_INTERVAL_INDEX = THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS.length - 1

export type ThreadPullRequestsSnapshot = {
  readonly byThread: ReadonlyMap<string, readonly ThreadPullRequestSummary[]>
  /** null 直到首次响应；capability 缺失后为 false，用于隐藏 PR 功能。 */
  readonly supported: boolean | null
}

type ThreadPullRequestsState = ThreadPullRequestsSnapshot

export type ThreadPullRequestSchedulerHost = {
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(handle: number): void
  /** 页面隐藏或窗口失焦时返回 true，暂停后台请求。 */
  backgrounded(): boolean
  now(): number
  /** 监听页面可见性与窗口焦点，返回取消订阅函数。 */
  onLifecycle(onChange: (event: 'visible' | 'hidden' | 'focus' | 'blur') => void): () => void
}

type FetchLists = (
  threadIds: readonly string[],
  refreshEnvironment: boolean,
) => Promise<readonly ThreadPullRequestList[] | null>

type Batch = {
  waiters: Set<() => void>
}

const EMPTY_BY_THREAD: ReadonlyMap<string, readonly ThreadPullRequestSummary[]> = new Map()

export const threadPullRequestStore = createStore<ThreadPullRequestsState>()(() => ({
  byThread: EMPTY_BY_THREAD,
  supported: null,
}))

/** PR 标识、主关联与状态的比较键；`checkedAt` 与列表引用不计入业务变化。 */
const fingerprint = (item: ThreadPullRequestSummary): string =>
  [
    item.owner.toLowerCase(),
    item.repository.toLowerCase(),
    item.number,
    item.primary,
    item.status.state,
    item.status.reason ?? '',
    item.status.stale,
  ].join('|')

/** 只有 PR 标识、主关联与状态变化才算业务变化。 */
export function threadPullRequestListsChanged(
  previous: readonly ThreadPullRequestSummary[] | undefined,
  next: readonly ThreadPullRequestSummary[],
): boolean {
  if (!previous) return next.length > 0
  if (previous.length !== next.length) return true
  return previous.some((item, index) => fingerprint(item) !== fingerprint(next[index]!))
}

/**
 * 侧栏 PR 标记的订阅与刷新协调。
 *
 * - 订阅按会话引用计数；重复订阅、卸载与移出展示范围都成对移除，
 *   最后一个订阅退出时清理后台计时器。
 * - 用“请求完成后再安排下一次”的 `setTimeout` 取代固定 `setInterval`；
 *   无业务变化逐级退避，有变化回到初始间隔。
 * - 请求进行中的新订阅与主动刷新进入下一批，不会被 `inFlight` 丢弃。
 * - 收到 capability 缺失后停止全部调度。
 */
export class ThreadPullRequestScheduler {
  private readonly subscriptions = new Map<string, number>()
  /** 最近一次远端请求时间：60 秒窗口内的悬浮卡、聚焦恢复与轮询去重。 */
  private readonly requestedAt = new Map<string, number>()
  /** 尚未发出的本批会话。 */
  private pending = new Set<string>()
  private pendingActive = false
  private flushTimer: number | null = null
  private refreshTimer: number | null = null
  /** 本批结算时唤醒的首次展示与主动刷新等待者。 */
  private batchWaiters = new Set<() => void>()
  private inFlight = false
  private intervalIndex = 0
  private supported = true
  private recorded: ReadonlyMap<string, readonly ThreadPullRequestSummary[]> = EMPTY_BY_THREAD
  private stopLifecycle: (() => void) | null = null

  constructor(
    private readonly host: ThreadPullRequestSchedulerHost,
    private readonly fetchLists: FetchLists,
  ) {}

  get subscribedThreadIds(): readonly string[] {
    return [...this.subscriptions.keys()]
  }

  /** 当前后台间隔，供测试断言退避档位。 */
  get refreshInterval(): number {
    return THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS[this.intervalIndex]!
  }

  get refreshScheduled(): boolean {
    return this.refreshTimer !== null
  }

  /** 是否还有未结算的批次（测试与诊断用）。 */
  get batchPending(): boolean {
    return this.flushTimer !== null || this.inFlight || this.pending.size > 0
  }

  /** 后台请求是否暂停（页面隐藏或窗口失焦）。 */
  get paused(): boolean {
    return this.refreshTimer === null && this.subscriptions.size > 0
  }

  /** 同一会话的多次订阅与对应次数的卸载成对生效。 */
  subscribe(threadId: string): () => void {
    if (!threadId) return () => undefined
    this.subscriptions.set(threadId, (this.subscriptions.get(threadId) ?? 0) + 1)
    this.observeLifecycle()
    this.ensureTimer()
    let released = false
    return () => {
      if (released) return
      released = true
      this.unsubscribe(threadId)
    }
  }

  /**
   * 登记需要读取的会话：请求窗口内已读取的会话跳过，批内已存在的会话合并。
   * `wait` 在本批结算时调用，用于首次展示等待数据与主动刷新等待结果。
   */
  request(threadIds: readonly string[], wait?: () => void, active = false): void {
    if (!this.supported) {
      wait?.()
      return
    }
    const now = this.host.now()
    let due = false
    for (const threadId of threadIds) {
      // 主动读取（悬浮卡、环境变化）允许在当前请求窗口内重新登记；
      // 轮询与首次展示仍按窗口去重。
      if (!threadId || this.pending.has(threadId)) continue
      if (!active && this.isFresh(threadId, now)) continue
      this.pending.add(threadId)
      due = true
    }
    if (wait) {
      if (due) this.batchWaiters.add(wait)
      else this.waitForCurrentBatch(wait)
    }
    if (!due) return
    if (active) this.pendingActive = true
    this.scheduleFlush()
  }

  /**
   * 主动刷新（悬浮卡、聚焦恢复）：重新请求窗口内的会话，
   * 但同一会话在本批或进行中的批次里不会重复排队。
   */
  refresh(threadIds: readonly string[]): Promise<void> {
    const ids = threadIds.filter(Boolean)
    if (ids.length === 0 || !this.supported) return Promise.resolve()
    this.observeLifecycle()
    return new Promise<void>((resolve) => {
      this.request(ids, resolve, true)
    })
  }

  /** 页面隐藏或窗口失焦：暂停后台请求，保留订阅与已排队批次。 */
  pause(): void {
    if (this.refreshTimer === null) return
    this.host.clearTimeout(this.refreshTimer)
    this.refreshTimer = null
  }

  /** 恢复聚焦：只刷新过期数据；本批已排队的会话不会重复请求。 */
  resume(): void {
    if (!this.supported || this.host.backgrounded()) return
    this.ensureTimer()
    const now = this.host.now()
    this.request([...this.subscriptions.keys()].filter((id) => !this.isFresh(id, now)))
  }

  /**
   * 会话执行环境（cwd/revision/分支）变化后重新登记主动读取，
   * 让 Agent 重新解析当前目录；窗口内不会重复请求。
   */
  refreshEnvironment(threadId: string): void {
    this.requestedAt.delete(threadId)
    this.request([threadId], undefined, true)
  }

  /** 展开集或分页范围变化时对齐订阅；最后一个订阅退出时清理后台计时器。 */
  syncSubscriptions(threadIds: readonly string[]): void {
    const next = new Set(threadIds.filter(Boolean))
    let changed = false
    for (const threadId of [...this.subscriptions.keys()]) {
      if (next.has(threadId)) continue
      this.subscriptions.delete(threadId)
      changed = true
    }
    for (const threadId of next) {
      if (this.subscriptions.has(threadId)) continue
      this.subscriptions.set(threadId, 0)
      changed = true
    }
    if (!changed) return
    if (this.subscriptions.size === 0) this.pause()
    else this.ensureTimer()
  }

  /**
   * 应用一批列表并比较业务变化：只有 PR 标识、主关联与状态变化才重置退避。
   */
  applyLists(lists: readonly ThreadPullRequestList[]): void {
    const byThread = new Map(threadPullRequestStore.getState().byThread)
    let changed = false
    for (const thread of lists) {
      if (threadPullRequestListsChanged(this.recorded.get(thread.threadId), thread.items)) {
        changed = true
      }
      byThread.set(thread.threadId, thread.items)
    }
    this.supported = true
    this.recorded = byThread
    threadPullRequestStore.setState({ byThread, supported: true })
    this.intervalIndex = changed ? 0 : Math.min(this.intervalIndex + 1, LAST_INTERVAL_INDEX)
  }

  /** 订阅页面可见性与窗口焦点：隐藏/失焦暂停，恢复时只刷新过期数据。 */
  observeLifecycle(): () => void {
    if (this.stopLifecycle) return this.stopLifecycle
    const stop = this.host.onLifecycle((event) => {
      if (event === 'hidden' || event === 'blur') this.pause()
      else this.resume()
    })
    const release = () => {
      if (this.stopLifecycle !== release) return
      this.stopLifecycle = null
      stop()
    }
    this.stopLifecycle = release
    return release
  }

  /** 收到 capability 缺失后停止调度并结束等待中的批次。 */
  markUnsupported(): void {
    if (!this.supported) return
    this.supported = false
    threadPullRequestStore.setState({ supported: false })
    this.pause()
    this.pending.clear()
    this.pendingActive = false
    if (this.flushTimer !== null) {
      this.host.clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.releaseBatchWaiters()
    this.stopLifecycle?.()
  }

  private unsubscribe(threadId: string): void {
    const count = this.subscriptions.get(threadId) ?? 0
    if (count > 1) {
      this.subscriptions.set(threadId, count - 1)
      return
    }
    this.subscriptions.delete(threadId)
    // 已不可见的会话不再占用下一次批次。
    this.pending.delete(threadId)
    if (this.subscriptions.size > 0) return
    this.pause()
    this.stopLifecycle?.()
  }

  /**
   * 安排下一次后台请求。请求完成后才安排下一轮，慢请求不会堆积轮询；
   * 会话都处于请求窗口内时没有批次可等，按当前档位继续安排。
   */
  private ensureTimer(): void {
    if (!this.supported || this.refreshTimer !== null) return
    if (this.subscriptions.size === 0 || this.host.backgrounded()) return
    this.refreshTimer = this.host.setTimeout(() => {
      this.refreshTimer = null
      if (this.host.backgrounded() || !this.supported) return
      const now = this.host.now()
      this.request([...this.subscriptions.keys()].filter((id) => !this.isFresh(id, now)))
      if (this.flushTimer === null && !this.inFlight && this.pending.size === 0) this.ensureTimer()
    }, this.refreshInterval)
  }

  private isFresh(threadId: string, now: number): boolean {
    const requestedAt = this.requestedAt.get(threadId)
    return requestedAt !== undefined && now - requestedAt < THREAD_PULL_REQUEST_REQUEST_WINDOW_MS
  }

  private waitForCurrentBatch(wait: () => void): void {
    if (this.flushTimer !== null || this.inFlight || this.pending.size > 0) {
      this.batchWaiters.add(wait)
      return
    }
    wait()
  }

  private releaseBatchWaiters(): void {
    const waiters = [...this.batchWaiters]
    this.batchWaiters.clear()
    for (const wait of waiters) wait()
  }

  /** 同一 40ms 窗口内的订阅与主动刷新合并成一次请求；进行中的需求进入下一批。 */
  private scheduleFlush(): void {
    if (this.flushTimer !== null || this.inFlight) return
    this.flushTimer = this.host.setTimeout(() => {
      this.flushTimer = null
      const active = this.pendingActive
      this.pendingActive = false
      void this.flush(active)
    }, BATCH_DELAY_MS)
  }

  private async flush(active: boolean): Promise<void> {
    if (this.inFlight || this.pending.size === 0 || !this.supported) return
    const threadIds = [...this.pending]
    this.pending = new Set()
    const now = this.host.now()
    for (const threadId of threadIds) this.requestedAt.set(threadId, now)
    this.inFlight = true
    try {
      // 后台轮询只刷新远端状态；主动读取才重新探测本地目录。
      const lists = await this.fetchLists(threadIds, active)
      if (lists && this.supported) this.applyLists(lists)
    } catch {
      // 保留旧值；侧栏标记维持灰色未知，不逐行弹错误。
    } finally {
      this.inFlight = false
      this.releaseBatchWaiters()
    }
    // 请求期间产生的新订阅或主动刷新进入下一批，而不是被 inFlight 丢弃。
    if (this.pending.size > 0) {
      this.scheduleFlush()
      return
    }
    this.ensureTimer()
  }
}

// ---------------------------------------------------------------------------
// 模块级单例：窗口内共享订阅、批处理与后台计时器。
// ---------------------------------------------------------------------------

const browserHost: ThreadPullRequestSchedulerHost = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
  backgrounded: () => document.visibilityState === 'hidden' || !document.hasFocus(),
  now: () => Date.now(),
  onLifecycle: (onChange) => {
    const onVisibility = () =>
      onChange(document.visibilityState === 'hidden' ? 'hidden' : 'visible')
    const onFocus = () => onChange('focus')
    const onBlur = () => onChange('blur')
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  },
}

/**
 * 后台读取只刷新远端 PR 状态（`refreshEnvironment: false`），复用 Agent 的本地环境缓存；
 * 主动读取（首次展示、悬浮卡、聚焦恢复、环境变化）才重新探测本地目录。
 */
async function fetchThreadPullRequests(
  threadIds: readonly string[],
  refreshEnvironment: boolean,
): Promise<readonly ThreadPullRequestList[] | null> {
  const result = await desktopClient.listThreadPullRequests([...threadIds], { refreshEnvironment })
  if (result.ok === true) return result.threads
  if (result.errorCode === 'CAPABILITY_REQUIRED') threadPullRequestScheduler.markUnsupported()
  return null
}

export const threadPullRequestScheduler = new ThreadPullRequestScheduler(
  browserHost,
  fetchThreadPullRequests,
)

/** 关联/解除关联返回的最新列表直接回填，不等待下一轮刷新。 */
export function applyThreadPullRequestList(thread: ThreadPullRequestList): void {
  threadPullRequestScheduler.applyLists([thread])
}

/** 悬浮卡打开：只请求目标会话并重新校验本地环境，不再刷新整个订阅集合。 */
export async function refreshThreadPullRequests(threadIds: readonly string[]): Promise<void> {
  await threadPullRequestScheduler.refresh(threadIds)
}

export type ThreadPullRequestEnvironmentInput = {
  threadId: string
  cwd: string | null | undefined
  revision: number | undefined
  branch: string | null | undefined
}

/**
 * 会话执行环境的 cwd、revision 或分支变化时重新登记主动读取；
 * Renderer 只传递变化信息，Git 数据仍由 Agent 校验。
 */
export function useThreadPullRequestEnvironments(
  inputs: readonly ThreadPullRequestEnvironmentInput[],
): void {
  const previous = useRef<Map<string, string> | null>(null)
  const { moved } = useMemo(() => {
    const next = new Map<string, string>()
    const changed: string[] = []
    for (const input of inputs) {
      const value = `${input.cwd ?? ''}\u0001${input.revision ?? ''}\u0001${input.branch ?? ''}`
      const before = previous.current?.get(input.threadId)
      if (before !== undefined && before !== value) changed.push(input.threadId)
      next.set(input.threadId, value)
    }
    previous.current = next
    return { moved: changed }
  }, [inputs])
  useEffect(() => {
    for (const threadId of moved) threadPullRequestScheduler.refreshEnvironment(threadId)
  }, [moved])
}

/**
 * 页面隐藏或窗口失焦暂停后台请求；恢复聚焦只刷新过期数据。
 * 连续 focus/visibility 事件由请求窗口去重，不会重复请求。
 */
export function useThreadPullRequestLifecycle(): void {
  useEffect(() => threadPullRequestScheduler.observeLifecycle(), [])
}

/**
 * 订阅当前展示范围内的会话并返回快照。首次展示请求尚未加载的数据，
 * 之后由后台调度按退避间隔刷新；空 PR 列表不参与周期轮询。
 */
export function useThreadPullRequests(threadIds: readonly string[]): ThreadPullRequestsSnapshot {
  const key = threadIds.join('\u0000')
  const ids = useMemo(() => (key ? key.split('\u0000') : []), [key])
  const supported = useStore(threadPullRequestStore, (state) => state.supported)
  const lists = useStore(
    threadPullRequestStore,
    useShallow((state) => ids.map((id) => state.byThread.get(id))),
  )
  const byThread = useMemo(
    () => new Map(ids.flatMap((id, index) => (lists[index] ? [[id, lists[index]!] as const] : []))),
    [ids, lists],
  )
  const snapshot = useMemo(() => ({ byThread, supported }), [byThread, supported])
  useEffect(() => {
    threadPullRequestScheduler.syncSubscriptions(ids)
    threadPullRequestScheduler.request(ids)
  }, [ids])
  return snapshot
}
