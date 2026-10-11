import { describe, expect, jest, test } from 'bun:test'
import {
  createReviewCommentIdentity,
  createReviewSummaryIdentity,
  isReviewRequestCurrent,
  reviewGitChangeMatchesProject,
  REVIEW_AUTO_REFRESH_DELAY_MS,
  REVIEW_REPOSITORY_BUSY_MESSAGE,
  ReviewAutoRefreshScheduler,
  ReviewRefreshCoordinator,
  ReviewRepositoryBusyError,
  shouldDeferReviewRefresh,
} from '../src/features/review/state/ReviewRefreshCoordinator.js'

describe('ReviewRefreshCoordinator', () => {
  test('stale 结果会排队一次 force 刷新并以 fresh 结果收敛', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []

    const result = await coordinator.request('project:unstaged', false, (force) => {
      forces.push(force)
      return Promise.resolve(
        forces.length === 1
          ? { cacheState: 'stale', generation: 'old' }
          : { cacheState: 'fresh', generation: 'new' },
      )
    })

    expect(forces).toEqual([false, true])
    expect(result?.generation).toBe('new')
  })

  test('运行中的多个 force 事件只合并为一个尾随请求', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const execute = async (force: boolean) => {
      forces.push(force)
      if (forces.length === 1) await firstBlocked
      return {
        cacheState: 'fresh' as const,
        generation: `generation-${forces.length}`,
      }
    }

    const first = coordinator.request('project:unstaged', false, execute)
    const second = coordinator.request('project:unstaged', true, execute)
    const third = coordinator.request('project:unstaged', true, execute)
    expect(second).toBe(first)
    expect(third).toBe(first)

    releaseFirst()
    const result = await first

    expect(forces).toEqual([false, true])
    expect(result?.generation).toBe('generation-2')
  })

  test('持续 stale 最多刷新三次并返回 repository busy', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []

    await expect(
      coordinator.request('project:unstaged', false, (force) => {
        forces.push(force)
        return Promise.resolve({
          cacheState: 'stale' as const,
          generation: `generation-${forces.length}`,
        })
      }),
    ).rejects.toThrow(REVIEW_REPOSITORY_BUSY_MESSAGE)

    expect(forces).toEqual([false, true, true])
  })

  test('dispose 后停止请求，activate 后同一实例可以重新执行', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh'
      generation: string
    }>()
    let executions = 0

    coordinator.dispose()
    const disposedResult = await coordinator.request('project:unstaged', false, () => {
      executions += 1
      return Promise.resolve({
        cacheState: 'fresh' as const,
        generation: 'disposed',
      })
    })

    expect(disposedResult).toBeNull()
    expect(executions).toBe(0)

    coordinator.activate()
    const activeResult = await coordinator.request('project:unstaged', false, () => {
      executions += 1
      return Promise.resolve({
        cacheState: 'fresh' as const,
        generation: 'active',
      })
    })

    expect(activeResult?.generation).toBe('active')
    expect(executions).toBe(1)
  })

  test('cleanup 前的旧 cycle 不会阻止重新激活后的新 cycle', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh'
      generation: string
    }>()
    let releaseOld!: () => void
    const oldBlocked = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    const oldRequest = coordinator.request('project:unstaged', false, async () => {
      await oldBlocked
      return { cacheState: 'fresh' as const, generation: 'old' }
    })

    coordinator.dispose()
    coordinator.activate()
    const newRequest = coordinator.request('project:unstaged', false, () =>
      Promise.resolve({
        cacheState: 'fresh' as const,
        generation: 'new',
      }),
    )
    releaseOld()

    expect((await newRequest)?.generation).toBe('new')
    expect((await oldRequest)?.generation).toBe('old')
  })

  test('重新激活后 stale 请求仍会尾随 force 并收敛到 fresh', async () => {
    const coordinator = new ReviewRefreshCoordinator<{
      cacheState: 'fresh' | 'stale'
      generation: string
    }>()
    const forces: boolean[] = []

    coordinator.dispose()
    coordinator.activate()
    const result = await coordinator.request('project:unstaged', false, (force) => {
      forces.push(force)
      return Promise.resolve(
        force
          ? { cacheState: 'fresh' as const, generation: 'same' }
          : { cacheState: 'stale' as const, generation: 'same' },
      )
    })

    expect(forces).toEqual([false, true])
    expect(result).toEqual({ cacheState: 'fresh', generation: 'same' })
  })

  test('文件请求必须同时匹配 identity、generation 和 requestId', () => {
    const current = {
      identity: 'project:unstaged',
      generation: 'generation-2',
      requestId: 9,
    }

    expect(isReviewRequestCurrent({ ...current }, current)).toBe(true)
    expect(isReviewRequestCurrent({ ...current, identity: 'project:staged' }, current)).toBe(false)
    expect(isReviewRequestCurrent({ ...current, generation: 'generation-1' }, current)).toBe(false)
    expect(isReviewRequestCurrent({ ...current, requestId: 8 }, current)).toBe(false)
  })

  test('identity 包含项目、工作区、来源和评论会话', () => {
    const summary = createReviewSummaryIdentity('project-1', 'C:\\workspace', {
      kind: 'pull-request',
      owner: 'acme',
      repository: 'app',
      number: 7,
    })

    expect(summary).toContain('project-1')
    expect(summary).toContain('C:\\workspace')
    expect(summary).toContain('pull-request:acme/app#7')
    expect(createReviewCommentIdentity(summary, 'thread-1')).toEndWith('\0thread-1')
  })

  test('Git 事件只刷新同一 projectId', () => {
    expect(reviewGitChangeMatchesProject({ projectId: 'project-1' }, 'project-1')).toBe(true)
    expect(reviewGitChangeMatchesProject({ projectId: 'project-2' }, 'project-1')).toBe(false)
    expect(reviewGitChangeMatchesProject({}, 'project-1')).toBe(false)
    expect(reviewGitChangeMatchesProject({ projectId: 'project-1' }, null)).toBe(false)
  })
})

describe('ReviewAutoRefreshScheduler', () => {
  const withFakeTimers = (run: () => void): void => {
    jest.useFakeTimers()
    try {
      run()
    } finally {
      jest.useRealTimers()
    }
  }

  test('默认等待 60 秒静默期', () => {
    expect(REVIEW_AUTO_REFRESH_DELAY_MS).toBe(60_000)
  })

  test('到期前不刷新，到期后只刷新一次', () => {
    withFakeTimers(() => {
      const scheduler = new ReviewAutoRefreshScheduler()
      let refreshes = 0
      scheduler.schedule(() => {
        refreshes += 1
      })

      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS - 1)
      expect(refreshes).toBe(0)

      jest.advanceTimersByTime(1)
      expect(refreshes).toBe(1)

      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS)
      expect(refreshes).toBe(1)
    })
  })

  test('连续变化重置倒计时，只在最后一次变化后刷新', () => {
    withFakeTimers(() => {
      const scheduler = new ReviewAutoRefreshScheduler()
      let refreshes = 0
      scheduler.schedule(() => {
        refreshes += 1
      })

      for (let change = 0; change < 3; change += 1) {
        jest.advanceTimersByTime(30_000)
        scheduler.schedule(() => {
          refreshes += 1
        })
      }
      expect(refreshes).toBe(0)

      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS - 1)
      expect(refreshes).toBe(0)
      jest.advanceTimersByTime(1)
      expect(refreshes).toBe(1)
    })
  })

  test('cancel 取消待执行的自动刷新', () => {
    withFakeTimers(() => {
      const scheduler = new ReviewAutoRefreshScheduler()
      let refreshes = 0
      scheduler.schedule(() => {
        refreshes += 1
      })

      scheduler.cancel()
      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS)
      expect(refreshes).toBe(0)
    })
  })

  test('dispose 后不执行，activate 后恢复', () => {
    withFakeTimers(() => {
      const scheduler = new ReviewAutoRefreshScheduler()
      let refreshes = 0
      const refresh = () => {
        refreshes += 1
      }

      scheduler.schedule(refresh)
      scheduler.dispose()
      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS)
      expect(refreshes).toBe(0)

      scheduler.schedule(refresh)
      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS)
      expect(refreshes).toBe(0)

      scheduler.activate()
      scheduler.schedule(refresh)
      jest.advanceTimersByTime(REVIEW_AUTO_REFRESH_DELAY_MS)
      expect(refreshes).toBe(1)
    })
  })
})

describe('shouldDeferReviewRefresh', () => {
  const rpcBusyError = Object.assign(new Error(REVIEW_REPOSITORY_BUSY_MESSAGE), {
    errorCode: 'REVIEW_REPOSITORY_BUSY',
  })

  test('自动刷新遇到 RPC busy 或协调器 busy 时静默退避', () => {
    expect(shouldDeferReviewRefresh('auto', rpcBusyError)).toBe(true)
    expect(shouldDeferReviewRefresh('auto', new ReviewRepositoryBusyError())).toBe(true)
  })

  test('手动刷新和其他错误保持现有反馈', () => {
    expect(shouldDeferReviewRefresh('immediate', rpcBusyError)).toBe(false)
    expect(shouldDeferReviewRefresh('immediate', new ReviewRepositoryBusyError())).toBe(false)
    expect(shouldDeferReviewRefresh('auto', new Error('network down'))).toBe(false)
    expect(shouldDeferReviewRefresh('auto', null)).toBe(false)
  })
})
