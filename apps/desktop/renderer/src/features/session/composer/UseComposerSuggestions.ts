import { useState } from 'react'
import {
  composerSuggestionSignature,
  resolveComposerSuggestionRequest,
  type ComposerSuggestionRequest,
} from './ComposerSuggestionState.js'

/** A single request owns the trigger range, dismissal and synthetic + selection. */
export function useComposerSuggestions(
  input: string,
  cursor: number | null,
  composing: boolean,
  draftKey: string,
) {
  const [state, setState] = useState<{
    scope: string
    synthetic: ComposerSuggestionRequest | null
    dismissed: string
  }>({ scope: draftKey, synthetic: null, dismissed: '' })
  const typed = resolveComposerSuggestionRequest(input, cursor, composing)
  const synthetic =
    state.scope === draftKey && state.synthetic?.input === input ? state.synthetic : null
  const candidate = synthetic ?? typed
  const request =
    !composing &&
    !(state.scope === draftKey && state.dismissed === composerSuggestionSignature(candidate))
      ? candidate
      : null
  function dismiss(): void {
    setState({
      scope: draftKey,
      synthetic: null,
      dismissed: composerSuggestionSignature(candidate),
    })
  }
  function open(kind: 'plus' | 'review'): void {
    setState({
      scope: draftKey,
      dismissed: '',
      synthetic: {
        kind,
        input,
        query: '',
        start: cursor ?? input.length,
        end: cursor ?? input.length,
      },
    })
  }
  return { request, dismiss, openPlus: () => open('plus'), openReview: () => open('review') }
}
