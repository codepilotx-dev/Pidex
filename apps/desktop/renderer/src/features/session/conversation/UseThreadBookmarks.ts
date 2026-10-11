import React from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { THREAD_BOOKMARKS_UPDATED_EVENT } from '../../../services/desktop-client/SessionCatalogCoordinator.js'

export type ThreadBookmarkState = {
  inputIds: ReadonlySet<string>
  version: number
} | null

export type ThreadBookmarkUpdateEvent = {
  threadId: string
  inputIds: string[]
  version: number
}

/**
 * 管理当前会话的书签集合：读取、写入与 `thread/bookmarks/updated` 事件同步。
 * 切换会话后丢弃旧会话的读取与写入结果；版本冲突时刷新为服务端最新状态，
 * 不覆盖其他窗口的操作。null 表示未协商到书签 capability 或尚未读取完成。
 */
export class ThreadBookmarkStore {
  #state: ThreadBookmarkState = null
  #sessionId = ''
  #loadToken = 0
  #listeners = new Set<() => void>()

  getSnapshot = (): ThreadBookmarkState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }

  async load(sessionId: string): Promise<void> {
    this.#sessionId = sessionId
    const token = ++this.#loadToken
    this.#state = null
    this.#emit()
    if (!sessionId) return
    try {
      const result = await desktopClient.listThreadBookmarks(sessionId)
      if (token !== this.#loadToken) return
      this.#state = result ? { inputIds: new Set(result.inputIds), version: result.version } : null
    } catch {
      if (token !== this.#loadToken) return
      this.#state = null
    }
    this.#emit()
  }

  applyEvent(payload: ThreadBookmarkUpdateEvent): void {
    if (payload.threadId !== this.#sessionId) return
    this.#state = { inputIds: new Set(payload.inputIds), version: payload.version }
    this.#emit()
  }

  async toggle(inputId: string, bookmarked: boolean): Promise<void> {
    const current = this.#state
    const requestedSessionId = this.#sessionId
    if (!current || !requestedSessionId) return
    try {
      const result = await desktopClient.setThreadBookmark(requestedSessionId, {
        inputId,
        bookmarked,
        expectedVersion: current.version,
      })
      // mock 或未协商 capability 返回 null；切换会话后不应用旧会话的写入结果。
      if (!result || this.#sessionId !== requestedSessionId) return
      this.#state = { inputIds: new Set(result.inputIds), version: result.version }
      this.#emit()
    } catch (error) {
      // 版本冲突或其他失败：刷新为服务端最新集合，保留原状态等待重试。
      const latest = await desktopClient.listThreadBookmarks(this.#sessionId).catch(() => null)
      if (latest && this.#sessionId === requestedSessionId) {
        this.#state = { inputIds: new Set(latest.inputIds), version: latest.version }
        this.#emit()
      }
      throw error
    }
  }
}

export function useThreadBookmarks(sessionId: string): {
  bookmarks: ThreadBookmarkState
  toggle: (inputId: string, bookmarked: boolean) => Promise<void>
} {
  const storeRef = React.useRef<ThreadBookmarkStore | null>(null)
  if (!storeRef.current) storeRef.current = new ThreadBookmarkStore()
  const store = storeRef.current

  React.useEffect(() => {
    void store.load(sessionId)
  }, [store, sessionId])

  React.useEffect(() => {
    const handleUpdated = (event: Event) => {
      store.applyEvent((event as CustomEvent).detail as ThreadBookmarkUpdateEvent)
    }
    window.addEventListener(THREAD_BOOKMARKS_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(THREAD_BOOKMARKS_UPDATED_EVENT, handleUpdated)
  }, [store])

  const bookmarks = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const toggle = React.useCallback(
    (inputId: string, bookmarked: boolean) => store.toggle(inputId, bookmarked),
    [store],
  )
  return { bookmarks, toggle }
}
