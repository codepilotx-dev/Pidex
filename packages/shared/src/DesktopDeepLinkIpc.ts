import { isRecord } from './Guards'
export const DESKTOP_DEEP_LINK_IPC_CHANNELS = {
  consumePending: 'desktop-deep-link:consume-pending',
  activated: 'desktop-deep-link:activated',
} as const

export const DESKTOP_THREAD_DEEP_LINK_ID_MAX_LENGTH = 512

export type DesktopThreadDeepLinkPayload = {
  threadId: string
}

export interface DesktopDeepLinkIpcBridge {
  consumePendingThreadDeepLink(): Promise<DesktopThreadDeepLinkPayload | null>
  onThreadDeepLinkActivated(listener: (payload: DesktopThreadDeepLinkPayload) => void): () => void
}

// IPC-level validation shared by main and preload. Only a plain object whose
// sole required field is a non-blank, reasonably bounded threadId is accepted;
// anything else must never reach the renderer.
export function normalizeDesktopThreadDeepLinkPayload(
  value: unknown,
): DesktopThreadDeepLinkPayload | null {
  if (!isRecord(value)) return null
  if (typeof value.threadId !== 'string') return null
  const threadId = value.threadId
  if (threadId.trim().length < 1) return null
  if (threadId.length > DESKTOP_THREAD_DEEP_LINK_ID_MAX_LENGTH) return null
  return { threadId }
}

export function isDesktopThreadDeepLinkPayload(
  value: unknown,
): value is DesktopThreadDeepLinkPayload {
  return normalizeDesktopThreadDeepLinkPayload(value) !== null
}
