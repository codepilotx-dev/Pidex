import { describe, expect, test } from 'bun:test'
import {
  canDropOnDestination,
  dropContainerKey,
  resolveSidebarDragSelection,
  type SidebarDragState,
} from '../src/features/layout/sidebar/SidebarDragContext.js'
import {
  anchorToInsertIndex,
  dropAnchorKey,
  canAcceptSidebarDrop,
  firstForeignAnchor,
  previewSidebarDrop,
  reorderSidebarKeys,
  resolveSidebarDisplayOrder,
  resolveSidebarDrop,
  resolveSidebarDropRegion,
  type SidebarDragSession,
  type SidebarDropContainer,
} from '../src/features/layout/sidebar/SidebarDragRules.js'
import {
  registerSidebarPreviewHold,
  shouldCloseSidebarPreviewOnEscape,
} from '../src/features/layout/SidebarShellState.js'
import {
  collectAllThreadPages,
  THREAD_LIST_MAX_PAGES,
} from '../src/services/desktop-client/AgentSessionClient.js'

describe('侧栏拖放规则', () => {
  test('容器键映射到具体放置目标', () => {
    expect(dropContainerKey({ kind: 'section', sectionId: 'work', index: 0 })).toBe('section:work')
    expect(dropContainerKey({ kind: 'project', projectKey: 'id:a', index: 3 })).toBe('project:id:a')
    expect(dropContainerKey({ kind: 'default', index: 1 })).toBe('default')
    expect(dropContainerKey({ kind: 'pinned', index: 2 })).toBe('pinned')
  })

  test('真实项目目标只接受本项目的子聊天，其他项目拒绝放置', () => {
    const allowedSessionKeys = ['session:a', 'session:b']
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
        allowedSessionKeys,
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
        allowedSessionKeys,
      ),
    ).toBeFalse()
    // 项目行本身不能被拖入其他项目
    expect(
      canDropOnDestination(
        { keys: ['project:id:beta'], projectKeys: ['project:id:beta'], sessionKeys: [] },
        { kind: 'project', projectKey: 'id:alpha', index: 0 },
        allowedSessionKeys,
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
    expect(state.keys).toEqual(['project:id:alpha', 'session:c'])

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

function dragState(keys: readonly string[], projectKeys: readonly string[] = []): SidebarDragState {
  return {
    keys,
    projectKeys,
    sessionKeys: keys.filter((key) => key.startsWith('session:') && !projectKeys.includes(key)),
  }
}

function dragSession(
  drag: SidebarDragState,
  sourceContainerKey: string,
  sourceOrder: readonly string[],
): SidebarDragSession {
  return {
    state: drag,
    sourceDisplayId: `${sourceContainerKey}::${drag.keys[0] ?? ''}`,
    sourceContainerKey,
    sourceOrder,
    lists: { [sourceContainerKey]: sourceOrder },
  }
}

function dropContainer(
  key: string,
  order: readonly string[],
  destination: SidebarDropContainer['destination'],
  sessionKeys?: readonly string[],
): SidebarDropContainer {
  return { key, destination, order, sessionKeys }
}

describe('侧栏拖放临时顺序与最终操作', () => {
  test('同一目标的上下半区给出不同锚点，预览与提交位置一致', () => {
    const order = ['a', 'b', 'c', 'd']
    const drag = dragSession(dragState(['a']), 'pinned', order)
    const target = dropContainer('pinned', order, { kind: 'pinned', index: 0 })
    const before = dropAnchorKey('before', 'c', order, ['a'])
    const after = dropAnchorKey('after', 'c', order, ['a'])
    expect(before).toBe('c')
    expect(after).toBe('d')
    expect(previewSidebarDrop(drag, target, before).lists.pinned).toEqual(['b', 'a', 'c', 'd'])
    expect(previewSidebarDrop(drag, target, after).lists.pinned).toEqual(['b', 'c', 'a', 'd'])
    expect(dropAnchorKey('after', 'd', order, ['a'])).toBeNull()
    expect(dropAnchorKey('after', 'b', order, ['a', 'c'])).toBe('d')
  })

  test('跨容器放到中间时不会提交到列表开头', () => {
    const drag = dragSession(dragState(['session:a']), 'recent', ['session:a'])
    const target = dropContainer('pinned', ['session:b', 'session:c'], { kind: 'pinned', index: 0 })
    const next = previewSidebarDrop(drag, target, 'session:c')
    expect(resolveSidebarDrop({
      session: drag, target, canceled: false, sourcePersistedOrder: drag.sourceOrder,
      nextOrder: next.lists.pinned,
    })).toEqual({
      status: 'commit',
      operations: [{ kind: 'moveToPinned', keys: ['session:a'], anchorKey: 'session:c' }],
    })
  })

  test('同容器排序只移动指定条目并保留其余顺序', () => {
    expect(reorderSidebarKeys(['a', 'b', 'c', 'd'], ['b'], 3)).toEqual({
      order: ['a', 'c', 'd', 'b'],
      changed: true,
    })
    expect(reorderSidebarKeys(['a', 'b'], ['a'], 0).changed).toBeFalse()
  })

  test('多选插入保持原有显示顺序', () => {
    expect(reorderSidebarKeys(['a', 'b', 'c', 'd', 'e'], ['d', 'b'], 1).order).toEqual([
      'a',
      'b',
      'd',
      'c',
      'e',
    ])
  })

  test('跨容器预览仅用于提交，显示列表保持原位', () => {
    const drag = dragSession(dragState(['session:a']), 'default', ['session:a', 'session:z'])
    const preview = previewSidebarDrop(
      drag,
      dropContainer('section:work', ['session:b'], {
        kind: 'section',
        sectionId: 'work',
        index: 0,
      }),
      null,
    )
    expect(preview.lists['section:work']).toEqual(['session:b', 'session:a'])
    expect(preview.lists.default).toEqual(['session:a', 'session:z'])
    expect(resolveSidebarDisplayOrder(preview, {
      containerKey: 'default', order: ['session:z', 'session:a'],
    })).toEqual(['session:a', 'session:z'])
    expect(
      resolveSidebarDisplayOrder(preview, { containerKey: 'section:work', order: ['session:b'] }),
    ).toEqual(['session:b'])
    // 未登记的容器继续使用持久化顺序
    expect(resolveSidebarDisplayOrder(preview, { containerKey: 'pinned', order: ['x'] })).toEqual([
      'x',
    ])
  })

  test('更换悬停容器恢复源顺序并丢弃上个目标的预览', () => {
    const initial = dragSession(dragState(['a']), 'default', ['a', 'b'])
    const reordered = previewSidebarDrop(
      initial,
      dropContainer('default', ['a', 'b'], { kind: 'default', index: 0 }),
      'b',
    )
    const cross = previewSidebarDrop(
      reordered,
      dropContainer('section:work', ['c'], { kind: 'section', sectionId: 'work', index: 0 }),
      'c',
    )
    expect(cross.lists.default).toEqual(['a', 'b'])
    const another = previewSidebarDrop(
      cross,
      dropContainer('pinned', [], { kind: 'pinned', index: 0 }),
      null,
    )
    expect(another.lists['section:work']).toBeUndefined()
    expect(another.lists.pinned).toEqual(['a'])
  })

  test('多选包含其他容器条目时回到源容器仍生成归属移动', () => {
    const result = resolveSidebarDrop({
      session: dragSession(dragState(['session:a', 'session:b']), 'section:work', ['session:a']),
      target: dropContainer('section:work', ['session:a'], {
        kind: 'section',
        sectionId: 'work',
        index: 0,
      }),
      canceled: false,
      sourcePersistedOrder: ['session:a'],
      nextOrder: ['session:a', 'session:b'],
    })
    expect(result).toEqual({
      status: 'commit',
      operations: [
        {
          kind: 'moveToSection',
          keys: ['session:a', 'session:b'],
          sectionId: 'work',
          anchorKey: null,
        },
      ],
    })  })

  test('分组只能在分组排序轴移动，聊天与项目不能进入分组排序轴', () => {
    const sections = {
      ...dropContainer('sections', ['section:a', 'section:b'], { kind: 'default', index: 0 }),
      acceptsSections: true,
    }
    expect(canAcceptSidebarDrop(dragState(['section:a']), sections)).toBeTrue()
    expect(canAcceptSidebarDrop(dragState(['session:a']), sections)).toBeFalse()
    expect(
      canAcceptSidebarDrop(
        dragState(['section:a']),
        dropContainer('sections', [], { kind: 'default', index: 0 }),
      ),
    ).toBeFalse()
    expect(
      resolveSidebarDrop({
        session: dragSession(dragState(['section:a']), 'sections', sections.order),
        target: sections,
        canceled: false,
        sourcePersistedOrder: sections.order,
        nextOrder: ['section:b', 'section:a'],
      }),
    ).toEqual({
      status: 'commit',
      operations: [{ kind: 'reorder', scopeKey: 'sections', order: ['section:b', 'section:a'] }],
    })
  })

  test('真实项目只接受本项目的整批聊天', () => {
    const own = dropContainer(
      'project:id:alpha',
      [],
      { kind: 'project', projectKey: 'id:alpha', index: 0 },
      ['session:a', 'session:b'],
    )
    expect(canAcceptSidebarDrop(dragState(['session:a', 'session:b']), own)).toBeTrue()
    // 混合载荷整批拒绝
    expect(canAcceptSidebarDrop(dragState(['session:a', 'session:c']), own)).toBeFalse()
    // 项目行不能拖进项目
    expect(
      canAcceptSidebarDrop(dragState(['project:id:beta'], ['project:id:beta']), own),
    ).toBeFalse()
  })

  test('链点表示插入到某项之前，无链点表示追加', () => {
    expect(firstForeignAnchor(['a', 'b', 'c'], ['c'])).toBeNull()
    expect(firstForeignAnchor(['a', 'b', 'c', 'd'], ['b', 'c'])).toBe('d')
    expect(firstForeignAnchor(['a', 'b'], ['a', 'b'])).toBeNull()
    // 把 a 插到 b 之前：未移动条目为 b,c，a 的位置是 0。
    expect(anchorToInsertIndex(['a', 'b', 'c'], ['a'], 'b')).toBe(0)
    expect(anchorToInsertIndex(['b', 'a', 'c'], ['a'], 'c')).toBe(1)
    // 无链点：追加到末尾。
    expect(anchorToInsertIndex(['a', 'b'], ['a'], null)).toBe(1)
  })

  test('落点区域：项目行边缘排序、中间接收；普通条目上下半区', () => {
    expect(
      resolveSidebarDropRegion({ isProjectEntry: true, offsetY: 3, height: 40, hasOwnItems: true }),
    ).toBe('before')
    expect(
      resolveSidebarDropRegion({ isProjectEntry: true, offsetY: 20, height: 40, hasOwnItems: true }),
    ).toBe('receive')
    expect(
      resolveSidebarDropRegion({ isProjectEntry: true, offsetY: 38, height: 40, hasOwnItems: true }),
    ).toBe('after')
    expect(
      resolveSidebarDropRegion({ isProjectEntry: false, offsetY: 5, height: 30, hasOwnItems: true }),
    ).toBe('before')
    expect(
      resolveSidebarDropRegion({ isProjectEntry: false, offsetY: 25, height: 30, hasOwnItems: true }),
    ).toBe('after')
  })

  test('分组只在分组排序轴内移动', () => {
    const sections = { key: 'sections', destination: { kind: 'default' as const, index: 0 } }
    expect(
      canAcceptSidebarDrop(dragState(['section:work']), { ...sections, acceptsSections: true }),
    ).toBeTrue()
    // 分组不能落到普通列表
    expect(canAcceptSidebarDrop(dragState(['section:work']), sections)).toBeFalse()
    // 聊天不能落到分组排序轴
    expect(
      canAcceptSidebarDrop(dragState(['session:a']), { ...sections, acceptsSections: true }),
    ).toBeFalse()
  })

  test('同容器排序提交一次，未变化不提交', () => {
    const drag = dragSession(dragState(['session:a']), 'default', ['session:a', 'session:b'])
    const target = dropContainer('default', ['session:b', 'session:a'], {
      kind: 'default',
      index: 1,
    })
    expect(
      resolveSidebarDrop({
        session: drag,
        target,
        canceled: false,
        sourcePersistedOrder: ['session:a', 'session:b'],
        nextOrder: ['session:b', 'session:a'],
      }),
    ).toEqual({
      status: 'commit',
      operations: [{ kind: 'reorder', scopeKey: 'default', order: ['session:b', 'session:a'] }],
    })
    expect(
      resolveSidebarDrop({
        session: drag,
        target,
        canceled: false,
        sourcePersistedOrder: ['session:a', 'session:b'],
        nextOrder: ['session:a', 'session:b'],
      }).status,
    ).toBe('canceled')
  })

  test('跨容器生成一次移动操作并保留插入链点', () => {
    const resolution = resolveSidebarDrop({
      session: dragSession(dragState(['session:a']), 'default', ['session:a']),
      target: dropContainer('section:work', ['session:b', 'session:c'], {
        kind: 'section',
        sectionId: 'work',
        index: 1,
      }),
      canceled: false,
      sourcePersistedOrder: ['session:a'],
      nextOrder: ['session:b', 'session:a', 'session:c'],
    })
    expect(resolution).toEqual({
      status: 'commit',
      operations: [
        {
          kind: 'moveToSection',
          keys: ['session:a'],
          sectionId: 'work',
          anchorKey: 'session:c',
        },
      ],
    })
  })

  test('向上插入到目标项之前时链点为下一项', () => {
    const resolution = resolveSidebarDrop({
      session: dragSession(dragState(['session:c']), 'default', ['session:c']),
      target: dropContainer('section:work', ['session:c', 'session:a', 'session:b'], {
        kind: 'section',
        sectionId: 'work',
        index: 1,
      }),
      canceled: false,
      sourcePersistedOrder: ['session:c'],
      nextOrder: ['session:c', 'session:a', 'session:b'],
    })
    // 未移动条目保持 a→b，链点为 a，语义是“插到 a 之前”。
    expect(resolution).toEqual({
      status: 'commit',
      operations: [
        { kind: 'moveToSection', keys: ['session:c'], sectionId: 'work', anchorKey: 'session:a' },
      ],
    })
    expect(anchorToInsertIndex(['session:c', 'session:a', 'session:b'], ['session:c'], 'session:a')).toBe(0)
  })

  test('放回原项目同时保存插入位置', () => {
    const resolution = resolveSidebarDrop({
      session: dragSession(dragState(['session:a']), 'section:work', ['session:x', 'session:a']),
      target: dropContainer(
        'project:id:alpha',
        ['session:a', 'session:b'],
        {
          kind: 'project',
          projectKey: 'id:alpha',
          index: 0,
        },
        ['session:a', 'session:b'],
      ),
      canceled: false,
      sourcePersistedOrder: ['session:x', 'session:a'],
      nextOrder: ['session:a', 'session:b'],
    })
    expect(resolution).toEqual({
      status: 'commit',
      operations: [
        { kind: 'restoreToProject', keys: ['session:a'], projectKey: 'id:alpha', anchorKey: 'session:b' },
      ],
    })
  })

  test('取消、无目标与跨项目整批拒绝都不产生提交', () => {
    const drag = dragSession(dragState(['session:a', 'session:c']), 'default', [
      'session:a',
      'session:c',
    ])
    const otherProject = dropContainer(
      'project:id:alpha',
      ['session:b'],
      { kind: 'project', projectKey: 'id:alpha', index: 0 },
      ['session:a'],
    )
    expect(
      resolveSidebarDrop({
        session: drag,
        target: otherProject,
        canceled: false,
        sourcePersistedOrder: ['session:a', 'session:c'],
        nextOrder: null,
      }),
    ).toEqual({ status: 'reject' })
    expect(
      resolveSidebarDrop({
        session: drag,
        target: null,
        canceled: false,
        sourcePersistedOrder: ['session:a', 'session:c'],
        nextOrder: null,
      }).status,
    ).toBe('canceled')
    expect(
      resolveSidebarDrop({
        session: drag,
        target: otherProject,
        canceled: true,
        sourcePersistedOrder: ['session:a', 'session:c'],
        nextOrder: null,
      }).status,
    ).toBe('canceled')
  })

  test('多选父子折叠后只提交父项目', () => {
    const collapsed = resolveSidebarDragSelection({
      selectedKeys: ['project:id:alpha', 'session:a'],
      fallbackKey: 'project:id:alpha',
      projectKeyOfSession: () => 'project:id:alpha',
      projectKeys: ['project:id:alpha'],
    })
    // 项目行与子聊天同时选中时，载荷只保留父项目。
    expect(collapsed.keys).toEqual(['project:id:alpha'])
    expect(collapsed.sessionKeys).toEqual([])
    const resolution = resolveSidebarDrop({
      session: dragSession(collapsed, 'default', ['project:id:alpha', 'session:a']),
      target: dropContainer('pinned', [], { kind: 'pinned', index: 0 }),
      canceled: false,
      sourcePersistedOrder: ['project:id:alpha', 'session:a'],
      nextOrder: null,
    })
    expect(resolution).toEqual({
      status: 'commit',
      operations: [{ kind: 'moveToPinned', keys: ['project:id:alpha'], anchorKey: null }],
    })
  })

  test('空组与折叠组追加到末尾，不自动展开', () => {
    const empty = dropContainer('section:empty', [], {
      kind: 'section',
      sectionId: 'empty',
      index: 0,
    })
    expect(
      resolveSidebarDrop({
        session: dragSession(dragState(['session:a']), 'default', ['session:a']),
        target: empty,
        canceled: false,
        sourcePersistedOrder: ['session:a'],
        nextOrder: ['session:a'],
      }),
    ).toEqual({
      status: 'commit',
      operations: [
        { kind: 'moveToSection', keys: ['session:a'], sectionId: 'empty', anchorKey: null },
      ],
    })
    // 折叠组同样只接收，不产生展开状态变更。
    expect(
      resolveSidebarDrop({
        session: dragSession(dragState(['session:b']), 'default', ['session:b']),
        target: empty,
        canceled: false,
        sourcePersistedOrder: ['session:b'],
        nextOrder: ['session:b'],
      }).status,
    ).toBe('commit')
  })

  test('分页隐藏项在排序后保持相对顺序', () => {
    // 显示顺序只包含可见项，隐藏项由持久化顺序补回末尾。
    const visible = ['session:a', 'session:b', 'session:c']
    const hidden = ['session:x', 'session:y']
    const moved = reorderSidebarKeys(visible, ['session:c'], 0)
    expect([...moved.order, ...hidden]).toEqual([
      'session:c',
      'session:a',
      'session:b',
      'session:x',
      'session:y',
    ])
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
