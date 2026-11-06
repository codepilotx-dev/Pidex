import React from 'react'

import { desktopClient } from '../../../services/desktop-client/index.js'
import type { PatchAction } from '../timeline/CanonicalItemRenderer.js'
import { normalizePatchActionError } from '../timeline/PatchActionError.js'

export type ThreadPatchApplyHandler = (
  itemId: string,
  action: PatchAction,
  expectedVersion: number,
) => Promise<void>

/**
 * 补丁撤销/重应用入口。
 *
 * 参数只接受稳定引用：`reload` 是 canonical 会话已有的重载函数，
 * `onRefreshDiff` 来自 quick chat 上下文。调用方必须先把它们从
 * `useCanonicalThreadConversation` 的返回对象上取出来再传入——该返回对象每次
 * 渲染都会重建，一旦整个对象进入依赖，流式输出时每个已挂载的历史轮次和
 * 推理/工具条目都会因为回调引用变化而失去 memo 复用。
 */
export function useThreadPatchApplier(
  activeSessionId: string | null,
  reload: () => Promise<void>,
  onRefreshDiff: () => void,
): ThreadPatchApplyHandler {
  return React.useCallback(
    async (itemId: string, action: PatchAction, expectedVersion: number): Promise<void> => {
      if (!activeSessionId) return
      try {
        await desktopClient.applyThreadPatch({
          threadId: activeSessionId,
          itemId,
          action,
          expectedVersion,
        })
        await reload()
        onRefreshDiff()
      } catch (error) {
        throw normalizePatchActionError(error, action)
      }
    },
    [activeSessionId, reload, onRefreshDiff],
  )
}
