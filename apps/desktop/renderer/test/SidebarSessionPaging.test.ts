import { expect, test } from 'bun:test'
import {
  createSidebarSessionPagingState,
  setSidebarSessionVisibleLimit,
  syncSidebarSessionPaging,
  type SidebarSessionPagingInput,
  type SidebarSessionPagingState,
} from '../src/features/layout/sidebar/SidebarSessionPaging.js'

const INITIAL_LIMIT = 5

function state(): SidebarSessionPagingState {
  return createSidebarSessionPagingState({ groupKey: 'project:alpha', initialLimit: INITIAL_LIMIT })
}

function input(overrides: Partial<SidebarSessionPagingInput> = {}): SidebarSessionPagingInput {
  return {
    disclosureExpanded: true,
    groupKey: 'project:alpha',
    initialLimit: INITIAL_LIMIT,
    ...overrides,
  }
}

test('折叠区分页默认使用默认条数', () => {
  expect(state().visibleLimit).toBe(INITIAL_LIMIT)
})

test('展开状态下的同步保持当前分页（数据刷新与排序变化不回落）', () => {
  const expanded = setSidebarSessionVisibleLimit(state(), 20)
  const next = syncSidebarSessionPaging(expanded, input())

  expect(next).toBe(expanded)
  expect(next.visibleLimit).toBe(20)
})

test('收起期间保留内容高度，再次展开前恢复默认条数', () => {
  const expanded = setSidebarSessionVisibleLimit(state(), 20)
  const collapsed = syncSidebarSessionPaging(expanded, input({ disclosureExpanded: false }))

  expect(collapsed.visibleLimit).toBe(20)
  expect(syncSidebarSessionPaging(collapsed, input({ disclosureExpanded: false }))).toBe(collapsed)

  const reopened = syncSidebarSessionPaging(collapsed, input())

  expect(reopened.visibleLimit).toBe(INITIAL_LIMIT)
  expect(syncSidebarSessionPaging(reopened, input())).toBe(reopened)
})

test('手动展开后的条数保持不变，直到用户收起或折叠区收起', () => {
  const expanded = setSidebarSessionVisibleLimit(state(), 10)
  const next = syncSidebarSessionPaging(expanded, input())

  expect(next.visibleLimit).toBe(10)
})

test('分组实例被复用到其他分组时回到默认条数', () => {
  const expanded = setSidebarSessionVisibleLimit(state(), 20)
  const next = syncSidebarSessionPaging(expanded, input({ groupKey: 'project:beta' }))

  expect(next.groupKey).toBe('project:beta')
  expect(next.visibleLimit).toBe(INITIAL_LIMIT)
})

test('调整到相同条数时保持原状态引用', () => {
  const current = state()

  expect(setSidebarSessionVisibleLimit(current, INITIAL_LIMIT)).toBe(current)
  expect(setSidebarSessionVisibleLimit(current, (visibleLimit) => visibleLimit)).toBe(current)
})

test('展开与折叠显示按增量计算条数', () => {
  const expanded = setSidebarSessionVisibleLimit(
    state(),
    (visibleLimit) => visibleLimit + INITIAL_LIMIT,
  )

  expect(expanded.visibleLimit).toBe(INITIAL_LIMIT * 2)

  const collapsed = setSidebarSessionVisibleLimit(expanded, INITIAL_LIMIT)

  expect(collapsed.visibleLimit).toBe(INITIAL_LIMIT)
})
