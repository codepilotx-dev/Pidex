import { describe, expect, test } from 'bun:test'
import { createFloatingUpdateScheduler } from '../src/components/ui/floating/UseFloatingPosition.js'

function createFakeFrameHost() {
  const pending = new Map<number, () => void>()
  let nextHandle = 1
  return {
    host: {
      requestAnimationFrame: (callback: () => void) => {
        const handle = nextHandle
        nextHandle += 1
        pending.set(handle, callback)
        return handle
      },
      cancelAnimationFrame: (handle: number) => {
        pending.delete(handle)
      },
    },
    flush() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
    pendingCount: () => pending.size,
  }
}

describe('浮层定位通知合并', () => {
  test('同一帧内的重复通知只测量一次', () => {
    const frame = createFakeFrameHost()
    let updates = 0
    const scheduler = createFloatingUpdateScheduler(() => {
      updates += 1
    }, frame.host)
    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    expect(frame.pendingCount()).toBe(1)
    frame.flush()
    expect(updates).toBe(1)
    // 帧执行完成后允许再次调度。
    scheduler.schedule()
    expect(frame.pendingCount()).toBe(1)
    frame.flush()
    expect(updates).toBe(2)
  })

  test('卸载取消待执行更新，之后不再测量', () => {
    const frame = createFakeFrameHost()
    let updates = 0
    const scheduler = createFloatingUpdateScheduler(() => {
      updates += 1
    }, frame.host)
    scheduler.schedule()
    scheduler.dispose()
    expect(frame.pendingCount()).toBe(0)
    frame.flush()
    expect(updates).toBe(0)
  })
})
