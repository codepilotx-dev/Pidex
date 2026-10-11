import { describe, expect, test } from 'bun:test'
import { stopTerminalsBeforeSupervisor } from '../src/terminal/TerminalShutdown'

describe('终端退出顺序', () => {
  test('等待 terminal stopAll/clear 后才停止 managed Agent', async () => {
    const order: string[] = []
    let releaseTerminals!: () => void
    const terminalsStopped = new Promise<void>((resolve) => {
      releaseTerminals = resolve
    })
    const shutdown = stopTerminalsBeforeSupervisor({
      manager: {
        stopAll: async () => {
          order.push('terminal-start')
          await terminalsStopped
          order.push('terminal-clear')
        },
      },
      stopSupervisor: async () => {
        order.push('supervisor-stop')
      },
      timeoutMs: 1_000,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['terminal-start'])
    releaseTerminals()
    await shutdown
    expect(order).toEqual(['terminal-start', 'terminal-clear', 'supervisor-stop'])
  })

  test('终端清理失联时按有界超时继续停止 Agent', async () => {
    const order: string[] = []
    const shutdown = stopTerminalsBeforeSupervisor({
      manager: {
        stopAll: async () => {
          order.push('terminal-start')
          await new Promise(() => undefined)
        },
      },
      stopSupervisor: async () => {
        order.push('supervisor-stop')
      },
      timeoutMs: 10,
    })

    await shutdown
    expect(order).toEqual(['terminal-start', 'supervisor-stop'])
  })
})
