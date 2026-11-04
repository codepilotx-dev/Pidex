import React from 'react'
import { useStore } from 'zustand/react'
import { createStore } from 'zustand/vanilla'
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

type ThreadBookmarkStoreState = {
  bookmarks: ThreadBookmarkState
}

/**
 * 管理当前会话的书签集合：读取、写入与 `thread/bookmarks/updated` 事件同步。
 * 切换会话后丢弃旧会话的读取与写入结果；版本冲突时刷新为服务端最新状态，
 * 不覆盖其他窗口的操作。null 表示未协商到书签 capability 或尚未读取完成。
 * 每个挂载实例各自持有 store，避免不同会话面板互相覆盖书签。
 */
export class ThreadBookmarkStore {
  readonly store = createStore<ThreadBookmarkStoreState>()(() => ({ bookmarks: null }))
  #sessionId = ''
  #loadToken = 0

  getSnapshot = (): ThreadBookmarkState => this.store.getState().bookmarks

  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  #set(bookmarks: ThreadBookmarkState): void {
    this.store.setState({ bookmarks })
  }

  async load(sessionId: string): Promise<void> {
    this.#sessionId = sessionId
    const token = ++this.#loadToken
    this.#set(null)
    if (!sessionId) return
    try {
      const result = await desktopClient.listThreadBookmarks(sessionId)
      if (token !== this.#loadToken) return
      this.#set(result ? { inputIds: new Set(result.inputIds), version: result.version } : null)
    } catch {
      if (token !== this.#loadToken) return
      this.#set(null)
    }
  }

  applyEvent(payload: ThreadBookmarkUpdateEvent): void {
    if (payload.threadId !== this.#sessionId) return
    this.#set({ inputIds: new Set(payload.inputIds), version: payload.version })
  }

  async toggle(inputId: string, bookmarked: boolean): Promise<void> {
    const current = this.store.getState().bookmarks
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
      this.#set({ inputIds: new Set(result.inputIds), version: result.version })
    } catch (error) {
      // 版本冲突或其他失败：刷新为服务端最新集合，保留原状态等待重试。
      const latest = await desktopClient.listThreadBookmarks(this.#sessionId).catch(() => null)
      if (latest && this.#sessionId === requestedSessionId) {
        this.#set({ inputIds: new Set(latest.inputIds), version: latest.version })
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

  const bookmarks = useStore(store.store, (state) => state.bookmarks)
  const toggle = React.useCallback(
    (inputId: string, bookmarked: boolean) => store.toggle(inputId, bookmarked),
    [store],
  )
  return { bookmarks, toggle }
}
