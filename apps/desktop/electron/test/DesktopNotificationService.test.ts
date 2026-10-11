import { describe, expect, test } from 'bun:test'
import {
  DESKTOP_NOTIFICATION_IPC_CHANNELS,
  DESKTOP_NOTIFICATION_TITLES,
  desktopNotificationTitleFor,
  normalizeDesktopNotificationRequest,
  type DesktopNotificationRequest,
} from '@pidex/shared/desktop-notification-ipc'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import {
  createShowNotificationHandler,
  DesktopNotificationService,
  type DesktopNotificationFactory,
  type DesktopNotificationHandle,
} from '../src/notifications/DesktopNotificationService'

const request = (
  overrides: Partial<DesktopNotificationRequest> = {},
): DesktopNotificationRequest => ({
  notificationId: 'thread-1:completed:2026-08-03T00:00:00.000Z',
  threadId: 'thread-1',
  kind: 'completed',
  body: '任务标题',
  visibility: 'unfocused',
  ...overrides,
})

class FakeNotification implements DesktopNotificationHandle {
  shown = false
  #click: (() => void) | null = null
  #close: (() => void) | null = null
  #failed: ((error: unknown) => void) | null = null

  show(): void {
    this.shown = true
  }

  onClick(listener: () => void): void {
    this.#click = listener
  }

  onClose(listener: () => void): void {
    this.#close = listener
  }

  onFailed(listener: (error: unknown) => void): void {
    this.#failed = listener
  }

  click(): void {
    this.#click?.()
  }

  close(): void {
    this.#close?.()
  }

  fail(): void {
    this.#failed?.(new Error('os-error'))
  }
}

function fakeLogger(
  records: Array<{ event: string; fields: Record<string, unknown> }>,
): DesktopLogger {
  return {
    directory: 'C:\\logs',
    consoleEnabled: false,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields = {}) => records.push({ event, fields }),
    error: (event, fields = {}) => records.push({ event, fields }),
    forwardConsoleLine: () => undefined,
  }
}

function createService(
  options: {
    supported?: boolean
    focused?: boolean
    focusedCalls?: boolean[]
    records?: Array<{ event: string; fields: Record<string, unknown> }>
    notifications?: FakeNotification[]
    activations?: Array<{ notificationId: string; threadId: string }>
  } = {},
) {
  const records = options.records ?? []
  const notifications = options.notifications ?? []
  const activations = options.activations ?? []
  const focusedCalls = options.focusedCalls ?? []
  const factory: DesktopNotificationFactory = {
    isSupported: () => options.supported ?? true,
    create: (opts) => {
      const notification = new FakeNotification()
      notifications.push(notification)
      return notification
    },
  }
  const service = new DesktopNotificationService({
    logger: fakeLogger(records),
    factory,
    resolveIconPath: () => 'C:\\app\\build\\icon.ico',
    isMainWindowFocused: () => options.focused ?? false,
    focusMainWindow: () => focusedCalls.push(true),
    publishActivation: (activation) => activations.push(activation),
  })
  return { service, notifications, activations, records, focusedCalls }
}

describe('desktop notification service', () => {
  test('Windows 不支持 Notification 时安全返回 unsupported', () => {
    const { service } = createService({ supported: false })
    expect(service.show(request())).toEqual({ status: 'unsupported' })
  })

  test('同一 notificationId 只显示一次，进程级去重返回 duplicate', () => {
    const { service } = createService()
    expect(service.show(request())).toEqual({ status: 'shown' })
    expect(service.show(request())).toEqual({ status: 'duplicate' })
  })

  test('聚焦窗口下 unfocused 被抑制，always 仍显示', () => {
    const { service } = createService({ focused: true })
    expect(service.show(request({ visibility: 'unfocused' }))).toEqual({ status: 'suppressed' })
    expect(service.show(request({ visibility: 'always' }))).toEqual({ status: 'shown' })
  })

  test('四类 kind 使用主进程固定标题，并携带图标路径', () => {
    const created: Array<{ title: string; body: string; icon: string }> = []
    const service = new DesktopNotificationService({
      logger: fakeLogger([]),
      factory: {
        isSupported: () => true,
        create: (options) => {
          created.push(options)
          return new FakeNotification()
        },
      },
      resolveIconPath: () => 'C:\\app\\build\\icon.ico',
      isMainWindowFocused: () => false,
      focusMainWindow: () => undefined,
      publishActivation: () => undefined,
    })
    const kinds = ['permission', 'question', 'completed', 'failed'] as const
    for (const kind of kinds) {
      service.show(
        request({
          kind,
          notificationId: `thread-1:${kind}:2026-08-03T00:00:00.000Z`,
        }),
      )
    }
    expect(DESKTOP_NOTIFICATION_TITLES).toEqual({
      permission: '需要你的授权',
      question: '需要你的回答',
      completed: '任务已完成',
      failed: '任务执行失败',
    })
    expect(created.map((item) => item.title)).toEqual([
      '需要你的授权',
      '需要你的回答',
      '任务已完成',
      '任务执行失败',
    ])
    expect(created.map((item) => item.icon)).toEqual(Array(4).fill('C:\\app\\build\\icon.ico'))
    for (const kind of kinds) {
      expect(desktopNotificationTitleFor(kind)).toBe(DESKTOP_NOTIFICATION_TITLES[kind])
    }
  })

  test('点击通知恢复主窗口并发布 thread activation', () => {
    const activations: Array<{ notificationId: string; threadId: string }> = []
    const focusedCalls: boolean[] = []
    const notifications: FakeNotification[] = []
    const service = new DesktopNotificationService({
      logger: fakeLogger([]),
      factory: {
        isSupported: () => true,
        create: (opts) => {
          const notification = new FakeNotification()
          notifications.push(notification)
          return notification
        },
      },
      resolveIconPath: () => 'C:\\app\\build\\icon.ico',
      isMainWindowFocused: () => false,
      focusMainWindow: () => focusedCalls.push(true),
      publishActivation: (activation) => activations.push(activation),
    })
    const shown = request({ notificationId: 'thread-1:question:r-1', kind: 'question' })
    service.show(shown)
    notifications[0]?.click()
    expect(focusedCalls).toEqual([true])
    expect(activations).toEqual([{ notificationId: 'thread-1:question:r-1', threadId: 'thread-1' }])
  })

  test('close 与 failed 释放活动引用，失败日志不记录敏感信息', () => {
    const records: Array<{ event: string; fields: Record<string, unknown> }> = []
    const notifications: FakeNotification[] = []
    const service = new DesktopNotificationService({
      logger: fakeLogger(records),
      factory: {
        isSupported: () => true,
        create: (opts) => {
          const notification = new FakeNotification()
          notifications.push(notification)
          return notification
        },
      },
      resolveIconPath: () => 'C:\\app\\build\\icon.ico',
      isMainWindowFocused: () => false,
      focusMainWindow: () => undefined,
      publishActivation: () => undefined,
    })
    service.show(
      request({ notificationId: 'thread-1:failed:1', kind: 'failed', body: '敏感任务标题' }),
    )
    notifications[0]?.fail()
    service.show(request({ notificationId: 'thread-1:failed:2', kind: 'failed' }))
    notifications[1]?.close()
    expect(records).toEqual([{ event: 'desktop.notification-failed', fields: { kind: 'failed' } }])
    expect(JSON.stringify(records)).not.toContain('敏感任务标题')
    expect(JSON.stringify(records)).not.toContain('thread-1')
    expect(JSON.stringify(records)).not.toContain('os-error')
    expect(JSON.stringify(records)).not.toContain('C:\\')
  })

  test('进程级去重容量保持最近 500 个 ID', () => {
    const { service } = createService()
    const ids = Array.from({ length: 505 }, (_, index) => `thread-1:completed:t${index}`)
    for (const id of ids) service.show(request({ notificationId: id }))
    expect(service.show(request({ notificationId: ids[0] }))).toEqual({ status: 'shown' })
    expect(service.show(request({ notificationId: ids[504] }))).toEqual({ status: 'duplicate' })
  })
})

describe('show notification IPC handler', () => {
  test('非主窗口 sender 被拒绝', () => {
    const { service } = createService()
    const handler = createShowNotificationHandler({
      isMainSender: () => false,
      service,
    })
    expect(() => handler({}, request())).toThrow('IPC 调用来源无效')
  })

  test('非法 payload 被拒绝', () => {
    const { service } = createService()
    const handler = createShowNotificationHandler({
      isMainSender: () => true,
      service,
    })
    expect(() => handler({}, null)).toThrow('通知请求无效')
    expect(() => handler({}, { ...request(), body: '' })).toThrow('通知请求无效')
    expect(() => handler({}, { ...request(), threadId: '../escape' })).toThrow('通知请求无效')
    expect(() => handler({}, { ...request(), kind: 'custom' })).toThrow('通知请求无效')
  })

  test('合法请求归一化并调用服务', () => {
    const { service } = createService()
    const handler = createShowNotificationHandler({
      isMainSender: () => true,
      service,
    })
    expect(handler({}, request())).toEqual({ status: 'shown' })
  })
})

describe('desktop notification shared contract', () => {
  test('归一化校验长度、字符集与固定枚举', () => {
    expect(normalizeDesktopNotificationRequest(request())).toEqual(request())
    expect(normalizeDesktopNotificationRequest({ ...request(), body: '  ' })).toBeNull()
    expect(normalizeDesktopNotificationRequest({ ...request(), body: 'x'.repeat(201) })).toBeNull()
    expect(normalizeDesktopNotificationRequest({ ...request(), threadId: 'bad path' })).toBeNull()
    expect(
      normalizeDesktopNotificationRequest({ ...request(), visibility: 'sometimes' }),
    ).toBeNull()
    expect(normalizeDesktopNotificationRequest(42)).toBeNull()
    expect(
      normalizeDesktopNotificationRequest({
        ...request(),
        body: '  标题  ',
      }),
    ).toEqual({ ...request(), body: '标题' })
  })

  test('IPC channel 保持集中定义', () => {
    expect(DESKTOP_NOTIFICATION_IPC_CHANNELS).toEqual({
      show: 'desktop-notification:show',
      activated: 'desktop-notification:activated',
    })
  })
})
