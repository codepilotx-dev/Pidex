import { describe, expect, test } from 'bun:test'
import { TurnCoordinator } from '../src/session/TurnCoordinator'

describe('TurnCoordinator', () => {
  test('同一 Thread 只能保留一个精确活动 Turn', () => {
    const coordinator = new TurnCoordinator()
    const first = coordinator.reserve('thread-1', 'turn-1')

    expect(coordinator.reserve('thread-1', 'turn-1')).toBe(first)
    expect(() => coordinator.reserve('thread-1', 'turn-2')).toThrow(
      expect.objectContaining({ code: 'TURN_ACTIVE' }),
    )
    expect(() => coordinator.closeAdmission('thread-1', 'turn-2')).toThrow(
      expect.objectContaining({ code: 'TURN_ID_MISMATCH' }),
    )
    expect(first.acceptingSteer).toBe(true)
  })

  test('terminal promise 在 TurnRunner 完成终态后解析', async () => {
    const coordinator = new TurnCoordinator()
    const handle = coordinator.reserve('thread-1', 'turn-1')

    coordinator.finish('thread-1', 'turn-1', 'interrupted')

    await expect(handle.terminal).resolves.toBe('interrupted')
    expect(coordinator.active('thread-1')).toBeNull()
  })

  test('同一 Thread 的 admission gate 按提交顺序串行执行', async () => {
    const coordinator = new TurnCoordinator()
    const order: string[] = []
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const first = coordinator.exclusive('thread-1', async () => {
      order.push('first-start')
      markFirstStarted()
      await firstBlocked
      order.push('first-end')
    })
    const second = coordinator.exclusive('thread-1', () => {
      order.push('second')
    })

    await firstStarted
    expect(order).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])

    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })
})
