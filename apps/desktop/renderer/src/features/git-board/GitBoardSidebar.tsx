import { useState } from 'react'
import { LayoutDashboard, RefreshCw, Pencil, Trash2, ListX } from 'lucide-react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Button } from '../../components/ui/Button.js'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { ConfirmationDialog, InputDialog } from '../../components/ui/ConfirmationDialog.js'
import { SidebarEmptyRow, SidebarRow } from '../layout/sidebar/SidebarRow.js'
import { SidebarHoverCardProvider } from '../layout/sidebar/SidebarHoverCard.js'
import {
  buildProjectSessionBuckets,
  sidebarProjectKey,
  sortProjectsForSidebar,
} from '../layout/sidebar/SidebarViewModel.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { useGitBoard } from './GitBoardContext.js'
import { addGitBoardGroup, deleteGitBoardGroup } from './GitBoardState.js'
import { GitBoardProjectRow } from './GitBoardProjectRow.js'
import { GitBoardSection } from './GitBoardSection.js'

type GroupDialog =
  { kind: 'create'; projectId: string } | { kind: 'rename' | 'delete'; groupId: string }

export function GitBoardSidebar({
  sessions,
  onArchiveSessions,
  onRemoveWorkspace,
  onReport,
}: {
  sessions: readonly SessionListItem[]
  onArchiveSessions: (
    ids: readonly string[],
  ) => Promise<{ failedSessionIds: string[]; succeededSessionIds: string[] }>
  onRemoveWorkspace: (project: DesktopWorkspace) => void
  onReport: (message: string) => void
}) {
  const { t } = useLocale()
  const {
    state,
    view,
    update,
    openGroup,
    storageError,
    projects,
    projectCatalogState,
    repositories,
    refresh,
    refreshing,
  } = useGitBoard()
  const hasQuickProjects = state.quickProjectIds.some((id) =>
    projects.some((project) => project.projectId === id),
  )
  const [dialog, setDialog] = useState<GroupDialog | null>(null)
  const [name, setName] = useState('')
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const buckets = buildProjectSessionBuckets(
    sessions.filter((session) => !session.archivedAt),
    [],
  )
  const visible = sortProjectsForSidebar(projects, {
    manualOrderByScope: {},
    scopeKey: 'git-projects',
    sessions: [],
  }).filter((project) => {
    const result = repositories[project.projectId!]?.result
    return result?.ok !== false || result.errorCode !== 'REPOSITORY_NOT_FOUND'
  })
  const createGroup = (projectId: string) => {
    setName('')
    setDialog({ kind: 'create', projectId })
  }
  const renderProject = (project: DesktopWorkspace) => (
    <GitBoardProjectRow
      key={project.projectId}
      project={project}
      sessions={buckets.get(sidebarProjectKey(project))?.allSessions ?? []}
      onArchiveSessions={async (targets) => {
        const result = await onArchiveSessions(targets.map((session) => session.id))
        if (result.failedSessionIds.length) onReport(t('部分聊天归档失败，请重试。'))
        return result.failedSessionIds.length === 0
      }}
      onRemoveWorkspace={onRemoveWorkspace}
      onReport={onReport}
      onCreateGroup={createGroup}
    />
  )
  const renderMembers = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const project = projects.find((item) => item.projectId === id)
      return project ? [renderProject(project)] : []
    })
  const saveGroup = () => {
    const title = name.trim()
    if (!title || !dialog || dialog.kind === 'delete') return
    if (dialog.kind === 'create') {
      const id = crypto.randomUUID()
      update((current) => addGitBoardGroup(current, id, title, dialog.projectId))
    } else {
      update((current) => ({
        ...current,
        groups: current.groups.map((group) =>
          group.id === dialog.groupId ? { ...group, name: title } : group,
        ),
      }))
    }
    setDialog(null)
  }
  return (
    <SidebarHoverCardProvider>
      <div className="sidebar-git-pane tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:py-2">
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
        {hasQuickProjects && (
          <div className="tw:flex tw:shrink-0 tw:flex-col tw:sidebar-row-gap tw:p-2">
            <SidebarRow
              active={view.id === null}
              className="tw:group"
              layout="flex"
              leading={<LayoutDashboard aria-hidden size={APP_ICON_SIZE} />}
              trailing={
                // 速览行的尾部操作与标题行图标按钮同轴：容器 p-2 加行内 px-2 比标题 px-3 多出 4px，这里抵消。
                <span className="tw:inline-flex tw:-mr-1 tw:opacity-0 tw:pointer-events-none tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-focus-within:opacity-100 tw:group-focus-within:pointer-events-auto">
                  <Tooltip content={t('清空速览')}>
                    <Button
                      nativeTitle={false}
                      isIconOnly
                      variant="text"
                      size="compact"
                      title={t('清空速览')}
                      onClick={() => update((current) => ({ ...current, quickProjectIds: [] }))}
                    >
                      <ListX size={APP_ICON_SIZE} />
                    </Button>
                  </Tooltip>
                </span>
              }
            >
              <button
                type="button"
                aria-current={view.id === null ? 'page' : undefined}
                className="tw:w-full tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:type-body"
                onClick={() => openGroup(null)}
              >
                <span>{t('速览')}</span>
              </button>
            </SidebarRow>
          </div>
        )}
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
            {visible.map(renderProject)}
            {projectCatalogState.status === 'ready' && !visible.length && (
              <SidebarEmptyRow>{t('没有匹配的 Git 仓库')}</SidebarEmptyRow>
            )}
          </GitBoardSection>
          {state.groups.map((group) => (
            <GitBoardSection
              key={group.id}
              title={group.name}
              collapsed={group.collapsed}
              onToggle={() =>
                update((current) => ({
                  ...current,
                  groups: current.groups.map((item) =>
                    item.id === group.id ? { ...item, collapsed: !item.collapsed } : item,
                  ),
                }))
              }
              onOpen={() => openGroup(group.id)}
              actions={[
                {
                  kind: 'item',
                  label: t('重命名分组'),
                  icon: <Pencil size={APP_ICON_SIZE} />,
                  onSelect: () => {
                    setName(group.name)
                    setDialog({ kind: 'rename', groupId: group.id })
                  },
                },
                {
                  kind: 'item',
                  label: t('删除分组'),
                  icon: <Trash2 size={APP_ICON_SIZE} />,
                  onSelect: () => setDialog({ kind: 'delete', groupId: group.id }),
                },
              ]}
            >
              {group.projectIds.length ? (
                renderMembers(group.projectIds)
              ) : (
                <SidebarEmptyRow>{t('通过项目的更多菜单加入分组')}</SidebarEmptyRow>
              )}
            </GitBoardSection>
          ))}
        </ScrollArea>
        <InputDialog
          open={dialog?.kind === 'create' || dialog?.kind === 'rename'}
          title={t(dialog?.kind === 'create' ? '新建分组' : '重命名分组')}
          description={t('分组名称')}
          actionLabel={t('保存')}
          cancelLabel={t('取消')}
          input={{ value: name, onChange: setName, maxLength: 80 }}
          onCancel={() => setDialog(null)}
          onAction={saveGroup}
        />
        <ConfirmationDialog
          open={dialog?.kind === 'delete'}
          title={t('删除分组')}
          description={t('仅删除分组，不会移除项目或改变速览。')}
          actionLabel={t('删除')}
          cancelLabel={t('取消')}
          tone="danger"
          onCancel={() => setDialog(null)}
          onAction={() => {
            if (dialog?.kind === 'delete')
              update((current) => deleteGitBoardGroup(current, dialog.groupId))
            setDialog(null)
          }}
        />
      </div>
    </SidebarHoverCardProvider>
  )
}
