import type { DesktopWorkspace } from '../../../shared/Types.js'
import type { SessionListItem } from '../../UiTypes.js'
import { sidebarProjectKey, sidebarSessionProjectKey } from '../layout/sidebar/SidebarViewModel.js'

export function resolveConversationProject(
  session: SessionListItem | null,
  projects: readonly DesktopWorkspace[],
  currentWorkspace: DesktopWorkspace | null,
): DesktopWorkspace | null {
  if (!session || session.standalone || (!session.projectId && !session.workspacePath)) return null
  const key = sidebarSessionProjectKey(session)
  return (
    projects.find((project) => sidebarProjectKey(project) === key) ??
    (currentWorkspace && sidebarProjectKey(currentWorkspace) === key ? currentWorkspace : null)
  )
}
