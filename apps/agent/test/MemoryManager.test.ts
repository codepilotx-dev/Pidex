import { describe, expect, test } from 'bun:test'
import { MemoryManager } from '../src/resource/MemoryManager'

describe('MemoryManager', () => {
  test('自动收缩只写 debug，手动收缩写 info，hook 失败继续告警', async () => {
    const logs: string[] = []
    const manager = new MemoryManager({
      logger: {
        debug: (event) => {
          logs.push(`debug:${event}`)
        },
        info: (event) => {
          logs.push(`info:${event}`)
        },
        warn: (event) => {
          logs.push(`warn:${event}`)
        },
        error: () => undefined,
      },
    })
    try {
      await manager.shrink('idle')
      await manager.shrink('turn_end')
      manager.registerHook('failed', () => {
        throw new Error('hook failed')
      })
      await manager.shrink('manual')
      expect(logs).toEqual([
        'debug:memory.shrink',
        'debug:memory.shrink',
        'warn:memory.hook_failed',
        'info:memory.shrink',
      ])
    } finally {
      manager.dispose()
    }
  })
  test('returns valid memory stats', () => {
    const manager = new MemoryManager()
    const stats = manager.getStats()
    expect(stats.rss).toBeGreaterThan(0)
    expect(stats.heapTotal).toBeGreaterThan(0)
    expect(stats.heapUsed).toBeGreaterThan(0)
    expect(stats.external).toBeGreaterThanOrEqual(0)
    manager.dispose()
  })

  test('skips shrink when active turns are in flight (mutual exclusion)', async () => {
    const manager = new MemoryManager()
    let hookRan = false
    manager.registerHook('test', () => {
      hookRan = true
    })

    manager.notifyTurnStarted()
    expect(manager.diagnostics.activeTurns).toBe(1)

    const result = await manager.shrink('manual')
    expect(result.success).toBe(false)
    expect(hookRan).toBe(false)

    manager.notifyTurnCompleted()
    expect(manager.diagnostics.activeTurns).toBe(0)

    const successfulResult = await manager.shrink('manual')
    expect(successfulResult.success).toBe(true)
    expect(hookRan).toBe(true)
    expect(manager.diagnostics.shrinkCount).toBe(1)

    manager.dispose()
  })

  test('debounces turn completion and cancels debounce on new turn start', async () => {
    let shrinkCalled = false
    let currentTime = 1000
    const manager = new MemoryManager({
      debounceMs: 50,
      now: () => currentTime,
    })

    manager.registerHook('test', () => {
      shrinkCalled = true
    })

    manager.notifyTurnStarted()
    manager.notifyTurnCompleted()
    expect(shrinkCalled).toBe(false)

    // Start another turn before debounce fires
    manager.notifyTurnStarted()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(shrinkCalled).toBe(false)

    // Complete second turn and let debounce fire
    manager.notifyTurnCompleted()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(shrinkCalled).toBe(true)

    manager.dispose()
  })

  test('runs registered hooks and tolerates throwing hooks safely', async () => {
    const manager = new MemoryManager()
    let hook1Ran = false
    let hook2Ran = false

    manager.registerHook('hook1', () => {
      hook1Ran = true
      throw new Error('Hook 1 failed intentionally')
    })

    const unregister = manager.registerHook('hook2', () => {
      hook2Ran = true
    })

    const result = await manager.shrink('manual')
    expect(result.success).toBe(true)
    expect(hook1Ran).toBe(true)
    expect(hook2Ran).toBe(true)

    // Test unregistering
    hook1Ran = false
    hook2Ran = false
    unregister()

    await manager.shrink('manual')
    expect(hook1Ran).toBe(true)
    expect(hook2Ran).toBe(false)

    manager.dispose()
  })

  test('triggers idle shrink when idle timeout expires', async () => {
    let idleShrinkRan = false
    const manager = new MemoryManager({
      debounceMs: 1000,
      idleIntervalMs: 30,
    })

    manager.registerHook('idle-test', () => {
      idleShrinkRan = true
    })

    manager.notifyTurnStarted()
    manager.notifyTurnCompleted()

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(idleShrinkRan).toBe(true)

    manager.dispose()
  })
})
