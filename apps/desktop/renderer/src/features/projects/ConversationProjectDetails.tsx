import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import {
  mergeCatalogProjects,
  useSidebarProjectCatalog,
} from '../layout/sidebar/UseSidebarProjectCatalog.js'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import { AnchoredPopover } from '../../components/ui/AnchoredPopover.js'
import { Button } from '../../components/ui/Button.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import {
  buildProjectSessionBuckets,
  normalizeSidebarPath,
  sidebarProjectKey,
} from '../layout/sidebar/SidebarViewModel.js'
import { DEFAULT_PROJECT_APPEARANCE, ProjectAppearanceGlyph } from './ProjectAppearance.js'
import { ProjectDetailsCard } from './ProjectDetailsCard.js'
import { ProjectManagementDialogs } from './ProjectManagementDialogs.js'
import { resolveConversationProject } from './ProjectDetailsModel.js'

type Props = {
  session: SessionListItem | null
  currentWorkspace: DesktopWorkspace | null
  projects: readonly DesktopWorkspace[]
  sessions: readonly SessionListItem[]
  unavailableWorkspacePaths: ReadonlySet<string>
  onPinWorkspace: (project: DesktopWorkspace) => void
  onUnpinWorkspace: (project: DesktopWorkspace) => void
  onRemoveWorkspace: (project: DesktopWorkspace) => void
  onArchiveSessions: (
    ids: readonly string[],
  ) => Promise<{ failedSessionIds: string[]; succeededSessionIds: string[] }>
  onReport: (message: string) => void
}

export function ConversationProjectDetails(props: Props): React.ReactNode {
  const { projectCatalogState } = useSidebarProjectCatalog({ onReport: props.onReport })
  const projects = useMemo(
    () => mergeCatalogProjects(projectCatalogState.projects, props.projects),
    [projectCatalogState.projects, props.projects],
  )
  const project = resolveConversationProject(props.session, projects, props.currentWorkspace)
  if (!project || !props.session) return null
  return (
    <ProjectDetailsTrigger
      {...props}
      key={`${props.session.id}:${sidebarProjectKey(project)}`}
      project={project}
    />
  )
}

function ProjectDetailsTrigger({
  project,
  sessions,
  unavailableWorkspacePaths,
  onPinWorkspace,
  onUnpinWorkspace,
  onRemoveWorkspace,
  onArchiveSessions,
  onReport,
}: Props & { project: DesktopWorkspace }): React.ReactNode {
  const [managedProject, setManagedProject] = useState(project)
  const [open, setOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const editFrameRef = useRef<number | null>(null)
  const { projectAppearances } = useDesktopSettings()
  useEffect(() => setManagedProject(project), [project])
  useEffect(
    () => () => {
      if (editFrameRef.current !== null) cancelAnimationFrame(editFrameRef.current)
    },
    [],
  )
  const bucket = useMemo(
    () =>
      buildProjectSessionBuckets(
        sessions.filter((session) => !session.archivedAt && !session.standalone),
        [],
      ).get(sidebarProjectKey(managedProject)),
    [sessions, managedProject],
  )
  const appearance = managedProject.projectId
    ? (projectAppearances[managedProject.projectId] ?? DEFAULT_PROJECT_APPEARANCE)
    : DEFAULT_PROJECT_APPEARANCE
  const isPinned = Boolean(managedProject.pinnedAt)
  const isUnavailable = [...unavailableWorkspacePaths].some(
    (path) => normalizeSidebarPath(path) === normalizeSidebarPath(managedProject.path),
  )

  return (
    <>
      <AnchoredPopover
        align="start"
        className="sidebar-hover-card-surface sidebar-project-hover-card"
        size="md"
        contentLabel="项目详情"
        contentRole="dialog"
        open={open}
        side="bottom"
        sideOffset={4}
        onOpenChange={setOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
        trigger={
          <Button
            isIconOnly
            ref={triggerRef}
            className="chat-session-project-details tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center"
            color="ghostSecondary"
            size="toolbar"
            title={`项目详情：${managedProject.name}`}
          >
            <ProjectAppearanceGlyph size={APP_ICON_SIZE} appearance={appearance} />
          </Button>
        }
      >
        <ProjectDetailsCard
          appearance={appearance}
          conversationCount={bucket?.allSessions.length ?? 0}
          openCount={bucket?.openCount ?? 0}
          unreadCount={bucket?.unreadCount ?? 0}
          isPinned={isPinned}
          isUnavailable={isUnavailable}
          project={managedProject}
          onTogglePinned={() => {
            if (isPinned) onUnpinWorkspace(managedProject)
            else onPinWorkspace(managedProject)
            setOpen(false)
          }}
          onOpenFolder={(path) => {
            void desktopClient.openPathWithDefaultTarget(path)
            setOpen(false)
          }}
          onEdit={() => {
            setOpen(false)
            // Let the popover restore focus before the dialog captures its return target.
            editFrameRef.current = requestAnimationFrame(() => setManagerOpen(true))
          }}
        />
      </AnchoredPopover>
      <ProjectManagementDialogs
        project={managedProject}
        managerOpen={managerOpen}
        confirmRemoveOpen={confirmRemoveOpen}
        setManagerOpen={setManagerOpen}
        setConfirmRemoveOpen={setConfirmRemoveOpen}
        onProjectChange={setManagedProject}
        onArchiveSessions={async () => {
          const result = await onArchiveSessions(
            bucket?.allSessions.map((session) => session.id) ?? [],
          )
          if (result.failedSessionIds.length > 0) {
            onReport(
              `已归档 ${result.succeededSessionIds.length} 个任务，${result.failedSessionIds.length} 个失败。`,
            )
          }
          return result.failedSessionIds.length === 0
        }}
        onRemoveWorkspace={onRemoveWorkspace}
        onReport={onReport}
      />
    </>
  )
}
