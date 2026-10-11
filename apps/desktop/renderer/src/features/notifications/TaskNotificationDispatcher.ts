import type { DesktopNotificationVisibility } from '@pidex/shared/desktop-notification-ipc'
import type {
  DesktopSessionSnapshot,
  DesktopSystemNotificationSettings,
} from '../../../shared/Types.js'
import {
  projectTaskNotifications,
  type TaskNotificationCandidate,
  type TaskNotificationKind,
} from './TaskNotificationProjector.js'

export type TaskNotificationSendRequest = {
  notificationId: string
  threadId: string
  kind: TaskNotificationKind
  body: string
  visibility: DesktopNotificationVisibility
}

export type TaskNotificationSender = (request: TaskNotificationSendRequest) => void

// 应对 SSE 在 ACK 前断线后的重放：Renderer 保留最近 500 个已发送 ID，
// Electron 服务再做同容量的进程级防重复。
const MAX_SENT_IDS = 500

export class TaskNotificationDispatcher {
  readonly #send: TaskNotificationSender
  #settings: DesktopSystemNotificationSettings | undefined
  #previous: readonly DesktopSessionSnapshot[] = []
  #observedRequestIds = new Set<string>()
  #sentIds = new Set<string>()
  #sentOrder: string[] = []
  #baselineReady = false
  #automationThreadsByRun = new Map<string, string>()
  #automationThreadCounts = new Map<string, number>()

  constructor(send: TaskNotificationSender) {
    this.#send = send
  }

  setSettings(settings: DesktopSystemNotificationSettings | undefined): void {
    this.#settings = settings
  }

  markBaselineReady(): void {
    this.#baselineReady = true
  }

  isBaselineReady(): boolean {
    return this.#baselineReady
  }

  trackAutomationRun(runId: string, threadId: string): void {
    const previous = this.#automationThreadsByRun.get(runId)
    if (previous === threadId) return
    if (previous) this.releaseAutomationRun(runId)
    this.#automationThreadsByRun.set(runId, threadId)
    this.#automationThreadCounts.set(
      threadId,
      (this.#automationThreadCounts.get(threadId) ?? 0) + 1,
    )
  }

  releaseAutomationRun(runId: string): void {
    const threadId = this.#automationThreadsByRun.get(runId)
    if (!threadId) return
    this.#automationThreadsByRun.delete(runId)
    const count = (this.#automationThreadCounts.get(threadId) ?? 1) - 1
    if (count > 0) this.#automationThreadCounts.set(threadId, count)
    else this.#automationThreadCounts.delete(threadId)
  }

  // 基线批次只登记状态不发送；之后的批次才产生通知。
  ingest(snapshots: readonly DesktopSessionSnapshot[], isBaseline: boolean): void {
    const candidates = projectTaskNotifications({
      previous: this.#previous,
      current: snapshots,
    })
    if (!isBaseline) {
      for (const candidate of candidates) {
        if (
          (candidate.kind === 'permission' || candidate.kind === 'question') &&
          candidate.requestId &&
          this.#observedRequestIds.has(candidate.requestId)
        ) {
          continue
        }
        if (this.#sentIds.has(candidate.id)) continue
        if (this.#emit(candidate)) this.#markSent(candidate.id)
      }
    }
    // 无论设置是否关闭，都把本批已见到的 pending request ID 记为已观察，
    // 避免开启设置或重放时对旧请求补发通知。
    for (const snapshot of snapshots) {
      for (const request of snapshot.view.pendingPermissions) {
        this.#observedRequestIds.add(request.requestId)
      }
    }
    this.#previous = snapshots
  }

  #emit(candidate: TaskNotificationCandidate): boolean {
    if (
      (candidate.kind === 'completed' || candidate.kind === 'failed') &&
      this.#automationThreadCounts.has(candidate.threadId)
    )
      return false
    const settings = this.#settings
    if (!settings) return false
    let visibility: DesktopNotificationVisibility | null = null
    if (candidate.kind === 'permission') {
      if (!settings.permissions) return false
      visibility = 'unfocused'
    } else if (candidate.kind === 'question') {
      if (!settings.questions) return false
      visibility = 'unfocused'
    } else if (candidate.kind === 'failed') {
      if (!settings.errors) return false
      visibility = 'unfocused'
    } else {
      if (settings.completion === 'never') return false
      visibility = settings.completion === 'always' ? 'always' : 'unfocused'
    }
    this.#send({
      notificationId: candidate.id,
      threadId: candidate.threadId,
      kind: candidate.kind,
      // 失败通知正文固定为“任务标题 · 需要检查”，不直接显示错误文本；
      // 截断标题保证总长不超过 IPC 的 200 字符上限。
      body:
        candidate.kind === 'failed'
          ? failedNotificationBody(candidate.taskTitle)
          : candidate.taskTitle,
      visibility,
    })
    return true
  }

  #markSent(id: string): void {
    if (this.#sentIds.has(id)) return
    this.#sentIds.add(id)
    this.#sentOrder.push(id)
    while (this.#sentOrder.length > MAX_SENT_IDS) {
      const oldest = this.#sentOrder.shift()
      if (oldest) this.#sentIds.delete(oldest)
    }
  }
}

const FAILED_BODY_SUFFIX = ' · 需要检查'

function failedNotificationBody(taskTitle: string): string {
  const suffix = FAILED_BODY_SUFFIX
  if (taskTitle.length + suffix.length <= 200) {
    return `${taskTitle}${suffix}`
  }
  return `${taskTitle.slice(0, 200 - suffix.length)}${suffix}`
}
