import type { DesktopSessionStatus } from '../../../../shared/Types.js'

export function canRegenerateConversationTitle(input: {
  hasActiveSession: boolean
  hasFirstMessage: boolean
  pending: boolean
  status: DesktopSessionStatus
}): boolean {
  return (
    input.hasActiveSession && input.hasFirstMessage && input.status === 'done' && !input.pending
  )
}

export function shouldCloseConversationRenameDialog(input: {
  activeSessionId: string | null
  requestedSessionId: string
  succeeded: boolean
}): boolean {
  return input.succeeded && input.activeSessionId === input.requestedSessionId
}

export function normalizeConversationTitle(title: string): string {
  return title.trim()
}

export function shouldSubmitConversationRename(input: {
  currentTitle: string
  nextTitle: string
  isComposing?: boolean
  isRenaming?: boolean
}): boolean {
  if (input.isRenaming) return false
  if (input.isComposing) return false
  const trimmedNext = normalizeConversationTitle(input.nextTitle)
  if (!trimmedNext) return false
  if (trimmedNext === normalizeConversationTitle(input.currentTitle)) return false
  return true
}

export function canInlineEditConversationTitle(input: {
  hasActiveSession: boolean
  isLoading: boolean
  isRegenerating: boolean
  isRenaming: boolean
}): boolean {
  return input.hasActiveSession && !input.isLoading && !input.isRegenerating && !input.isRenaming
}
