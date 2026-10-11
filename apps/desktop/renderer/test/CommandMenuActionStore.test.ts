import { describe, expect, test } from 'bun:test'

import {
  createCommandMenuActionStore,
  filterCommandMenuActions,
  registerCommandMenuActions,
  type CommandMenuActionRegistration,
} from '../src/features/search/CommandMenuActionStore.js'

function action(
  id: string,
  overrides: Partial<CommandMenuActionRegistration> = {},
): CommandMenuActionRegistration {
  return {
    id,
    group: 'workspace-actions',
    label: id,
    keywords: [],
    order: 0,
    availability: 'available',
    execute: () => undefined,
    ...overrides,
  }
}

describe('命令菜单动作注册表', () => {
  test('按 order 和注册顺序发布，并在清理后移除动作', () => {
    const store = createCommandMenuActionStore()
    const disposeSecond = store.register(action('second', { order: 20 }))
    const disposeFirst = store.register(action('first', { order: 10 }))
    const disposeSameOrder = store.register(action('same-order', { order: 10 }))

    expect(store.getSnapshot().map((item) => item.id)).toEqual(['first', 'same-order', 'second'])

    disposeFirst()
    expect(store.getSnapshot().map((item) => item.id)).toEqual(['same-order', 'second'])
    disposeSecond()
    disposeSameOrder()
    expect(store.getSnapshot()).toEqual([])
  })

  test('更新动作时保留原注册顺序', () => {
    const store = createCommandMenuActionStore()
    const token = Symbol('action')
    store.register(action('before', { order: 10 }), token)
    store.register(action('after', { order: 10 }))

    store.update(token, action('updated', { order: 10, label: '已更新' }))

    expect(store.getSnapshot().map((item) => item.id)).toEqual(['updated', 'after'])
    expect(store.getSnapshot()[0]?.label).toBe('已更新')
  })

  test('清理后的旧动作引用不会执行，并允许重新注册新周期', async () => {
    const store = createCommandMenuActionStore()
    let oldRuns = 0
    let newRuns = 0
    const disposeOld = registerCommandMenuActions(store, [
      action('old', {
        execute: () => {
          oldRuns += 1
        },
      }),
    ])
    const staleAction = store.getSnapshot()[0]

    disposeOld()
    await staleAction?.execute()
    const disposeNew = registerCommandMenuActions(store, [
      action('new', {
        execute: () => {
          newRuns += 1
        },
      }),
    ])
    await store.getSnapshot()[0]?.execute()

    expect(oldRuns).toBe(0)
    expect(newRuns).toBe(1)
    disposeNew()
  })

  test('按标题、说明、禁用原因和关键词过滤', () => {
    const store = createCommandMenuActionStore()
    store.register(
      action('handoff', {
        group: 'task-transfer',
        label: '移交当前任务…',
        description: '迁移到工作树',
        keywords: ['handoff', 'worktree'],
        availability: 'disabled',
        disabledReason: '操作正在进行中',
      }),
    )

    for (const query of ['移交', '工作树', 'HANDOFF', 'worktree', '进行中']) {
      expect(filterCommandMenuActions(store.getSnapshot(), query)).toHaveLength(1)
    }
    expect(filterCommandMenuActions(store.getSnapshot(), '不存在')).toEqual([])
  })
})
