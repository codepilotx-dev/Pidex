import type { ThreadPullRequestList, ThreadPullRequestSummary } from '@pidex/shared/thread'
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand/react'
import { useShallow } from 'zustand/react/shallow'
import { createStore } from 'zustand/vanilla'
import { desktopClient } from '../../../services/desktop-client/index.js'

const REFRESH_INTERVAL_MS = 60_000
const BATCH_DELAY_MS = 40

export type ThreadPullRequestsSnapshot = {
  readonly byThread: ReadonlyMap<string, readonly ThreadPullRequestSummary[]>
  /** null 直到首次响应；capability 缺失后为 false，用于隐藏 PR 功能。 */
  readonly supported: boolean | null
}

type ThreadPullRequestsState = ThreadPullRequestsSnapshot

const EMPTY_BY_THREAD: ReadonlyMap<string, readonly ThreadPullRequestSummary[]> = new Map()

export const threadPullRequestStore = createStore<ThreadPullRequestsState>()(() => ({
  byThread: EMPTY_BY_THREAD,
  supported: null,
}))

/** 需要在 60 秒周期内刷新的已渲染会话；请求协调留在模块内，不进订阅快照。 */
const requested = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let interval: ReturnType<typeof setInterval> | null = null
let inFlight = false
let subscriberCount = 0

function apply(threads: readonly ThreadPullRequestList[]): void {
  const byThread = new Map(threadPullRequestStore.getState().byThread)
  for (const thread of threads) byThread.set(thread.threadId, thread.items)
  threadPullRequestStore.setState({ byThread, supported: true })
}

function markUnsupported(): void {
  threadPullRequestStore.setState({ supported: false })
}

/** 关联/解除关联返回的最新列表直接回填，避免等待下一轮刷新。 */
export function applyThreadPullRequestList(thread: ThreadPullRequestList): void {
  apply([thread])
}

async function flush(): Promise<void> {
  flushTimer = null
  if (inFlight || requested.size === 0) return
  inFlight = true
  const threadIds = [...requested]
  try {
    const result = await desktopClient.listThreadPullRequests(threadIds)
    if (result.ok === true) apply(result.threads)
    else if (result.errorCode === 'CAPABILITY_REQUIRED') markUnsupported()
  } catch {
    // 保留旧值；侧栏标记维持灰色未知，不逐行弹错误。
  } finally {
    inFlight = false
  }
}

/** 登记需要在 60 秒周期内刷新的已渲染会话。 */
export function requestThreadPullRequests(threadIds: readonly string[]): void {
  let changed = false
  for (const threadId of threadIds) {
    if (!threadId || requested.has(threadId)) continue
    requested.add(threadId)
    changed = true
  }
  if (changed && flushTimer === null) flushTimer = setTimeout(() => void flush(), BATCH_DELAY_MS)
}

/** 悬浮卡打开时立即刷新，绕过批处理等待。 */
export async function refreshThreadPullRequests(threadIds: readonly string[]): Promise<void> {
  requestThreadPullRequests(threadIds)
  if (inFlight) return
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flush()
}

const onVisibilityChange = (): void => {
  if (document.visibilityState === 'visible') void flush()
}

function acquireRefreshLoop(): () => void {
  subscriberCount += 1
  if (subscriberCount === 1) {
    interval = setInterval(() => {
      if (document.visibilityState === 'visible') void flush()
    }, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  return () => {
    subscriberCount -= 1
    if (subscriberCount > 0) return
    if (interval !== null) {
      clearInterval(interval)
      interval = null
    }
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

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
    requestThreadPullRequests(key ? key.split('\u0000') : [])
    return acquireRefreshLoop()
  }, [key])
  return snapshot
}
