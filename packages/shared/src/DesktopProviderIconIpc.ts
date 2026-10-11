export const DESKTOP_PROVIDER_ICON_IPC_CHANNELS = {
  resolve: 'desktop-provider-icon:resolve',
  changed: 'desktop-provider-icon:changed',
} as const

export type DesktopProviderIconResolveInput = {
  /** 供应商目录中的完整图标地址，缓存按该地址区分。 */
  url: string
}

export type DesktopProviderIconResolution = {
  /**
   * 本地缓存图标的可显示地址（`data:` URL）。首次下载失败或尚无缓存时为 `null`，
   * 客户端继续展示既有占位图标。
   */
  source: string | null
}

export type DesktopProviderIconChange = {
  url: string
  /** 后台刷新成功后的新地址，失败时不发送。 */
  source: string
}

export interface DesktopProviderIconIpcBridge {
  resolveProviderIcon(
    input: DesktopProviderIconResolveInput,
  ): Promise<DesktopProviderIconResolution>
  onProviderIconChange(listener: (change: DesktopProviderIconChange) => void): () => void
}
