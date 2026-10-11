import React from 'react'

import { liveItemTailStore } from './LiveItemTailStore.js'

/**
 * 订阅单个 item 的未提交尾部文本。只有当前正在流式、且尚未提交到 canonical
 * projection 的 item 会拿到非空值，因此重渲染范围被限制在尾部 item 上。
 */
export function useLiveItemTail(threadId: string | null | undefined, itemId: string): string {
  const threadKey = threadId ?? ''
  const subscribe = React.useCallback(
    (listener: () => void) =>
      threadKey && itemId
        ? liveItemTailStore.subscribe(threadKey, itemId, listener)
        : () => undefined,
    [itemId, threadKey],
  )
  const getSnapshot = React.useCallback(
    () => (threadKey && itemId ? liveItemTailStore.read(threadKey, itemId) : ''),
    [itemId, threadKey],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
