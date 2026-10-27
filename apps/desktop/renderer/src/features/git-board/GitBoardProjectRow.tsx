import { useEffect, useId, useState } from 'react'
import {
  Archive,
  FolderOpen,
  MoreHorizontal,
  List,
  Plus,
  SquareArrowOutUpRight,
  Settings2,
  X,
} from 'lucide-react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Button } from '../../components/ui/Button.js'
import { DropdownActions } from '../../components/ui/DropdownActions.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { DisclosureContent } from '../../components/ui/DisclosureContent.js'
import {
  useDisclosureExpanded,
  type KeyedDisclosureStore,
} from '../../components/ui/KeyedDisclosureStore.js'
import { PopoverMenu } from '../../components/ui/PopoverMenu.js'
import {
  AppContextMenu as SidebarContextMenu,
  type AppContextMenuAction as ContextMenuAction,
} from '../../components/ui/AppContextMenu.js'
import { cx } from '../../utils/Cx.js'
import { useDesktopSettingsField } from '../settings/UseDesktopSettings.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  PROJECT_APPEARANCE_COLOR_CLASS,
  PROJECT_APPEARANCE_MARKER_CLASS,
  ProjectAppearanceGlyph,
} from '../projects/ProjectAppearance.js'
import { ProjectManagementDialogs } from '../projects/ProjectManagementDialogs.js'
import { SidebarRow } from '../layout/sidebar/SidebarRow.js'
import { SidebarProjectHoverCard } from '../layout/sidebar/SidebarProjectHoverCard.js'
import { countOpenProjectSessions, sidebarProjectKey } from '../layout/sidebar/SidebarViewModel.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useGitBoard } from './GitBoardContext.js'
import { GitBoardCommitRows } from './GitBoardCommitRows.js'
import { toggleGitBoardGroupProject } from './GitBoardState.js'

/**
 * 提交子列表的折叠键按“区域 + 仓库”区分：同一仓库在项目区与分组区各渲染一次，
 * 两处展开互不影响，与提交分页的 groupKey 保持一致。
 */
export function gitBoardCommitsDisclosureKey(
  type: 'project' | 'group',
  project: DesktopWorkspace,
): string {
  return `commits:${type}:${sidebarProjectKey(project)}`
}

export function GitBoardProjectRow({
  project,
  sessions,
  type = 'project',
  onArchiveSessions,
  onRemoveWorkspace,
  onReport,
  onCreateGroup,
  commitsDisclosureStore,
}: {
  project: DesktopWorkspace
  sessions: readonly SessionListItem[]
  /** 该行出现在“项目”区还是自定义分组；同一仓库会各渲染一次，提交选中态共享。 */
  type?: 'project' | 'group'
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onRemoveWorkspace: (project: DesktopWorkspace) => void
  onReport: (message: string) => void
  onCreateGroup: (projectId: string) => void
  /** 与会话列表一致的折叠仓库：项目行标题负责展开/折叠提交子列表。 */
  commitsDisclosureStore: KeyedDisclosureStore
}) {
  const { state, update, repositories, toggleQuickView } = useGitBoard()
  const projectAppearances = useDesktopSettingsField((settings) => settings.projectAppearances)
  const [managedProject, setManagedProject] = useState(project)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false)
  const [processingAction, setProcessingAction] = useState<'archive' | null>(null)
  const commitsId = useId()
  const commitsDisclosureKey = gitBoardCommitsDisclosureKey(type, project)
  const commitsExpanded = useDisclosureExpanded(commitsDisclosureStore, commitsDisclosureKey)
  useEffect(() => setManagedProject(project), [project])
  const projectKey = sidebarProjectKey(managedProject)
  const isPinned = state.quickProjectIds.includes(managedProject.projectId!)
  const result = repositories[managedProject.projectId!]?.result
  const isUnavailable = result?.ok === false
  const appearance = projectAppearances[managedProject.projectId!] ?? DEFAULT_PROJECT_APPEARANCE
  const countedProjectSessions = sessions
  const openCount = countOpenProjectSessions(sessions)
  const unreadCount = sessions.filter((session) => session.unreadAt).length
  function togglePinned() {
    toggleQuickView(managedProject.projectId!)
  }
  function archiveAll() {
    setProcessingAction('archive')
    void onArchiveSessions(countedProjectSessions)
      .then((success) => {
        if (success) setConfirmArchiveOpen(false)
      })
      .catch((error) => onReport(error instanceof Error ? error.message : String(error)))
      .finally(() => setProcessingAction(null))
  }
  function contextActions(): ContextMenuAction[] {
    const folders =
      managedProject.folders ?? (managedProject.path ? [{ path: managedProject.path }] : [])
    return [
      {
        kind: 'item',
        label: isPinned ? '从看板移除' : '在速览中打开',
        icon: isPinned ? (
          <X size={APP_ICON_SIZE} />
        ) : (
          <SquareArrowOutUpRight size={APP_ICON_SIZE} />
        ),
        onSelect: togglePinned,
      },
      {
        kind: 'item',
        label: '编辑',
        icon: <Settings2 size={APP_ICON_SIZE} />,
        onSelect: () => setManagerOpen(true),
      },
      { kind: 'separator' },
      {
        kind: 'sub',
        label: '分组',
        icon: <List size={APP_ICON_SIZE} />,
        layout: 'grid',
        children: [
          ...state.groups.map((section): ContextMenuAction => ({
            kind: 'item',
            label: section.name,
            checked: section.projectIds.includes(managedProject.projectId!),
            onSelect: () =>
              update((current) =>
                toggleGitBoardGroupProject(current, section.id, managedProject.projectId!),
              ),
          })),
          ...(state.groups.length ? [{ kind: 'separator' as const }] : []),
          {
            kind: 'item',
            label: '新建分组…',
            icon: <Plus size={APP_ICON_SIZE} />,
            onSelect: () => onCreateGroup(managedProject.projectId!),
          },
        ],
      },
      ...(folders.length === 1
        ? [
            {
              kind: 'item' as const,
              label: '在资源管理器中打开',
              icon: <FolderOpen size={APP_ICON_SIZE} />,
              disabled: isUnavailable,
              onSelect: () => {
                void desktopClient.openPathWithDefaultTarget(folders[0]!.path)
              },
            },
          ]
        : []),
      { kind: 'separator' },
      {
        kind: 'item',
        label: '归档聊天',
        icon: <Archive size={APP_ICON_SIZE} />,
        disabled: countedProjectSessions.length === 0 || processingAction !== null,
        onSelect: () => setConfirmArchiveOpen(true),
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: '移除项目',
        icon: <X size={APP_ICON_SIZE} />,
        onSelect: () => setConfirmRemoveOpen(true),
      },
    ]
  }

  const projectButton = (
    <button
      type="button"
      aria-controls={commitsId}
      aria-expanded={commitsExpanded}
      className="sidebar-project-button tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:focus-visible:outline-none"
      onClick={() => commitsDisclosureStore.setExpanded(commitsDisclosureKey, !commitsExpanded)}
    >
      <span className="sidebar-project-title-text tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:whitespace-nowrap tw:text-inherit tw:type-row-title">
        {managedProject.name}
      </span>

    </button>
  )

  return (
    <section className="sidebar-project tw:flex tw:flex-col">
      <SidebarContextMenu
        actions={contextActions()}
        layout="grid"
        size="sm"
        trigger={
          <SidebarRow
            className={cx(
              'sidebar-project-header tw:cursor-pointer tw:group tw:focus:outline-none tw:focus-visible:outline-none tw:has-[:focus-visible]:outline-2 tw:has-[:focus-visible]:outline-offset-0 tw:has-[:focus-visible]:outline-app-focus tw:[&>.sidebar-row-trailing]:relative tw:[&>.sidebar-row-trailing]:w-auto',
              isUnavailable &&
                'sidebar-project-header--unavailable tw:text-app-text-disabled tw:hover:bg-transparent tw:[&_.sidebar-item-icon]:text-app-text-disabled',
            )}
            labelClassName="sidebar-project-name tw:flex tw:min-w-0 tw:items-center tw:text-inherit"
            layout="grid"
            leading={
              <ProjectAppearanceGlyph
                size={APP_ICON_SIZE}
                appearance={appearance}
                className={cx(
                  PROJECT_APPEARANCE_MARKER_CLASS,
                  PROJECT_APPEARANCE_COLOR_CLASS[appearance.color] ?? 'tw:text-app-text-soft',
                )}
              />
            }
            trailing={
              <>
                <div
                  className={cx(
                    'sidebar-project-actions tw:relative tw:min-h-6 tw:items-center tw:justify-end tw:gap-1 tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto',
                    menuOpen
                      ? 'is-visible tw:flex tw:opacity-100 tw:pointer-events-auto'
                      : 'tw:hidden tw:group-hover:flex tw:group-has-[:focus-visible]:flex tw:opacity-100 tw:pointer-events-auto',
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Tooltip.Root open={menuOpen ? false : undefined}>
                    <PopoverMenu
                      className="popover-sidebar-project popover-menu--grid"
                      open={menuOpen}
                      side="bottom"
                      size="sm"
                      trigger={
                        <Tooltip.Trigger asChild>
                          <Button
                            nativeTitle={false}
                            isIconOnly
                            className="sidebar-project-action-button"
                            variant="text"
                            color="text"
                            iconSize="md"
                            size="compact"
                            title="更多"
                          >
                            <MoreHorizontal size={APP_ICON_SIZE} />
                          </Button>
                        </Tooltip.Trigger>
                      }
                      onOpenChange={setMenuOpen}
                    >
                      <DropdownActions actions={contextActions()} />
                    </PopoverMenu>
                    <Tooltip.Portal>
                      <Tooltip.Content>更多</Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                  <Tooltip content={isPinned ? '从看板移除' : '在速览中打开'}>
                    <Button
                      nativeTitle={false}
                      isIconOnly
                      aria-label={isPinned ? '从看板移除' : '在速览中打开'}
                      className="sidebar-project-action-button"
                      variant="text"
                      color="text"
                      iconSize="md"
                      disabled={isUnavailable && !isPinned}
                      size="compact"
                      title={isPinned ? '从看板移除' : '在速览中打开'}
                      onClick={togglePinned}
                    >
                      {isPinned ? (
                        <X size={APP_ICON_SIZE} />
                      ) : (
                        <SquareArrowOutUpRight size={APP_ICON_SIZE} />
                      )}
                    </Button>
                  </Tooltip>
                </div>
              </>
            }
          >
            <SidebarProjectHoverCard
              appearance={appearance}
              conversationCount={countedProjectSessions.length}
              openCount={openCount}
              unreadCount={unreadCount}
              isPinned={isPinned}
              pinLabel={isPinned ? '从看板移除' : '在速览中打开'}
              pinIcon={
                isPinned ? (
                  <X size={APP_ICON_SIZE} />
                ) : (
                  <SquareArrowOutUpRight size={APP_ICON_SIZE} />
                )
              }
              isUnavailable={isUnavailable}
              project={managedProject}
              projectKey={projectKey}
              onEdit={() => setManagerOpen(true)}
              onOpenFolder={(path) => {
                void desktopClient.openPathWithDefaultTarget(path)
              }}
              onTogglePinned={togglePinned}
            >
              {projectButton}
            </SidebarProjectHoverCard>
          </SidebarRow>
        }
      />
      <ConfirmationDialog
        open={confirmArchiveOpen}
        title={`归档 ${countedProjectSessions.length} 个聊天？`}
        description={
          '归档后可从归档列表恢复聊天。' +
          (countedProjectSessions.some(
            (session) =>
              session.status === 'running' ||
              session.status === 'waiting' ||
              session.status === 'queued',
          )
            ? ' 正在进行的工作将停止，待执行队列将暂停。'
            : '') +
          (countedProjectSessions.some((session) => session.hasScheduledRun)
            ? ' 这些聊天的定时任务将移除，撤销归档不会恢复定时任务。'
            : '')
        }
        actionLabel={processingAction ? '归档中…' : '归档聊天'}
        actionDisabled={processingAction !== null}
        onCancel={() => {
          if (!processingAction) setConfirmArchiveOpen(false)
        }}
        onAction={archiveAll}
      />
      <ProjectManagementDialogs
        project={managedProject}
        managerOpen={managerOpen}
        confirmRemoveOpen={confirmRemoveOpen}
        busy={processingAction !== null}
        setManagerOpen={setManagerOpen}
        setConfirmRemoveOpen={setConfirmRemoveOpen}
        onProjectChange={setManagedProject}
        onArchiveSessions={() => onArchiveSessions(countedProjectSessions)}
        onRemoveWorkspace={onRemoveWorkspace}
        onReport={onReport}
      />
      {!isUnavailable && (
        <DisclosureContent
          id={commitsId}
          expanded={commitsExpanded}
          mountPolicy="until-exit"
          className="sidebar-project-commits-disclosure"
        >
          <GitBoardCommitRows project={managedProject} type={type} />
        </DisclosureContent>
      )}
    </section>
  )
}
