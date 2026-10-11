import { describe, expect, test } from 'bun:test'
import {
  createWorkspaceHeaderStore,
  selectWorkspaceHeaderItems,
} from '../src/features/layout/workspace-header/WorkspaceHeaderStore.js'

describe('workspace header store', () => {
  test('publishes registrations and cleanup changes', () => {
    const store = createWorkspaceHeaderStore()
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })
    const unregister = store.register({
      id: 'title',
      routeScope: '/plugins',
      slot: 'center',
      align: 'center',
      order: 0,
      node: '插件',
    })

    expect(store.getSnapshot()).toHaveLength(1)
    unregister()
    expect(store.getSnapshot()).toEqual([])
    expect(notifications).toBe(2)
    unsubscribe()
  })

  test('protects a replacement registration from stale cleanup', () => {
    const store = createWorkspaceHeaderStore()
    const cleanupFirst = store.register({
      id: 'actions',
      routeScope: '/plugins',
      slot: 'right',
      align: 'end',
      order: 10,
      node: 'first',
    })
    const cleanupReplacement = store.register({
      id: 'actions',
      routeScope: '/plugins',
      slot: 'right',
      align: 'end',
      order: 10,
      node: 'replacement',
    })

    cleanupFirst()
    expect(store.getSnapshot().map((item) => item.node)).toEqual(['replacement'])
    cleanupReplacement()
    expect(store.getSnapshot()).toEqual([])
  })

  test('isolates route scopes and sorts by order then registration sequence', () => {
    const store = createWorkspaceHeaderStore()
    for (const item of [
      { id: 'last', routeScope: '/plugins', slot: 'right', align: 'end', order: 0 },
      { id: 'second', routeScope: '/plugins', slot: 'right', align: 'start', order: 2 },
      { id: 'first', routeScope: '/plugins', slot: 'right', align: 'start', order: 1 },
      { id: 'other', routeScope: '/settings', slot: 'right', align: 'start', order: 0 },
    ] as const) {
      store.register({ ...item, node: item.id })
    }

    expect(
      selectWorkspaceHeaderItems(store.getSnapshot(), '/plugins', 'right').map((item) => item.id),
    ).toEqual(['last', 'first', 'second'])
    expect(
      selectWorkspaceHeaderItems(store.getSnapshot(), '/settings').map((item) => item.id),
    ).toEqual(['other'])
  })

  test('updates an entry without changing its registration sequence', () => {
    const store = createWorkspaceHeaderStore()
    const token = Symbol('first')
    store.register(
      {
        id: 'first',
        routeScope: '/models',
        slot: 'right',
        align: 'end',
        order: 100,
        node: 'old',
      },
      token,
    )
    store.register({
      id: 'second',
      routeScope: '/models',
      slot: 'right',
      align: 'end',
      order: 100,
      node: 'second',
    })

    store.update(token, {
      id: 'first',
      routeScope: '/models',
      slot: 'right',
      align: 'end',
      order: 100,
      node: 'new',
    })

    expect(
      selectWorkspaceHeaderItems(store.getSnapshot(), '/models').map((item) => item.node),
    ).toEqual(['new', 'second'])
  })
})
