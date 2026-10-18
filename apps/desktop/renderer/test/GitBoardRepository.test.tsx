import { expect, spyOn, test } from 'bun:test'
import { GitBoardDetails } from '../src/features/git-board/GitBoardDetails.js'
import { AgentRpcError } from '../src/services/AgentRpcClient.js'
import { SidebarRow } from '../src/features/layout/sidebar/SidebarRow.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { desktopClient } from '../src/services/desktop-client/index.js'
import { reviewAgentClient } from '../src/features/review/source/ReviewAgentClient.js'
import {
  gitBoardRefreshTargets,
  gitBoardPollingTargets,
  loadGitBoardRepository,
} from '../src/features/git-board/GitBoardRepository.js'
import {
  GitBoardView,
  RepositoryColumn,
  gitBoardFileStatuses as reExportedGitBoardFileStatuses,
} from '../src/features/git-board/GitBoardView.js'
import {
  gitBoardFileStatuses,
  hasGitBoardConflicts,
} from '../src/features/git-board/GitBoardStatus.js'
import {
  GIT_BOARD_ACTION_ORDER,
  gitBoardActionAvailability,
} from '../src/features/git-board/GitBoardRepositoryMenu.js'
import {
  filterGitBoardBranches,
  gitBoardLocalBranches,
} from '../src/features/git-board/GitBoardCheckoutDialog.js'
import {
  GitBoardFilterBar,
  GitBoardFilterEmpty,
} from '../src/features/git-board/GitBoardFilterBar.js'
import * as boardContext from '../src/features/git-board/GitBoardContext.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
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
const cleanResult: DesktopGitStatusResult = {
  ok: true,
  status: { branchName: 'main', upstream: null, ahead: 0, behind: 0, clean: true, files: [] },
}
const commit = {
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  subject: 'Commit subject',
  author: 'Author Name',
  authoredAt: 123456789,
}

function repositoryColumnContext(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof boardContext.useGitBoard> {
  return {
    state: { quickProjectIds: ['board'], quickCollapsed: false, groups: [] },
    selectedRefs: {},
    supportsCommitRef: false,
    refresh: () => {},
    refreshView: () => {},
    toggleQuickView: () => {},
    selectBranch: () => {},
    capabilities: [],
    ...overrides,
  } as unknown as ReturnType<typeof boardContext.useGitBoard>
}

test('操作后的逐列刷新通过共享序号丢弃仍在执行的旧请求', async () => {
  const sequence = { current: 0 }
  const status = spyOn(desktopClient, 'getWorkspaceGitStatus').mockResolvedValue(cleanResult)
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
    const staleRequest = ++sequence.current
    const stale = loadGitBoardRepository(project, {
      supportsCommitRef: true,
      supportsBranches: false,
      visible: true,
      loadHistory: true,
      isCancelled: () => staleRequest !== sequence.current,
    })
    while (!finish) await Promise.resolve()
    // refreshProject(branchChanged) 递增共享序号，旧请求随后完成也必须被丢弃。
    sequence.current += 1
    const fresh = await loadGitBoardRepository(project, {
      supportsCommitRef: true,
      supportsBranches: false,
      visible: true,
      loadHistory: true,
      isCancelled: () => false,
    })
    finish([{ ...commit, subject: 'Stale commit' }])
    expect(await stale).toBeNull()
    expect(fresh?.commits?.[0]?.subject).toBe('Commit subject')
  } finally {
    status.mockRestore()
    commits.mockRestore()
  }
})

test('仓库历史忽略快速切换前的响应，分支列表按 git.review.v1 能力加载', async () => {
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
    const previous = loadGitBoardRepository(project, {
      selectedRef: 'old',
      supportsCommitRef: true,
      supportsBranches: true,
      visible: true,
      loadHistory: true,
      isCancelled: () => cancelled,
    })
    while (!finish) await Promise.resolve()
    cancelled = true
    const next = await loadGitBoardRepository(project, {
      selectedRef: 'new',
      supportsCommitRef: true,
      supportsBranches: true,
      visible: true,
      loadHistory: true,
      isCancelled: () => false,
    })
    finish([{ ...commit, subject: 'Stale commit' }])
    expect(await previous).toBeNull()
    expect(next?.commits?.[0]?.subject).toBe('Commit subject')
    expect(next?.diffStats).toEqual({ additions: 12, deletions: 3 })
    // 侧栏按 10 条步进补拉：缺省请求 10 条，切换分支时同样带上当前上限。
    expect(commits.mock.calls[1]).toEqual([project.path, project.projectId, 'new', 10])
    branches.mockClear()
    await loadGitBoardRepository(project, {
      supportsCommitRef: false,
      supportsBranches: false,
      visible: true,
      loadHistory: true,
      isCancelled: () => false,
    })
    expect(branches).not.toHaveBeenCalled()
    expect(commits.mock.calls.at(-1)).toEqual([project.path, project.projectId, undefined, 10])
    // 签出选择器只需要 git.review.v1：历史引用能力缺失时分支列表仍然加载。
    await loadGitBoardRepository(project, {
      supportsCommitRef: false,
      supportsBranches: true,
      visible: true,
      loadHistory: true,
      isCancelled: () => false,
    })
    expect(branches).toHaveBeenCalledTimes(1)
    summary.mockRejectedValueOnce(new Error('unavailable'))
    expect(
      (
        await loadGitBoardRepository(project, {
          supportsCommitRef: false,
          supportsBranches: false,
          visible: true,
          loadHistory: true,
          isCancelled: () => false,
        })
      )?.diffStats,
    ).toBeUndefined()
    summary.mockClear()
    status.mockResolvedValueOnce(cleanResult)
    expect(
      (
        await loadGitBoardRepository(project, {
          supportsCommitRef: false,
          supportsBranches: false,
          visible: true,
          loadHistory: true,
          isCancelled: () => false,
        })
      )?.diffStats,
    ).toEqual({ additions: 0, deletions: 0 })
    expect(summary).not.toHaveBeenCalled()
  } finally {
    summary.mockRestore()
    status.mockRestore()
    branches.mockRestore()
    commits.mockRestore()
  }
})

test('文件状态保留暂存和工作区的独立标识并复用冲突判定', () => {
  // GitBoardView 继续重导出文件状态判定，避免调用方迁移。
  expect(reExportedGitBoardFileStatuses).toBe(gitBoardFileStatuses)
  expect(gitBoardFileStatuses(file)).toEqual([{ code: 'M', label: '未暂存：修改' }])
  expect(gitBoardFileStatuses({ ...file, stagedStatus: 'A' }).map((item) => item.code)).toEqual([
    'A',
    'M',
  ])
  expect(gitBoardFileStatuses({ ...file, isUntracked: true }).map((item) => item.code)).toEqual([
    'U',
  ])
  const conflicted = { ...file, stagedStatus: 'U', unstagedStatus: 'U' }
  expect(gitBoardFileStatuses(conflicted).map((item) => item.code)).toEqual(['!'])
  expect(hasGitBoardConflicts([file, conflicted])).toBe(true)
  expect(hasGitBoardConflicts([file])).toBe(false)
  expect(hasGitBoardConflicts([{ ...file, isUntracked: true, stagedStatus: 'U' }])).toBe(false)
  expect(
    gitBoardFileStatuses({ ...file, stagedStatus: 'D', unstagedStatus: 'D' }).map(
      (item) => item.code,
    ),
  ).toEqual(['!'])
})

test('卡片只显示文件名、状态，提交历史已移入侧栏，禁用旧服务端分支选择', () => {
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(repositoryColumnContext())
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
    // 主区域不再渲染“最近提交”区块；提交历史只在侧栏仓库行下方展示。
    expect(html).not.toContain('最近提交')
    expect(html).not.toContain('Commit subject')
    expect(html).not.toContain('Author Name')
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
    // 列头提供仓库操作菜单；能力缺失时在列内说明禁用原因。
    expect(html).toContain('aria-label="board：仓库操作"')
    expect(html).toContain('当前服务不支持：提交、推送、创建分支、签出分支、Fetch、Pull')
  } finally {
    hook.mockRestore()
  }
})

test('仓库操作按 capability、仓库状态与忙碌状态禁用', () => {
  const allCapabilities = [
    'git.review.v1',
    'github.pullRequests.v1',
    'git.workspace.v1',
    'git.sync.v1',
  ] as const
  const ready = gitBoardActionAvailability({
    capabilities: allCapabilities,
    available: true,
    busy: false,
  })
  expect(ready.missing).toEqual([])
  expect(GIT_BOARD_ACTION_ORDER.every((action) => !ready.isDisabled(action))).toBe(true)
  expect(
    GIT_BOARD_ACTION_ORDER.every((action) =>
      gitBoardActionAvailability({
        capabilities: allCapabilities,
        available: false,
        busy: false,
      }).isDisabled(action),
    ),
  ).toBe(true)
  expect(
    GIT_BOARD_ACTION_ORDER.every((action) =>
      gitBoardActionAvailability({
        capabilities: allCapabilities,
        available: true,
        busy: true,
      }).isDisabled(action),
    ),
  ).toBe(true)
  const reviewOnly = gitBoardActionAvailability({
    capabilities: ['git.review.v1'],
    available: true,
    busy: false,
  })
  expect(reviewOnly.missing).toEqual(['push', 'createBranch', 'checkoutBranch', 'fetch', 'pull'])
  expect(reviewOnly.isDisabled('commit')).toBe(false)
  expect(reviewOnly.isDisabled('fetch')).toBe(true)
})

test('仓库状态不可用时列内说明全部仓库操作已禁用', () => {
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(
    repositoryColumnContext({
      capabilities: ['git.review.v1', 'github.pullRequests.v1', 'git.workspace.v1', 'git.sync.v1'],
    }),
  )
  try {
    const html = renderToStaticMarkup(
      <RepositoryColumn
        project={project}
        repository={{ result: { ok: false, error: '仓库状态加载失败' } }}
        onSelect={() => {}}
        onBranchChange={() => {}}
      />,
    )
    expect(html).toContain('仓库状态不可用，仓库操作已禁用')
    expect(html).not.toContain('当前服务不支持')
  } finally {
    hook.mockRestore()
  }
})

test('签出选择器只列本地分支，支持搜索过滤且未加载时可重试', () => {
  const branches = [
    { name: 'main', sha: 'a', current: true, remote: false },
    { name: 'origin/main', sha: 'a', current: false, remote: true },
    { name: 'feature/x', sha: 'b', current: false, remote: false },
  ]
  expect(gitBoardLocalBranches({ result, branches })?.map((branch) => branch.name)).toEqual([
    'main',
    'feature/x',
  ])
  // 分支列表未加载时返回 null，由对话框展示加载/重试状态。
  expect(gitBoardLocalBranches({ result })).toBeNull()
  expect(
    filterGitBoardBranches(
      branches.filter((branch) => !branch.remote),
      'FEAT',
    ).map((branch) => branch.name),
  ).toEqual(['feature/x'])
  expect(filterGitBoardBranches([branches[0]!], '   ').map((branch) => branch.name)).toEqual([
    'main',
  ])
})

test('筛选栏显示匹配数量，空结果提供重置入口', () => {
  const bar = renderToStaticMarkup(
    <GitBoardFilterBar filter="attention" matched={0} total={3} onChange={() => {}} />,
  )
  expect(bar).toContain('aria-label="仓库筛选"')
  expect(bar).toContain('待处理')
  expect(bar).toContain('匹配 0 / 3 个仓库')
  const empty = renderToStaticMarkup(<GitBoardFilterEmpty filter="conflict" onReset={() => {}} />)
  expect(empty).toContain('没有存在冲突的仓库')
  expect(empty).toContain('查看全部仓库')
})

test('仓库分节只剩未提交改动，仍复用共享折叠动画并默认展开', () => {
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(repositoryColumnContext())
  try {
    const html = renderToStaticMarkup(
      <RepositoryColumn
        project={project}
        repository={{ result, commits: [commit] }}
        onSelect={() => {}}
        onBranchChange={() => {}}
      />,
    )
    // 提交历史移入侧栏后，列内只有“未提交改动”一个分节。
    expect(html.match(/class="ui-disclosure-content /g)).toHaveLength(1)
    expect(html.match(/data-expanded="true"/g)).toHaveLength(1)
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(html).not.toContain('<details')
  } finally {
    hook.mockRestore()
  }
})

test('非仓库项目由共享客户端控制冷却，拒绝访问与已删除项目仍暂停轮询', () => {
  const projects = ['missing', 'denied', 'removed', 'transient', 'ready', 'new'].map((id) => ({
    ...project,
    projectId: id,
  }))
  const repositories = {
    missing: {
      result: { ok: false as const, error: '不是 Git 仓库', errorCode: 'REPOSITORY_NOT_FOUND' },
    },
    denied: { result: { ok: false as const, error: '路径拒绝', errorCode: 'PATH_DENIED' } },
    removed: {
      result: { ok: false as const, error: '项目不存在', errorCode: 'PROJECT_NOT_FOUND' },
    },
    transient: {
      result: { ok: false as const, error: '暂时失败', errorCode: 'GIT_COMMAND_FAILED' },
    },
    ready: { result },
  }
  expect(gitBoardPollingTargets(projects, repositories).map((item) => item.projectId)).toEqual([
    'missing',
    'transient',
    'ready',
    'new',
  ])
  expect(gitBoardRefreshTargets(projects, ['missing']).map((item) => item.projectId)).toEqual([
    'missing',
  ])
  expect(
    gitBoardPollingTargets(projects, { ...repositories, missing: { result } }).map(
      (item) => item.projectId,
    ),
  ).toContain('missing')
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
    view: { id: null as string | null, name: '速览', projectIds: [] as string[] },
    state: { quickProjectIds: [], quickCollapsed: false, groups: [] },
    projects: [project],
    repositories: {} as Record<string, { result: DesktopGitStatusResult }>,
    capabilities: [] as string[],
    ready: true,
    refreshing: false,
    refreshView: () => {},
    refreshProject: () => {},
    toggleQuickView: () => {},
  }
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(
    controller as unknown as ReturnType<typeof boardContext.useGitBoard>,
  )
  const render = () =>
    renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <GitBoardView />
      </DesktopSettingsProvider>,
    )
  try {
    const quick = render()
    expect(quick).toContain('>速览</h1>')
    expect(quick).not.toContain('primary-page-layout__description')
    expect(quick).not.toContain('primary-page-layout__navigation')
    expect(quick).not.toContain('Git 看板')
    expect(quick).toContain('刷新')
    controller.view = { id: 'test', name: '测试', projectIds: [project.projectId!] }
    controller.projects = [project]
    controller.repositories = { [project.projectId!]: { result } }
    const filtered = render()
    expect(filtered).toContain('>测试</h1>')
    expect(filtered).toContain('primary-page-layout__navigation')
    expect(filtered).toContain('aria-label="仓库筛选"')
    expect(filtered).toContain('匹配 1 / 1 个仓库')
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

test('同一不可用状态的后台刷新不重试 Review，状态变化或手动刷新后恢复', async () => {
  const status = spyOn(desktopClient, 'getWorkspaceGitStatus').mockResolvedValue(result)
  const summary = spyOn(reviewAgentClient, 'summary').mockRejectedValue(
    new AgentRpcError('merge 进行中', 503, { code: 'REVIEW_SOURCE_UNAVAILABLE' }),
  )
  const commits = spyOn(reviewAgentClient, 'commits').mockResolvedValue([commit])
  const options = {
    supportsCommitRef: false,
    supportsBranches: false,
    visible: true,
    loadHistory: true,
    isCancelled: () => false,
  }
  try {
    const first = await loadGitBoardRepository(project, options)
    expect(first?.summaryUnavailable).toBe(true)
    const background = await loadGitBoardRepository(project, {
      ...options,
      background: true,
      previousRepository: first!,
    })
    expect(summary).toHaveBeenCalledTimes(1)
    expect(background?.summaryUnavailable).toBe(true)
    expect(background?.diffStats).toBeUndefined()
    expect(background?.commits).toEqual([commit])
    const successfulSummary = { snapshot: { totals: { additions: 2, deletions: 1 } } } as Awaited<
      ReturnType<typeof reviewAgentClient.summary>
    >
    summary.mockResolvedValue(successfulSummary)
    const manual = await loadGitBoardRepository(project, {
      ...options,
      previousRepository: background!,
    })
    expect(summary).toHaveBeenCalledTimes(2)
    expect(manual?.summaryUnavailable).toBeUndefined()
    expect(manual?.diffStats).toEqual({ additions: 2, deletions: 1 })
    status.mockResolvedValue({
      ...result,
      status: { ...result.status, files: [{ ...file, path: 'changed.ts' }] },
    })
    const changed = await loadGitBoardRepository(project, {
      ...options,
      background: true,
      previousRepository: background!,
    })
    expect(summary).toHaveBeenCalledTimes(3)
    expect(changed?.diffStats).toEqual({ additions: 2, deletions: 1 })
  } finally {
    status.mockRestore()
    summary.mockRestore()
    commits.mockRestore()
  }
})

test('冲突仓库继续加载状态和历史但跳过 Review，已取消任务不再发出请求', async () => {
  const status = spyOn(desktopClient, 'getWorkspaceGitStatus').mockResolvedValue({
    ...result,
    status: { ...result.status, files: [{ ...file, stagedStatus: 'U', unstagedStatus: 'U' }] },
  })
  const summary = spyOn(reviewAgentClient, 'summary')
  const commits = spyOn(reviewAgentClient, 'commits').mockResolvedValue([commit])
  const options = {
    supportsCommitRef: false,
    supportsBranches: false,
    visible: true,
    loadHistory: true,
    isCancelled: () => false,
  }
  try {
    const conflicted = await loadGitBoardRepository(project, options)
    expect(summary).not.toHaveBeenCalled()
    expect(conflicted?.summaryUnavailable).toBe(true)
    expect(conflicted?.commits).toEqual([commit])
    for (const background of [true, false]) {
      await loadGitBoardRepository(project, {
        ...options,
        background,
        previousRepository: conflicted!,
      })
    }
    expect(summary).not.toHaveBeenCalled()
    expect(
      await loadGitBoardRepository(project, { ...options, isCancelled: () => true }),
    ).toBeNull()
    expect(status).toHaveBeenCalledTimes(3)
    expect(commits).toHaveBeenCalledTimes(3)
    status.mockResolvedValueOnce(result)
    summary.mockResolvedValueOnce({
      snapshot: { totals: { additions: 1, deletions: 0 } },
    } as Awaited<ReturnType<typeof reviewAgentClient.summary>>)
    const recovered = await loadGitBoardRepository(project, {
      ...options,
      background: true,
      previousRepository: conflicted!,
    })
    expect(summary).toHaveBeenCalledTimes(1)
    expect(recovered?.diffStats).toEqual({ additions: 1, deletions: 0 })
  } finally {
    status.mockRestore()
    summary.mockRestore()
    commits.mockRestore()
  }
})

test('冲突详情显示普通状态说明，仓库列继续展示冲突文件', () => {
  const conflictedResult: DesktopGitStatusResult = {
    ok: true,
    status: { ...result.status, files: [{ ...file, stagedStatus: 'U', unstagedStatus: 'U' }] },
  }
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(repositoryColumnContext())
  try {
    const column = renderToStaticMarkup(
      <RepositoryColumn
        project={project}
        repository={{ result: conflictedResult, commits: [commit] }}
        onSelect={() => {}}
        onBranchChange={() => {}}
      />,
    )
    expect(column).toContain('存在未解决的冲突')
    expect(column).toContain('aria-label="冲突"')
    // 冲突文件仍在列内展示，提交历史已移到侧栏。
    expect(column).toContain('>one.ts</span>')
    expect(column).not.toContain(commit.subject)
    const details = renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <GitBoardDetails
          project={project}
          source={{ kind: 'uncommitted' }}
          path={file.path}
          hasConflicts
          onClose={() => {}}
        />
      </DesktopSettingsProvider>,
    )
    expect(details).toContain('冲突解除后将自动恢复')
    expect(details).not.toContain('role="alert"')
    expect(details).not.toContain('加载中')
  } finally {
    hook.mockRestore()
  }
})


test('仅侧栏可见的仓库加载历史，不请求主区域 Diff 和分支', async () => {
  const status = spyOn(desktopClient, 'getWorkspaceGitStatus').mockResolvedValue(result)
  const summary = spyOn(reviewAgentClient, 'summary')
  const branches = spyOn(reviewAgentClient, 'branches')
  const commits = spyOn(reviewAgentClient, 'commits').mockResolvedValue([commit])
  try {
    const loaded = await loadGitBoardRepository(project, {
      supportsCommitRef: true, supportsBranches: true, visible: false,
      loadHistory: true, selectedRef: 'feature', isCancelled: () => false,
    })
    expect(loaded?.commits).toEqual([commit])
    expect(commits).toHaveBeenCalledWith(project.path, project.projectId, 'feature', 10)
    expect(summary).not.toHaveBeenCalled()
    expect(branches).not.toHaveBeenCalled()
  } finally {
    status.mockRestore()
    summary.mockRestore()
    branches.mockRestore()
    commits.mockRestore()
  }
})

test('展开提交只补拉历史，保留仓库状态与 Diff，失败后可重试', async () => {
  const status = spyOn(desktopClient, 'getWorkspaceGitStatus')
  const summary = spyOn(reviewAgentClient, 'summary')
  const branches = spyOn(reviewAgentClient, 'branches')
  const commits = spyOn(reviewAgentClient, 'commits').mockRejectedValueOnce(new Error('retry'))
  const previous = { result, diffStats: { additions: 8, deletions: 2 }, commits: [commit] }
  const options = {
    supportsCommitRef: true, supportsBranches: true, visible: true,
    loadHistory: true, historyOnly: true, commitLimit: 20, isCancelled: () => false,
  }
  try {
    const failed = await loadGitBoardRepository(project, { ...options, previousRepository: previous })
    expect(failed?.commits).toEqual([commit])
    expect(failed?.historyError).toBeDefined()
    commits.mockResolvedValue([commit])
    const loaded = await loadGitBoardRepository(project, { ...options, previousRepository: failed! })
    expect(loaded?.historyError).toBeUndefined()
    expect(loaded?.diffStats).toEqual(previous.diffStats)
    expect(loaded?.result).toBe(result)
    expect(commits).toHaveBeenLastCalledWith(project.path, project.projectId, undefined, 20)
    expect(status).not.toHaveBeenCalled()
    expect(summary).not.toHaveBeenCalled()
    expect(branches).not.toHaveBeenCalled()
  } finally {
    status.mockRestore()
    summary.mockRestore()
    branches.mockRestore()
    commits.mockRestore()
  }
})
