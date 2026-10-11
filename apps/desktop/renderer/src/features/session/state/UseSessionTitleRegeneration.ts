import { useCallback, useReducer } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'

const pendingSessionIds = new Set<string>()

export function useSessionTitleRegeneration(): readonly [
  pendingSessionIds: ReadonlySet<string>,
  regenerateSessionTitle: (sessionId: string) => Promise<boolean>,
] {
  const [, rerender] = useReducer((value) => value + 1, 0)

  const regenerateSessionTitle = useCallback(async (sessionId: string): Promise<boolean> => {
    if (pendingSessionIds.has(sessionId)) return false

    pendingSessionIds.add(sessionId)
    rerender()
    try {
      await desktopClient.regenerateSessionTitle(sessionId)
      return true
    } finally {
      pendingSessionIds.delete(sessionId)
      rerender()
    }
  }, [])

  return [pendingSessionIds, regenerateSessionTitle]
}
