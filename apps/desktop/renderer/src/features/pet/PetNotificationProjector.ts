import type {
  DesktopPetSettings,
  DesktopPermissionRequest,
  DesktopSessionSnapshot,
  DesktopSessionStatus,
} from '../../../shared/Types.js'
import {
  projectTaskNotifications,
  type TaskNotificationCandidate,
} from '../notifications/TaskNotificationProjector.js'

export type PetNotificationKind =
  'approval' | 'question' | 'exec' | 'network' | 'tool' | 'completed' | 'failed'

export type PetNotification = {
  id: string
  threadId: string
  requestId?: string
  request?: DesktopPermissionRequest
  kind: PetNotificationKind
  title: string
  detail?: string
  createdAt: number
  expiresAt: number | null
  priority: number
}

export type PetProjectionInput = {
  previous: readonly DesktopSessionSnapshot[]
  current: readonly DesktopSessionSnapshot[]
  now: number
  dismissedIds: ReadonlySet<string>
  preferences: DesktopPetSettings
}

export function resolvePetReplyDelivery(
  status: DesktopSessionStatus | undefined,
  hasPendingRequest: boolean,
): 'follow-up' | 'message' {
  return hasPendingRequest || status === 'running' || status === 'waiting' || status === 'queued'
    ? 'follow-up'
    : 'message'
}

// 薄包装：分类逻辑统一由通用任务提醒投影负责，这里只保留桌宠自身的
// 过期、优先级、dismiss 与偏好过滤行为。
export function projectPetNotifications({
  previous,
  current,
  now,
  dismissedIds,
  preferences,
}: PetProjectionInput): PetNotification[] {
  const notifications: PetNotification[] = []

  for (const candidate of projectTaskNotifications({ previous, current })) {
    if (!preferences.notifyAttention && isBlockerKind(candidate)) continue
    if (candidate.kind === 'completed' && !preferences.notifyCompletion) continue
    if (candidate.kind === 'failed' && !preferences.notifyFailure) continue
    const notification = petNotification(candidate, now)
    if (notification && !dismissedIds.has(notification.id)) {
      notifications.push(notification)
    }
  }

  return notifications
    .filter((item) => item.expiresAt === null || item.expiresAt > now)
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    )
}

function petNotification(
  candidate: TaskNotificationCandidate,
  now: number,
): PetNotification | null {
  const threadId = candidate.threadId
  const taskTitle = candidate.taskTitle
  if (candidate.kind === 'permission' || candidate.kind === 'question') {
    const request = candidate.request
    const kind = request
      ? blockerKind(request)
      : candidate.kind === 'question'
        ? 'question'
        : 'approval'
    const label = {
      approval: '等待你的批准',
      question: '有一个问题',
      exec: '命令等待批准',
      network: '联网请求等待批准',
      tool: '工具调用等待批准',
    }[kind]
    return {
      id: candidate.id,
      threadId,
      requestId: candidate.requestId,
      request,
      kind,
      title: label,
      detail: request?.description || taskTitle,
      createdAt: now,
      expiresAt: null,
      priority: kind === 'question' ? 100 : 90,
    }
  }
  if (candidate.kind === 'completed') {
    return {
      id: candidate.id,
      threadId,
      kind: 'completed',
      title: '任务已完成',
      detail: taskTitle,
      createdAt: now,
      expiresAt: now + 15_000,
      priority: 40,
    }
  }
  if (candidate.kind === 'failed') {
    return {
      id: candidate.id,
      threadId,
      kind: 'failed',
      title: '任务需要检查',
      detail: taskTitle,
      createdAt: now,
      expiresAt: now + 30_000,
      priority: 80,
    }
  }
  return null
}

function isBlockerKind(candidate: TaskNotificationCandidate): boolean {
  return candidate.kind === 'permission' || candidate.kind === 'question'
}

function blockerKind(
  request: DesktopPermissionRequest,
): Exclude<PetNotificationKind, 'completed' | 'failed'> {
  if (request.toolName === 'AskUserQuestion') return 'question'
  if (request.requestKind === 'network') return 'network'
  if (request.requestKind === 'shell-command') return 'exec'
  if (request.requestKind === 'tool') return 'tool'
  return 'approval'
}
