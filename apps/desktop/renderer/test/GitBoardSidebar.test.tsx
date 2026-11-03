import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitBoardSidebar } from '../src/features/git-board/GitBoardSidebar.js'
import * as boardContext from '../src/features/git-board/GitBoardContext.js'
import { defaultGitBoardState } from '../src/features/git-board/GitBoardState.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { ProjectDetailsCard } from '../src/features/projects/ProjectDetailsCard.js'
import { DEFAULT_PROJECT_APPEARANCE } from '../src/features/projects/ProjectAppearance.js'
import { SquareArrowOutUpRight } from 'lucide-react'
import { mockWorkspace } from '../src/services/desktop-client/Fixtures.js'

test('Git 看板侧栏移除速览、项目行更多/从看板移除按钮与提交展开，仅保留 GitHub 仓库与纯项目选择行', () => {
  const project = { ...mockWorkspace('C:\\git-board'), projectId: 'git-board-project' }
  const state = defaultGitBoardState()
  const controller = {
    state,
    ready: true,
    view: { id: null as string | null, name: 'Git 看板', projectIds: [] as string[] },
    selectedProjectId: null as string | null,
    selectedProject: null as typeof project | null,
    selectProject: () => {},
    remoteView: 'board' as boardContext.GitBoardRemoteView,
    openGroup: () => {},
    openRemoteView: () => {},
    toggleQuickView: () => {},
    update: () => {},
    storageError: false,
    projects: [project],
    projectCatalogState: { status: 'ready' as const, projects: [project] },
    repositories: {},
    selectedRefs: {},
    selectBranch: () => {},
    supportsCommitRef: false,
    capabilities: [],
    refreshing: false,
    refresh: () => {},
    refreshView: () => {},
    refreshGithubRepositories: () => {},
    registerGithubRefresh: () => {},
    refreshProject: () => {},
    commitLimitByProject: {},
    ensureCommitHistory: () => {},
    expandCommitHistory: () => {},
    selectedReview: null,
    selectReview: () => {},
    clearReview: () => {},
    registerActivitySessions: () => {},
  }
  const hook = spyOn(boardContext, 'useGitBoard').mockImplementation(((
    selector?: (value: typeof controller) => unknown,
  ) => (selector ? selector(controller) : controller)) as typeof boardContext.useGitBoard)
  try {
    const render = () =>
      renderToStaticMarkup(
        <DesktopSettingsProvider access="read-only">
          <GitBoardSidebar />
        </DesktopSettingsProvider>,
      )

    // 1. 默认未选中任何项：不渲染速览、清空速览、分组、项目更多/移除按钮与侧栏提交展开。
    const initialHtml = render()
    expect(initialHtml.match(/aria-label="刷新所有项目仓库"/g)).toHaveLength(1)
    expect(initialHtml).not.toContain('>速览</span>')
    expect(initialHtml).not.toContain('清空速览')
    expect(initialHtml).not.toContain('从看板移除')
    expect(initialHtml).not.toContain('在速览中打开')
    expect(initialHtml).not.toContain('aria-label="更多"')
    expect(initialHtml).not.toContain('title="更多"')
    expect(initialHtml).not.toContain('sidebar-project-actions')
    expect(initialHtml).not.toContain('sidebar-project-commits-disclosure')
    expect(initialHtml).not.toContain('aria-current="page"')

    const githubRowIndex = initialHtml.indexOf('>GitHub 仓库</span>')
    const projectSectionIndex = initialHtml.indexOf('>项目</span>')
    expect(githubRowIndex).toBeGreaterThan(-1)
    expect(initialHtml.indexOf('lucide-github')).toBeGreaterThan(-1)
    expect(initialHtml.indexOf('lucide-github')).toBeLessThan(githubRowIndex)
    expect(githubRowIndex).toBeLessThan(projectSectionIndex)
    expect(initialHtml).toContain(project.name)
    expect(initialHtml.match(/sidebar-project-title-text/g)).toHaveLength(1)

    // 2. 选中左侧项目时：项目行高亮并标记 aria-current="page"。
    controller.selectedProjectId = project.projectId
    controller.selectedProject = project
    controller.view = { id: project.projectId, name: project.name, projectIds: [project.projectId] }
    const selectedHtml = render()
    expect(selectedHtml.match(/aria-current="page"/g)).toHaveLength(1)
    expect(selectedHtml.slice(selectedHtml.indexOf('aria-current="page"'))).toContain(project.name)

    // 3. 切换到 GitHub 仓库视图时：选中态切到 GitHub 仓库，与项目行互斥。
    controller.remoteView = 'github'
    const githubHtml = render()
    expect(githubHtml.match(/aria-current="page"/g)).toHaveLength(1)
    expect(githubHtml.slice(githubHtml.indexOf('aria-current="page"'))).toContain('GitHub 仓库')
  } finally {
    hook.mockRestore()
  }
})

test('project details keep homepage pin defaults and allow the board open action', () => {
  const props = {
    appearance: DEFAULT_PROJECT_APPEARANCE,
    conversationCount: 0,
    openCount: 0,
    unreadCount: 0,
    isPinned: false,
    isUnavailable: false,
    project: mockWorkspace('C:\\git-board'),
    onEdit: () => {},
    onOpenFolder: () => {},
    onTogglePinned: () => {},
  }
  expect(renderToStaticMarkup(<ProjectDetailsCard {...props} />)).toContain('aria-label="置顶项目"')
  const html = renderToStaticMarkup(
    <ProjectDetailsCard {...props} pinLabel="在速览中打开" pinIcon={<SquareArrowOutUpRight />} />,
  )
  expect(html).toContain('aria-label="在速览中打开"')
  expect(html).toContain('lucide-square-arrow-out-up-right')
  expect(html).not.toContain('aria-label="置顶项目"')
})
