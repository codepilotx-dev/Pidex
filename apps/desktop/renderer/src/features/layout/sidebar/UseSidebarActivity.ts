import { useState } from 'react'
import type { SessionListItem } from '../../../UiTypes.js'
import { reconcileSidebarActivitySnapshot } from './SidebarViewModel.js'

export function useSidebarActivity(sessions: readonly SessionListItem[], key: string | null) {
  const [state, setState] = useState(() => ({
    key,
    sessions,
    snapshot: reconcileSidebarActivitySnapshot(null, sessions),
  }))
  let current = state
  if (state.key !== key || state.sessions !== sessions) {
    current = {
      key,
      sessions,
      snapshot: reconcileSidebarActivitySnapshot(
        state.key === key ? state.snapshot : null,
        sessions,
      ),
    }
    setState(current)
  }
  return {
    snapshot: key === null ? undefined : current.snapshot,
    clearRead: () =>
      setState({
        key,
        sessions,
        snapshot: reconcileSidebarActivitySnapshot(current.snapshot, sessions, true),
      }),
  }
}
