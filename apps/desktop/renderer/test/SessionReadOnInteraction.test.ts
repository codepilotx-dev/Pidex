import { describe, expect, spyOn, test } from 'bun:test'
import {
  markActiveSessionRead,
  type SessionActionContext,
} from '../src/features/session/state/SessionActions.js'
import { desktopClient } from '../src/services/desktop-client/index.js'
import type { SessionListItem } from '../src/UiTypes.js'

const unreadAt = '2026-11-06T05:28:00.000Z'

function session(id: string, unread: string | null): SessionListItem {
  return { id, unreadAt: unread } as unknown as SessionListItem
}

function createContext(sessions: SessionListItem[], activeId: string | null): SessionActionContext {
  const sessionsRef = { current: sessions }
  const activeSessionIdRef = { current: activeId }
  return {
    activeSessionIdRef,
    sessionsRef,
    sessionViewsRef: { current: {} },
    sessionWorkspacesRef: { current: {} },
    onErrorRef: { current: () => {} },
    viewSetters: {} as SessionActionContext['viewSetters'],
    setSessions: (next) => {
      sessionsRef.current =
        typeof next === 'function' ? next(sessionsRef.current) : next
    },
    setSessionId: () => {},
    setSessionStatus: () => {},
  } as SessionActionContext
}

describe('右侧工作区操作清除未读', () => {
  test('当前会话未读时操作工作区会标记已读，并清除本地未读', () => {
    const context = createContext([session('session-1', unreadAt)], 'session-1')
    const markRead = spyOn(desktopClient, 'markSessionRead').mockResolvedValue(
      {} as Awaited<ReturnType<typeof desktopClient.markSessionRead>>,
    )
    try {
      markActiveSessionRead(context)
      expect(markRead.mock.calls).toEqual([['session-1', unreadAt]])
      expect(context.sessionsRef.current[0]?.unreadAt).toBeNull()
    } finally {
      markRead.mockRestore()
    }
  })

  test('当前会话已读或没有活动会话时不发起标记请求', () => {
    const markRead = spyOn(desktopClient, 'markSessionRead').mockResolvedValue(
      {} as Awaited<ReturnType<typeof desktopClient.markSessionRead>>,
    )
    try {
      markActiveSessionRead(createContext([session('session-1', null)], 'session-1'))
      markActiveSessionRead(createContext([session('session-1', unreadAt)], null))
      expect(markRead).not.toHaveBeenCalled()
    } finally {
      markRead.mockRestore()
    }
  })

  test('只清除当前会话的未读，其他会话保持未读', () => {
    const context = createContext(
      [session('session-1', unreadAt), session('session-2', unreadAt)],
      'session-2',
    )
    const markRead = spyOn(desktopClient, 'markSessionRead').mockResolvedValue(
      {} as Awaited<ReturnType<typeof desktopClient.markSessionRead>>,
    )
    try {
      markActiveSessionRead(context)
      expect(markRead.mock.calls).toEqual([['session-2', unreadAt]])
      expect(context.sessionsRef.current.map((item) => item.unreadAt)).toEqual([unreadAt, null])
    } finally {
      markRead.mockRestore()
    }
  })
})
