import type {
  DesktopContextUsage,
  DesktopFilePreview,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionListItem,
  DesktopSessionMessage,
  DesktopToolLogEntry,
  DesktopWorkflowEvent,
} from '../shared/Types.js'

export type AppView =
  'new' | 'sessionGroups' | 'projects' | 'search' | 'plugins' | 'pullRequests' | 'automations'

export type DrawerTab = 'files' | 'diff' | 'permissions' | 'toolLog' | 'settings'

export type Message = DesktopSessionMessage

export type SessionListItem = DesktopSessionListItem

export type ToolLogEntry = DesktopToolLogEntry

export const SESSION_TITLE_MAX_LENGTH = 20

const DEFAULT_SESSION_TITLE = '新对话'

export function sessionResolvedTitle(
  session: SessionListItem,
  fallbackTitle?: string | null,
): string {
  const persistedTitle = session.sessionName
  return (
    session.customTitle ||
    session.aiTitle ||
    (persistedTitle && persistedTitle !== DEFAULT_SESSION_TITLE ? persistedTitle : '') ||
    fallbackTitle ||
    session.firstPrompt ||
    persistedTitle ||
    session.workspaceName ||
    DEFAULT_SESSION_TITLE
  )
}

export function sessionDisplayTitle(
  session: SessionListItem | null | undefined,
  fallbackTitle?: string | null,
): string {
  const title = cleanSessionTitleForDisplay(
    session ? sessionResolvedTitle(session, fallbackTitle) : fallbackTitle || DEFAULT_SESSION_TITLE,
  )
  const characters = [...title]
  return characters.length > SESSION_TITLE_MAX_LENGTH
    ? `${characters.slice(0, SESSION_TITLE_MAX_LENGTH - 1).join('')}…`
    : title
}

export { sessionResolvedTitle as sessionEditableTitle }

export type SessionViewState = {
  eventModelVersion?: 1
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  selectedFile: DesktopFilePreview | null
}

export function sessionViewFallbackTitle(
  view: Pick<SessionViewState, 'events' | 'messages'>,
): string | null {
  const event = view.events.find((event) => event.role === 'user')
  return sessionTitleFromContent(
    event && 'content' in event && typeof event.content === 'string'
      ? event.content
      : view.messages.find((message) => message.role === 'user')?.text,
  )
}

export function sessionTitleFromContent(content: string | null | undefined): string | null {
  const title = content?.trim().split(/\r?\n/)[0]?.trim()
  return title ? cleanSessionTitleForDisplay(title) : null
}

function cleanSessionTitleForDisplay(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || DEFAULT_SESSION_TITLE
}
