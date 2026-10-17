import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request } from 'node:https'

export function isPublicIconAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number]
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113)
  }
  // Global unicast only: excludes mapped IPv4, NAT64, local and multicast addresses.
  if (family !== 6 || !/^[23][0-9a-f]{3}:/i.test(address)) return false
  const [first, second] = address.split(':').map((part) => parseInt(part || '0', 16))
  return !(first === 0x2002 || first === 0x2001 && (second! < 0x200 || second === 0xdb8) || first === 0x3fff && second! < 0x1000)
}

export function websiteIconURL(raw: string, base?: string): URL {
  const url = new URL(raw, base)
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048 || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new Error('请使用公网 HTTPS 网站地址')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicIconAddress(host)) throw new Error('网站图标仅支持公网地址')
  return url
}

export type IconPage = { bytes: Buffer; type: string; url: string }
export type IconPageFetcher = (url: string, signal: AbortSignal) => Promise<IconPage>

/** Resolve once and dial that address: redirects and image links receive the same checks. */
export async function fetchIconPage(raw: string, signal: AbortSignal, redirects = 0): Promise<IconPage> {
  const url = websiteIconURL(raw)
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true })
  // Clash/Surge TUN returns RFC 2544 fake IPs for public names. Keep the name for
  // TLS and pin its answer, but never accept a literal fake IP from the renderer.
  if (!addresses.length || addresses.some(({ address }) => !isPublicIconAddress(address) && !(isIP(url.hostname) === 0 && /^198\.(18|19)\./.test(address)))) throw new Error('网站图标仅支持公网地址')
  const target = addresses[0]!
  return new Promise((resolve, reject) => {
    const req = request(url, {
      signal,
      headers: { accept: 'text/html,application/json,image/*', 'user-agent': 'Pidex' },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [target])
        else callback(null, target.address, target.family)
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirects >= 3) { reject(new Error('网站重定向过多')); return }
        try { resolve(fetchIconPage(websiteIconURL(res.headers.location, url.href).href, signal, redirects + 1)) } catch (error) { reject(error) }
        return
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('网站未返回可用内容')); return }
      const parts: Buffer[] = []
      let length = 0
      res.on('data', (part: Buffer) => {
        length += part.length
        if (length > 1024 * 1024) { res.destroy(new Error('网站图标内容超过 1 MB')); return }
        parts.push(part)
      })
      res.on('error', reject)
      res.on('end', () => resolve({ bytes: Buffer.concat(parts), type: res.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '', url: url.href }))
    })
    req.setTimeout(10_000, () => req.destroy(new Error('获取网站图标超时')))
    req.on('error', reject)
    req.end()
  })
}

export function pageIconCandidates(html: string, base: string): string[] {
  const candidates: { url: string; priority: number }[] = []
  for (const tag of html.split(/<\/head>|<body\b/i)[0]!.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/\b(rel|href|type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((match) => [match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '']))
    if (!attrs.href || !/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(attrs.rel ?? '')) continue
    try {
      const url = websiteIconURL(attrs.href.replace(/&amp;/g, '&'), base)
      candidates.push({ url: url.href, priority: attrs.type === 'image/svg+xml' || url.pathname.endsWith('.svg') ? 0 : attrs.rel?.includes('apple-touch') ? 1 : 2 })
    } catch { /* Ignore unsupported links; the next candidate may work. */ }
  }
  return [...new Set(candidates.sort((a, b) => a.priority - b.priority).map(({ url }) => url))]
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** 从文件头识别图标真实类型，避免信任声明的内容类型。 */
export function sniffImageMediaType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return 'image/x-icon'
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg\b/i.test(bytes.toString('utf8'))) return 'image/svg+xml'
  return undefined
}

function iconSource(page: IconPage): string {
  const b = page.bytes
  const type = sniffImageMediaType(b)
  if (!type || !b.length || b.length > 1024 * 1024) throw new Error('网站未提供有效图标')
  return `data:${type};base64,${b.toString('base64')}`
}

export async function discoverWebsiteIcon(raw: string, fetchPage: IconPageFetcher = fetchIconPage): Promise<string> {
  const input = websiteIconURL(raw)
  const sites = [input.origin]
  // Only strip the API prefix, never walk arbitrary public suffixes (e.g. co.uk).
  if (/^(api|api-cn|api-us)\./i.test(input.hostname)) sites.push(`https://${input.hostname.replace(/^[^.]+\./, '')}`)
  const signal = AbortSignal.timeout(30_000)
  for (const site of sites) {
    if (signal.aborted) break
    let panel = false
    let logo = ''
    try {
      const status = JSON.parse((await fetchPage(`${site}/api/status`, signal)).bytes.toString('utf8'))
      panel = status.success === true && typeof status.data?.system_name === 'string'
      if (panel && typeof status.data.logo === 'string' && status.data.logo) logo = websiteIconURL(status.data.logo, site).href
    } catch { /* Ordinary providers need not expose a panel API. */ }
    let candidates: string[] = []
    try { const page = await fetchPage(`${site}/`, signal); candidates = pageIconCandidates(page.bytes.toString('utf8'), page.url) } catch { /* Try the explicit logo or favicon next. */ }
    candidates = panel
      ? [...(logo ? [logo] : []), ...candidates.filter((url) => !['/logo.png', '/favicon.ico'].includes(new URL(url).pathname))]
      : [...candidates, `${site}/favicon.ico`]
    for (const candidate of candidates) {
      try { return iconSource(await fetchPage(candidate, signal)) } catch { /* Keep the previous icon if every candidate fails. */ }
    }
    if (panel) break
  }
  throw new Error('未找到网站专属图标，已保留原图标')
}
