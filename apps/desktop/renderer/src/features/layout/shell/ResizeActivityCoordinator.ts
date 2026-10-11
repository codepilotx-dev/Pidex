import React from 'react'
import type {
  DesktopResizeActivity,
  DesktopResizeActivityPhase,
} from '@pidex/shared/desktop-window-ipc'

/**
 * 原生窗口缩放的统一降载信号。
 *
 * 取代此前"单个易失布尔 ref"的做法：状态按 windowId 维护，事件带单调 revision，
 * 陈旧/重复事件被丢弃，并有看门狗兜底，避免主进程事件丢失时渲染端永久卡在
 * 降载状态（白屏、黑边或不再结算布局）。
 *
 * 由 `useWorkbenchShellController` 安装（shell 是桌面根布局，常驻挂载）；
 * 终端等其他消费者只读取 `isResizing()` 并订阅变化。
 */

const RESIZE_ACTIVITY_WATCHDOG_MS = 5_000

export type ResizeActivityCoordinator = {
  subscribe(listener: () => void): () => void
  /** 任一窗口正在被原生缩放。 */
  isResizing(): boolean
  /** 主进程事件入口；按 windowId + revision 收敛。 */
  applyNativeActivity(activity: DesktopResizeActivity): void
  /** 卸载或测试用：清空所有窗口状态并通知。 */
  reset(): void
}

export function createResizeActivityCoordinator(
  options: { watchdogMs?: number } = {},
): ResizeActivityCoordinator {
  const watchdogMs = options.watchdogMs ?? RESIZE_ACTIVITY_WATCHDOG_MS
  const listeners = new Set<() => void>()
  /** windowId -> 当前生效的 start revision */
  const activeWindows = new Map<number, number>()
  /** windowId -> 最近一次已接受的 revision */
  const lastRevisions = new Map<number, number>()
  let watchdog: ReturnType<typeof setTimeout> | null = null

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const armWatchdog = (): void => {
    if (watchdog !== null) {
      clearTimeout(watchdog)
      watchdog = null
    }
    if (activeWindows.size === 0) return
    watchdog = setTimeout(() => {
      watchdog = null
      if (activeWindows.size === 0) return
      // 主进程事件丢失时的兜底：宁可提前恢复渲染，也不要永久降载。
      activeWindows.clear()
      notify()
    }, watchdogMs)
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isResizing(): boolean {
      return activeWindows.size > 0
    },
    applyNativeActivity(activity: DesktopResizeActivity): void {
      const lastRevision = lastRevisions.get(activity.windowId) ?? 0
      if (activity.revision <= lastRevision) return
      lastRevisions.set(activity.windowId, activity.revision)
      if (activity.phase === 'start') {
        activeWindows.set(activity.windowId, activity.revision)
      } else {
        activeWindows.delete(activity.windowId)
      }
      armWatchdog()
      notify()
    },
    reset(): void {
      if (watchdog !== null) {
        clearTimeout(watchdog)
        watchdog = null
      }
      if (activeWindows.size === 0 && lastRevisions.size === 0) return
      activeWindows.clear()
      lastRevisions.clear()
      notify()
    },
  }
}

const resizeActivityCoordinator = createResizeActivityCoordinator()

export function getResizeActivityCoordinator(): ResizeActivityCoordinator {
  return resizeActivityCoordinator
}

/** 旧版 Electron 只有布尔信号时，用来合成带 revision 的活动事件。 */
export function resizeActivityFromLegacy(
  resizing: boolean,
  revision: number,
  windowId = 0,
): { windowId: number; phase: DesktopResizeActivityPhase; revision: number } {
  return { windowId, phase: resizing ? 'start' : 'end', revision }
}

export function useResizeActivityResizing(): boolean {
  const subscribe = React.useCallback(
    (listener: () => void) => resizeActivityCoordinator.subscribe(listener),
    [],
  )
  const getSnapshot = React.useCallback(() => resizeActivityCoordinator.isResizing(), [])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
