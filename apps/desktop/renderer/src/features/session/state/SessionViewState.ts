import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Message, SessionViewState, ToolLogEntry } from '../../../UiTypes.js'
import type { DesktopPermissionRequest } from '../../../../shared/Types.js'
import type { DesktopSessionEvent, DesktopWorkflowEvent } from '../../../../shared/Types.js'

export type SessionViewStateSetters = {
  setEvents: Dispatch<SetStateAction<DesktopSessionEvent[]>>
  setWorkflowEvents: Dispatch<SetStateAction<DesktopWorkflowEvent[]>>
  setMessages: Dispatch<SetStateAction<Message[]>>
  setToolLog: Dispatch<SetStateAction<ToolLogEntry[]>>
  setPendingPermissions: Dispatch<SetStateAction<DesktopPermissionRequest[]>>
  setContextUsage: Dispatch<SetStateAction<SessionViewState['contextUsage']>>
}

export type SessionViewRefs = {
  activeSessionIdRef: MutableRefObject<string | null>
  sessionViewsRef: MutableRefObject<Record<string, SessionViewState>>
}

export type UpdateSessionView = (
  targetSessionId: string,
  updater: (view: SessionViewState) => SessionViewState,
) => void

export type AddToolLogEntry = (
  targetSessionId: string,
  entry: Omit<ToolLogEntry, 'id' | 'createdAt' | 'expanded'>,
) => void

export function createEmptySessionView(): SessionViewState {
  return {
    events: [],
    workflowEvents: [],
    messages: [],
    toolLog: [],
    pendingPermissions: [],
    contextUsage: null,
    selectedFile: null,
  }
}

export function applySessionView(view: SessionViewState, setters: SessionViewStateSetters): void {
  setters.setEvents(view.events)
  setters.setWorkflowEvents(view.workflowEvents)
  setters.setMessages(view.messages)
  setters.setToolLog(view.toolLog)
  setters.setPendingPermissions(view.pendingPermissions)
  setters.setContextUsage(view.contextUsage)
}

export function setSessionView(
  sessionViewsRef: MutableRefObject<Record<string, SessionViewState>>,
  targetSessionId: string,
  view: SessionViewState,
): void {
  sessionViewsRef.current = {
    ...sessionViewsRef.current,
    [targetSessionId]: view,
  }
}

export function updateSessionView(
  refs: SessionViewRefs,
  setters: SessionViewStateSetters,
  targetSessionId: string,
  updater: (view: SessionViewState) => SessionViewState,
): void {
  const nextView = updater(
    refs.sessionViewsRef.current[targetSessionId] ?? createEmptySessionView(),
  )
  setSessionView(refs.sessionViewsRef, targetSessionId, nextView)
  if (targetSessionId === refs.activeSessionIdRef.current) {
    applySessionView(nextView, setters)
  }
}

export function addToolLogEntry(
  updateView: UpdateSessionView,
  targetSessionId: string,
  entry: Omit<ToolLogEntry, 'id' | 'createdAt' | 'expanded'>,
): void {
  updateView(targetSessionId, (view) => ({
    ...view,
    toolLog: [
      {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: new Date().toLocaleTimeString(),
        expanded: entry.isError === true,
      },
      ...view.toolLog,
    ],
  }))
}

export function toggleToolLogEntry(
  refs: SessionViewRefs,
  updateView: UpdateSessionView,
  entryId: string,
): void {
  const activeId = refs.activeSessionIdRef.current
  if (!activeId) return
  updateView(activeId, (view) => ({
    ...view,
    toolLog: view.toolLog.map((entry) =>
      entry.id === entryId ? { ...entry, expanded: !entry.expanded } : entry,
    ),
  }))
}
