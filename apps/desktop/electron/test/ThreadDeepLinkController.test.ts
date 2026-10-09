import { describe, expect, test } from 'bun:test'
import { buildThreadDeepLink, parseThreadDeepLink } from '@pidex/shared/thread-reference'
import type { DesktopLogger } from '../src/logging/DesktopLogger'
import {
  createThreadDeepLinkController,
  type ThreadDeepLinkController,
  type ThreadDeepLinkControllerDependencies,
  type ThreadDeepLinkPayload,
} from '../src/deep-link/ThreadDeepLinkController'

// 合法深链一律通过共享 buildThreadDeepLink 构造，并以共享 parseThreadDeepLink
// 回读确认，测试不手拼合法深链；非法链接按定义手工构造。
function legalLink(threadId: string): string {
  const link = buildThreadDeepLink(threadId)
  expect(parseThreadDeepLink(link)).toBe(threadId)
  return link
}

const LEGAL_IDS = ['plain-id-123', '会话 with spaces/123', 'a?b#c&d=100% loaded']

const ILLEGAL_LINKS = [
  'http://threads/abc',
  'https://threads/abc',
  'pidex://chat/abc',
  'pidex://threads:8080/abc',
  'pidex://threads/abc?tab=open',
  'pidex://threads/abc#section',
  'pidex://user@threads/abc',
  'pidex://user:pass@threads/abc',
  'pidex://threads/',
  'pidex://threads',
  'pidex://threads//',
  'pidex://threads/abc/def',
  'pidex://threads/abc/',
  'pidex://threads/%',
  '',
  '   ',
]

function fakeLogger(
  logs: Array<{ event: string; fields: Record<string, unknown> }>,
): DesktopLogger {
  const record = (event: string, fields: Record<string, unknown> = {}): void => {
    logs.push({ event, fields })
  }
  return {
    directory: 'C:\\logs',
    consoleEnabled: false,
    debug: (event, fields) => record(event, fields),
    info: (event, fields) => record(event, fields),
    warn: (event, fields) => record(event, fields),
    error: (event, fields) => record(event, fields),
    forwardConsoleLine: () => undefined,
  }
}

type HarnessOptions = {
  argv?: readonly string[]
  ready?: boolean
  onFocus?: () => void
  onNotify?: (payload: ThreadDeepLinkPayload) => void
}

type Harness = {
  controller: ThreadDeepLinkController
  notifyCalls: ThreadDeepLinkPayload[]
  focusCalls: number
  order: string[]
  logs: Array<{ event: string; fields: Record<string, unknown> }>
  readyListeners: Array<() => void>
  unsubscribeCalls: number
  ready(): void
  dispose(): void
}

function createHarness(options: HarnessOptions = {}): Harness {
  const records: {
    notifyCalls: ThreadDeepLinkPayload[]
    focusCalls: number
    order: string[]
    logs: Array<{ event: string; fields: Record<string, unknown> }>
    readyListeners: Array<() => void>
    unsubscribeCalls: number
  } = {
    notifyCalls: [],
    focusCalls: 0,
    order: [],
    logs: [],
    readyListeners: [],
    unsubscribeCalls: 0,
  }
  const readyState = { value: options.ready ?? false }

  const dependencies: ThreadDeepLinkControllerDependencies = {
    logger: fakeLogger(records.logs),
    getInitialArgv: () => options.argv ?? [],
    subscribeRendererReady: (listener) => {
      records.readyListeners.push(listener)
      return () => {
        records.unsubscribeCalls += 1
      }
    },
    isRendererReady: () => readyState.value,
    focusMainWindow: () => {
      records.focusCalls += 1
      records.order.push('focus')
      options.onFocus?.()
    },
    notify: (payload) => {
      records.notifyCalls.push(payload)
      records.order.push('notify')
      options.onNotify?.(payload)
    },
  }
  const controller = createThreadDeepLinkController(dependencies)
  return {
    controller,
    notifyCalls: records.notifyCalls,
    get focusCalls() {
      return records.focusCalls
    },
    order: records.order,
    logs: records.logs,
    readyListeners: records.readyListeners,
    get unsubscribeCalls() {
      return records.unsubscribeCalls
    },
    ready: () => {
      readyState.value = true
      for (const listener of [...records.readyListeners]) listener()
    },
    dispose: () => controller.dispose(),
  }
}

// 内部状态与发送 payload 只保存解析后的 threadId；注入 logger 记录的所有
// 参数/消息都不得包含原始链接或 threadId。测试不要求日志里出现任何 ID。
function assertNoSensitiveData(harness: Harness, threadId: string, rawLink: string): void {
  const serialized = harness.logs
    .map((record) => `${record.event} ${JSON.stringify(record.fields ?? {})}`)
    .join('\n')
  expect(serialized).not.toContain(threadId)
  expect(serialized).not.toContain(rawLink)
}

describe('ThreadDeepLinkController 冷启动 argv', () => {
  for (const threadId of LEGAL_IDS) {
    test(`argv 中的合法深链只缓存解析后的 threadId（${threadId}），Renderer 未就绪不发送`, () => {
      const link = legalLink(threadId)
      const harness = createHarness({
        argv: ['C:\\Pidex Desktop.exe', '--flag', link],
        ready: false,
      })

      expect(harness.notifyCalls).toEqual([])
      expect(harness.focusCalls).toBe(0)
      expect(harness.controller.consumePendingThreadDeepLink()).toEqual({
        threadId,
      })
      expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
      assertNoSensitiveData(harness, threadId, link)
    })
  }

  test('Renderer/订阅就绪后只消费一次，再消费为 null、不重复通知', () => {
    const threadId = 'cold-ready-002'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [link], ready: false })

    harness.ready()
    expect(harness.notifyCalls).toEqual([{ threadId }])

    harness.ready()
    expect(harness.notifyCalls).toEqual([{ threadId }])
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
    assertNoSensitiveData(harness, threadId, link)
  })

  test('consumePendingThreadDeepLink 先消费后，订阅就绪不再通知', () => {
    const threadId = 'cold-pulled-003'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [link], ready: false })

    expect(harness.controller.consumePendingThreadDeepLink()).toEqual({
      threadId,
    })
    harness.ready()
    expect(harness.notifyCalls).toEqual([])
  })

  test('冷启动只取 argv 中第一个合法深链', () => {
    const first = 'cold-first-004'
    const second = 'cold-second-005'
    const harness = createHarness({
      argv: ['C:\\Pidex Desktop.exe', legalLink(first), legalLink(second)],
      ready: false,
    })

    expect(harness.controller.consumePendingThreadDeepLink()).toEqual({
      threadId: first,
    })
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
  })

  test('argv 中普通参数不产生缓存', () => {
    const harness = createHarness({
      argv: ['C:\\Pidex Desktop.exe', '--no-sandbox', 'C:\\plain\\path'],
      ready: false,
    })

    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
    expect(harness.notifyCalls).toEqual([])
    expect(harness.focusCalls).toBe(0)
  })
})

describe('ThreadDeepLinkController second-instance 运行时激活', () => {
  test('合法深链：聚焦主窗口并向已就绪 Renderer 通知精确 {threadId}，每次激活仅一次', () => {
    const threadId = 'runtime-100'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [], ready: true })

    harness.controller.pushRuntimeActivation(['C:\\Pidex Desktop.exe', link])
    expect(harness.focusCalls).toBe(1)
    expect(harness.notifyCalls).toEqual([{ threadId }])
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()

    harness.controller.pushRuntimeActivation(['C:\\Pidex Desktop.exe', link])
    expect(harness.focusCalls).toBe(2)
    expect(harness.notifyCalls).toEqual([{ threadId }, { threadId }])
    assertNoSensitiveData(harness, threadId, link)
  })

  test('最小化窗口先 restore：每次合法激活必须先执行 focusMainWindow 再通知', () => {
    const threadId = 'runtime-focus-order-101'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [], ready: true })

    harness.controller.pushRuntimeActivation([link])
    expect(harness.order).toEqual(['focus', 'notify'])

    harness.controller.pushRuntimeActivation([link])
    expect(harness.order).toEqual(['focus', 'notify', 'focus', 'notify'])
  })

  test('Renderer 未就绪时激活不发送，缓存供稍后消费', () => {
    const threadId = 'runtime-cached-102'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [], ready: false })

    harness.controller.pushRuntimeActivation([link])
    expect(harness.focusCalls).toBe(1)
    expect(harness.notifyCalls).toEqual([])
    expect(harness.controller.consumePendingThreadDeepLink()).toEqual({
      threadId,
    })
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
    assertNoSensitiveData(harness, threadId, link)
  })

  test('无窗口时安全缓存供稍后消费：稍后就绪仅通知一次', () => {
    const threadId = 'runtime-no-window-103'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [], ready: false })

    harness.controller.pushRuntimeActivation([link])
    expect(harness.notifyCalls).toEqual([])

    harness.ready()
    expect(harness.notifyCalls).toEqual([{ threadId }])

    harness.ready()
    expect(harness.notifyCalls).toEqual([{ threadId }])
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
  })

  test('非法深链一律忽略：不聚焦、不发送、不缓存', () => {
    const harness = createHarness({ argv: [], ready: true })

    harness.controller.pushRuntimeActivation(['C:\\Pidex Desktop.exe', 'pidex://evil/abc'])
    expect(harness.focusCalls).toBe(0)
    expect(harness.notifyCalls).toEqual([])
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
  })

  test('普通 argv 参数没有深链时同样忽略', () => {
    const harness = createHarness({ argv: [], ready: true })

    harness.controller.pushRuntimeActivation(['C:\\Pidex Desktop.exe', '--flag', 'C:\\plain\\path'])
    expect(harness.focusCalls).toBe(0)
    expect(harness.notifyCalls).toEqual([])
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
  })
})

describe('ThreadDeepLinkController open-url（macOS 生命周期兼容）', () => {
  test('合法链接语义同 second-instance：聚焦并通知一次', () => {
    const threadId = 'open-url-200'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [], ready: true })

    harness.controller.pushRuntimeActivation([link])
    expect(harness.focusCalls).toBe(1)
    expect(harness.notifyCalls).toEqual([{ threadId }])

    harness.controller.pushRuntimeActivation([link])
    expect(harness.focusCalls).toBe(2)
    expect(harness.notifyCalls).toEqual([{ threadId }, { threadId }])
    assertNoSensitiveData(harness, threadId, link)
  })

  test('非法 open-url 链接同样忽略', () => {
    const harness = createHarness({ argv: [], ready: true })

    harness.controller.pushRuntimeActivation(['pidex://threads?tab=open'])
    expect(harness.focusCalls).toBe(0)
    expect(harness.notifyCalls).toEqual([])
    expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
  })
})

describe('ThreadDeepLinkController 非法深链整体拒绝', () => {
  test('非法 scheme/host/port/query/hash/userinfo/空/额外段深链一律忽略', () => {
    for (const link of ILLEGAL_LINKS) {
      const harness = createHarness({ argv: [link], ready: true })
      expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
      expect(harness.focusCalls).toBe(0)
      expect(harness.notifyCalls).toEqual([])

      harness.controller.pushRuntimeActivation([link])
      expect(harness.focusCalls).toBe(0)
      expect(harness.notifyCalls).toEqual([])
      expect(harness.controller.consumePendingThreadDeepLink()).toBeNull()
    }
  })
})

describe('ThreadDeepLinkController 订阅绑定与 dispose', () => {
  test('工厂创建时只绑定一次 Renderer 就绪订阅，避免重复监听造成重复导航', () => {
    const threadId = 'binding-300'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [link], ready: false })

    expect(harness.readyListeners).toHaveLength(1)
    harness.ready()
    expect(harness.notifyCalls).toEqual([{ threadId }])
    harness.ready()
    expect(harness.notifyCalls).toEqual([{ threadId }])
  })

  test('dispose 解绑订阅，之后就绪不再自动通知', () => {
    const threadId = 'dispose-301'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [link], ready: false })

    harness.dispose()
    expect(harness.unsubscribeCalls).toBe(1)
    harness.ready()
    expect(harness.notifyCalls).toEqual([])
  })

  test('dispose 后运行时激活仍然只聚焦、不通知、不重复导航', () => {
    const threadId = 'dispose-302'
    const link = legalLink(threadId)
    const harness = createHarness({ argv: [], ready: true })

    harness.dispose()
    harness.controller.pushRuntimeActivation([link])
    expect(harness.focusCalls).toBe(1)
    expect(harness.notifyCalls).toEqual([])
    harness.ready()
    expect(harness.notifyCalls).toEqual([])
  })
})
