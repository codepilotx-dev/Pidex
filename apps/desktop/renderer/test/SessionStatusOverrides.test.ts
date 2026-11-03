import { describe, expect, test } from 'bun:test'

import {
  hasNonTerminalSessionStatus,
  withSessionStatusOverride,
} from '../src/services/desktop-client/SessionStatusOverrides.js'

describe('session status overrides', () => {
  test('keeps the row identity when there is nothing to change', () => {
    const running = {
      id: 'thread-1',
      status: 'running' as const,
      latestTurnStatus: 'running' as const,
      latestTurnError: null,
    }

    expect(withSessionStatusOverride(running, undefined)).toBe(running)
    expect(
      withSessionStatusOverride(running, {
        status: 'running',
        latestTurnStatus: 'running',
        latestTurnError: null,
      }),
    ).toBe(running)
  })

  test('replaces status and latest turn status for a covered thread', () => {
    const running = {
      id: 'thread-1',
      status: 'running' as const,
      latestTurnStatus: 'running' as const,
    }

    expect(
      withSessionStatusOverride(running, {
        status: 'done',
        latestTurnStatus: 'completed',
        latestTurnError: null,
      }),
    ).toEqual({
      id: 'thread-1',
      status: 'done',
      latestTurnStatus: 'completed',
      latestTurnError: null,
    })

    // A row without `latestTurnStatus` still compares against null.
    const bare = { id: 'thread-2', status: 'running' as const }
    expect(
      withSessionStatusOverride(bare, {
        status: 'done',
        latestTurnStatus: null,
        latestTurnError: null,
      }),
    ).toEqual({ id: 'thread-2', status: 'done', latestTurnStatus: null, latestTurnError: null })
  })

  test('non-failed status clears error details', () => {
    const failedWithOldError = {
      id: 'thread-error',
      status: 'error' as const,
      latestTurnStatus: 'failed' as const,
      latestTurnError: '上一轮失败原因',
    }

    // 新活动轮次开始执行，错误必须清除为 null
    const resumed = withSessionStatusOverride(failedWithOldError, {
      status: 'running',
      latestTurnStatus: 'running',
      latestTurnError: null,
    })
    expect(resumed.status).toBe('running')
    expect(resumed.latestTurnStatus).toBe('running')
    expect(resumed.latestTurnError).toBeNull()

    // 即使覆盖对象带有残留错误文本，只要状态非 failed 也会归一化为 null
    const completed = withSessionStatusOverride(failedWithOldError, {
      status: 'done',
      latestTurnStatus: 'completed',
      latestTurnError: '残留错误',
    })
    expect(completed.latestTurnError).toBeNull()
  })

  test('failed status preserves error text and triggers new object on text change', () => {
    const failedInitial = {
      id: 'thread-fail',
      status: 'error' as const,
      latestTurnStatus: 'failed' as const,
      latestTurnError: null,
    }

    // 错误详情到达：null -> 文本 触发新对象
    const withDetail = withSessionStatusOverride(failedInitial, {
      status: 'error',
      latestTurnStatus: 'failed',
      latestTurnError: '模型上下文超限',
    })
    expect(withDetail).not.toBe(failedInitial)
    expect(withDetail.latestTurnError).toBe('模型上下文超限')

    // 详情相同保留 identity
    const unchanged = withSessionStatusOverride(withDetail, {
      status: 'error',
      latestTurnStatus: 'failed',
      latestTurnError: '模型上下文超限',
    })
    expect(unchanged).toBe(withDetail)

    // 文本更新触发新对象
    const updated = withSessionStatusOverride(withDetail, {
      status: 'error',
      latestTurnStatus: 'failed',
      latestTurnError: '网络超时',
    })
    expect(updated).not.toBe(withDetail)
    expect(updated.latestTurnError).toBe('网络超时')
  })

  test('only in-flight statuses keep the reconcile running', () => {
    const row = (status: 'queued' | 'waiting' | 'running' | 'done' | 'idle' | 'error') => ({
      id: `thread-${status}`,
      status,
    })

    expect(hasNonTerminalSessionStatus([])).toBe(false)
    expect(hasNonTerminalSessionStatus([row('done'), row('idle'), row('error')])).toBe(false)
    expect(hasNonTerminalSessionStatus([row('done'), row('running')])).toBe(true)
    expect(hasNonTerminalSessionStatus([row('waiting')])).toBe(true)
    expect(hasNonTerminalSessionStatus([row('queued')])).toBe(true)
  })
})
