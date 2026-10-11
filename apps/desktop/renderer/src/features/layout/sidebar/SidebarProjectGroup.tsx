import type React from 'react'
import { memo, useEffect, useId, useState } from 'react'
import {
  Archive,
  FolderOpen,
  MoreHorizontal,
  List,
  Plus,
  Pin,
  PinOff,
  Settings2,
  SquarePen,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import type { DesktopSidebarSort, DesktopWorkspace } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { SessionListItem } from '../../../UiTypes.js'
import { Button } from '../../../components/ui/Button.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { DropdownActions } from '../../../components/ui/DropdownActions.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SidebarRow } from './SidebarRow.js'
import { SidebarSessionGroup } from './SidebarSessionGroup.js'
import {
  AppContextMenu as SidebarContextMenu,
  type AppContextMenuAction as ContextMenuAction,
} from '../../../components/ui/AppContextMenu.js'
import { cx } from '../../../utils/Cx.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  PROJECT_APPEARANCE_COLOR_CLASS,
  PROJECT_APPEARANCE_MARKER_CLASS,
  ProjectAppearanceGlyph,
} from '../../projects/ProjectAppearance.js'
import {
  type SidebarProjectSessionBucket,
  sidebarProjectKey,
  normalizeSidebarPath,
} from './SidebarViewModel.js'
import { SidebarProjectHoverCard } from './SidebarProjectHoverCard.js'
import { ProjectManagementDialogs } from '../../projects/ProjectManagementDialogs.js'
import { sidebarProjectDisclosureKey } from './SidebarDisclosureStore.js'

const SESSION_KEY_SEPARATOR = '|'

type Props = {
  /** 项目行在默认区域的全局拖放序号。 */
  dropIndex?: number
  onItemDragStart?: (sessionId: string) => void
  onItemDragEnd?: () => void
  currentSectionId?: string | null
  onMoveProjectToSection?: (project: DesktopWorkspace, sectionId: string) => void
  onMoveProjectToDefault?: (project: DesktopWorkspace) => void
  onCreateSection?: (itemKeys?: string[]) => void
  customSections?: readonly { id: string; title: string }[]
  onMoveToSection?: (sessionId: string, sectionId: string) => void
  onMoveToDefault?: (sessionId: string) => void
  activeSessionId: string | null
  bucket: SidebarProjectSessionBucket
  disclosureStore: KeyedDisclosureStore
  isUnavailable: boolean
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  titleLoadingIds: ReadonlySet<string>
  project: DesktopWorkspace
  sessionFallbackTitles: Record<string, string>
  sort?: DesktopSidebarSort
  manualOrderByScope?: Record<string, string[]>
  workspace: DesktopWorkspace | null
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onManualOrderChange?: (scopeKey: string, order: string[]) => void
  onSortChange?: (sort: 'manual') => void
  onPinSession: (session: SessionListItem) => void
  onUnpinSession: (session: SessionListItem) => void
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  onReport?: (message: string) => void
}

function SidebarProjectGroupComponent({
  dropIndex,
  onItemDragStart,
  onItemDragEnd,
  currentSectionId = null,
  onMoveProjectToSection,
  onMoveProjectToDefault,
  onCreateSection,
  customSections = [],
  onMoveToSection,
  onMoveToDefault,
  activeSessionId,
  bucket,
  disclosureStore,
  isUnavailable,
  now,
  pendingPermissionSessionIds,
  titleLoadingIds,
  project,
  sessionFallbackTitles,
  sort = 'priority',
  manualOrderByScope = {},
  workspace,
  onArchiveSessions,
  onCreateSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onManualOrderChange,
  onSortChange,
  onPinSession,
  onUnpinSession,
  onUnpinWorkspace,
  onReport = () => undefined,
}: Props): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [managedProject, setManagedProject] = useState(project)
  const [processingAction, setProcessingAction] = useState<'archive' | null>(null)
  const { projectAppearances } = useDesktopSettings()

  useEffect(() => setManagedProject(project), [project])

  const projectKey = sidebarProjectKey(managedProject)
  const disclosureKey = sidebarProjectDisclosureKey(managedProject)
  const isExpanded = useDisclosureExpanded(disclosureStore, disclosureKey)
  const projectSessionsId = useId()
  const projectSessions = bucket.displaySessions
  const hasCollapsedUnread =
    !isExpanded && projectSessions.some((session) => Boolean(session.unreadAt))
  const countedProjectSessions = bucket.allSessions
  const unreadCount = bucket.unreadCount
  const openCount = bucket.openCount
  const isCurrent =
    workspace?.projectId && managedProject.projectId
      ? workspace.projectId === managedProject.projectId
      : normalizeSidebarPath(workspace?.path ?? '') === normalizeSidebarPath(managedProject.path)
  const actionsVisible = hovered || menuOpen
  const isPinned = Boolean(managedProject.pinnedAt)
  const appearance = managedProject.projectId
    ? (projectAppearances[managedProject.projectId] ?? DEFAULT_PROJECT_APPEARANCE)
    : DEFAULT_PROJECT_APPEARANCE

  function archiveAll(): void {
    setProcessingAction('archive')
    void onArchiveSessions(countedProjectSessions)
      .then((success) => {
        if (success) setConfirmArchiveOpen(false)
      })
      .finally(() => setProcessingAction(null))
  }

  function togglePinned(): void {
    if (isPinned) {
      onUnpinWorkspace(managedProject)
    } else {
      onPinWorkspace(managedProject)
    }
  }

  function contextActions(): ContextMenuAction[] {
    const folders =
      managedProject.folders ?? (managedProject.path ? [{ path: managedProject.path }] : [])
    return [
      {
        kind: 'item',
        label: isPinned ? '取消置顶' : '置顶',
        icon: isPinned ? <PinOff size={APP_ICON_SIZE} /> : <Pin size={APP_ICON_SIZE} />,
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
        label: '分区',
        icon: <List size={APP_ICON_SIZE} />,
        layout: 'grid',
        children: [
          ...customSections.map((section): ContextMenuAction => ({
            kind: 'item',
            label: section.title,
            checked: currentSectionId === section.id,
            onSelect: () =>
              currentSectionId === section.id
                ? onMoveProjectToDefault?.(managedProject)
                : onMoveProjectToSection?.(managedProject, section.id),
          })),
          ...(customSections.length ? [{ kind: 'separator' as const }] : []),
          {
            kind: 'item',
            label: '新建分区…',
            icon: <Plus size={APP_ICON_SIZE} />,
            onSelect: () => onCreateSection?.([`project:${projectKey}`]),
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
      aria-controls={projectSessionsId}
      aria-expanded={isExpanded}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown ArrowRight"
      aria-label={`${managedProject.name}，${isExpanded ? '折叠项目任务' : '展开项目任务'}`}
      className="sidebar-project-button tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit tw:focus-visible:outline-none"
      data-current={isCurrent || undefined}
      data-sidebar-drop-index={dropIndex}
      data-sidebar-project-key={projectKey}
      data-sidebar-project-session-keys={bucket.allSessions
        .map((session) => `session:${session.id}`)
        .join(SESSION_KEY_SEPARATOR)}
      type="button"
      onClick={() => disclosureStore.setExpanded(disclosureKey, !isExpanded)}
    >
      <span className="sidebar-project-title-text tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:whitespace-nowrap tw:text-inherit tw:type-row-title">
        {managedProject.name}
      </span>
    </button>
  )

  return (
    <section className={cx('sidebar-project', 'tw:flex', 'tw:flex-col', 'tw:flex tw:flex-col')}>
      <SidebarContextMenu
        actions={contextActions()}
        layout="grid"
        size="md"
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
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            trailing={
              <>
                <div
                  className={cx(
                    'sidebar-project-actions tw:relative tw:flex tw:min-h-6 tw:items-center tw:justify-end tw:gap-1 tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto',
                    actionsVisible
                      ? 'is-visible tw:opacity-100 tw:pointer-events-auto'
                      : 'tw:opacity-0 tw:pointer-events-none',
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <PopoverMenu
                    className="popover-sidebar-project popover-menu--grid"
                    open={menuOpen}
                    side="bottom"
                    size="md"
                    trigger={
                      <Button
                        isIconOnly
                        className="sidebar-project-action-button"
                        variant="text"
                        iconSize="md"
                        size="compact"
                        title="更多"
                      >
                        <MoreHorizontal size={APP_ICON_SIZE} />
                      </Button>
                    }
                    onOpenChange={setMenuOpen}
                  >
                    <DropdownActions actions={contextActions()} />
                  </PopoverMenu>
                  <Button
                    isIconOnly
                    aria-label="新建对话"
                    className="sidebar-project-action-button"
                    variant="text"
                    iconSize="md"
                    disabled={isUnavailable}
                    size="compact"
                    title="新建对话"
                    onClick={() => onCreateSession(managedProject)}
                  >
                    <SquarePen size={APP_ICON_SIZE} />
                  </Button>
                </div>
                {hasCollapsedUnread && !actionsVisible ? (
                  <span
                    className="sidebar-project-unread sidebar-indicator tw:pointer-events-none tw:absolute tw:inset-y-0 tw:end-0 tw:my-auto tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:text-app-text-meta tw:group-hover:hidden tw:group-has-[:focus-visible]:hidden tw:group-has-[[data-state=open]]:hidden"
                    role="img"
                    aria-label="项目内有未读会话"
                  >
                    <span className="sidebar-status-icon tw:inline-flex tw:size-5 tw:shrink-0 tw:items-center tw:justify-center">
                      <span className="sidebar-unread-dot tw:size-2 tw:flex-none tw:rounded-full tw:bg-app-accent" />
                    </span>
                  </span>
                ) : null}
              </>
            }
          >
            <SidebarProjectHoverCard
              appearance={appearance}
              conversationCount={countedProjectSessions.length}
              openCount={openCount}
              unreadCount={unreadCount}
              isPinned={isPinned}
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
      <DisclosureContent
        className="sidebar-project-sessions-disclosure"
        contentClassName="sidebar-project-sessions-disclosure__content tw:pt-0.5"
        expanded={projectSessions.length > 0 && isExpanded}
        id={projectSessionsId}
        mountPolicy="always"
      >
        {projectSessions.length > 0 ? (
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            currentSectionId={currentSectionId}
            customSections={customSections}
            pendingPermissionSessionIds={pendingPermissionSessionIds}
            titleLoadingIds={titleLoadingIds}
            groupKey={`project:${projectKey}`}
            onItemDragEnd={onItemDragEnd}
            onItemDragStart={onItemDragStart}
            onMoveToDefault={onMoveToDefault}
            onMoveToSection={onMoveToSection}
            manualOrderByScope={manualOrderByScope}
            now={now}
            sessionFallbackTitles={sessionFallbackTitles}
            sessions={projectSessions}
            sort={sort}
            onArchiveSessions={onArchiveSessions}
            onManualOrderChange={onManualOrderChange}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleSessionUnread={onToggleSessionUnread}
            onRenameSession={onRenameSession}
            onSortChange={onSortChange}
            onUnpinSession={onUnpinSession}
          />
        ) : null}
      </DisclosureContent>

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
    </section>
  )
}

export const SidebarProjectGroup = memo(SidebarProjectGroupComponent)
