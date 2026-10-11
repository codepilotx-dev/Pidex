export const CONVERSATION_SELECTION_HIGHLIGHT_NAME = 'conversation-action-selection'

type SelectionLike = {
  rangeCount: number
  toString: () => string
  getRangeAt: (index: number) => RangeLike
}

type RangeLike = {
  collapsed: boolean
  cloneRange: () => unknown
}

type HighlightRegistryLike = {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => boolean
}

type HighlightScopeLike = {
  CSS?: {
    highlights?: HighlightRegistryLike
  }
  Highlight?: new (range: unknown) => unknown
}

export type ConversationSelectionSnapshot = {
  text: string
  range: unknown
}

export function createConversationSelectionSnapshot(
  selection: SelectionLike | null | undefined,
): ConversationSelectionSnapshot | null {
  const text = selection?.toString().trim() ?? ''
  if (!selection || selection.rangeCount === 0 || !text) return null
  const range = selection.getRangeAt(0)
  if (range.collapsed) return null
  return {
    text,
    range: range.cloneRange(),
  }
}

export function installConversationSelectionHighlight(
  range: unknown,
  scope: HighlightScopeLike = window,
): boolean {
  const registry = scope.CSS?.highlights
  const HighlightCtor = scope.Highlight
  if (!registry || !HighlightCtor) return false
  registry.set(CONVERSATION_SELECTION_HIGHLIGHT_NAME, new HighlightCtor(range))
  return true
}

export function clearConversationSelectionHighlight(scope: HighlightScopeLike = window): void {
  scope.CSS?.highlights?.delete(CONVERSATION_SELECTION_HIGHLIGHT_NAME)
}
