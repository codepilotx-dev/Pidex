import { describe, expect, test } from 'bun:test'
import { createStore } from 'zustand/vanilla'

/**
 * 字段订阅隔离的回归检查：无关字段更新不得通知对应消费者。
 * 这里只验证 Store 层通知；React effect 与渲染回归由 ProviderManagementSubscription
 * 和 ComposerDraftSubscription 的真实浏览器挂载测试覆盖。
 */
describe('zustand 字段订阅隔离', () => {
  test('只有被订阅字段变化才通知消费者', () => {
    const store = createStore<{ a: number; b: number; list: readonly string[] }>()(() => ({
      a: 0,
      b: 0,
      list: [],
    }))
    let aCalls = 0
    let listCalls = 0
    store.subscribe((state, previous) => {
      if (state.a !== previous.a) aCalls += 1
    })
    store.subscribe((state, previous) => {
      if (state.list !== previous.list) listCalls += 1
    })

    store.setState({ b: 1 })
    expect([aCalls, listCalls]).toEqual([0, 0])

    store.setState({ a: 1 })
    expect([aCalls, listCalls]).toEqual([1, 0])

    store.setState({ list: [] })
    expect([aCalls, listCalls]).toEqual([1, 1])
  })

  test('缺失实体返回稳定空值，不产生新引用', () => {
    const EMPTY: readonly string[] = []
    const store = createStore<{ byId: Readonly<Record<string, readonly string[]>> }>()(() => ({
      byId: {},
    }))
    const read = (id: string) => store.getState().byId[id] ?? EMPTY
    const first = read('missing')
    const second = read('missing')
    expect(first).toBe(second)
    expect(first).toBe(EMPTY)
  })

  test('清空后重新写入仍按 id 隔离', () => {
    const store = createStore<{ byId: Readonly<Record<string, number>> }>()(() => ({ byId: {} }))
    store.setState({ byId: { a: 1, b: 2 } })
    store.setState((state) => {
      const { a: _removed, ...rest } = state.byId
      return { byId: rest }
    })
    expect(store.getState().byId.a).toBeUndefined()
    expect(store.getState().byId.b).toBe(2)
    store.setState((state) => ({ byId: { ...state.byId, a: 3 } }))
    expect(store.getState().byId).toEqual({ b: 2, a: 3 })
  })
})
