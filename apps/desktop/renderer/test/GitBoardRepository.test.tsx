import { expect, spyOn, test } from 'bun:test'
import { SidebarRow } from '../src/features/layout/sidebar/SidebarRow.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { desktopClient } from '../src/services/desktop-client/index.js'
import { reviewAgentClient } from '../src/features/review/source/ReviewAgentClient.js'
import {
  gitBoardRefreshTargets,
  loadGitBoardRepository,
} from '../src/features/git-board/GitBoardRepository.js'
import {
  GitBoardView,
  RepositoryColumn,
  gitBoardFileStatuses,
} from '../src/features/git-board/GitBoardView.js'
import * as boardContext from '../src/features/git-board/GitBoardContext.js'
import { mockWorkspace } from '../src/services/desktop-client/Fixtures.js'
import type { DesktopGitFileChange, DesktopGitStatusResult } from '../shared/Types.js'

const project = { ...mockWorkspace('C:\\board'), projectId: 'board' }
const file: DesktopGitFileChange = {
  path: 'src/nested/one.ts',
  status: 'M',
  stagedStatus: ' ',
  unstagedStatus: 'M',
  additions: null,
  deletions: null,
  isUntracked: false,
}
const result: DesktopGitStatusResult = {
  ok: true,
  status: { branchName: 'main', upstream: null, ahead: 0, behind: 0, clean: false, files: [file] },
}
const commit = {
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  subject: 'Commit subject',
  author: 'Author Name',
  authoredAt: 123456789,
}

test('仓库历史忽略快速切换前的响应，并为旧服务端查询 HEAD', async () => {
  const status = spyOn(desktopClient, 'getWorkspaceGitStatus').mockResolvedValue(result)
  const summary = spyOn(reviewAgentClient, 'summary').mockResolvedValue({
    snapshot: { totals: { additions: 12, deletions: 3 } },
  } as Awaited<ReturnType<typeof reviewAgentClient.summary>>)
  const branches = spyOn(reviewAgentClient, 'branches').mockResolvedValue([])
  let finish!: (value: (typeof commit)[]) => void
  const commits = spyOn(reviewAgentClient, 'commits')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue([commit])
  try {
    let cancelled = false
    const previous = loadGitBoardRepository(project, 'old', true, true, () => cancelled)
    while (!finish) await Promise.resolve()
    cancelled = true
    const next = await loadGitBoardRepository(project, 'new', true, true, () => false)
    finish([{ ...commit, subject: 'Stale commit' }])
    expect(await previous).toBeNull()
    expect(next?.commits?.[0]?.subject).toBe('Commit subject')
    expect(next?.diffStats).toEqual({ additions: 12, deletions: 3 })
    expect(commits.mock.calls[1]).toEqual([project.path, project.projectId, 'new'])
    branches.mockClear()
    await loadGitBoardRepository(project, undefined, false, true, () => false)
    expect(branches).not.toHaveBeenCalled()
    expect(commits.mock.calls.at(-1)).toEqual([project.path, project.projectId, undefined])
    summary.mockRejectedValueOnce(new Error('unavailable'))
    expect(
      (await loadGitBoardRepository(project, undefined, false, true, () => false))?.diffStats,
    ).toBeUndefined()
    summary.mockClear()
    status.mockResolvedValueOnce({ ok: true, status: { ...result.status, clean: true, files: [] } })
    expect(
      (await loadGitBoardRepository(project, undefined, false, true, () => false))?.diffStats,
    ).toEqual({ additions: 0, deletions: 0 })
    expect(summary).not.toHaveBeenCalled()
  } finally {
    summary.mockRestore()
    status.mockRestore()
    branches.mockRestore()
    commits.mockRestore()
  }
})

test('文件状态保留暂存和工作区的独立标识', () => {
  expect(gitBoardFileStatuses(file)).toEqual([{ code: 'M', label: '未暂存：修改' }])
  expect(gitBoardFileStatuses({ ...file, stagedStatus: 'A' }).map((item) => item.code)).toEqual([
    'A',
    'M',
  ])
  expect(gitBoardFileStatuses({ ...file, isUntracked: true }).map((item) => item.code)).toEqual([
    'U',
  ])
  expect(
    gitBoardFileStatuses({ ...file, stagedStatus: 'U', unstagedStatus: 'U' }).map(
      (item) => item.code,
    ),
  ).toEqual(['!'])
  expect(
    gitBoardFileStatuses({ ...file, stagedStatus: 'D', unstagedStatus: 'D' }).map(
      (item) => item.code,
    ),
  ).toEqual(['!'])
})

test('卡片只显示文件名、状态和单行提交作者，禁用旧服务端分支选择', () => {
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue({
    state: { quickProjectIds: ['board'], quickCollapsed: false, groups: [] },
    selectedRefs: {},
    supportsCommitRef: false,
    refresh: () => {},
    toggleQuickView: () => {},
    selectBranch: () => {},
  } as unknown as ReturnType<typeof boardContext.useGitBoard>)
  try {
    const html = renderToStaticMarkup(
      <RepositoryColumn
        project={project}
        repository={{ result, commits: [commit], diffStats: { additions: 12, deletions: 3 } }}
        onSelect={() => {}}
        onBranchChange={() => {}}
      />,
    )
    expect(html).toContain('>one.ts</span>')
    // 未提交改动行在文件名前复用文件类型图标。
    const fileNameIndex = html.indexOf('>one.ts</span>')
    expect(html.slice(html.lastIndexOf('<button', fileNameIndex), fileNameIndex)).toContain('<svg')
    expect(html).not.toContain('src/nested/one.ts')
    expect(html).toContain('>M</span>')
    expect(html).toContain('Commit subject')
    expect(html).toContain('Author Name')
    expect(html).not.toContain('aaaaaaa')
    expect(html).not.toContain('<time')
    expect(html).toContain('tw:w-[400px]')
    expect(html).toContain('tw:overflow-y-auto')
    expect(html).toContain('选择查看分支')
    expect(html).toContain('disabled=""')
    expect(html).toContain('lucide-chevron-down')
    expect(html).not.toContain('当前工作区')
    expect(html).not.toContain('从看板移除')
    expect(html).toContain('↑ 0 ↓ 0')
    expect(html).toContain('+12</span>')
    expect(html).toContain('-3</span>')
    expect(html).toContain('tw:ml-auto tw:inline-flex')
  } finally {
    hook.mockRestore()
  }
})

test('仓库分节复用共享折叠动画并默认展开', () => {
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue({
    state: { quickProjectIds: ['board'], quickCollapsed: false, groups: [] },
    selectedRefs: {},
    supportsCommitRef: false,
    refresh: () => {},
    toggleQuickView: () => {},
    selectBranch: () => {},
  } as unknown as ReturnType<typeof boardContext.useGitBoard>)
  try {
    const html = renderToStaticMarkup(
      <RepositoryColumn
        project={project}
        repository={{ result, commits: [commit] }}
        onSelect={() => {}}
        onBranchChange={() => {}}
      />,
    )
    // 未提交改动与最近提交都使用共享的 grid-rows 折叠动画，而不是原生 details。
    expect(html.match(/class="ui-disclosure-content /g)).toHaveLength(2)
    expect(html.match(/data-expanded="true"/g)).toHaveLength(2)
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2)
    expect(html).not.toContain('<details')
  } finally {
    hook.mockRestore()
  }
})

test('右侧只刷新当前分组，左侧刷新全部项目，空分组不请求仓库', () => {
  const other = { ...project, projectId: 'other' }
  expect(gitBoardRefreshTargets([project, other]).map((item) => item.projectId)).toEqual([
    'board',
    'other',
  ])
  expect(gitBoardRefreshTargets([project, other], ['other']).map((item) => item.projectId)).toEqual(
    ['other'],
  )
  expect(gitBoardRefreshTargets([project, other], [])).toEqual([])
})

test('页面直接使用速览或当前分组名称且不渲染说明与重复导航', () => {
  const controller = {
    view: { id: null as string | null, name: '速览', projectIds: [] },
    state: { quickProjectIds: [], quickCollapsed: false, groups: [] },
    projects: [],
    repositories: {},
    refreshing: false,
    refreshView: () => {},
    toggleQuickView: () => {},
  }
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(
    controller as unknown as ReturnType<typeof boardContext.useGitBoard>,
  )
  try {
    const quick = renderToStaticMarkup(<GitBoardView />)
    expect(quick).toContain('>速览</h1>')
    expect(quick).not.toContain('primary-page-layout__description')
    expect(quick).not.toContain('primary-page-layout__navigation')
    expect(quick).not.toContain('Git 看板')
    expect(quick).toContain('刷新')
    controller.view = { id: 'test', name: '测试', projectIds: [] }
    expect(renderToStaticMarkup(<GitBoardView />)).toContain('>测试</h1>')
  } finally {
    hook.mockRestore()
  }
})

test('没有尾部操作的侧栏行不预留空列', () => {
  const plain = renderToStaticMarkup(
    <SidebarRow asChild layout="flex" leadingMode="none">
      <button type="button">Row</button>
    </SidebarRow>,
  )
  expect(plain).toContain('tw:grid-cols-1')
  expect(plain).not.toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
  const actions = renderToStaticMarkup(
    <SidebarRow layout="flex" leadingMode="none" trailing={<span>Action</span>}>
      Row
    </SidebarRow>,
  )
  expect(actions).toContain('tw:grid-cols-[minmax(0,1fr)_auto]')
})
