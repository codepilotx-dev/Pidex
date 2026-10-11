import { describe, expect, test } from 'bun:test'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore.js'

describe('keyed disclosure store', () => {
  test('notifies only the changed key and ignores identical values', () => {
    const store = createKeyedDisclosureStore({ initialExpandedKeys: [] })
    let aCalls = 0
    let bCalls = 0
    store.subscribe('a', () => {
      aCalls += 1
    })
    store.subscribe('b', () => {
      bCalls += 1
    })

    store.setExpanded('a', true)
    store.setExpanded('a', true)

    expect(store.getSnapshot('a')).toBe(true)
    expect(aCalls).toBe(1)
    expect(bCalls).toBe(0)
  })

  test('replace notifies only changed keys without persisting', () => {
    let persistCalls = 0
    const store = createKeyedDisclosureStore({
      initialExpandedKeys: ['a', 'b'],
      persist: () => {
        persistCalls += 1
      },
    })
    let aCalls = 0
    let bCalls = 0
    let cCalls = 0
    store.subscribe('a', () => {
      aCalls += 1
    })
    store.subscribe('b', () => {
      bCalls += 1
    })
    store.subscribe('c', () => {
      cCalls += 1
    })

    store.replace(['a', 'c'])

    expect([aCalls, bCalls, cCalls]).toEqual([0, 1, 1])
    expect(persistCalls).toBe(0)
  })

  test('notifies aggregate subscribers once per update', () => {
    const store = createKeyedDisclosureStore({ initialExpandedKeys: ['a'] })
    let calls = 0
    store.subscribeAll(() => {
      calls += 1
    })

    store.replace(['b', 'c'])

    expect(calls).toBe(1)
    expect(store.getVersion()).toBe(1)
  })

  test('coalesces a rapid toggle burst and flushes the final snapshot', async () => {
    const snapshots: string[][] = []
    const store = createKeyedDisclosureStore({
      initialExpandedKeys: [],
      persistDelayMs: 10,
      persist: (keys) => snapshots.push([...keys]),
    })

    for (let index = 0; index < 60; index += 1) {
      store.setExpanded('target', index % 2 === 0)
    }
    await Bun.sleep(25)

    expect(store.getSnapshot('target')).toBe(false)
    expect(snapshots).toEqual([[]])

    store.setExpanded('target', true)
    store.flush()
    expect(snapshots).toEqual([[], ['target']])
  })
})
