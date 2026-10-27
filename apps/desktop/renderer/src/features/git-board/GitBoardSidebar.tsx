import { useShallow } from 'zustand/react/shallow'
import { useState } from 'react'
import { Github, RefreshCw } from 'lucide-react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Button } from '../../components/ui/Button.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { SidebarEmptyRow, SidebarRow } from '../layout/sidebar/SidebarRow.js'
import { sortProjectsForSidebar } from '../layout/sidebar/SidebarViewModel.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { useGitBoard } from './GitBoardContext.js'
import { GitBoardProjectRow } from './GitBoardProjectRow.js'
import { GitBoardSection } from './GitBoardSection.js'

export function GitBoardSidebar(_props?: {
  sessions?: readonly SessionListItem[]
  onArchiveSessions?: (
    ids: readonly string[],
  ) => Promise<{ failedSessionIds: string[]; succeededSessionIds: string[] }>
  onRemoveWorkspace?: (project: DesktopWorkspace) => void
  onReport?: (message: string) => void
}) {
  const { t } = useLocale()
  const {
    ready,
    remoteView,
    openRemoteView,
    storageError,
    projects,
    projectCatalogState,
    repositories,
    refresh,
    refreshing,
  } = useGitBoard(
    useShallow((state) => ({
      ready: state.ready,
      remoteView: state.remoteView,
      openRemoteView: state.openRemoteView,
      storageError: state.storageError,
      projects: state.projects,
      projectCatalogState: state.projectCatalogState,
      repositories: state.repositories,
      refresh: state.refresh,
      refreshing: state.refreshing,
    })),
  )
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const githubViewActive = remoteView === 'github'
  const visible = sortProjectsForSidebar(projects, {
    manualOrderByScope: {},
    scopeKey: 'git-projects',
    sessions: [],
  }).filter((project) => {
    const result = repositories[project.projectId!]?.result
    return result?.ok !== false || result.errorCode !== 'REPOSITORY_NOT_FOUND'
  })

  return (
    <div
      inert={ready === false}
      aria-busy={ready === false}
      className="sidebar-git-pane tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:py-2"
    >
      <header className="sidebar-pane-heading tw:flex tw:min-h-9 tw:shrink-0 tw:items-center tw:justify-between tw:px-3">
        <h2 className="tw:m-0 tw:text-app-text tw:type-title-sm">{t('Git 看板')}</h2>
        <Tooltip content={t('刷新所有项目仓库')}>
          <Button
            nativeTitle={false}
            isIconOnly
            variant="ghost"
            size="compact"
            title={t('刷新所有项目仓库')}
            disabled={refreshing}
            onClick={refresh}
          >
            <RefreshCw size={APP_ICON_SIZE} />
          </Button>
        </Tooltip>
      </header>
      {storageError && (
        <p role="alert" className="tw:m-0 tw:px-3 tw:type-caption">
          {t('看板保存失败，本次修改仅在当前窗口有效')}
        </p>
      )}
      <div className="tw:flex tw:shrink-0 tw:flex-col tw:sidebar-row-gap tw:p-2">
        <SidebarRow
          active={githubViewActive}
          layout="flex"
          leading={<Github aria-hidden size={APP_ICON_SIZE} />}
        >
          <button
            type="button"
            aria-current={githubViewActive ? 'page' : undefined}
            className="tw:w-full tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:type-body"
            onClick={openRemoteView}
          >
            <span>{t('GitHub 仓库')}</span>
          </button>
        </SidebarRow>
      </div>
      <ScrollArea
        className="tw:min-h-0 tw:flex-1 tw:px-2 tw:pb-2 tw:pt-0"
        contentClassName="tw:flex tw:flex-col tw:gap-3"
      >
        <GitBoardSection
          title={t('项目')}
          collapsed={projectsCollapsed}
          onToggle={() => setProjectsCollapsed((current) => !current)}
        >
          {projectCatalogState.status === 'loading' && (
            <SidebarEmptyRow role="status">{t('加载中')}</SidebarEmptyRow>
          )}
          {projectCatalogState.status === 'unavailable' && (
            <SidebarEmptyRow role="alert">{t('项目列表加载失败')}</SidebarEmptyRow>
          )}
          {visible.map((project) => (
            <GitBoardProjectRow key={project.projectId} project={project} />
          ))}
          {projectCatalogState.status === 'ready' && !visible.length && (
            <SidebarEmptyRow>{t('没有匹配的 Git 仓库')}</SidebarEmptyRow>
          )}
        </GitBoardSection>
      </ScrollArea>
    </div>
  )
}
