import type React from 'react'
import { useRef } from 'react'
import type { DesktopWorkspace, ProjectAppearance } from '../../../../shared/Types.js'
import {
  focusSidebarHoverCardAnchor,
  type SidebarHoverCardOverlayRenderProps,
} from './SidebarHoverCard.js'
import { ProjectDetailsCard } from '../../projects/ProjectDetailsCard.js'
import { SidebarHoverCardSurface } from './SidebarHoverCardSurface.js'

type Props = SidebarHoverCardOverlayRenderProps & {
  appearance: ProjectAppearance
  conversationCount: number
  focusRequest: number
  openCount: number
  isPinned: boolean
  isUnavailable: boolean
  project: DesktopWorkspace
  projectKey: string
  unreadCount: number
  onFocusRequestHandled: () => void
  onEdit: () => void
  onOpenFolder: (path: string) => void
  onTogglePinned: () => void
}

export function SidebarProjectHoverCardOverlay({
  appearance,
  conversationCount,
  focusRequest,
  openCount,
  isPinned,
  isUnavailable,
  project,
  projectKey,
  unreadCount,
  onFocusRequestHandled,
  onEdit,
  onOpenFolder,
  onTogglePinned,
  ...interactionProps
}: Props): React.ReactNode {
  const initialFocusRef = useRef<HTMLButtonElement | null>(null)
  return (
    <SidebarHoverCardSurface
      {...interactionProps}
      ariaLabel="项目详情"
      className="sidebar-project-hover-card tw:w-[min(280px,calc(100vw-16px))] tw:max-h-[min(640px,calc(100vh-32px))] tw:overflow-y-auto tw:px-3 tw:py-2"
      focusRef={initialFocusRef}
      focusRequest={focusRequest}
      onFocusRequestHandled={onFocusRequestHandled}
      positionOutsideSidebar
    >
      <ProjectDetailsCard
        appearance={appearance}
        conversationCount={conversationCount}
        openCount={openCount}
        unreadCount={unreadCount}
        isPinned={isPinned}
        isUnavailable={isUnavailable}
        project={project}
        pinRef={initialFocusRef}
        onEdit={() => {
          onEdit()
          interactionProps.requestOpenChange(false)
        }}
        onOpenFolder={(path) => {
          onOpenFolder(path)
          interactionProps.requestOpenChange(false)
        }}
        onTogglePinned={() => {
          onTogglePinned()
          interactionProps.requestOpenChange(false)
          focusProjectAnchorAfterUpdate(projectKey, !isPinned)
        }}
      />
    </SidebarHoverCardSurface>
  )
}

function focusProjectAnchorAfterUpdate(projectKey: string, willBePinned: boolean): void {
  requestAnimationFrame(() => {
    const projectAnchor = [
      ...document.querySelectorAll<HTMLElement>('.sidebar-project-button'),
    ].find((button) => button.dataset.sidebarProjectKey === projectKey)
    const preferredSection = willBePinned ? 'pinned' : 'projects'
    const sectionFallback =
      document.querySelector<HTMLElement>(`[data-sidebar-section-id="${preferredSection}"]`) ??
      document.querySelector<HTMLElement>('[data-sidebar-section-id="recent"]') ??
      document.querySelector<HTMLElement>('.sidebar-section-header')
    focusSidebarHoverCardAnchor(projectAnchor ?? sectionFallback)
  })
}
