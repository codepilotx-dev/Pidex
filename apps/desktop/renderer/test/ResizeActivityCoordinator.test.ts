import { describe, expect, test } from 'bun:test'

import {
  createResizeActivityCoordinator,
  resizeActivityFromLegacy,
} from '../src/features/layout/shell/ResizeActivityCoordinator.js'

describe('resize activity coordinator', () => {
  test('start/end 切换降载状态并通知订阅者', () => {
    const coordinator = createResizeActivityCoordinator()
    const notifications: boolean[] = []
    const unsubscribe = coordinator.subscribe(() => {
      notifications.push(coordinator.isResizing())
    })

    expect(coordinator.isResizing()).toBe(false)
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 1 })
    expect(coordinator.isResizing()).toBe(true)
    coordinator.applyNativeActivity({ windowId: 1, phase: 'end', revision: 2 })
    expect(coordinator.isResizing()).toBe(false)

    expect(notifications).toEqual([true, false])
    unsubscribe()
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 3 })
    expect(notifications).toEqual([true, false])
  })

  test('按 revision 丢弃陈旧或重复事件', () => {
    const coordinator = createResizeActivityCoordinator()
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 5 })
    coordinator.applyNativeActivity({ windowId: 1, phase: 'end', revision: 6 })
    // 迟到的 start（revision 更小）或重复的 end 不得复活降载状态。
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 2 })
    coordinator.applyNativeActivity({ windowId: 1, phase: 'end', revision: 6 })

    expect(coordinator.isResizing()).toBe(false)
  })

  test('按窗口维护状态，一个窗口结束不影响另一个窗口', () => {
    const coordinator = createResizeActivityCoordinator()
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 1 })
    coordinator.applyNativeActivity({ windowId: 2, phase: 'start', revision: 1 })
    coordinator.applyNativeActivity({ windowId: 1, phase: 'end', revision: 2 })

    expect(coordinator.isResizing()).toBe(true)
    coordinator.applyNativeActivity({ windowId: 2, phase: 'end', revision: 2 })
    expect(coordinator.isResizing()).toBe(false)
  })

  test('看门狗在主进程事件丢失时兜底恢复渲染', async () => {
    const coordinator = createResizeActivityCoordinator({ watchdogMs: 20 })
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 1 })
    expect(coordinator.isResizing()).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(coordinator.isResizing()).toBe(false)
  })

  test('reset 清空全部窗口状态，便于卸载后不再降载', () => {
    const coordinator = createResizeActivityCoordinator()
    coordinator.applyNativeActivity({ windowId: 1, phase: 'start', revision: 1 })
    coordinator.applyNativeActivity({ windowId: 2, phase: 'start', revision: 1 })

    coordinator.reset()

    expect(coordinator.isResizing()).toBe(false)
  })

  test('旧版布尔信号合成为带 revision 的活动事件', () => {
    expect(resizeActivityFromLegacy(true, 3)).toEqual({
      windowId: 0,
      phase: 'start',
      revision: 3,
    })
    expect(resizeActivityFromLegacy(false, 4)).toEqual({
      windowId: 0,
      phase: 'end',
      revision: 4,
    })
  })
})
