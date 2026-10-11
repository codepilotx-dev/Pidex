import type { DesktopPermissionRequest, DesktopSessionSnapshot } from '../../../shared/Types.js'

export type TaskNotificationKind = 'permission' | 'question' | 'completed' | 'failed'

export type TaskNotificationCandidate = {
  id: string
  threadId: string
  kind: TaskNotificationKind
  taskTitle: string
  requestId?: string
  /** Present on permission/question candidates; consumers that need the full
   *  request (e.g. the pet reply flow) use it, system notifications ignore it. */
  request?: DesktopPermissionRequest
  source: 'user' | 'subagent'
}

export type TaskNotificationProjectionInput = {
  previous: readonly DesktopSessionSnapshot[]
  current: readonly DesktopSessionSnapshot[]
}

export function projectTaskNotifications({
  previous,
  current,
}: TaskNotificationProjectionInput): TaskNotificationCandidate[] {
  const previousById = new Map(previous.map((snapshot) => [snapshot.item.id, snapshot]))
  const candidates: TaskNotificationCandidate[] = []

  for (const snapshot of current) {
    if (snapshot.item.archivedAt || snapshot.item.source === 'internal_guardian') {
      continue
    }
    const threadId = snapshot.item.id
    const source = snapshot.item.source === 'subagent' ? 'subagent' : 'user'
    const taskTitle =
      snapshot.item.customTitle ||
      snapshot.item.aiTitle ||
      snapshot.item.sessionName ||
      snapshot.item.firstPrompt ||
      '未命名任务'

    for (const request of snapshot.view.pendingPermissions) {
      const kind = request.toolName === 'AskUserQuestion' ? 'question' : 'permission'
      candidates.push({
        id: `${threadId}:${request.requestId}`,
        threadId,
        kind,
        taskTitle,
        requestId: request.requestId,
        request,
        source,
      })
    }

    // 完成/失败必须存在真实状态跃迁：线程必须已在上一次投影中出现，
    // 且 previous 不是 done/error。子代理只产生阻塞类提醒。
    const previousStatus = previousById.get(threadId)?.item.status
    const status = snapshot.item.status
    if (
      source === 'user' &&
      previousStatus !== undefined &&
      previousStatus !== 'done' &&
      status === 'done'
    ) {
      candidates.push({
        id: `${threadId}:completed:${snapshot.updatedAt}`,
        threadId,
        kind: 'completed',
        taskTitle,
        source,
      })
    }
    if (
      source === 'user' &&
      previousStatus !== undefined &&
      previousStatus !== 'error' &&
      status === 'error'
    ) {
      candidates.push({
        id: `${threadId}:failed:${snapshot.updatedAt}`,
        threadId,
        kind: 'failed',
        taskTitle,
        source,
      })
    }
  }

  return candidates
}
