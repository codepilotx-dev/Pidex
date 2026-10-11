import type React from 'react'
import { lazy, Suspense, useState } from 'react'
import type { DesktopWorkspace, ProjectAppearance } from '../../../../shared/Types.js'
import { SidebarHoverCard } from './SidebarHoverCard.js'
export { countOpenProjectSessions } from './SidebarViewModel.js'

const SidebarProjectHoverCardOverlay = lazy(async () => {
  const module = await import('./SidebarProjectHoverCardOverlay.js')
  return { default: module.SidebarProjectHoverCardOverlay }
})

type Props = {
  appearance: ProjectAppearance
  children: React.ReactElement
  conversationCount: number
  openCount: number
  unreadCount: number
  isPinned: boolean
  isUnavailable: boolean
  project: DesktopWorkspace
  projectKey: string
  onEdit: () => void
  onOpenFolder: (path: string) => void
  onTogglePinned: () => void
}

export function SidebarProjectHoverCard({
  appearance,
  children,
  conversationCount,
  openCount,
  unreadCount,
  isPinned,
  isUnavailable,
  project,
  projectKey,
  onEdit,
  onOpenFolder,
  onTogglePinned,
}: Props): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)

  return (
    <SidebarHoverCard
      open={open}
      onAnchorKeyDown={(event) => {
        if (event.altKey || event.key !== 'ArrowRight') return
        event.preventDefault()
        setOpen(true)
        setFocusRequest((current) => current + 1)
      }}
      onOpenChange={setOpen}
      renderOverlay={(interactionProps) => (
        <Suspense fallback={null}>
          <SidebarProjectHoverCardOverlay
            {...interactionProps}
            appearance={appearance}
            conversationCount={conversationCount}
            openCount={openCount}
            unreadCount={unreadCount}
            focusRequest={focusRequest}
            isPinned={isPinned}
            isUnavailable={isUnavailable}
            project={project}
            projectKey={projectKey}
            onFocusRequestHandled={() => setFocusRequest(0)}
            onEdit={onEdit}
            onOpenFolder={onOpenFolder}
            onTogglePinned={onTogglePinned}
          />
        </Suspense>
      )}
    >
      {children}
    </SidebarHoverCard>
  )
}
