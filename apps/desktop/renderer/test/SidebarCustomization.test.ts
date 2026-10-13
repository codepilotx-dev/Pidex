import { describe, expect, test } from 'bun:test'
import type { SidebarCustomization } from '../shared/Types.js'
import {
  DEFAULT_SIDEBAR_CUSTOMIZATION,
  DEFAULT_SIDEBAR_HIDDEN_DESTINATION_IDS,
  normalizeSidebarCustomization,
} from '../shared/SettingsSchema.js'
import {
  addSidebarSection,
  captureSidebarAssignments,
  restoreFailedArchiveAssignments,
  createSidebarSectionTitle,
  deleteSidebarSection,
  moveItemToSection,
  moveItemsToSection,
  orderSidebarSections,
  removeItemsFromSections,
  renameSidebarSection,
  restoreSidebarAssignments,
  setSidebarSectionCollapsed,
  setSidebarSectionItems,
  setSidebarSectionSort,
} from '../src/features/layout/sidebar/SidebarCustomization.js'
import {
  buildSidebarCustomSections,
  buildSidebarViewModel,
  sidebarClaimedItemKeys,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
} from '../src/features/layout/sidebar/SidebarViewModel.js'
import { sortSessionsForSidebar } from '../src/features/session/state/SessionSorting.js'
import type { DesktopWorkspace } from '../shared/Types.js'
import type { SessionListItem } from '../src/UiTypes.js'

function session(id: string, workspacePath = 'C:\\alpha'): SessionListItem {
  return {
    id,
    workspacePath,
    workspaceName: 'Alpha',
    createdAt: '2026-07-18T01:00:00.000Z',
    lastMessageAt: '2026-07-18T02:00:00.000Z',
    status: 'idle',
  } as unknown as SessionListItem
}

const sections: SidebarCustomization = {
  ...DEFAULT_SIDEBAR_CUSTOMIZATION,
  sections: [
    { id: 'work', title: '工作', itemKeys: ['session:a'], sort: 'manual', collapsed: false },
    { id: 'later', title: '稍后', itemKeys: ['project:id:beta'], sort: 'manual', collapsed: true },
  ],
  sectionOrder: ['work', 'later'],
}

describe('侧栏自定义分组', () => {
  test('创建分组补默认值并保持在 order 末尾', () => {
    const created = addSidebarSection(DEFAULT_SIDEBAR_CUSTOMIZATION, 'section-1')
    expect(created.sections).toHaveLength(1)
    expect(created.sections[0]).toMatchObject({
      id: 'section-1',
      title: '新建分组 1',
      itemKeys: [],
      sort: 'manual',
      collapsed: false,
    })
    expect(created.sectionOrder).toEqual(['section-1'])

    const second = addSidebarSection(created, 'section-2')
    expect(second.sections[1]?.title).toBe('新建分组 2')
    // 同名分组不会重复生成标题
    expect(createSidebarSectionTitle(second.sections)).toBe('新建分组 3')
    expect(addSidebarSection(second, 'section-1')).toBe(second)
  })

  test('重命名、折叠、排序与删除只影响目标分组', () => {
    expect(renameSidebarSection(sections, 'work', '  深度工作  ').sections[0]?.title).toBe(
      '深度工作',
    )
    expect(renameSidebarSection(sections, 'work', '   ').sections[0]?.title).toBe('工作')
    expect(setSidebarSectionCollapsed(sections, 'work', true).sections[0]?.collapsed).toBeTrue()
    expect(setSidebarSectionSort(sections, 'work', 'updated').sections[0]?.sort).toBe('updated')
    expect(orderSidebarSections(sections, ['later', 'work']).sectionOrder).toEqual([
      'later',
      'work',
    ])
    // 未出现在 order 中的分组保持原有相对位置
    expect(orderSidebarSections(sections, ['later']).sectionOrder).toEqual(['later', 'work'])
    expect(deleteSidebarSection(sections, 'work')).toMatchObject({
      sectionOrder: ['later'],
    })
    expect(deleteSidebarSection(sections, 'work').sections.map((item) => item.id)).toEqual([
      'later',
    ])
    expect(deleteSidebarSection(sections, 'missing')).toBe(sections)
  })

  test('同一键不会同时出现在多个分组', () => {
    const withTwo = setSidebarSectionItems(sections, 'later', ['session:a', 'session:b'])
    expect(withTwo.sections[0]?.itemKeys).toEqual([])
    expect(withTwo.sections[1]?.itemKeys).toEqual(['session:a', 'session:b'])
  })

  test('跨分组移动按插入位置写入并移除旧归属', () => {
    const moved = moveItemToSection(sections, 'later', 'session:a', 0)
    expect(moved.sections[0]?.itemKeys).toEqual([])
    expect(moved.sections[1]?.itemKeys).toEqual(['session:a', 'project:id:beta'])

    const emptyFirst: SidebarCustomization = {
      ...sections,
      sections: [{ ...sections.sections[0]!, itemKeys: [] }, sections.sections[1]!],
    }
    const batch = moveItemsToSection(emptyFirst, 'later', ['session:a', 'session:b'], 0)
    expect(batch.sections[1]?.itemKeys).toEqual(['session:a', 'session:b', 'project:id:beta'])
  })

  test('移除归属与归档撤销只恢复缺失条目', () => {
    expect(removeItemsFromSections(sections, ['session:a']).sections[0]?.itemKeys).toEqual([])
    expect(removeItemsFromSections(sections, [])).toBe(sections)

    const afterArchive = removeItemsFromSections(sections, ['session:a', 'project:id:beta'])
    const restored = restoreSidebarAssignments(afterArchive, {
      sectionId: 'work',
      itemKey: 'session:a',
      index: 0,
    })
    expect(restored.sections[0]?.itemKeys).toEqual(['session:a'])
    // 后续操作已经重新加入的条目不会被再次写入
    expect(
      restoreSidebarAssignments(sections, { sectionId: 'work', itemKey: 'session:a', index: 0 }),
    ).toBe(sections)
    expect(restoreSidebarAssignments(sections, null)).toBe(sections)
    // 分组已删除时保持原样，不重建存储
    expect(
      restoreSidebarAssignments(afterArchive, {
        sectionId: 'gone',
        itemKey: 'session:a',
        index: 0,
      }),
    ).toBe(afterArchive)
  })
})

describe('归档失败回滚', () => {
  test('只恢复失败条目，成功归档的条目保持移除', () => {
    const before: SidebarCustomization = {
      ...DEFAULT_SIDEBAR_CUSTOMIZATION,
      sections: [
        {
          id: 'work',
          title: '工作',
          itemKeys: ['session:a', 'session:b'],
          sort: 'manual',
          collapsed: false,
        },
      ],
      sectionOrder: ['work'],
    }
    const captured = captureSidebarAssignments(before, ['session:a', 'session:b'])
    expect([...captured.entries()]).toEqual([
      ['session:a', { sectionId: 'work', index: 0 }],
      ['session:b', { sectionId: 'work', index: 1 }],
    ])

    // 归档成功后两个条目都被移除；其中 b 失败，需要回到原位置。
    const afterArchive = removeItemsFromSections(before, ['session:a', 'session:b'])
    const rolledBack = restoreFailedArchiveAssignments(afterArchive, ['session:b'], captured)
    expect(rolledBack.sections[0]?.itemKeys).toEqual(['session:b'])

    // 分组在归档后已被删除时不重建，只保留当前状态。
    const deleted = deleteSidebarSection(afterArchive, 'work')
    expect(restoreFailedArchiveAssignments(deleted, ['session:b'], captured)).toBe(deleted)

    // 归档之后的新操作（这里是把 b 放进另一个分组）不会被回滚覆盖。
    const movedElsewhere = moveItemToSection(
      addSidebarSection(afterArchive, 'later', '稍后'),
      'later',
      'session:b',
      0,
    )
    expect(restoreFailedArchiveAssignments(movedElsewhere, ['session:b'], captured)).toBe(
      movedElsewhere,
    )
  })
})

describe('侧栏自定义分组解析', () => {
  const projects: DesktopWorkspace[] = [
    { name: 'Beta', path: 'C:\\beta', projectId: 'beta' },
    { name: 'Gamma', path: 'C:\\gamma', projectId: 'gamma' },
  ]

  test('按存储顺序解析条目，未知键不删除也不展示', () => {
    const resolved = buildSidebarCustomSections({
      sections: [
        {
          id: 'mix',
          title: '混合',
          itemKeys: ['project:id:beta', 'session:a', 'session:missing', 'project:id:gamma'],
          sort: 'manual',
          collapsed: false,
        },
      ],
      sessions: [session('a')],
      projects,
    })
    expect(resolved[0]?.entries.map((entry) => entry.key)).toEqual([
      sidebarPinnedProjectKey(projects[0]!),
      sidebarPinnedSessionKey(session('a')),
      sidebarPinnedProjectKey(projects[1]!),
    ])
  })

  test('最近更新排序把项目活动时间纳入比较', () => {
    const resolved = buildSidebarCustomSections({
      sections: [
        {
          id: 'mix',
          title: '混合',
          itemKeys: ['session:a', 'project:id:beta'],
          sort: 'updated',
          collapsed: false,
        },
      ],
      sessions: [{ ...session('a'), lastMessageAt: '2026-07-18T09:00:00.000Z' }],
      projects: [
        {
          name: 'Beta',
          path: 'C:\\beta',
          projectId: 'beta',
          lastOpenedAt: '2026-07-18T10:00:00.000Z',
        },
      ],
    })
    expect(resolved[0]?.entries.map((entry) => entry.key)).toEqual([
      sidebarPinnedProjectKey({ name: 'Beta', path: 'C:\\beta', projectId: 'beta' }),
      sidebarPinnedSessionKey(session('a')),
    ])
  })

  test('归属唯一：置顶与自定义分组共同决定条目的顶层位置', () => {
    const claimed = sidebarClaimedItemKeys({
      pinnedItems: [
        { key: 'session:pinned', kind: 'session', pinnedAt: null, session: session('pinned') },
      ],
      sections: [
        { id: 'work', title: '工作', itemKeys: ['session:a'], sort: 'manual', collapsed: false },
      ],
    })
    expect([...claimed].sort()).toEqual(['session:a', 'session:pinned'])

    const model = buildSidebarViewModel({
      recentWorkspaces: [],
      removedWorkspaces: [],
      sessionPins: {},
      sessions: [session('a'), session('b')],
      customSections: [
        { id: 'work', title: '工作', itemKeys: ['session:a'], sort: 'manual', collapsed: false },
      ],
      pendingPermissionSessionIds: new Set(),
    })
    expect(model.customSections[0]?.entries.map((entry) => entry.key)).toEqual(['session:a'])
    // 项目会话不会因为进入自定义分组而回到普通区域。
    expect(model.recentSessions).toEqual([])
    expect(model.unpinnedSessions.map((item) => item.id)).toEqual(['b'])
  })
})

describe('普通列表排序语义', () => {
  test('历史 priority 值按最近更新呈现', () => {
    const items = [
      {
        ...session('older'),
        lastMessageAt: '2026-07-18T02:00:00.000Z',
        status: 'running' as const,
      },
      { ...session('newer'), lastMessageAt: '2026-07-18T05:00:00.000Z' },
    ]
    const options = {
      needsInputSessionIds: new Set<string>(),
      unreadSessionIds: new Set<string>(),
      manualOrderByScope: {},
    }
    expect(
      sortSessionsForSidebar(items, { ...options, sort: 'priority' }).map((item) => item.id),
    ).toEqual(['newer', 'older'])
    expect(
      sortSessionsForSidebar(items, { ...options, sort: 'updated' }).map((item) => item.id),
    ).toEqual(['newer', 'older'])
  })
})

describe('自定义信息保留式迁移', () => {
  test('更高版本原样保留，禁止降级写入', () => {
    const future = { version: 2, sections: [{ id: 'x' }], extra: { keep: true } }
    expect(normalizeSidebarCustomization(future as never)).toBe(future)
  })

  test('缺失字段补默认值并保留未知条目键', () => {
    const normalized = normalizeSidebarCustomization({
      sections: [{ id: 'work', title: '工作', itemKeys: ['session:a', 'session:unknown'] }],
    })
    expect(normalized.version).toBe(1)
    expect(normalized.sections[0]).toEqual({
      id: 'work',
      title: '工作',
      itemKeys: ['session:a', 'session:unknown'],
      sort: 'manual',
      collapsed: false,
    })
    expect(normalized.sectionOrder).toEqual(['work'])
    expect(normalized.pinnedSort).toBe('manual')
    expect(normalized.destinationOrder).toEqual([
      'automations',
      'plugins',
      'providers',
      'pets',
      'sessionGroups',
    ])
    expect(normalized.hiddenDestinationIds).toEqual(['pets', 'sessionGroups'])
  })

  test('非法输入回退到默认值而不是清空', () => {
    expect(normalizeSidebarCustomization(null)).toEqual(DEFAULT_SIDEBAR_CUSTOMIZATION)
    expect(normalizeSidebarCustomization('nope')).toEqual(DEFAULT_SIDEBAR_CUSTOMIZATION)
    const duplicated = normalizeSidebarCustomization({
      sections: [{ id: 'work' }, { id: 'work' }, { id: '  ' }],
      sectionOrder: ['work', 'work'],
      destinationOrder: ['plugins', 'plugins', 'unknown'],
    })
    expect(duplicated.sections).toHaveLength(1)
    expect(duplicated.sectionOrder).toEqual(['work'])
    expect(DEFAULT_SIDEBAR_HIDDEN_DESTINATION_IDS).toEqual(['pets', 'sessionGroups'])
    // 未知目的地键保留原值，仅在缺失时补齐默认项。
    expect(duplicated.destinationOrder).toEqual([
      'plugins',
      'unknown',
      'automations',
      'providers',
      'pets',
      'sessionGroups',
    ])
  })
})

test('旧导航配置补齐宠物市场并保留已有排序和隐藏设置', () => {
  const destinationOrder = ['providers', 'plugins', 'automations', 'sessionGroups']
  const hiddenDestinationIds = ['plugins', 'sessionGroups']
  const normalized = normalizeSidebarCustomization({ destinationOrder, hiddenDestinationIds })
  expect(normalized.destinationOrder).toEqual([...destinationOrder, 'pets'])
  expect(normalized.hiddenDestinationIds).toEqual(hiddenDestinationIds)
  expect(normalized.version).toBe(1)
})

test('最近区显示项目聊天开关保留置顶和分区归属', () => {
  const project = { projectId: 'alpha', path: 'C:\\alpha', name: 'Alpha' }
  const items = ['a', 'b', 'c'].map((id) => ({
    ...session(id),
    projectId: 'alpha',
    standalone: false,
  }))
  const input = {
    sessions: items,
    recentWorkspaces: [project],
    removedWorkspaces: [],
    sessionPins: { b: '2026-10-06' },
    pendingPermissionSessionIds: new Set<string>(),
    customSections: [
      {
        id: 'work',
        title: 'Work',
        itemKeys: ['session:c'],
        sort: 'manual' as const,
        collapsed: false,
      },
    ],
  }
  expect(buildSidebarViewModel(input).recentSessions).toEqual([])
  expect(
    buildSidebarViewModel({ ...input, showProjectsInRecents: true }).recentSessions.map(
      (entry) => entry.id,
    ),
  ).toEqual(['a'])
  expect(normalizeSidebarCustomization({ showProjectsInRecents: true }).showProjectsInRecents).toBe(
    true,
  )
})
