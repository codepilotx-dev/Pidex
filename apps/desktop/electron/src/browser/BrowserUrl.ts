export type DesktopBrowserNavigationTarget = {
  url: string
  origin: string | null
}

export function normalizeDesktopBrowserUrl(value: string): DesktopBrowserNavigationTarget {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('请输入要打开的网址')
  if (trimmed === 'about:blank') return { url: trimmed, origin: null }

  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(trimmed)
  const withProtocol =
    local && !/^https?:/.test(trimmed)
      ? `http://${trimmed}`
      : /^[A-Za-z][A-Za-z\d+.-]*:/.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new Error('网址格式无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('内置浏览器只支持 HTTP 和 HTTPS 地址')
  }
  if (parsed.username || parsed.password) throw new Error('网址不得包含凭据')
  return { url: parsed.toString(), origin: parsed.origin }
}

export function isAllowedDesktopBrowserNavigation(value: string): boolean {
  try {
    normalizeDesktopBrowserUrl(value)
    return true
  } catch {
    return false
  }
}
