import { expect, test } from 'bun:test'
import { discoverWebsiteIcon, fetchIconPage, isPublicIconAddress, pageIconCandidates, websiteIconURL, type IconPageFetcher } from '../src/ipc/ProviderWebsiteIcon.js'

test('网站地址与 DNS 地址拒绝私网、映射地址和凭据', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) expect(isPublicIconAddress(address)).toBe(false)
  expect(isPublicIconAddress('8.8.8.8')).toBe(true)
  expect(isPublicIconAddress('2606:4700:4700::1111')).toBe(true)
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://localhost', 'https://198.18.0.123', 'https://127.0.0.1', 'file:///icon.svg']) expect(() => websiteIconURL(url)).toThrow()
})

test('下载入口在连接前拒绝实际解析到的私网地址', async () => {
  await expect(fetchIconPage('https://127.0.0.1/favicon.ico', AbortSignal.timeout(1000))).rejects.toThrow('仅支持公网')
})

test('网站声明优先 SVG、Apple 图标，解析相对地址并忽略脚本协议', () => {
  expect(pageIconCandidates(`<link rel="icon" href="/favicon.ico"><link href='/touch.png' rel='apple-touch-icon'><link rel="icon" type="image/svg+xml" href="../logo.svg"><link rel="icon" href="javascript:alert(1)">`, 'https://example.com/home/')).toEqual(['https://example.com/logo.svg', 'https://example.com/touch.png', 'https://example.com/favicon.ico'])
})

test('API 主机失败后尝试官网，拒绝 HTML 冒充图片', async () => {
  const calls: string[] = []
  const fetcher: IconPageFetcher = async (url) => {
    calls.push(url)
    if (url === 'https://example.com/') return { bytes: Buffer.from('<link rel="icon" href="/brand.svg">'), type: 'text/html', url }
    if (url.endsWith('/brand.svg')) return { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), type: 'image/svg+xml', url }
    return { bytes: Buffer.from('<html>not an image</html>'), type: 'image/png', url }
  }
  expect(await discoverWebsiteIcon('https://api.example.com/v1', fetcher)).toStartWith('data:image/svg+xml;base64,')
  expect(calls).toContain('https://example.com/brand.svg')
})

test('New API 优先专属 logo，缺失时不采用通用面板图标', async () => {
  const calls: string[] = []
  const fetcher: IconPageFetcher = async (url) => {
    calls.push(url)
    const content = url.endsWith('/api/status') ? JSON.stringify({ success: true, data: { system_name: 'Relay' } }) : '<link rel="icon" href="/logo.png">'
    return { bytes: Buffer.from(content), type: 'text/html', url }
  }
  await expect(discoverWebsiteIcon('https://relay.example.com', fetcher)).rejects.toThrow('已保留原图标')
  expect(calls.some((url) => url.endsWith('/favicon.ico') || url.endsWith('/logo.png'))).toBe(false)
  const withLogo: IconPageFetcher = async (url, signal) => url.endsWith('/api/status')
    ? { bytes: Buffer.from(JSON.stringify({ success: true, data: { system_name: 'Relay', logo: '/own.svg' } })), type: 'application/json', url }
    : url.endsWith('/own.svg') ? { bytes: Buffer.from('<svg/>'), type: 'image/svg+xml', url } : fetcher(url, signal)
  expect(await discoverWebsiteIcon('https://relay.example.com', withLogo)).toStartWith('data:image/svg+xml;')
})
