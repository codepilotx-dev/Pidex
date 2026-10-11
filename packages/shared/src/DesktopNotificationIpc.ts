import { isRecord } from './Guards'
export const DESKTOP_NOTIFICATION_IPC_CHANNELS = {
  show: 'desktop-notification:show',
  activated: 'desktop-notification:activated',
} as const

export const DESKTOP_NOTIFICATION_KINDS = ['permission', 'question', 'completed', 'failed'] as const

export const DESKTOP_NOTIFICATION_VISIBILITIES = ['always', 'unfocused'] as const

export type DesktopNotificationKind = (typeof DESKTOP_NOTIFICATION_KINDS)[number]

export type DesktopNotificationVisibility = (typeof DESKTOP_NOTIFICATION_VISIBILITIES)[number]

export type DesktopNotificationRequest = {
  notificationId: string
  threadId: string
  kind: DesktopNotificationKind
  body: string
  visibility: DesktopNotificationVisibility
}

export type DesktopNotificationResult = {
  status: 'shown' | 'suppressed' | 'unsupported' | 'duplicate'
}

export type DesktopNotificationActivation = {
  notificationId: string
  threadId: string
}

export interface DesktopNotificationIpcBridge {
  showDesktopNotification(request: DesktopNotificationRequest): Promise<DesktopNotificationResult>
  onDesktopNotificationActivated(
    listener: (activation: DesktopNotificationActivation) => void,
  ): () => void
}

// The main process owns the title mapping so the renderer can never choose
// the text shown on a system toast.
export const DESKTOP_NOTIFICATION_TITLES: Record<DesktopNotificationKind, string> = {
  permission: '需要你的授权',
  question: '需要你的回答',
  completed: '任务已完成',
  failed: '任务执行失败',
}

export function desktopNotificationTitleFor(kind: DesktopNotificationKind): string {
  return DESKTOP_NOTIFICATION_TITLES[kind]
}

// IPC-level validation shared by main and preload. Opaque identifiers reuse
// the same letter/digit/dot/underscore/colon/hyphen alphabet as thread IDs;
// the body is a plain task title bounded to one toast-sized line.
export function normalizeDesktopNotificationRequest(
  value: unknown,
): DesktopNotificationRequest | null {
  if (!isRecord(value)) return null
  if (!isOpaqueIdentifier(value.notificationId)) return null
  if (!isOpaqueIdentifier(value.threadId)) return null
  if (!DESKTOP_NOTIFICATION_KINDS.includes(value.kind as DesktopNotificationKind)) {
    return null
  }
  if (
    !DESKTOP_NOTIFICATION_VISIBILITIES.includes(value.visibility as DesktopNotificationVisibility)
  ) {
    return null
  }
  if (typeof value.body !== 'string') return null
  const body = value.body.trim()
  if (body.length < 1 || body.length > 200) return null
  return {
    notificationId: value.notificationId,
    threadId: value.threadId,
    kind: value.kind as DesktopNotificationKind,
    body,
    visibility: value.visibility as DesktopNotificationVisibility,
  }
}

export function isDesktopNotificationActivation(
  value: unknown,
): value is DesktopNotificationActivation {
  return (
    isRecord(value) &&
    isOpaqueIdentifier(value.notificationId) &&
    isOpaqueIdentifier(value.threadId)
  )
}

function isOpaqueIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}
