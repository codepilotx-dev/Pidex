import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitBoardSidebar } from '../src/features/git-board/GitBoardSidebar.js'
import * as boardContext from '../src/features/git-board/GitBoardContext.js'
import {
  defaultGitBoardState,
  gitBoardView,
  addGitBoardGroup,
} from '../src/features/git-board/GitBoardState.js'
import { DesktopSettingsProvider } from '../src/features/settings/UseDesktopSettings.js'
import { ProjectDetailsCard } from '../src/features/projects/ProjectDetailsCard.js'
import { DEFAULT_PROJECT_APPEARANCE } from '../src/features/projects/ProjectAppearance.js'
import { SquareArrowOutUpRight } from 'lucide-react'
import { mockWorkspace } from '../src/services/desktop-client/Fixtures.js'

test('Git sidebar renders real project hover cards inside its own provider', () => {
  const project = { ...mockWorkspace('C:\\git-board'), projectId: 'git-board-project' }
  const state = addGitBoardGroup(defaultGitBoardState(), 'dev', '开发组', project.projectId)
  const controller: ReturnType<typeof boardContext.useGitBoard> = {
    state,
    ready: true,
    view: gitBoardView(state, null),
    remoteView: 'board',
    openGroup: () => {},
    openRemoteView: () => {},
    toggleQuickView: () => {},
    update: () => {},
    storageError: false,
    projects: [project],
    projectCatalogState: { status: 'ready', projects: [project] },
    repositories: {},
    selectedRefs: {},
    selectBranch: () => {},
    supportsCommitRef: false,
    capabilities: [],
    refreshing: false,
    refresh: () => {},
    refreshView: () => {},
    refreshProject: () => {},
  }
  const hook = spyOn(boardContext, 'useGitBoard').mockReturnValue(controller)
  try {
    const render = () =>
      renderToStaticMarkup(
        <DesktopSettingsProvider access="read-only">
          <GitBoardSidebar
            sessions={[]}
            onArchiveSessions={async () => ({ succeededSessionIds: [], failedSessionIds: [] })}
            onRemoveWorkspace={() => {}}
            onReport={() => {}}
          />
        </DesktopSettingsProvider>,
      )
    const emptyQuick = render()
    expect(emptyQuick).not.toContain('搜索仓库')
    expect(emptyQuick.match(/aria-label="刷新所有项目仓库"/g)).toHaveLength(1)
    expect(emptyQuick).not.toContain('title="新建分组"')
    expect(emptyQuick).toContain('>速览</span>')
    expect(emptyQuick).toContain('清空速览')
    expect(emptyQuick.indexOf('>项目</span>')).toBeGreaterThan(-1)
    expect(emptyQuick.indexOf('>项目</span>')).toBeLessThan(emptyQuick.indexOf('>开发组</span>'))
    controller.state = { ...state, quickProjectIds: [project.projectId] }
    controller.view = gitBoardView(controller.state, null)
    const html = render()
    expect(html.indexOf('>速览</span>')).toBeGreaterThan(-1)
    expect(html.indexOf('>速览</span>')).toBeLessThan(html.indexOf('>项目</span>'))
    // 速览与「已安排」「插件」等页面的一级导航一致：左侧图标槽 + 当前页语义。
    const quickRowIcon = html.indexOf('lucide-layout-dashboard')
    expect(quickRowIcon).toBeGreaterThan(-1)
    expect(quickRowIcon).toBeLessThan(html.indexOf('>速览</span>'))
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('aria-label="清空速览"')
    // 清空速览图标与标题行刷新图标同轴：尾部操作抵消行内多出的 4px。
    const clearWrapper = html.slice(
      html.indexOf('>速览</span>'),
      html.indexOf('aria-label="清空速览"'),
    )
    expect(clearWrapper).toContain('-mr-1')
    expect(html.indexOf('aria-label="清空速览"')).toBeLessThan(
      html.indexOf('aria-label="在右侧面板中打开"'),
    )
    const groupStart = html.indexOf('>开发组</span>')
    const groupHeader = html.slice(
      groupStart,
      html.indexOf('sidebar-section-disclosure', groupStart),
    )
    expect(groupHeader.indexOf('开发组：更多')).toBeLessThan(
      groupHeader.indexOf('aria-label="在右侧面板中打开"'),
    )
    expect(html).toContain(project.name)
    expect(html).toContain('速览')
    expect(html).toContain('aria-label="在右侧面板中打开"')
    expect(html).toContain('开发组：更多')
    expect(html).toContain('lucide-square-arrow-out-up-right')
    expect(html).not.toContain('看板分组')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-label="在右侧面板中打开"')
    expect(html).toContain('aria-label="更多"')
    expect(html).not.toContain('aria-pressed="true"')
    expect(html).not.toContain('title="更多"')
    expect(html).not.toContain('title="在右侧面板中打开"')
    expect(html.match(/sidebar-project-title-text/g)).toHaveLength(2)
    // GitHub 仓库与速览并列：左侧图标槽相邻，默认看板视图下只有速览带当前页语义。
    const githubRowIndex = html.indexOf('>GitHub 仓库</span>')
    expect(githubRowIndex).toBeGreaterThan(-1)
    expect(html.indexOf('lucide-github')).toBeGreaterThan(-1)
    expect(html.indexOf('lucide-github')).toBeLessThan(githubRowIndex)
    expect(githubRowIndex).toBeGreaterThan(html.indexOf('>速览</span>'))
    expect(githubRowIndex).toBeLessThan(html.indexOf('>项目</span>'))
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    // 切到仓库页后两行选中态互斥。
    controller.view = gitBoardView(state, 'dev')
    controller.remoteView = 'github'
    const githubHtml = render()
    expect(githubHtml.match(/aria-current="page"/g)).toHaveLength(1)
    expect(githubHtml.slice(githubHtml.indexOf('aria-current="page"'))).toContain('GitHub 仓库')
    expect(githubHtml).toContain('>开发组</span>')
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
