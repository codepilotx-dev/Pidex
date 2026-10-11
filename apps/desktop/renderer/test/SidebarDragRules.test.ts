import { describe, expect, test } from 'bun:test'
import {
  canDropOnDestination,
  computeSidebarInsertIndex,
  dropContainerKey,
  resolveSidebarDragSelection,
  resolveSidebarDropDestination,
} from '../src/features/layout/sidebar/SidebarDragContext.js'
import {
  registerSidebarPreviewHold,
  shouldCloseSidebarPreviewOnEscape,
} from '../src/features/layout/SidebarShellState.js'
import {
  collectAllThreadPages,
  THREAD_LIST_MAX_PAGES,
} from '../src/services/desktop-client/AgentSessionClient.js'

type FakeRow = { top: number; height: number; index: string }

function fakeContainer(
  rows: readonly FakeRow[],
  dataset: Record<string, string> = {},
): HTMLElement {
  return {
    dataset,
    querySelectorAll: () =>
      rows.map((row) => ({
        dataset: { sidebarDropIndex: row.index },
        getBoundingClientRect: () => ({
          top: row.top,
          height: row.height,
          bottom: row.top + row.height,
        }),
      })),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 300, bottom: 100 }),
  } as unknown as HTMLElement
}

const rows: FakeRow[] = [
  { top: 0, height: 30, index: '0' },
  { top: 30, height: 30, index: '1' },
  { top: 60, height: 30, index: '2' },
]

describe('侧栏拖放规则', () => {
  test('插入线跟随指针落在行的上半/下半', () => {
    const container = fakeContainer(rows)
    expect(computeSidebarInsertIndex(container, 1)).toBe(0)
    expect(computeSidebarInsertIndex(container, 20)).toBe(1)
    expect(computeSidebarInsertIndex(container, 50)).toBe(2)
    expect(computeSidebarInsertIndex(container, 999)).toBe(3)
  })

  test('容器键映射到具体放置目标', () => {
    expect(
      resolveSidebarDropDestination(fakeContainer(rows, { sidebarDropContainer: 'pinned' }), 0),
    ).toEqual({ kind: 'pinned', index: 0 })
    expect(
      resolveSidebarDropDestination(
        fakeContainer(rows, { sidebarDropContainer: 'section:work' }),
        40,
      ),
    ).toEqual({ kind: 'section', sectionId: 'work', index: 1 })
    expect(
      resolveSidebarDropDestination(
        fakeContainer(rows, { sidebarDropContainer: 'project:id:alpha' }),
        70,
      ),
    ).toEqual({ kind: 'project', projectKey: 'id:alpha', index: 2 })
    expect(resolveSidebarDropDestination(fakeContainer(rows), 0)).toBeNull()
    expect(dropContainerKey({ kind: 'section', sectionId: 'work', index: 0 })).toBe('section:work')
    expect(dropContainerKey({ kind: 'project', projectKey: 'id:a', index: 3 })).toBe('project:id:a')
    expect(dropContainerKey({ kind: 'default', index: 1 })).toBe('default')
  })

  test('真实项目目标只接受本项目的子聊天，其他项目拒绝放置', () => {
    const container = fakeContainer(rows, {
      sidebarDropContainer: 'project:id:alpha',
      sidebarProjectSessionKeys: 'session:a|session:b',
    })
    const ownSessions = resolveSidebarDragSelection({
      selectedKeys: ['session:a', 'session:b'],
      fallbackKey: 'session:a',
      projectKeyOfSession: () => 'project:id:alpha',
      projectKeys: [],
    })
    expect(
      canDropOnDestination(
        ownSessions,
        { kind: 'project', projectKey: 'id:alpha', index: 0 },
        container,
      ),
    ).toBeTrue()

    const otherProject = resolveSidebarDragSelection({
      selectedKeys: ['session:c'],
      fallbackKey: 'session:c',
      projectKeyOfSession: () => 'project:id:beta',
      projectKeys: [],
    })
    expect(
      canDropOnDestination(
        otherProject,
        { kind: 'project', projectKey: 'id:alpha', index: 0 },
        container,
      ),
    ).toBeFalse()
    // 项目行本身不能被拖入其他项目
    expect(
      canDropOnDestination(
        { keys: ['project:id:beta'], projectKeys: ['project:id:beta'], sessionKeys: [] },
        { kind: 'project', projectKey: 'id:alpha', index: 0 },
        container,
      ),
    ).toBeFalse()
  })

  test('多选拖放按父项目折叠，避免重复操作子聊天', () => {
    const projectKeys = ['project:id:alpha']
    const state = resolveSidebarDragSelection({
      selectedKeys: ['project:id:alpha', 'session:a', 'session:b', 'session:c'],
      fallbackKey: 'session:a',
      projectKeyOfSession: (key) =>
        key === 'session:b' ? 'project:id:alpha' : key === 'session:a' ? 'project:id:alpha' : null,
      projectKeys,
    })
    expect(state.projectKeys).toEqual(['project:id:alpha'])
    // session:a 与 session:b 属于已选中的父项目，被折叠掉
    expect(state.sessionKeys).toEqual(['session:c'])

    // 未选中的行只拖动自身
    const single = resolveSidebarDragSelection({
      selectedKeys: ['session:x'],
      fallbackKey: 'session:y',
      projectKeyOfSession: () => null,
      projectKeys: [],
    })
    expect(single.keys).toEqual(['session:y'])
  })

  test('预览保持注册期间 Escape 不关闭预览', () => {
    expect(shouldCloseSidebarPreviewOnEscape({ defaultPrevented: false, held: false })).toBeTrue()
    expect(shouldCloseSidebarPreviewOnEscape({ defaultPrevented: true, held: false })).toBeFalse()
    expect(shouldCloseSidebarPreviewOnEscape({ defaultPrevented: false, held: true })).toBeFalse()

    const release = registerSidebarPreviewHold('menu')
    const dragRelease = registerSidebarPreviewHold('sidebar-drag')
    expect(shouldCloseSidebarPreviewOnEscape({ defaultPrevented: false, held: true })).toBeFalse()
    release()
    dragRelease()
    expect(shouldCloseSidebarPreviewOnEscape({ defaultPrevented: false, held: false })).toBeTrue()
  })
})

describe('会话目录分页', () => {
  function thread(id: string): { id: string } {
    return { id }
  }

  test('消费 nextCursor 直到取完全部会话', async () => {
    const pages = [
      { threads: [thread('a'), thread('b')], nextCursor: 'page-2' },
      { threads: [], nextCursor: 'page-3' },
      { threads: [thread('c')], nextCursor: null },
    ]
    const cursors: Array<string | undefined> = []
    const all = await collectAllThreadPages(async (cursor) => {
      cursors.push(cursor)
      return pages[cursors.length - 1]!
    })
    expect(cursors).toEqual([undefined, 'page-2', 'page-3'])
    expect(all.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  test('超过 100 项时分页结果全部保留', async () => {
    const total = 250
    const all = await collectAllThreadPages(async (cursor) => {
      const start = cursor ? Number(cursor) : 0
      const threads = Array.from({ length: Math.min(100, total - start) }, (_, index) =>
        thread(`t${start + index}`),
      )
      const next = start + threads.length
      return { threads, nextCursor: next < total ? String(next) : null }
    })
    expect(all).toHaveLength(total)
    expect(all[0]?.id).toBe('t0')
    expect(all[total - 1]?.id).toBe(`t${total - 1}`)
  })

  test('重复 cursor 与异常页数不会无限循环', async () => {
    const repeating = await collectAllThreadPages(async () => ({
      threads: [thread('a')],
      nextCursor: 'same',
    }))
    expect(repeating.map((item) => item.id)).toEqual(['a'])

    let calls = 0
    const runaway = await collectAllThreadPages(async () => {
      calls += 1
      return { threads: [], nextCursor: `cursor-${calls}` }
    })
    expect(calls).toBe(THREAD_LIST_MAX_PAGES)
    expect(runaway).toEqual([])
  })
})
