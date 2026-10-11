import { useEffect, useState } from 'react'
import type { SessionListItem } from '../../../UiTypes.js'
import { canonicalThreadCache } from '../../session/state/CanonicalThreadCache.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

export function latestAssistantPreview(
  messages: readonly { role: string; text: string }[],
): string | null {
  const text = messages.findLast(
    (message) => message.role === 'assistant' && message.text.trim(),
  )?.text
  return text?.replace(/\s+/g, ' ').trim().slice(0, 180) || null
}

export function useSidebarActivityPreview(session: SessionListItem): string | null {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const cached = canonicalThreadCache.get(session.id)
    const items = cached
      ? [...cached.itemsById.values()]
          .filter((item) => item.type === 'text' && item.placement === 'result')
          .sort((a, b) => a.createdAt - b.createdAt || (a.ordinal ?? 0) - (b.ordinal ?? 0))
      : []
    const latest = items.at(-1)
    const text = latest
      ? items
          .filter((item) => item.messageID === latest.messageID)
          .map((item) => (item.type === 'text' ? item.text : ''))
          .join('')
      : ''
    setPreview(latestAssistantPreview([{ role: 'assistant', text }]))
    void desktopClient
      .getSession(session.id)
      .then((snapshot) => {
        if (!cancelled) setPreview(latestAssistantPreview(snapshot.view.messages))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [session.id, session.lastMessageAt, session.latestTurnStatus])
  return preview
}
