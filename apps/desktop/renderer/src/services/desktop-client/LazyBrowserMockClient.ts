// Lazy Browser Mock facade：只负责代理，不复制 Mock 的领域实现。
// BrowserMockClient.ts 与 Fixtures.ts 通过缓存的动态 import 加载；
// Electron 有 typed bridge 时不会调用 mock 方法，因此不加载 Mock chunk，
// browser/visual/performance 模式仍在第一次读取时加载并保持原有数据。
// Promise 方法在 facade 中等待真实 Mock 后转发；订阅方法立即返回幂等
// disposer，真实 Mock 加载后若尚未取消再建立订阅。
import type { createBrowserMockDesktopClient } from './BrowserMockClient.js'

type BrowserMockClient = ReturnType<typeof createBrowserMockDesktopClient>

// 订阅方法签名统一为 (callback) => () => void，不能在 Mock 加载前调用；
// 其余方法统一为 Promise 转发。
const SUBSCRIPTION_METHODS = new Set([
  'onAgentEvent',
  'onWorkflowEvent',
  'onUiCommand',
  'onSessionStoreChange',
  'onDesktopSettingsChange',
  'onUpdateStatusChange',
  'onRuntimeSkillsUpdated',
  'onPluginsUpdated',
  'onMiniMaxCliUpdated',
  'onComputerChanged',
  'onSpeechStatusUpdated',
  'onToolingUpdated',
])

export function createLazyBrowserMockClient(storage: Storage | undefined): BrowserMockClient {
  let mockPromise: Promise<BrowserMockClient> | null = null

  const loadMock = (): Promise<BrowserMockClient> => {
    if (mockPromise) return mockPromise
    mockPromise = import('./BrowserMockClient.js')
      .then((module) => module.createBrowserMockDesktopClient(storage))
      .catch((error) => {
        mockPromise = null
        throw error
      })
    return mockPromise
  }

  const subscribe = (method: string, callback: unknown): (() => void) => {
    let cancelled = false
    let disposer: (() => void) | null = null
    void loadMock().then(
      (mock) => {
        if (cancelled) return
        const subscribeMock = mock[method] as (callback: unknown) => () => void
        disposer = subscribeMock(callback)
      },
      () => {
        // The caller owns no async error channel for subscription setup. A later
        // subscription or Promise method retries the cached dynamic import.
      },
    )
    return () => {
      cancelled = true
      disposer?.()
      disposer = null
    }
  }

  return new Proxy({} as BrowserMockClient, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (SUBSCRIPTION_METHODS.has(prop)) {
        return (callback: unknown) => subscribe(prop, callback)
      }
      return (...args: unknown[]) =>
        loadMock().then((mock) => {
          const method = mock[prop as keyof BrowserMockClient]
          if (typeof method !== 'function') {
            throw new Error(`Browser mock does not implement ${prop}.`)
          }
          return (method as (...methodArgs: unknown[]) => unknown)(...args)
        })
    },
  })
}
