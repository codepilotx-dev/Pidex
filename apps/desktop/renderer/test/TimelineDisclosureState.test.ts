import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  loadTimelineDisclosureState,
  releaseTimelineDisclosureStore,
  retainTimelineDisclosureStore,
  setTimelineDisclosureExpanded,
} from '../src/features/session/timeline/TimelineDisclosureState.js'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

class MemoryStorage implements Storage {
  readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  installStorage(storage)
})

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('timeline disclosure state', () => {
  test('shares a store until the final consumer releases it', async () => {
    const first = retainTimelineDisclosureStore('thread-shared')
    const second = retainTimelineDisclosureStore('thread-shared')
    expect(second).toBe(first)

    first.setExpanded('turn-activity:turn-1', true)
    releaseTimelineDisclosureStore(first)
    await nextTask()
    expect(retainTimelineDisclosureStore('thread-shared')).toBe(first)

    releaseTimelineDisclosureStore(first)
    releaseTimelineDisclosureStore(first)
    await nextTask()

    const restored = retainTimelineDisclosureStore('thread-shared')
    expect(restored).not.toBe(first)
    expect(restored.getSnapshot('turn-activity:turn-1')).toBe(true)
    releaseTimelineDisclosureStore(restored)
  })

  test('cancels deferred cleanup when a consumer immediately returns', async () => {
    const first = retainTimelineDisclosureStore('thread-reacquire')
    releaseTimelineDisclosureStore(first)
    const reacquired = retainTimelineDisclosureStore('thread-reacquire')

    await nextTask()
    expect(reacquired).toBe(first)
    reacquired.setExpanded('tool:1', true)
    expect(reacquired.getSnapshot('tool:1')).toBe(true)
    releaseTimelineDisclosureStore(reacquired)
  })

  test('persists turn activity alongside file diffs and legacy records', () => {
    setTimelineDisclosureExpanded('thread-1', 'turn-activity:turn-1', true)
    setTimelineDisclosureExpanded('thread-1', 'file-mutation:tool-1:0', true)
    setTimelineDisclosureExpanded('thread-1', 'turn-process:turn-1', true)
    setTimelineDisclosureExpanded('thread-2', 'turn-activity:turn-2', true)

    expect([...loadTimelineDisclosureState('thread-1')]).toEqual([
      'turn-activity:turn-1',
      'file-mutation:tool-1:0',
      'turn-process:turn-1',
    ])
    expect([...loadTimelineDisclosureState('thread-2')]).toEqual(['turn-activity:turn-2'])
  })

  test('removes collapsed disclosures and refreshes recency on expansion', () => {
    setTimelineDisclosureExpanded('thread-1', 'first', true)
    setTimelineDisclosureExpanded('thread-1', 'second', true)
    setTimelineDisclosureExpanded('thread-1', 'first', true)

    expect([...loadTimelineDisclosureState('thread-1')]).toEqual(['second', 'first'])

    const nextState = setTimelineDisclosureExpanded('thread-1', 'second', false)
    expect([...nextState]).toEqual(['first'])
    expect([...loadTimelineDisclosureState('thread-1')]).toEqual(['first'])
  })

  test('keeps only the 1000 most recently expanded disclosures', () => {
    const expandedIds = Array.from({ length: 1_001 }, (_, index) => `tool:${index}`)
    storage.setItem(storageKey('thread-1'), JSON.stringify({ schemaVersion: 1, expandedIds }))

    expect([...loadTimelineDisclosureState('thread-1')]).toEqual(expandedIds.slice(1))

    const nextState = setTimelineDisclosureExpanded('thread-1', 'tool:new', true)
    expect(nextState.size).toBe(1_000)
    expect(nextState.has('tool:1')).toBe(false)
    expect([...nextState].at(-1)).toBe('tool:new')
  })

  test('rejects damaged, unknown, and invalid snapshots', () => {
    const key = storageKey('thread-1')

    storage.setItem(key, '{bad json')
    expect(loadTimelineDisclosureState('thread-1')).toEqual(new Set())

    storage.setItem(key, JSON.stringify({ schemaVersion: 2, expandedIds: ['turn:1'] }))
    expect(loadTimelineDisclosureState('thread-1')).toEqual(new Set())

    storage.setItem(key, JSON.stringify({ schemaVersion: 1, expandedIds: ['turn:1', 42] }))
    expect(loadTimelineDisclosureState('thread-1')).toEqual(new Set())
  })

  test('degrades safely when storage reads or writes fail', () => {
    installStorage({
      ...storage,
      getItem() {
        throw new Error('storage unavailable')
      },
      setItem() {
        throw new Error('storage unavailable')
      },
    } as Storage)

    expect(loadTimelineDisclosureState('thread-1')).toEqual(new Set())
    expect(setTimelineDisclosureExpanded('thread-1', 'turn-activity:turn-1', true)).toEqual(
      new Set(['turn-activity:turn-1']),
    )
  })
})

function storageKey(threadId: string): string {
  return `conversation.timeline-disclosures.v1.${threadId}`
}

function installStorage(localStorage: Storage): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
