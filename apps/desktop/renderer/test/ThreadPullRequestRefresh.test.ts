import { afterEach, describe, expect, test } from 'bun:test'
import { afterEach, describe, expect, test } from 'bun:test'
import type { ThreadPullRequestList, ThreadPullRequestSummary } from '@pidex/shared/thread'
import {
  THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS,
  THREAD_PULL_REQUEST_REQUEST_WINDOW_MS,
  ThreadPullRequestScheduler,
  threadPullRequestListsChanged,
  threadPullRequestStore,
  type ThreadPullRequestSchedulerHost,
} from '../src/features/layout/sidebar/ThreadPullRequestStore.js'

const BATCH_DELAY_MS = 40
/** 等待本批 `setTimeout` 与请求 promise 结算。 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 固定时钟 + 手动计时器队列，测试不依赖真实等待。 */
function fakeHost() {
  let now = 1_000_000
  let backgrounded = false
  let nextHandle = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  const lifecycle = new Set<(event: 'visible' | 'hidden' | 'focus' | 'blur') => void>()
  const host: ThreadPullRequestSchedulerHost = {
    setTimeout: (callback, delay) => {
      const handle = nextHandle++
      timers.set(handle, { at: now + delay, callback })
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle)
    },
    backgrounded: () => backgrounded,
    now: () => now,
    onLifecycle: (onChange) => {
      lifecycle.add(onChange)
      return () => lifecycle.delete(onChange)
    },
  }
  return {
    host,
    emit: (event: 'visible' | 'hidden' | 'focus' | 'blur') => {
      for (const listener of [...lifecycle]) listener(event)
    },
    setBackgrounded: (value: boolean) => {
      backgrounded = value
    },
    timerCount: () => timers.size,
    advance: async (ms: number) => {
      now += ms
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at)
      for (const [handle, timer] of due) {
        timers.delete(handle)
        timer.callback()
      }
      await settle()
    },
  }
}

const summary = (
  number: number,
  overrides: Partial<ThreadPullRequestSummary> = {},
): ThreadPullRequestSummary => ({
  owner: 'octocat',
  repository: 'fixture',
  number,
  url: `https://github.com/octocat/fixture/pull/${number}`,
  title: `PR ${number}`,
  origin: 'manual',
  primary: true,
  status: { state: 'mergeable', reason: null, stale: false, checkedAt: 1 },
  ...overrides,
})

const list = (
  threadId: string,
  items: readonly ThreadPullRequestSummary[] = [summary(1)],
): ThreadPullRequestList => ({ threadId, items })

function schedulerFixture(
  respond: (
    threadIds: readonly string[],
    refreshEnvironment: boolean,
  ) => readonly ThreadPullRequestList[] | null = (threadIds) => threadIds.map((id) => list(id)),
) {
  const clock = fakeHost()
  const calls: Array<{ threadIds: readonly string[]; refreshEnvironment: boolean }> = []
  const scheduler = new ThreadPullRequestScheduler(clock.host, async (threadIds, refresh) => {
    calls.push({ threadIds: [...threadIds], refreshEnvironment: refresh })
    return respond(threadIds, refresh)
  })
  return { clock, calls, scheduler }
}

const initialStore = threadPullRequestStore.getState()

afterEach(() => {
  threadPullRequestStore.setState(initialStore, true)
})

describe('thread pull request change detection', () => {
  test('只有 PR 标识、主关联与状态变化算业务变化', () => {
    expect(
      threadPullRequestListsChanged(
        [summary(1, { status: { state: 'mergeable', reason: null, stale: false, checkedAt: 1 } })],
        [
          summary(1, {
            status: { state: 'mergeable', reason: null, stale: false, checkedAt: 999 },
          }),
        ],
      ),
    ).toBe(false)
    expect(threadPullRequestListsChanged(undefined, [])).toBe(false)
    expect(threadPullRequestListsChanged(undefined, [summary(1)])).toBe(true)
    expect(threadPullRequestListsChanged([summary(1)], [])).toBe(true)
    expect(threadPullRequestListsChanged([summary(1)], [summary(2)])).toBe(true)
    expect(threadPullRequestListsChanged([summary(1)], [summary(1, { primary: false })])).toBe(true)
    expect(
      threadPullRequestListsChanged(
        [summary(1)],
        [
          summary(1, {
            status: { state: 'checks-failed', reason: null, stale: false, checkedAt: 2 },
          }),
        ],
      ),
    ).toBe(true)
  })
})

describe('ThreadPullRequestScheduler subscriptions', () => {
  test('重复订阅与卸载成对移除，最后一个订阅退出后清理计时器', async () => {
    const { clock, calls, scheduler } = schedulerFixture()
    const releaseFirst = scheduler.subscribe('thread-1')
    const releaseSecond = scheduler.subscribe('thread-1')
    expect(scheduler.subscribedThreadIds).toEqual(['thread-1'])

    releaseFirst()
    expect(scheduler.subscribedThreadIds).toEqual(['thread-1'])
    expect(scheduler.refreshScheduled).toBe(true)

    const releaseSeen = scheduler.subscribe('thread-2')
    releaseSecond()
    releaseSecond()
    expect(scheduler.subscribedThreadIds).toEqual(['thread-2'])

    releaseSeen()
    // 最后一个订阅退出后，后台计时器与生命周期监听都被清理。
    expect(scheduler.subscribedThreadIds).toEqual([])
    expect(scheduler.refreshScheduled).toBe(false)
    expect(clock.timerCount()).toBe(0)

    await clock.advance(60 * 60_000)
    expect(calls).toEqual([])
  })

  test('集合对齐只保留展开且处于当前分页内的会话', async () => {
    const { clock, scheduler } = schedulerFixture()
    scheduler.syncSubscriptions(['a', 'b'])
    scheduler.request(['a', 'b'])
    await clock.advance(BATCH_DELAY_MS)

    scheduler.syncSubscriptions(['b'])
    expect(scheduler.subscribedThreadIds).toEqual(['b'])
    expect(scheduler.refreshScheduled).toBe(true)

    scheduler.syncSubscriptions([])
    expect(scheduler.subscribedThreadIds).toEqual([])
    expect(scheduler.refreshScheduled).toBe(false)

    await clock.advance(THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS[0]!)
    expect(scheduler.refreshScheduled).toBe(false)
  })

  test('折叠区域的会话立即停止订阅，展开后恢复', async () => {
    const { clock, calls, scheduler } = schedulerFixture()
    scheduler.syncSubscriptions(['a', 'b', 'c'])
    scheduler.request(['a', 'b', 'c'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(1)

    // 收起折叠区域：展示范围为空，立即停止订阅与后台轮询。
    scheduler.syncSubscriptions([])
    expect(scheduler.subscribedThreadIds).toEqual([])
    expect(scheduler.refreshScheduled).toBe(false)
    const collapsed = calls.length
    await clock.advance(30 * 60_000)
    expect(calls).toHaveLength(collapsed)

    // 重新展开：只请求首次展示尚未加载的数据，窗口内的会话不重复请求。
    scheduler.syncSubscriptions(['a'])
    scheduler.request(['a'])
    await clock.advance(BATCH_DELAY_MS)
    // 收起的这段时间已超过 60 秒请求窗口：重新展开时按首次展示重新读取。
    expect(calls).toHaveLength(collapsed + 1)
    expect(scheduler.refreshScheduled).toBe(true)
  })

  test('空 PR 列表首屏只加载一次，随后按退避间隔低频刷新', async () => {
    const { clock, calls, scheduler } = schedulerFixture((ids) => ids.map((id) => list(id, [])))
    scheduler.subscribe('empty')
    scheduler.request(['empty'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(1)
    expect(threadPullRequestStore.getState().byThread.get('empty')).toEqual([])

    // 空列表没有业务变化，间隔退避到 10 分钟后才再次刷新。
    expect(scheduler.refreshInterval).toBe(10 * 60_000)
    await clock.advance(THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS[0]!)
    expect(calls).toHaveLength(1)
    await clock.advance(THREAD_PULL_REQUEST_REFRESH_INTERVALS_MS[0]!)
    expect(calls[1]).toMatchObject({ threadIds: ['empty'], refreshEnvironment: false })
  })
})

describe('ThreadPullRequestScheduler backoff', () => {
  test('请求完成后才安排下一次，按 5→10→20→30 分钟退避并封顶', async () => {
    const { clock, calls, scheduler } = schedulerFixture()
    scheduler.subscribe('thread-1')
    scheduler.request(['thread-1'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(1)
    // 后台轮询必须只刷新远端状态，禁止触发本地环境探测。
    expect(calls[0]).toEqual({ threadIds: ['thread-1'], refreshEnvironment: false })

    let requests = calls.length
    const expected = [5, 10, 20, 30, 30]
    for (const minutes of expected) {
      expect(scheduler.refreshInterval).toBe(minutes * 60_000)
      await clock.advance(minutes * 60_000)
      await clock.advance(BATCH_DELAY_MS)
      requests += 1
      expect(calls).toHaveLength(requests)
    }
    // 除首次展示外，所有周期请求都是远端状态刷新。
    expect(calls.slice(1).every((call) => call.refreshEnvironment === false)).toBe(true)
  })

  test('主关联或状态变化把退避重置回 5 分钟', async () => {
    const { clock, calls, scheduler } = schedulerFixture((ids) => ids.map((id) => list(id)))
    scheduler.subscribe('thread-1')
    scheduler.request(['thread-1'])
    await clock.advance(BATCH_DELAY_MS)
    // 无变化：退避到 10 分钟。
    await clock.advance(5 * 60_000)
    await clock.advance(BATCH_DELAY_MS)
    expect(scheduler.refreshInterval).toBe(10 * 60_000)
    expect(calls).toHaveLength(2)

    scheduler.applyLists([list('thread-1', [summary(1, { primary: false })])])
    expect(scheduler.refreshInterval).toBe(5 * 60_000)
  })
})

describe('ThreadPullRequestScheduler focus and hover card', () => {
  test('失焦暂停后台请求，恢复聚焦只刷新过期数据且连续事件不重复请求', async () => {
    const { clock, calls, scheduler } = schedulerFixture()
    const release = scheduler.subscribe('thread-1')
    scheduler.request(['thread-1'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(1)

    clock.setBackgrounded(true)
    clock.emit('blur')
    expect(scheduler.refreshScheduled).toBe(false)
    await clock.advance(30 * 60_000)
    expect(calls).toHaveLength(1)

    clock.setBackgrounded(false)
    clock.emit('focus')
    clock.emit('visible')
    expect(scheduler.refreshScheduled).toBe(true)
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({ threadIds: ['thread-1'], refreshEnvironment: false })

    // 紧接的重复 focus/visibility 命中 60 秒请求窗口，不重复请求。
    clock.emit('focus')
    clock.emit('visible')
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(2)
    release()
  })

  test('悬浮卡只刷新目标会话，并重新校验本地环境', async () => {
    const { clock, calls, scheduler } = schedulerFixture()
    scheduler.syncSubscriptions(['a', 'b'])
    scheduler.request(['a', 'b'], undefined, true)
    await clock.advance(BATCH_DELAY_MS)
    expect([...calls[0]!.threadIds].sort()).toEqual(['a', 'b'])
    expect(calls[0]?.refreshEnvironment).toBe(true)

    await clock.advance(THREAD_PULL_REQUEST_REQUEST_WINDOW_MS)
    const refreshed = scheduler.refresh(['b'])
    await clock.advance(BATCH_DELAY_MS)
    expect(refreshed).toBeInstanceOf(Promise)

    expect(calls[1]).toEqual({ threadIds: ['b'], refreshEnvironment: true })
    expect(calls).toHaveLength(2)

    // 短时间内重复打开只合并为一次主动刷新，不会重复请求。
    const reopened = scheduler.refresh(['b'])
    expect(scheduler.batchPending).toBe(true)
    await clock.advance(BATCH_DELAY_MS)
    expect(reopened).toBeInstanceOf(Promise)
    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({ threadIds: ['b'], refreshEnvironment: true })
  })

  test('请求期间的新订阅与主动刷新进入下一批，不被 inFlight 丢弃', async () => {
    const clock = fakeHost()
    const calls: Array<{ threadIds: readonly string[]; refreshEnvironment: boolean }> = []
    const pendingResolvers: Array<() => void> = []
    const scheduler = new ThreadPullRequestScheduler(clock.host, (threadIds, refresh) => {
      calls.push({ threadIds: [...threadIds], refreshEnvironment: refresh })
      return new Promise((resolve) => {
        pendingResolvers.push(() => resolve(threadIds.map((id) => list(id))))
      })
    })

    scheduler.syncSubscriptions(['a'])
    scheduler.request(['a'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(1)
    expect(scheduler.batchPending).toBe(true)

    // 请求进行中：新订阅与主动刷新都排队到下一批。
    scheduler.syncSubscriptions(['a', 'b'])
    scheduler.request(['b'])
    const active = scheduler.refresh(['a'])
    expect(calls).toHaveLength(1)

    pendingResolvers[0]!()
    await settle()
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(2)
    expect([...calls[1]!.threadIds].sort()).toEqual(['a', 'b'])
    expect(calls[1]?.refreshEnvironment).toBe(true)

    // 下一批完成后，请求期间的主动刷新才结算，不被进行中的批次丢弃。
    let settled = false
    void active.then(() => {
      settled = true
    })
    pendingResolvers[1]!()
    await settle()
    expect(settled).toBe(true)
    expect(calls).toHaveLength(2)
  })

  test('执行环境变化重新登记主动读取，普通后台轮询保持 false', async () => {
    const { clock, calls, scheduler } = schedulerFixture()
    scheduler.subscribe('a')
    scheduler.request(['a'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls[0]?.threadIds).toEqual(['a'])

    // 环境变化是主动读取：窗口内也重新登记，并重新校验本地目录。
    scheduler.refreshEnvironment('a')
    await clock.advance(BATCH_DELAY_MS)
    expect(calls[1]).toEqual({ threadIds: ['a'], refreshEnvironment: true })
  })

  test('capability 缺失后停止调度并结束等待中的批次', async () => {
    const clock = fakeHost()
    const calls: string[][] = []
    const scheduler = new ThreadPullRequestScheduler(clock.host, async () => {
      calls.push(['called'])
      scheduler.markUnsupported()
      return null
    })
    scheduler.subscribe('a')
    scheduler.request(['a'])
    await clock.advance(BATCH_DELAY_MS)
    await settle()

    expect(threadPullRequestStore.getState().supported).toBe(false)
    expect(scheduler.refreshScheduled).toBe(false)
    await clock.advance(60 * 60_000)
    expect(calls).toHaveLength(1)

    // 已停止的调度器不再登记新请求。
    await scheduler.refresh(['a'])
    await clock.advance(BATCH_DELAY_MS)
    expect(calls).toHaveLength(1)
  })
})
