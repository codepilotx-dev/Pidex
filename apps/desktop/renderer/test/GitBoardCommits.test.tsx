import { expect, spyOn, test } from 'bun:test'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GitBoardCommitRows,
  GIT_BOARD_COMMIT_VISIBLE_LIMIT,
} from '../src/features/git-board/GitBoardCommitRows.js'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore.js'
import {
  buildGitBoardCommitHoverCardModel,
  formatGitBoardCommitTime,
} from '../src/features/git-board/GitBoardCommitHoverCard.js'
import * as boardContext from '../src/features/git-board/GitBoardContext.js'
import { GitBoardProjectRow } from '../src/features/git-board/GitBoardProjectRow.js'
import {
  gitBoardCommitLimitFor,
  GIT_BOARD_COMMIT_LIMIT_STEP,
  GIT_BOARD_DEFAULT_COMMIT_LIMIT,
} from '../src/features/git-board/GitBoardRepository.js'
import { gitBoardRepositoryIds } from '../src/features/git-board/GitBoardContext.js'
import { addGitBoardGroup, defaultGitBoardState } from '../src/features/git-board/GitBoardState.js'
import { GitBoardSidebar } from '../src/features/git-board/GitBoardSidebar.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { SidebarHoverCardProvider } from '../src/features/layout/sidebar/SidebarHoverCard.js'
import {
  createSidebarSessionPagingState,
  setSidebarSessionVisibleLimit,
} from '../src/features/layout/sidebar/SidebarSessionPaging.js'
import { mockWorkspace } from '../src/services/desktop-client/Fixtures.js'
import type { ReviewCommit } from '../src/features/review/source/ReviewAgentClient.js'
import type { DesktopGitStatusResult } from '../shared/Types.js'

const project = { ...mockWorkspace('C:\\commits'), projectId: 'commits' }
const other = { ...mockWorkspace('C:\\other'), projectId: 'other' }
const result: DesktopGitStatusResult = {
  ok: true,
  status: { branchName: 'main', upstream: null, ahead: 0, behind: 0, clean: true, files: [] },
}

function commits(count: number): ReviewCommit[] {
  return Array.from({ length: count }, (_, index) => ({
    sha: `${index}`.padStart(40, 'a'),
    shortSha: `aaaa00${index}`,
    subject: `提交标题 ${index}`,
    author: `作者 ${index}`,
    // Agent 返回毫秒时间戳。
    authoredAt: ((1_700_000_000 + index * 60) * 1000) as unknown as string,
  }))
}

function controller(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof boardContext.useGitBoard> {
  return {
    state: { quickProjectIds: ['commits'], quickCollapsed: false, groups: [] },
    ready: true,
    view: { id: null, name: '速览', projectIds: ['commits'] },
    remoteView: 'board',
    projects: [project, other],
    projectCatalogState: { status: 'ready', projects: [project, other] },
    repositories: {},
    selectedRefs: {},
    selectBranch: () => {},
    supportsCommitRef: false,
    capabilities: [],
    refreshing: false,
    refresh: () => {},
    refreshView: () => {},
    refreshProject: () => {},
    update: () => {},
    toggleQuickView: () => {},
    openGroup: () => {},
    openRemoteView: () => {},
    storageError: false,
    commitLimitByProject: {},
    ensureCommitHistory: () => {},
    expandCommitHistory: () => {},
    selectedReview: null,
    selectReview: () => {},
    clearReview: () => {},
    ...overrides,
  } as unknown as ReturnType<typeof boardContext.useGitBoard>
}

function renderCommits(
  repository: Record<string, unknown>,
  options: { type?: 'project' | 'group'; hook?: ReturnType<typeof boardContext.useGitBoard> } = {},
) {
  const hook =
    options.hook ??
    controller({
      repositories: { [project.projectId!]: { result, ...repository } },
    })
  const spy = spyOn(boardContext, 'useGitBoard').mockReturnValue(hook)
  try {
    return renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <SidebarHoverCardProvider>
          <GitBoardCommitRows project={project} type={options.type ?? 'project'} />
        </SidebarHoverCardProvider>
      </DesktopSettingsProvider>,
    )
  } finally {
    spy.mockRestore()
  }
}

test('提交条数按 10 条步进向上取整，并收敛到协议上限', () => {
  expect(GIT_BOARD_DEFAULT_COMMIT_LIMIT).toBe(10)
  expect(GIT_BOARD_COMMIT_LIMIT_STEP).toBe(10)
  expect(gitBoardCommitLimitFor(0)).toBe(10)
  expect(gitBoardCommitLimitFor(1)).toBe(10)
  expect(gitBoardCommitLimitFor(10)).toBe(10)
  expect(gitBoardCommitLimitFor(11)).toBe(20)
  expect(gitBoardCommitLimitFor(15)).toBe(20)
  expect(gitBoardCommitLimitFor(20)).toBe(20)
  expect(gitBoardCommitLimitFor(21)).toBe(30)
  expect(gitBoardCommitLimitFor(999)).toBe(200)
})

test('侧栏提交默认渲染 5 条并复用展开／折叠按钮', () => {
  const html = renderCommits({ commits: commits(10) })
  expect(GIT_BOARD_COMMIT_VISIBLE_LIMIT).toBe(5)
  expect(html.match(/sidebar-commit-row/g)).toHaveLength(5)
  expect(html).toContain('提交标题 0')
  expect(html).toContain('提交标题 4')
  expect(html).not.toContain('提交标题 5')
  expect(html).toContain('展开显示')
  expect(html).not.toContain('折叠显示')
  // 复用会话列表的展开按钮类名与缩进占位列，不新造一套视觉。
  expect(html).toContain('sidebar-show-more-actions')
  expect(html).toContain('sidebar-show-more-button')
  expect(html.match(/sidebar-row-leading-spacer/g)?.length).toBe(6)
  // 提交行必须是原生 button，选中态用 aria-current。
  expect(html).toContain('type="button"')
  expect(html).not.toContain('aria-current="true"')
  // 仅只读展示：不引入会话的归档、置顶、拖动与 PR 标记。
  expect(html).not.toContain('置顶')
  expect(html).not.toContain('归档')
  expect(html).not.toContain('sidebar-pull-request')
})

test('历史已取完时保留“展开显示”直到展示全部，取尽后不再提供按钮', () => {
  // 11 条：本次请求上限 20，服务端只返回 11 条 => commitsComplete 为 true（历史已取完）。
  // 首屏展示 5 条，仍应能再展开一次看到剩余 6 条，而不是因为“已加载条数固定”而永久失去入口。
  const html = renderCommits({ commits: commits(11), commitsComplete: true })
  expect(html.match(/sidebar-commit-row/g)).toHaveLength(5)
  expect(html).toContain('展开显示')
  // 3 条不足以填满首屏，历史也已取完，不提供展开入口。
  const short = renderCommits({ commits: commits(3), commitsComplete: true })
  expect(short.match(/sidebar-commit-row/g)).toHaveLength(3)
  expect(short).not.toContain('展开显示')
  // 恰好取满请求上限、服务端仍可能有更多时，继续提供展开入口。
  const more = renderCommits({ commits: commits(10), commitsComplete: false })
  expect(more).toContain('展开显示')
})

test('空历史、加载中与失败重试都渲染在仓库下方', () => {
  expect(renderCommits({ commits: [] })).toContain('暂无提交')
  const loading = renderCommits({})
  expect(loading).toContain('加载中')
  expect(loading).toContain('role="status"')
  const failed = renderCommits({ historyError: '提交历史加载失败' })
  expect(failed).toContain('提交历史加载失败')
  expect(failed).toContain('role="alert"')
  expect(failed).toContain('重试')
})

test('选中态命中任意一处渲染的同仓库提交，并共享 Context 的选中 Review', () => {
  const sha = commits(1)[0]!.sha
  const selectedReview = {
    project,
    source: { kind: 'commit' as const, commitSha: sha },
  }
  const html = renderCommits(
    { commits: commits(5) },
    {
      hook: controller({
        repositories: { [project.projectId!]: { result, commits: commits(5) } },
        selectedReview,
      }),
    },
  )
  expect(html).toContain('aria-current="true"')
  expect(html.match(/aria-current="true"/g)).toHaveLength(1)
  // 其他提交的选中态不受影响。
  expect(html.match(/sidebar-commit-row/g)).toHaveLength(5)
})

test('点击提交把选择交给 Context，由主区域跟随 selectedReview 打开详情', () => {
  // 侧栏只上报选中态：提交详情不在侧栏内自建，而由主区域按 Context 渲染。
  const html = renderCommits({ commits: commits(2) }, { type: 'group' })
  expect(html).not.toContain('GitBoardDetails')
  expect(html).not.toContain('变更详情')
})

test('展开显示按 5 条步进上报需求条数，并由 Context 换算成 10 的倍数补拉', () => {
  // 侧栏分页与会话列表同源：5 → 10 → 15，每次展开把需求条数交给 Context。
  let paging = createSidebarSessionPagingState({ groupKey: 'commits:project', initialLimit: 5 })
  const requested: number[] = []
  for (let index = 0; index < 2; index += 1) {
    paging = setSidebarSessionVisibleLimit(paging, paging.visibleLimit + 5)
    requested.push(gitBoardCommitLimitFor(paging.visibleLimit))
  }
  expect(paging.visibleLimit).toBe(15)
  // 15 条仍落在 20 条以内，因此 Context 只补拉一次到 10、再补拉到 20。
  expect(requested).toEqual([10, 20])
})

test('悬浮卡模型展示完整标题、作者、时间、短 SHA、仓库与查看分支', () => {
  const model = buildGitBoardCommitHoverCardModel({
    subject: `这是一个很长很长的提交标题，需要在悬浮卡中换行展示 ${'x'.repeat(80)}`,
    author: 'Author Name',
    authoredAt: '1700000000',
    shortSha: 'aaaa001',
    projectName: 'commits',
    branchLabel: 'feature/x',
  })
  expect(model.subject.startsWith('这是一个很长很长的提交标题')).toBe(true)
  expect(model.subject.endsWith('x'.repeat(80))).toBe(true)
  expect(model.author).toBe('Author Name')
  expect(model.shortSha).toBe('aaaa001')
  expect(model.projectName).toBe('commits')
  expect(model.branchLabel).toBe('feature/x')
  expect(model.authoredAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  expect(formatGitBoardCommitTime('not-a-time')).toBe('')
})

test('加载集合是速览、全部分组与主区域列的去重并集', () => {
  const state = addGitBoardGroup(defaultGitBoardState(), 'dev', '开发组', 'other')
  expect(gitBoardRepositoryIds(state, [])).toEqual(['other'])
  const withQuick = { ...state, quickProjectIds: ['commits', 'other'] }
  expect(gitBoardRepositoryIds(withQuick, ['extra'])).toEqual(['commits', 'other', 'extra'])
})

test('提交行收起短 SHA，只在 hover 或行内聚焦时显示', () => {
  const html = renderCommits({ commits: commits(2) })
  const sha = html.match(/<span[^>]*class="sidebar-commit-sha[^"]*"[^>]*>/g) ?? []
  expect(sha).toHaveLength(2)
  for (const element of sha) {
    expect(element).toContain('tw:hidden')
    expect(element).toContain('group-hover:inline')
    expect(element).toContain('group-has-[:focus-visible]:inline')
    // 点击选中的提交保留 SHA，便于对照当前详情。
    expect(element).toContain('group-data-[selected=true]:inline')
  }
  // 隐藏时不占布局宽度；悬浮卡仍提供完整 SHA。
  expect(html).toContain('aaaa000')
  expect(html.match(/sidebar-commit-row tw:group/g)).toHaveLength(2)
})

test('选中的提交行通过 data-selected 保留短 SHA', () => {
  const list = commits(2)
  const html = renderCommits(
    { commits: list },
    {
      hook: controller({
        repositories: { [project.projectId!]: { result, commits: list } },
        selectedReview: {
          project,
          source: { kind: 'commit', commitSha: list[1]!.sha },
        },
      }),
    },
  )
  // 只有被选中的那一行带 data-selected，组选择器据此让 SHA 常显。
  const selectedRows = html.match(/<div class="sidebar-row[^"]*"[^>]*data-selected="true"/g) ?? []
  expect(selectedRows).toHaveLength(1)
  // 两行提交各渲染一次，未选中的行不应带该属性。
  expect(html.match(/sidebar-row--grid/g)).toHaveLength(2)
  expect(html.match(/data-selected="true"/g)).toHaveLength(1)
})

test('项目行仅作为纯选择入口，不在侧栏内展开提交记录', () => {
  const spy = spyOn(boardContext, 'useGitBoard').mockReturnValue(
    controller({
      selectedProjectId: project.projectId,
      repositories: { [project.projectId!]: { result, commits: commits(2) } },
    }),
  )
  try {
    const html = renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <GitBoardProjectRow project={project} />
      </DesktopSettingsProvider>,
    )
    expect(html).not.toContain('sidebar-project-commits-disclosure')
    expect(html).not.toContain('提交标题 0')
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('aria-current="page"')
    expect(html).toMatch(/<button[^>]*sidebar-project-button[^>]*>/)
  } finally {
    spy.mockRestore()
  }
})

test('“项目”分组头不再粘在滚动视口顶部，且侧栏不直接渲染提交列表', () => {
  const spy = spyOn(boardContext, 'useGitBoard').mockReturnValue(
    controller({
      repositories: { [project.projectId!]: { result, commits: commits(10) } },
    }),
  )
  try {
    const sidebar = renderToStaticMarkup(
      <DesktopSettingsProvider access="read-only">
        <GitBoardSidebar />
      </DesktopSettingsProvider>,
    )
    const headers = sidebar.match(/<div class="sidebar-section-header[^"]*"/g) ?? []
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header).not.toContain('tw:sticky')
      expect(header).not.toContain('tw:top-0')
    }
    expect(sidebar).not.toContain('sidebar-project-commits-disclosure')
    expect(sidebar).not.toContain('提交标题 0')
    expect(sidebar).not.toContain('展开显示')
  } finally {
    spy.mockRestore()
  }
})
