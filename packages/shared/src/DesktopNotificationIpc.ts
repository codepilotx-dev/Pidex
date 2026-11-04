import { isRecord } from './Guards'
export const DESKTOP_NOTIFICATION_IPC_CHANNELS = {
  show: 'desktop-notification:show',
  activated: 'desktop-notification:activated',
} as const

export const DESKTOP_NOTIFICATION_KINDS = [
  'permission',
  'question',
  'completed',
  'failed',
  'task-due',
  'task-acceptance',
] as const

export const DESKTOP_NOTIFICATION_VISIBILITIES = ['always', 'unfocused'] as const

export type DesktopNotificationKind = (typeof DESKTOP_NOTIFICATION_KINDS)[number]

export type DesktopNotificationVisibility = (typeof DESKTOP_NOTIFICATION_VISIBILITIES)[number]

export type DesktopNotificationRequest = {
  notificationId: string
  threadId?: string
  taskId?: string
  occurrenceId?: string
  kind: DesktopNotificationKind
  body: string
  visibility: DesktopNotificationVisibility
}

export type DesktopNotificationResult = {
  status: 'shown' | 'suppressed' | 'unsupported' | 'duplicate'
}

export type DesktopNotificationActivation = {
  notificationId: string
  threadId?: string
  taskId?: string
  occurrenceId?: string
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
  'task-due': '任务到时间了，需要处理',
  'task-acceptance': '任务等待你的验收',
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
  if (value.threadId !== undefined && !isOpaqueIdentifier(value.threadId)) return null
  if (value.taskId !== undefined && !isOpaqueIdentifier(value.taskId)) return null
  if (value.occurrenceId !== undefined && !isOpaqueIdentifier(value.occurrenceId)) return null
  if (!value.threadId && !value.taskId) return null
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
    ...(typeof value.threadId === 'string' ? { threadId: value.threadId } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.occurrenceId === 'string' ? { occurrenceId: value.occurrenceId } : {}),
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
    (value.threadId === undefined || isOpaqueIdentifier(value.threadId)) &&
    (value.taskId === undefined || isOpaqueIdentifier(value.taskId)) &&
    (value.occurrenceId === undefined || isOpaqueIdentifier(value.occurrenceId)) &&
    (isOpaqueIdentifier(value.threadId) || isOpaqueIdentifier(value.taskId))
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
