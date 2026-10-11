import type { NewSessionSuggestionCategoryId } from './NewSessionSuggestions.js'

export type NewSessionSuggestionState =
  | { kind: 'root' }
  | { kind: 'templates' }
  | { kind: 'category'; categoryId: NewSessionSuggestionCategoryId }
  | { kind: 'hidden'; reason: 'custom-input' }

export function createNewSessionSuggestionState(composerValue: string): NewSessionSuggestionState {
  return composerValue.trim().length > 0
    ? { kind: 'hidden', reason: 'custom-input' }
    : { kind: 'root' }
}

export function syncNewSessionSuggestionState(
  state: NewSessionSuggestionState,
  composerValue: string,
): NewSessionSuggestionState {
  if (state.kind === 'category') return state
  return createNewSessionSuggestionState(composerValue)
}

export function showNewSessionSuggestionTemplates(): NewSessionSuggestionState {
  return { kind: 'templates' }
}

export function showContextualNewSessionSuggestions(): NewSessionSuggestionState {
  return { kind: 'root' }
}

export function selectNewSessionSuggestionCategory(
  categoryId: NewSessionSuggestionCategoryId,
): NewSessionSuggestionState {
  return { kind: 'category', categoryId }
}

export function removeGeneratedSuggestionStarter(composerValue: string, starter: string): string {
  if (!composerValue.startsWith(starter)) return composerValue
  return composerValue.slice(starter.length).trimStart()
}
