import { describe, expect, jest, spyOn, test } from 'bun:test'
import type { DesktopWorkspace } from '../shared/Types.js'
import type { SessionListItem } from '../src/UiTypes.js'
import { desktopClient } from '../src/services/desktop-client/index.js'
import {
  GIT_BOARD_ACTIVE_REFRESH_MS,
  GIT_BOARD_INACTIVE_REFRESH_MS,
  GIT_BOARD_REFRESH_TICK_MS,
  GitBoardLoadQueue,
  GitBoardRefreshTicker,
  orderGitBoardProjectsByActivity,
  type GitBoardLoadTask,
} from '../src/features/git-board/GitBoardLoadQueue.js'
import { loadGitBoardRepository } from '../src/features/git-board/GitBoardRepository.js'

const tick = () => Bun.sleep(0)

function workspace(id: string, name: string, lastOpenedAt?: string): DesktopWorkspace {
  return { name, path: `C:\\${id}`, projectId: id, lastOpenedAt }
}

function session(
  projectId: string,
  lastMessageAt: string,
  archivedAt: string | null = null,
): SessionListItem {
  return {
    id: `${projectId}-session`,
    workspaceName: projectId,
    workspacePath: `C:\\${projectId}`,
    projectId,
    standalone: false,
    createdAt: lastMessageAt,
    lastMessageAt,
    archivedAt,
    status: 'idle',
  } as unknown as SessionListItem
}

/** 记录执行顺序并允许逐个放行的队列执行器。 */
function createGateHarness(activityRank: (projectId: string) => number = () => 0) {
  const started: GitBoardLoadTask[] = []
  const gates: Array<() => void> = []
  let active = 0
  let peak = 0
  const queue = new GitBoardLoadQueue({
    activityRank,
    execute: async (task) => {
      started.push(task)
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => gates.push(resolve))
      active -= 1
    },
  })
  return {
    queue,
    started,
    gates,
    peak: () => peak,
    release: () => gates.shift()?.(),
  }
}

describe('GitBoardLoadQueue 串行加载', () => {
  test('首次加载、自动刷新、手动刷新、分支刷新与提交补拉共用一条队列', async () => {
    const harness = createGateHarness()
    const { queue } = harness
    queue.requestAll(['a', 'b', 'c'])
    queue.request('a', 'full', { manual: true })
    queue.request('a', 'full', { manual: true, invalidate: true })
    queue.request('b', 'history', { manual: true })
    queue.requestDue(['a', 'b', 'c', 'd'])
    await tick()
    // 当前仓库执行中，其余入口全部排队，不会并行。
    expect(harness.started.map((task) => task.projectId)).toEqual(['a'])
    while (harness.gates.length) {
      harness.release()
      await tick()
    }
    await queue.waitForIdle()
    expect(harness.peak()).toBe(1)
    // requestDue 在上一轮未完成时不再追加整轮任务，d 不会入队。
    expect(harness.started.map((task) => task.projectId)).not.toContain('d')
  })

  test('首次加载按项目应用活跃度降序执行', async () => {
    const rank = new Map([
      ['b', 0],
      ['c', 1],
      ['a', 2],
    ])
    const started: string[] = []
    const queue = new GitBoardLoadQueue({
      activityRank: (projectId) => rank.get(projectId) ?? Number.MAX_SAFE_INTEGER,
      execute: (task) => {
        started.push(task.projectId)
      },
    })
    queue.requestAll(['a', 'b', 'c'])
    await queue.waitForIdle()
    expect(started).toEqual(['b', 'c', 'a'])
  })

  test('活跃度相同时沿用入队顺序', async () => {
    const started: string[] = []
    const queue = new GitBoardLoadQueue({
      activityRank: () => 0,
      execute: (task) => {
        started.push(task.projectId)
      },
    })
    queue.requestAll(['a', 'b', 'c'])
    await queue.waitForIdle()
    expect(started).toEqual(['a', 'b', 'c'])
  })

  test('手动操作的仓库排在下一个，且不打断当前仓库', async () => {
    const harness = createGateHarness((projectId) =>
      projectId === 'b' ? 0 : projectId === 'c' ? 1 : 2,
    )
    const { queue } = harness
    queue.request('a')
    await tick()
    expect(harness.started.map((task) => task.projectId)).toEqual(['a'])
    queue.requestAll(['b', 'c'])
    // c 的活跃度低于 b，但手动操作让它优先进入下一位。
    queue.request('c', 'full', { manual: true })
    expect(harness.started.map((task) => task.projectId)).toEqual(['a'])
    harness.release()
    await tick()
    expect(harness.started.map((task) => task.projectId)).toEqual(['a', 'c'])
    harness.release()
    await tick()
    expect(harness.started.map((task) => task.projectId)).toEqual(['a', 'c', 'b'])
    harness.release()
    await queue.waitForIdle()
  })

  test('同一仓库只保留一项待执行任务，完整刷新吸收历史补拉', async () => {
    const harness = createGateHarness()
    const { queue } = harness
    queue.request('busy')
    queue.request('a', 'history')
    queue.request('a', 'history', { manual: true })
    queue.request('a', 'full')
    expect(queue.pendingProjectIds()).toEqual(['a'])
    harness.release()
    await tick()
    expect(harness.started.filter((task) => task.projectId === 'a')).toHaveLength(1)
    harness.release()
    await queue.waitForIdle()
    // 历史补拉不会额外执行：完整刷新已包含历史需求。
    expect(harness.started.filter((task) => task.projectId === 'a')).toHaveLength(1)
    expect(harness.started.find((task) => task.projectId === 'a')).toEqual({
      projectId: 'a',
      kind: 'full',
      manual: true,
    })
  })

  test('执行中出现新的必要刷新时只保留一项后续任务', async () => {
    const harness = createGateHarness()
    const { queue } = harness
    queue.request('a')
    queue.request('a', 'history')
    queue.request('a', 'full', { manual: true })
    queue.request('a', 'history')
    expect(queue.pendingProjectIds()).toEqual(['a'])
    harness.release()
    await tick()
    expect(harness.started.filter((task) => task.projectId === 'a')).toHaveLength(2)
    harness.release()
    await queue.waitForIdle()
  })

  test('切换分支后旧响应不会覆盖新结果', async () => {
    const applied: string[] = []
    let releaseOld!: () => void
    let first = true
    const queue = new GitBoardLoadQueue({
      activityRank: () => 0,
      execute: async (task, isCurrent) => {
        if (first) {
          first = false
          await new Promise<void>((resolve) => {
            releaseOld = resolve
          })
        }
        if (isCurrent()) applied.push(`${task.kind}:${task.manual}`)
      },
    })
    queue.request('a')
    await tick()
    queue.request('a', 'full', { manual: true, invalidate: true })
    releaseOld()
    await queue.waitForIdle()
    expect(applied).toEqual(['full:true'])
  })
})

describe('GitBoardLoadQueue 刷新到期', () => {
  function createClockQueue(
    options: {
      execute?: (task: GitBoardLoadTask) => void | Promise<void>
      isActive?: (projectId: string) => boolean
    } = {},
  ) {
    let now = 0
    const queue = new GitBoardLoadQueue({
      now: () => now,
      activityRank: () => 0,
      isActive: options.isActive,
      execute: options.execute ?? (() => {}),
    })
    return {
      queue,
      now: () => now,
      advance: (ms: number) => {
        now += ms
      },
    }
  }

  test('活跃仓库一分钟到期，不活跃仓库五分钟到期', async () => {
    const clock = createClockQueue({ isActive: (projectId) => projectId === 'active' })
    clock.queue.requestDue(['active', 'idle'])
    await clock.queue.waitForIdle()
    clock.advance(GIT_BOARD_ACTIVE_REFRESH_MS - 1)
    expect(clock.queue.isDue('active', clock.now())).toBe(false)
    expect(clock.queue.isDue('idle', clock.now())).toBe(false)
    clock.advance(1)
    expect(clock.queue.isDue('active', clock.now())).toBe(true)
    expect(clock.queue.isDue('idle', clock.now())).toBe(false)
    clock.advance(GIT_BOARD_INACTIVE_REFRESH_MS - GIT_BOARD_ACTIVE_REFRESH_MS)
    expect(clock.queue.isDue('idle', clock.now())).toBe(true)
  })

  test('最近五分钟手动操作过的仓库按活跃间隔刷新', async () => {
    const clock = createClockQueue()
    clock.queue.requestDue(['a'])
    await clock.queue.waitForIdle()
    clock.advance(GIT_BOARD_INACTIVE_REFRESH_MS - 1)
    expect(clock.queue.isDue('a', clock.now())).toBe(false)
    // 手动操作让仓库在五分钟内按活跃间隔（一分钟）判断到期。
    clock.queue.request('a', 'full', { manual: true })
    await clock.queue.waitForIdle()
    clock.advance(GIT_BOARD_ACTIVE_REFRESH_MS)
    expect(clock.queue.isDue('a', clock.now())).toBe(true)
  })

  test('长请求期间不重复追加整轮任务，完成后只补到期仓库', async () => {
    const gates: Array<() => void> = []
    let now = 0
    const started: string[] = []
    const queue = new GitBoardLoadQueue({
      now: () => now,
      activityRank: () => 0,
      execute: async (task) => {
        started.push(task.projectId)
        await new Promise<void>((resolve) => gates.push(resolve))
      },
    })
    queue.request('a')
    await tick()
    for (let index = 0; index < 4; index += 1) {
      now += GIT_BOARD_REFRESH_TICK_MS
      expect(queue.requestDue(['a', 'b'])).toBe(0)
    }
    expect(queue.pendingProjectIds()).toEqual([])
    gates.shift()?.()
    await queue.waitForIdle()
    expect(started.filter((projectId) => projectId === 'a')).toHaveLength(1)
    expect(queue.requestDue(['a', 'b'])).toBe(1)
    await tick()
    gates.shift()?.()
    await queue.waitForIdle()
    expect(started.filter((projectId) => projectId === 'b')).toHaveLength(1)
  })

  test('单仓库失败不阻塞其他仓库，失败也遵守刷新间隔', async () => {
    let now = 0
    const started: string[] = []
    const queue = new GitBoardLoadQueue({
      now: () => now,
      activityRank: () => 0,
      execute: async (task) => {
        started.push(task.projectId)
        if (task.projectId === 'broken') throw new Error('failed')
      },
    })
    queue.requestAll(['broken', 'ready'])
    await queue.waitForIdle()
    expect(started).toEqual(['broken', 'ready'])
    now += GIT_BOARD_ACTIVE_REFRESH_MS
    expect(queue.isDue('broken', now)).toBe(false)
    now = GIT_BOARD_INACTIVE_REFRESH_MS
    expect(queue.isDue('broken', now)).toBe(true)
  })
})

describe('GitBoardLoadQueue 生命周期', () => {
  test('离开 Git 页面后丢弃待执行任务与在途结果', async () => {
    const started: string[] = []
    let release!: () => void
    let applied = 0
    const queue = new GitBoardLoadQueue({
      activityRank: () => 0,
      execute: async (task, isCurrent) => {
        started.push(task.projectId)
        await new Promise<void>((resolve) => {
          release = resolve
        })
        if (isCurrent()) applied += 1
      },
    })
    queue.request('a')
    queue.request('b')
    await tick()
    expect(queue.pendingProjectIds()).toEqual(['b'])
    queue.dispose()
    expect(queue.pendingProjectIds()).toEqual([])
    release()
    await queue.waitForIdle()
    expect(applied).toBe(0)
    expect(started).toEqual(['a'])
    // 停止后新的入队请求不会再执行。
    queue.request('c')
    await tick()
    expect(started).toEqual(['a'])
  })
})

describe('GitBoardRefreshTicker', () => {
  test('页面隐藏时暂停到期检查，恢复可见时补查，停止后不再计时', () => {
    jest.useFakeTimers()
    try {
      let hidden = false
      let checks = 0
      const ticker = new GitBoardRefreshTicker(
        () => {
          checks += 1
        },
        () => hidden,
      )
      ticker.start()
      jest.advanceTimersByTime(GIT_BOARD_REFRESH_TICK_MS)
      expect(checks).toBe(1)
      hidden = true
      jest.advanceTimersByTime(GIT_BOARD_REFRESH_TICK_MS * 3)
      expect(checks).toBe(1)
      // 隐藏期间恢复事件不触发检查。
      ticker.resume()
      expect(checks).toBe(1)
      hidden = false
      ticker.resume()
      expect(checks).toBe(2)
      ticker.stop()
      jest.advanceTimersByTime(GIT_BOARD_REFRESH_TICK_MS * 2)
      expect(checks).toBe(2)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('GitBoard 项目活跃度排序', () => {
  test('取项目最后打开时间与未归档聊天最近消息时间的较新值降序', () => {
    const older = workspace('older', 'Older', '2026-01-01T00:00:00.000Z')
    const newer = workspace('newer', 'Newer', '2026-01-03T00:00:00.000Z')
    const chatty = workspace('chatty', 'Chatty', '2026-01-02T00:00:00.000Z')
    const sessions = [
      session('chatty', '2026-01-05T00:00:00.000Z'),
      // 已归档聊天不参与活跃度计算。
      session('older', '2026-01-09T00:00:00.000Z', '2026-01-10T00:00:00.000Z'),
    ]
    expect(
      orderGitBoardProjectsByActivity([older, newer, chatty], sessions).map(
        (project) => project.projectId,
      ),
    ).toEqual(['chatty', 'newer', 'older'])
  })

  test('同活跃度沿用现有稳定排序', () => {
    const beta = workspace('beta', 'Beta', '2026-01-01T00:00:00.000Z')
    const alpha = workspace('alpha', 'Alpha', '2026-01-01T00:00:00.000Z')
    expect(
      orderGitBoardProjectsByActivity([beta, alpha], []).map((project) => project.projectId),
    ).toEqual(['alpha', 'beta'])
  })
})

describe('loadGitBoardRepository 刷新失败保留旧数据', () => {
  test('状态请求失败时保留旧仓库数据并标记重试入口', async () => {
    const status = spyOn(desktopClient, 'getWorkspaceGitStatus').mockRejectedValue(
      new Error('boom'),
    )
    const project = workspace('board', 'Board')
    const result = {
      ok: true as const,
      status: {
        branchName: 'main',
        upstream: null,
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
      },
    }
    const previous = { result, diffStats: { additions: 1, deletions: 2 }, commits: [] }
    try {
      const failed = await loadGitBoardRepository(project, {
        previousRepository: previous,
        supportsCommitRef: false,
        supportsBranches: false,
        visible: true,
        isCancelled: () => false,
      })
      expect(failed?.result).toBe(result)
      expect(failed?.diffStats).toEqual(previous.diffStats)
      expect(failed?.refreshError).toBeDefined()
    } finally {
      status.mockRestore()
    }
  })
})
