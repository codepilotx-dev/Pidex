import { useEffect, useMemo, useState } from 'react'
import type { ComposerMenuItem } from './ComposerCommandMenu.js'
import {
  buildComposerSuggestionItems,
  resolveComposerMenuActiveKey,
} from './ComposerSuggestionMenu.js'

export function useComposerSuggestionMenu(
  source: ComposerMenuItem[],
  keyword: string,
  scope: string,
  open: boolean,
) {
  const [state, setState] = useState<{
    scope: string
    query: string
    category: string | null
    key: string | null
  }>({ scope: '', query: '', category: null, key: null })
  const category = state.scope === scope ? state.category : null
  useEffect(() => {
    if (!open) setState({ scope: '', query: '', category: null, key: null })
  }, [open])
  function setCategory(next: string | null): void {
    setState({ scope, query: keyword, category: next, key: null })
  }
  const items = useMemo(
    () => buildComposerSuggestionItems(source, keyword, category, setCategory),
    [source, keyword, category, scope],
  )
  const selected = resolveComposerMenuActiveKey(
    items,
    state.scope === scope && state.query === keyword ? state.key : null,
  )
  const activeKey = open ? selected : null
  function setActiveKey(key: string | null): void {
    setState({ scope, query: keyword, category, key })
  }
  return {
    items,
    activeKey,
    activeItem: items.find((item) => item.key === activeKey),
    setActiveKey,
  }
}
