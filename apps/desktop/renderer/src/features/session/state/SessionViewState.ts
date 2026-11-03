import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Message, SessionViewState } from '../../../UiTypes.js'
import type { DesktopSessionEvent, DesktopWorkflowEvent } from '../../../../shared/Types.js'

export type SessionViewStateSetters = {
  setEvents: Dispatch<SetStateAction<DesktopSessionEvent[]>>
  setWorkflowEvents: Dispatch<SetStateAction<DesktopWorkflowEvent[]>>
  setMessages: Dispatch<SetStateAction<Message[]>>
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
