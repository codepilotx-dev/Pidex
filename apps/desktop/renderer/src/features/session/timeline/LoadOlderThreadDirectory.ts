import type { CanonicalThreadState, ThreadHistoryPageLike } from '@pidex/session-view'

/** 沿现有历史游标读取，整批成功后才交给 canonical owner 提交。 */
export async function loadOlderThreadDirectory({
  initial,
  getCurrent,
  readPage,
}: {
  initial: CanonicalThreadState
  getCurrent: () => CanonicalThreadState | null
  readPage: (before: string) => Promise<ThreadHistoryPageLike>
}): Promise<ThreadHistoryPageLike | null> {
  let cursor = initial.history.olderCursor
  const pages: ThreadHistoryPageLike[] = []
  const cursors = new Set<string>()
  const isCurrent = () => {
    const current = getCurrent()
    return (
      current?.thread.id === initial.thread.id &&
      current.history.generation === initial.history.generation &&
      current.stream.streamId === initial.stream.streamId &&
      current.history.olderCursor === initial.history.olderCursor
    )
  }
  while (cursor && initial.history.hasOlder) {
    if (!isCurrent()) return null
    if (cursors.has(cursor)) throw new Error('历史游标未推进。')
    cursors.add(cursor)
    const page = await readPage(cursor)
    if (!isCurrent()) return null
    if (
      page.thread.id !== initial.thread.id ||
      page.streamPosition.streamId !== initial.stream.streamId
    )
      return null
    pages.push(page)
    if (!page.hasOlder) break
    if (!page.olderCursor) throw new Error('历史游标缺失。')
    cursor = page.olderCursor
  }
  const oldest = pages.at(-1)
  if (!oldest) return null
  // 历史快照中的队列可能早于实时事件，不能随目录补拉覆盖当前队列。
  const { queue: _queue, ...page } = oldest
  return {
    ...page,
    turns: pages.reverse().flatMap((entry) => entry.turns),
    subagents: pages.flatMap((entry) => entry.subagents),
  }
}
