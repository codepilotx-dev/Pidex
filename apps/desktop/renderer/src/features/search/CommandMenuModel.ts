import { sessionDisplayTitle, type SessionListItem } from '../../UiTypes.js'
import {
  deriveSidebarSessionVisualState,
  type SidebarSessionVisualState,
} from '../layout/sidebar/SidebarViewModel.js'

export const COMMAND_MENU_TASK_LIMIT = 9

export type CommandMenuTask = {
  session: SessionListItem
  id: string
  title: string
  workspaceName: string
  visualState: SidebarSessionVisualState
  shortcutIndex: number
  shortcutLabel: string
}

export {
  resolveCommandMenuShortcut,
  type CommandMenuShortcut,
  type CommandMenuShortcutEvent,
} from './CommandMenuShortcuts.js'

export function buildCommandMenuTasks(
  sessions: readonly SessionListItem[],
  query: string,
  pendingPermissionSessionIds: ReadonlySet<string> = new Set(),
): CommandMenuTask[] {
  return sessions
    .filter((session) => !session.archivedAt)
    .filter((session) => matchesTaskQuery(session, query))
    .slice(0, COMMAND_MENU_TASK_LIMIT)
    .map((session, index) => ({
      session,
      id: session.id,
      title: sessionDisplayTitle(session),
      workspaceName: session.workspaceName,
      visualState: deriveSidebarSessionVisualState(session, pendingPermissionSessionIds),
      shortcutIndex: index + 1,
      shortcutLabel: `Ctrl+${index + 1}`,
    }))
}

export function matchesTaskQuery(session: SessionListItem, query: string): boolean {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return true
  return [
    session.sessionName ?? '',
    session.customTitle ?? '',
    session.aiTitle ?? '',
    session.tag ?? '',
    session.gitBranch ?? '',
    session.summary ?? '',
    session.firstPrompt ?? '',
    session.prRepository ?? '',
    session.prUrl ?? '',
    session.workspaceName,
    session.workspacePath,
    session.createdAt,
    session.status,
  ]
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}
