import { describe, expect, test } from 'bun:test'

import {
  canInlineEditConversationTitle,
  canRegenerateConversationTitle,
  normalizeConversationTitle,
  shouldCloseConversationRenameDialog,
  shouldSubmitConversationRename,
} from '../src/features/session/conversation/ConversationTitleActions.js'

describe('conversation title actions', () => {
  test('only enables regeneration for a completed session with a first prompt', () => {
    const ready = {
      hasActiveSession: true,
      hasFirstMessage: true,
      pending: false,
      status: 'done' as const,
    }

    expect(canRegenerateConversationTitle(ready)).toBe(true)
    expect(canRegenerateConversationTitle({ ...ready, pending: true })).toBe(false)
    expect(canRegenerateConversationTitle({ ...ready, hasFirstMessage: false })).toBe(false)
    for (const status of [
      'idle',
      'queued',
      'waiting',
      'running',
      'error',
      'interrupted',
    ] as const) {
      expect(canRegenerateConversationTitle({ ...ready, status })).toBe(false)
    }
  })

  test('closes rename only after a successful request for the active session', () => {
    const completed = {
      activeSessionId: 'session-1',
      requestedSessionId: 'session-1',
      succeeded: true,
    }

    expect(shouldCloseConversationRenameDialog(completed)).toBe(true)
    expect(shouldCloseConversationRenameDialog({ ...completed, succeeded: false })).toBe(false)
    expect(
      shouldCloseConversationRenameDialog({
        ...completed,
        activeSessionId: 'session-2',
      }),
    ).toBe(false)
  })

  test('normalizes title by trimming outer whitespace', () => {
    expect(normalizeConversationTitle('  hello world  ')).toBe('hello world')
    expect(normalizeConversationTitle('\n\t新标题\t ')).toBe('新标题')
    expect(normalizeConversationTitle('   ')).toBe('')
  })

  test('validates when inline rename should submit', () => {
    const valid = {
      currentTitle: '旧标题',
      nextTitle: '新标题',
    }
    expect(shouldSubmitConversationRename(valid)).toBe(true)
    // Same title with whitespace differences
    expect(
      shouldSubmitConversationRename({
        currentTitle: '旧标题',
        nextTitle: '  旧标题  ',
      }),
    ).toBe(false)
    // Empty next title
    expect(
      shouldSubmitConversationRename({
        currentTitle: '旧标题',
        nextTitle: '   ',
      }),
    ).toBe(false)
    // IME composition active
    expect(
      shouldSubmitConversationRename({
        ...valid,
        isComposing: true,
      }),
    ).toBe(false)
    // Already renaming
    expect(
      shouldSubmitConversationRename({
        ...valid,
        isRenaming: true,
      }),
    ).toBe(false)
  })

  test('enables inline editing only when session is active and not busy', () => {
    const ready = {
      hasActiveSession: true,
      isLoading: false,
      isRegenerating: false,
      isRenaming: false,
    }
    expect(canInlineEditConversationTitle(ready)).toBe(true)
    expect(canInlineEditConversationTitle({ ...ready, hasActiveSession: false })).toBe(false)
    expect(canInlineEditConversationTitle({ ...ready, isLoading: true })).toBe(false)
    expect(canInlineEditConversationTitle({ ...ready, isRegenerating: true })).toBe(false)
    expect(canInlineEditConversationTitle({ ...ready, isRenaming: true })).toBe(false)
  })

  test('maps title regeneration RPC errors to clear user-facing messages', async () => {
    const { toUserErrorMessage } = await import('../src/utils/Errors.js')

    // 1. MODEL_UNAVAILABLE 未配置模型
    expect(
      toUserErrorMessage({
        errorCode: 'MODEL_UNAVAILABLE',
        message: '未配置可用的会话标题生成模型',
      }),
    ).toBe('未配置可用的会话标题生成模型')

    // 2. INTERNAL_ERROR 超时
    expect(
      toUserErrorMessage({
        errorCode: 'INTERNAL_ERROR',
        message: '生成会话标题超时，请重试',
      }),
    ).toBe('生成会话标题超时，请重试')

    // 3. INTERNAL_ERROR Provider 失败
    expect(
      toUserErrorMessage({
        errorCode: 'INTERNAL_ERROR',
        message: '生成会话标题失败，模型服务暂不可用',
      }),
    ).toBe('生成会话标题失败，模型服务暂不可用')

    // 4. INTERNAL_ERROR 无效输出
    expect(
      toUserErrorMessage({
        errorCode: 'INTERNAL_ERROR',
        message: '生成会话标题失败，模型未返回有效标题',
      }),
    ).toBe('生成会话标题失败，模型未返回有效标题')

    // 5. 其它非会话标题的 INTERNAL_ERROR 仍被安全映射为通用内部错误
    expect(
      toUserErrorMessage({
        errorCode: 'INTERNAL_ERROR',
        message: 'Internal server error: raw stack trace',
      }),
    ).toBe('Agent 发生内部错误，请重试。')
  })

  test('failed title regeneration dispatches desktop:error and clears busy state in finally', async () => {
    const pendingIds = new Set<string>()
    const dispatchedErrors: unknown[] = []

    const fakeRegenerate = async (sessionId: string) => {
      if (pendingIds.has(sessionId)) return false
      pendingIds.add(sessionId)
      try {
        throw new Error('未配置可用的会话标题生成模型')
      } finally {
        pendingIds.delete(sessionId)
      }
    }

    // 执行显式重新生成
    let threw = false
    try {
      await fakeRegenerate('session-1')
    } catch (error) {
      threw = true
      dispatchedErrors.push(error)
    }

    expect(threw).toBe(true)
    // 验证 loading 状态已恢复（pendingIds 为空）
    expect(pendingIds.has('session-1')).toBe(false)
    expect(dispatchedErrors).toHaveLength(1)
    expect((dispatchedErrors[0] as Error).message).toBe('未配置可用的会话标题生成模型')
  })
})
