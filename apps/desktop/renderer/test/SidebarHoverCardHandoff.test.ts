import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  HANDOFF_WINDOW_MS,
  createSidebarHoverCardCoordinator,
} from '../src/features/layout/sidebar/SidebarHoverCard.js'

type Coordinator = ReturnType<typeof createSidebarHoverCardCoordinator>

const originalWindow = globalThis.window

/** 只提供协调器真正用到的 window API，并让时间可推进。 */
function useFakeWindow(): { advance: (ms: number) => void } {
  let now = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextTimerId = 1
  const settle = (): void => {
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue
      timers.delete(id)
      timer.run()
    }
  }
  globalThis.window = {
    performance: { now: () => now },
    setTimeout: ((run: () => void, ms = 0) => {
      const id = nextTimerId++
      timers.set(id, { at: now + ms, run })
      return id
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => {
      timers.delete(id)
    }) as unknown as typeof clearTimeout,
  } as unknown as Window & typeof globalThis
  return {
    advance(ms: number): void {
      now += ms
      settle()
    },
  }
}

function openStates(): { openA: boolean | null; openB: boolean | null } {
  return { openA: state.a, openB: state.b }
}

const state: { a: boolean; b: boolean } = { a: false, b: false }

function registerPair(coordinator: Coordinator): void {
  state.a = false
  state.b = false
  coordinator.register('a', { isLocked: () => false, setOpen: (open) => (state.a = open) })
  coordinator.register('b', { isLocked: () => false, setOpen: (open) => (state.b = open) })
}

describe('SidebarHoverCard warm handoff window', () => {
  let coordinator: Coordinator
  let clock: { advance: (ms: number) => void }

  beforeEach(() => {
    clock = useFakeWindow()
    coordinator = createSidebarHoverCardCoordinator()
    registerPair(coordinator)
  })

  afterEach(() => {
    coordinator.dispose()
    globalThis.window = originalWindow
  })

  test('first hover is cold and unlocks only after the 300ms open delay', () => {
    coordinator.openAfterDelay('a')
    clock.advance(299)
    expect(openStates()).toEqual({ openA: false, openB: false })
    expect(coordinator.getOpenMode('a')).toBe('cold')

    clock.advance(1)
    expect(openStates()).toEqual({ openA: true, openB: false })
    expect(coordinator.getOpenMode('a')).toBe('cold')
  })

  test('switching to a sibling while open reuses the warm window with no delay', () => {
    coordinator.openAfterDelay('a')
    clock.advance(300)
    expect(coordinator.getOpenMode('a')).toBe('cold')

    coordinator.openAfterDelay('b')
    expect(openStates()).toEqual({ openA: false, openB: true })
    expect(coordinator.getOpenMode('b')).toBe('warm')
  })

  test('reopening inside the handoff window is warm, past it is cold again', () => {
    coordinator.openAfterDelay('a')
    clock.advance(300)
    coordinator.closeAfterDelay('a')
    clock.advance(120)
    expect(openStates()).toEqual({ openA: false, openB: false })

    clock.advance(HANDOFF_WINDOW_MS - 1)
    coordinator.openAfterDelay('b')
    expect(openStates()).toEqual({ openA: false, openB: true })
    expect(coordinator.getOpenMode('b')).toBe('warm')

    coordinator.closeAfterDelay('b')
    clock.advance(120)
    clock.advance(HANDOFF_WINDOW_MS + 1)
    coordinator.openAfterDelay('a')
    clock.advance(299)
    expect(openStates()).toEqual({ openA: false, openB: false })
    clock.advance(1)
    expect(openStates()).toEqual({ openA: true, openB: false })
    expect(coordinator.getOpenMode('a')).toBe('cold')
  })

  test('a cold open is never promoted by its own activation', () => {
    coordinator.openAfterDelay('a')
    clock.advance(300)
    // 本卡片已打开、模式已快照：再次 activate 不应改写模式。
    coordinator.openImmediately('a')
    expect(coordinator.getOpenMode('a')).toBe('cold')
  })

  test('dispose keeps state maps clean for the next session', () => {
    coordinator.openAfterDelay('a')
    clock.advance(300)
    coordinator.dispose()
    coordinator.register('a', { isLocked: () => false, setOpen: (open) => (state.a = open) })
    expect(coordinator.getOpenMode('a')).toBe('cold')
  })
})