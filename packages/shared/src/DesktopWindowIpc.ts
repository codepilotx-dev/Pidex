import { normalizeDesktopThreadDeepLinkPayload } from './DesktopDeepLinkIpc.js'

export const DESKTOP_WINDOW_IPC_CHANNELS = {
  openWindow: 'window:open',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  getPageZoom: 'window:page-zoom:get',
  changePageZoom: 'window:page-zoom:change',
  pageZoomChanged: 'window:page-zoom:changed',
  resizeStateChanged: 'window:resize-state-changed',
  resizeActivity: 'window:resize-activity',
} as const

export type DesktopResizeActivityPhase = 'start' | 'end'

/**
 * 原生窗口缩放活动。`revision` 在同一窗口内单调递增，渲染端据此丢弃陈旧或
 * 重复事件；`windowId` 让多窗口场景可以按窗口维度维护状态，而不是共用一个
 * 易失布尔值。
 */
export type DesktopResizeActivity = {
  windowId: number
  phase: DesktopResizeActivityPhase
  revision: number
}

export type DesktopOpenWindowInput = { kind: 'home' } | { kind: 'thread'; threadId: string }

export type DesktopPageZoomAction = 'in' | 'out' | 'reset'

export type DesktopPageZoomState = {
  percent: number
  canZoomIn: boolean
  canZoomOut: boolean
}

export interface DesktopWindowIpcBridge {
  openWindow(input: DesktopOpenWindowInput): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  getPageZoom(): Promise<DesktopPageZoomState>
  changePageZoom(action: DesktopPageZoomAction): Promise<DesktopPageZoomState>
  onPageZoomChanged(listener: (state: DesktopPageZoomState) => void): () => void
  onWindowResizeStateChanged(listener: (resizing: boolean) => void): () => void
  /** 旧版 Electron 没有该通道，调用方按可选能力使用。 */
  onWindowResizeActivity?(listener: (activity: DesktopResizeActivity) => void): () => void
}

export function isDesktopResizeActivity(value: unknown): value is DesktopResizeActivity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const activity = value as Record<string, unknown>
  if (Object.keys(activity).length !== 3) return false
  return (
    Number.isSafeInteger(activity.windowId) &&
    (activity.phase === 'start' || activity.phase === 'end') &&
    Number.isSafeInteger(activity.revision)
  )
}

export function isDesktopPageZoomAction(value: unknown): value is DesktopPageZoomAction {
  return value === 'in' || value === 'out' || value === 'reset'
}

export function normalizeDesktopOpenWindowInput(value: unknown): DesktopOpenWindowInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const input = value as Record<string, unknown>
  if (input.kind === 'home') {
    return Object.keys(input).length === 1 ? { kind: 'home' } : null
  }
  if (input.kind !== 'thread') return null
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'threadId')) return null

  const normalized = normalizeDesktopThreadDeepLinkPayload(input)
  return normalized ? { kind: 'thread', threadId: normalized.threadId } : null
}
