import { createDesktopSettingsDraft } from '../src/features/settings/UseDesktopSettings.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../shared/SettingsSchema.js'
import { describe, expect, test } from 'bun:test'
import {
  addGitBoardGroup,
  defaultGitBoardState,
  deleteGitBoardGroup,
  gitBoardView,
  parseGitBoardState,
  toggleGitBoardGroupProject,
  toggleGitBoardQuickView,
} from '../src/features/git-board/GitBoardState.js'
import {
  filterGitBoardProjectIds,
  gitBoardFilterEmptyMessage,
  gitBoardRepositoryNeedsAttention,
  matchesGitBoardFilter,
} from '../src/features/git-board/GitBoardFilter.js'
import type { GitBoardRepository } from '../src/features/git-board/GitBoardRepository.js'
import type { DesktopGitFileChange, DesktopGitStatus } from '../shared/Types.js'

describe('Git board quick view and independent groups', () => {
  test('quick view persists its order and is the startup view without a default group', () => {
    expect(defaultGitBoardState().groups).toEqual([])
    let state = toggleGitBoardQuickView(toggleGitBoardQuickView(defaultGitBoardState(), 'a'), 'b')
    state = addGitBoardGroup(state, 'dev', '开发', 'c')
    const opened = gitBoardView(state, 'dev')
    expect(opened.projectIds).toEqual(['c'])
    expect(state.quickProjectIds).toEqual(['a', 'b'])
    const restored = parseGitBoardState(JSON.stringify(state))
    expect(restored).toEqual(state)
    expect(gitBoardView(restored, null)).toMatchObject({
      id: null,
      name: '速览',
      projectIds: ['a', 'b'],
    })
    expect(toggleGitBoardQuickView(state, 'a').quickProjectIds).toEqual(['b'])
  })

  test('group membership, creation and deletion never change quick view', () => {
    let state = toggleGitBoardQuickView(defaultGitBoardState(), 'a')
    state = addGitBoardGroup(addGitBoardGroup(state, 'dev', '开发', 'repo'), 'ui', '设计')
    state = toggleGitBoardGroupProject(state, 'ui', 'repo')
    expect(state.groups.map((group) => group.projectIds)).toEqual([['repo'], ['repo']])
    expect(state.quickProjectIds).toEqual(['a'])
    state = toggleGitBoardGroupProject(state, 'ui', 'repo')
    expect(state.groups[0]!.projectIds).toEqual(['repo'])
    state = deleteGitBoardGroup(state, 'dev')
    expect(gitBoardView(state, 'dev').projectIds).toEqual(['a'])
    state = deleteGitBoardGroup(state, 'ui')
    expect(state.groups).toEqual([])
    expect(state.quickProjectIds).toEqual(['a'])
  })

  test('migrates the old default group and retains custom groups', () => {
    const migrated = parseGitBoardState(
      JSON.stringify({
        groups: [
          { id: 'default', name: '默认', projectIds: ['a', 'b'] },
          { id: 'dev', name: '开发', projectIds: ['c'] },
        ],
        activeGroupId: 'dev',
      }),
    )
    expect(migrated.quickProjectIds).toEqual(['a', 'b'])
    expect(migrated.groups).toEqual([
      { id: 'dev', name: '开发', projectIds: ['c'], collapsed: false },
    ])
    expect(
      parseGitBoardState(
        JSON.stringify({
          groups: [{ id: 'dev', name: '开发', projectIds: ['c'] }],
          activeGroupId: 'dev',
        }),
      ).quickProjectIds,
    ).toEqual(['c'])
  })

  test('keeps deliberately empty quick view and group collapse state across reloads', () => {
    const state = {
      quickProjectIds: [],
      quickCollapsed: true,
      groups: [{ id: 'dev', name: '开发', projectIds: ['repo'], collapsed: true }],
    }
    expect(parseGitBoardState(JSON.stringify({ ...state, activeGroupId: 'dev' }))).toEqual(state)
    expect(gitBoardView(parseGitBoardState(JSON.stringify(state)), null).projectIds).toEqual([])
  })

  test('handles malformed local data without preventing the board from opening', () => {
    expect(parseGitBoardState('{')).toEqual(defaultGitBoardState())
    expect(parseGitBoardState('null')).toEqual(defaultGitBoardState())
    expect(
      parseGitBoardState(JSON.stringify({ quickProjectIds: ['a', null, 'a'], groups: [null] })),
    ).toEqual({ quickProjectIds: ['a'], quickCollapsed: false, groups: [] })
  })
})

test('看板设置通过桌面设置保存并恢复，空速览不会被旧数据覆盖', async () => {
  let saved = defaultDesktopStoredSettings()
  const state = addGitBoardGroup(
    toggleGitBoardQuickView(defaultGitBoardState(), 'repo'),
    'dev',
    '开发',
    'repo',
  )
  state.groups[0]!.collapsed = true
  const draft = createDesktopSettingsDraft(saved, async (next) => {
    saved = normalizeDesktopStoredSettings(next)
    return saved
  })
  draft.setValue('gitBoardState', JSON.stringify(state))
  await draft.saveFields(['gitBoardState'])
  expect(parseGitBoardState(normalizeDesktopStoredSettings(saved).gitBoardState ?? null)).toEqual(
    state,
  )
  draft.setValue('gitBoardState', JSON.stringify({ ...state, quickProjectIds: [] }))
  await draft.saveFields(['gitBoardState'])
  expect(
    parseGitBoardState(normalizeDesktopStoredSettings(saved).gitBoardState ?? null).quickProjectIds,
  ).toEqual([])
  expect(saved.sidebarLayout).toBe('modern')
})

describe('Git 看板筛选分类', () => {
  const modifiedFile: DesktopGitFileChange = {
    path: 'src/a.ts',
    status: 'M',
    stagedStatus: ' ',
    unstagedStatus: 'M',
    additions: null,
    deletions: null,
    isUntracked: false,
  }
  const repository = (status: Partial<DesktopGitStatus> = {}): GitBoardRepository => ({
    result: {
      ok: true,
      status: {
        branchName: 'main',
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
        ...status,
      },
    },
  })
  const failed: GitBoardRepository = { result: { ok: false, error: '仓库状态加载失败' } }
  const changed = repository({ clean: false, files: [modifiedFile] })
  const ahead = repository({ ahead: 2 })
  const behind = repository({ behind: 1 })
  const conflict = repository({
    clean: false,
    files: [{ ...modifiedFile, stagedStatus: 'U', unstagedStatus: 'U' }],
  })
  const clean = repository()

  test('未加载仓库在任何筛选下保留加载占位', () => {
    for (const filter of ['all', 'attention', 'changed', 'ahead', 'behind', 'conflict'] as const) {
      expect(matchesGitBoardFilter(undefined, filter)).toBe(true)
    }
  })

  test('失败仓库只在全部与待处理中可见', () => {
    expect(matchesGitBoardFilter(failed, 'all')).toBe(true)
    expect(matchesGitBoardFilter(failed, 'attention')).toBe(true)
    for (const filter of ['changed', 'ahead', 'behind', 'conflict'] as const) {
      expect(matchesGitBoardFilter(failed, filter)).toBe(false)
    }
    expect(gitBoardRepositoryNeedsAttention(failed)).toBe(true)
    expect(gitBoardRepositoryNeedsAttention(undefined)).toBe(false)
  })

  test('各筛选区分改动、ahead、behind、冲突与待处理并集', () => {
    expect(matchesGitBoardFilter(clean, 'all')).toBe(true)
    expect(matchesGitBoardFilter(clean, 'attention')).toBe(false)
    expect(matchesGitBoardFilter(clean, 'changed')).toBe(false)
    expect(matchesGitBoardFilter(changed, 'changed')).toBe(true)
    expect(matchesGitBoardFilter(ahead, 'ahead')).toBe(true)
    expect(matchesGitBoardFilter(ahead, 'behind')).toBe(false)
    expect(matchesGitBoardFilter(behind, 'behind')).toBe(true)
    expect(matchesGitBoardFilter(conflict, 'conflict')).toBe(true)
    expect(matchesGitBoardFilter(changed, 'conflict')).toBe(false)
    for (const candidate of [changed, ahead, behind, conflict, failed]) {
      expect(matchesGitBoardFilter(candidate, 'attention')).toBe(true)
    }
  })

  test('筛选项目 id 保留顺序与加载占位，无匹配时返回空数组', () => {
    const repositories: Record<string, GitBoardRepository> = { changed, failed, clean }
    expect(
      filterGitBoardProjectIds(['changed', 'missing', 'failed', 'clean'], repositories, 'all'),
    ).toEqual(['changed', 'missing', 'failed', 'clean'])
    expect(
      filterGitBoardProjectIds(
        ['changed', 'missing', 'failed', 'clean'],
        repositories,
        'attention',
      ),
    ).toEqual(['changed', 'missing', 'failed'])
    expect(filterGitBoardProjectIds(['clean'], repositories, 'conflict')).toEqual([])
  })

  test('空结果提示随筛选变化', () => {
    expect(gitBoardFilterEmptyMessage('conflict')).toBe('没有存在冲突的仓库')
    expect(gitBoardFilterEmptyMessage('attention')).toBe('没有待处理的仓库')
  })
})
