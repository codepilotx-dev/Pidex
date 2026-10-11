import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { DesktopThreadBookmarkList } from '../shared/Types.js'
import { desktopClient } from '../src/services/desktop-client/index.js'
import {
  ThreadBookmarkStore,
  type ThreadBookmarkUpdateEvent,
} from '../src/features/session/conversation/UseThreadBookmarks.js'

const paths = (
  inputIds: string[],
  version: number,
  threadId = 'thread-1',
): DesktopThreadBookmarkList => ({
  threadId,
  inputIds,
  version,
})

const collect = (store: ThreadBookmarkStore) => {
  const snapshots: ReturnType<ThreadBookmarkStore['getSnapshot']>[] = []
  store.subscribe(() => snapshots.push(store.getSnapshot()))
  return snapshots
}

afterEach(() => {
  const list = spyOn(desktopClient, 'listThreadBookmarks')
  const set = spyOn(desktopClient, 'setThreadBookmark')
  list.mockRestore()
  set.mockRestore()
})

describe('ThreadBookmarkStore', () => {
  test('读取后按输入 id 建立书签集合并携带版本', async () => {
    const store = new ThreadBookmarkStore()
    const list = spyOn(desktopClient, 'listThreadBookmarks').mockResolvedValue(
      paths(['input-1', 'input-2'], 3),
    )
    await store.load('thread-1')
    expect(list).toHaveBeenCalledWith('thread-1')
    expect(store.getSnapshot()).toEqual({
      inputIds: new Set(['input-1', 'input-2']),
      version: 3,
    })
  })

  test('切换会话后丢弃旧会话的读取结果', async () => {
    const store = new ThreadBookmarkStore()
    const pending = Promise.withResolvers<DesktopThreadBookmarkList>()
    const list = spyOn(desktopClient, 'listThreadBookmarks')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(paths(['input-new'], 1, 'thread-2'))

    const first = store.load('thread-1')
    await store.load('thread-2')
    // 旧会话的结果在切换后返回，不得覆盖新会话状态。
    pending.resolve(paths(['input-old'], 5, 'thread-1'))
    await first
    expect(store.getSnapshot()).toEqual({ inputIds: new Set(['input-new']), version: 1 })
  })

  test('事件同步只应用当前会话的更新', () => {
    const store = new ThreadBookmarkStore()
    spyOn(desktopClient, 'listThreadBookmarks').mockResolvedValue(paths([], 0))
    return store.load('thread-1').then(() => {
      const snapshots = collect(store)
      store.applyEvent({
        threadId: 'thread-other',
        inputIds: ['input-x'],
        version: 9,
      } satisfies ThreadBookmarkUpdateEvent)
      expect(store.getSnapshot()).toEqual({ inputIds: new Set([]), version: 0 })
      expect(snapshots).toHaveLength(0)
      store.applyEvent({
        threadId: 'thread-1',
        inputIds: ['input-x'],
        version: 9,
      } satisfies ThreadBookmarkUpdateEvent)
      expect(store.getSnapshot()).toEqual({ inputIds: new Set(['input-x']), version: 9 })
      expect(snapshots).toHaveLength(1)
    })
  })

  test('toggle 成功后应用服务端集合；冲突时刷新并保留重试机会', async () => {
    const store = new ThreadBookmarkStore()
    const list = spyOn(desktopClient, 'listThreadBookmarks')
    const set = spyOn(desktopClient, 'setThreadBookmark')
    list.mockResolvedValueOnce(paths([], 0))
    await store.load('thread-1')

    // 成功路径：以当前版本提交，返回结果成为新状态。
    set.mockResolvedValueOnce(paths(['input-1'], 1))
    await store.toggle('input-1', true)
    expect(set).toHaveBeenCalledWith('thread-1', {
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 0,
    })
    expect(store.getSnapshot()).toEqual({ inputIds: new Set(['input-1']), version: 1 })

    // 冲突路径：报错向上抛出（卡片显示失败），同时刷新为服务端最新状态。
    set.mockRejectedValueOnce(Object.assign(new Error('conflict'), { errorCode: 'CONFLICT' }))
    list.mockResolvedValueOnce(paths(['input-1', 'input-2'], 4))
    await expect(store.toggle('input-2', true)).rejects.toThrow('conflict')
    expect(store.getSnapshot()).toEqual({
      inputIds: new Set(['input-1', 'input-2']),
      version: 4,
    })
  })

  test('切换会话后不应用旧会话的写入结果', async () => {
    const store = new ThreadBookmarkStore()
    const list = spyOn(desktopClient, 'listThreadBookmarks')
    const set = spyOn(desktopClient, 'setThreadBookmark')
    list.mockResolvedValueOnce(paths([], 0))
    await store.load('thread-1')

    const pending = Promise.withResolvers<DesktopThreadBookmarkList>()
    set.mockReturnValueOnce(pending.promise)
    const toggling = store.toggle('input-1', true)
    // 写入期间切换到新会话。
    list.mockResolvedValueOnce(paths(['input-new'], 2, 'thread-2'))
    await store.load('thread-2')
    pending.resolve(paths(['input-1'], 1, 'thread-1'))
    await toggling
    expect(store.getSnapshot()).toEqual({ inputIds: new Set(['input-new']), version: 2 })
  })

  test('未协商 capability（null 结果）保持 null 状态', async () => {
    const store = new ThreadBookmarkStore()
    spyOn(desktopClient, 'listThreadBookmarks').mockResolvedValue(null)
    await store.load('thread-1')
    expect(store.getSnapshot()).toBeNull()
    // toggle 在 null 状态下不发起任何写入。
    const set = spyOn(desktopClient, 'setThreadBookmark')
    await store.toggle('input-1', true)
    expect(set).not.toHaveBeenCalled()
  })
})
