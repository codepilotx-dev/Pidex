import {
  desktopNotificationTitleFor,
  normalizeDesktopNotificationRequest,
  type DesktopNotificationRequest,
  type DesktopNotificationResult,
} from '@pidex/shared/desktop-notification-ipc'
import type { DesktopLogger } from '../logging/DesktopLogger.js'

export type DesktopNotificationHandle = {
  show(): void
  onClick(listener: () => void): void
  onClose(listener: () => void): void
  onFailed(listener: (error: unknown) => void): void
}

export type DesktopNotificationFactory = {
  isSupported(): boolean
  create(options: { title: string; body: string; icon: string }): DesktopNotificationHandle
}

export type DesktopNotificationServiceOptions = {
  logger: DesktopLogger
  factory: DesktopNotificationFactory
  resolveIconPath(): string
  isMainWindowFocused(): boolean
  focusMainWindow(): void
  publishActivation(activation: { notificationId: string; threadId: string }): void
}

export type DesktopNotificationActivation = {
  notificationId: string
  threadId: string
}

// 进程级防重复容量，与 Renderer 最近 500 个 ID 的去重窗口一致。
const MAX_SEEN_IDS = 500

export class DesktopNotificationService {
  readonly #options: DesktopNotificationServiceOptions
  readonly #seen = new Set<string>()
  readonly #seenOrder: string[] = []
  readonly #active = new Set<DesktopNotificationHandle>()

  constructor(options: DesktopNotificationServiceOptions) {
    this.#options = options
  }

  show(request: DesktopNotificationRequest): DesktopNotificationResult {
    if (!this.#options.factory.isSupported()) {
      return { status: 'unsupported' }
    }
    if (this.#seen.has(request.notificationId)) {
      return { status: 'duplicate' }
    }
    if (request.visibility === 'unfocused' && this.#options.isMainWindowFocused()) {
      return { status: 'suppressed' }
    }

    const notification = this.#options.factory.create({
      title: desktopNotificationTitleFor(request.kind),
      body: request.body,
      icon: this.#options.resolveIconPath(),
    })
    this.#active.add(notification)
    notification.onClick(() => {
      this.#release(notification)
      this.#options.focusMainWindow()
      this.#options.publishActivation({
        notificationId: request.notificationId,
        threadId: request.threadId,
      })
    })
    notification.onClose(() => this.#release(notification))
    notification.onFailed(() => {
      this.#release(notification)
      // 安全日志只记录类别，不记录正文、任务标题、thread ID 或原始 OS error。
      this.#options.logger.warn('desktop.notification-failed', {
        kind: request.kind,
      })
    })
    notification.show()
    this.#markSeen(request.notificationId)
    return { status: 'shown' }
  }

  #release(notification: DesktopNotificationHandle): void {
    this.#active.delete(notification)
  }

  #markSeen(id: string): void {
    this.#seen.add(id)
    this.#seenOrder.push(id)
    while (this.#seenOrder.length > MAX_SEEN_IDS) {
      const oldest = this.#seenOrder.shift()
      if (oldest) this.#seen.delete(oldest)
    }
  }
}

// 与 Electron ipcMain 解耦的 show 处理器：sender 校验与 payload 归一化
// 可以在单元测试中直接验证，注册层只负责把 IPC 事件接进来。
export function createShowNotificationHandler(deps: {
  isMainSender(sender: unknown): boolean
  service: DesktopNotificationService
}): (sender: unknown, payload: unknown) => DesktopNotificationResult {
  return (sender, payload) => {
    if (!deps.isMainSender(sender)) {
      throw new Error('IPC 调用来源无效')
    }
    const request = normalizeDesktopNotificationRequest(payload)
    if (!request) {
      throw new Error('通知请求无效')
    }
    return deps.service.show(request)
  }
}
