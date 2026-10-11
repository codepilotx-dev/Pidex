import { describe, expect, test } from 'bun:test'
import { orchestrateDesktopQuit } from '../src/sidecar/DesktopQuitOrchestrator'

describe('orchestrateDesktopQuit', () => {
  test('owned Agent 退出无法确认时保留桌面进程并提示重试', async () => {
    const failure = new Error('termination unconfirmed')
    const blocked: unknown[] = []
    let exited = false
    let flushed = 0

    const outcome = await orchestrateDesktopQuit({
      stopRuntime: async () => {
        throw failure
      },
      flushState: [
        async () => {
          flushed += 1
        },
        async () => {
          flushed += 1
          throw new Error('state flush failed')
        },
      ],
      exit: () => {
        exited = true
      },
      onBlocked: (error) => {
        blocked.push(error)
      },
    })

    expect(outcome).toBe('blocked')
    expect(exited).toBe(false)
    expect(flushed).toBe(2)
    expect(blocked).toEqual([failure])
  })

  test('Agent 退出已确认时在状态刷盘后退出', async () => {
    const order: string[] = []

    const outcome = await orchestrateDesktopQuit({
      stopRuntime: async () => {
        order.push('stopped')
      },
      flushState: [
        async () => {
          order.push('flushed')
        },
      ],
      exit: () => {
        order.push('exited')
      },
      onBlocked: () => {
        order.push('blocked')
      },
    })

    expect(outcome).toBe('exited')
    expect(order.at(-1)).toBe('exited')
    expect(order).not.toContain('blocked')
  })
})
