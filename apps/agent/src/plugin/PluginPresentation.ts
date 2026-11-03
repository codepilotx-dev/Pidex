import type { PluginAssetKind } from '@pidex/agent-protocol'

export const MAX_PLUGIN_ASSET_BYTES = 2 * 1024 * 1024
export type PluginAssets = Partial<Record<PluginAssetKind, string>>

export function pluginAssetPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('无效资源路径')
  const path = value.replace(/^\.\//, '')
  if (
    !path ||
    path.split('/').some((part) => !part || /[. ]$/.test(part)) ||
    /[\\:<>"|?*]|\p{Cc}/u.test(path)
  )
    throw new Error('无效资源路径')
  if (!/\.(png|jpe?g|webp)$/i.test(path)) throw new Error('不支持的图片格式')
  return path
}

export function pluginPresentation(metadata: Record<string, unknown>) {
  const assets: PluginAssets = {}
  for (const kind of ['logo', 'logoDark'] as const) {
    if (metadata[kind] !== undefined) assets[kind] = pluginAssetPath(metadata[kind])
  }
  const links: {
    [K in 'websiteURL' | 'privacyPolicyURL' | 'termsOfServiceURL']?: string
  } = {}
  for (const key of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL'] as const) {
    if (metadata[key] === undefined) continue
    if (typeof metadata[key] !== 'string') throw new Error('无效链接')
    const url = new URL(metadata[key])
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('无效链接')
    links[key] = url.href
  }
  return { assets, links }
}

export function pluginAssetResult(bytes: Uint8Array) {
  if (bytes.length > MAX_PLUGIN_ASSET_BYTES) throw new Error('图片过大')
  const buffer = Buffer.from(bytes)
  const mimeType = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? ('image/png' as const)
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
      ? ('image/jpeg' as const)
      : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
        ? ('image/webp' as const)
        : null
  if (!mimeType) throw new Error('无效图片')
  return { mimeType, base64: buffer.toString('base64') }
}
