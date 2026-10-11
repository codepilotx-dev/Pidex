/**
 * Citation URL gate shared by tool result blocks and result cards: only
 * credential-free http/https targets may become clickable.
 */
export function safeCitationUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
