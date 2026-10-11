export function formatBrowserDisplayURL(url: string): string {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`
    }
    return url
  } catch {
    return url
  }
}
