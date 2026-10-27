import { describe, expect, test } from 'bun:test'
import type { DesktopProviderIconChange } from '@pidex/shared/desktop-provider-icon-ipc'
import { createProviderIconStore } from '../src/services/desktop-client/ProviderIconClient.js'

const ICON_URL = 'https://models.dev/logos/openai.svg'
const CACHED_SOURCE = 'data:image/svg+xml;base64,PHN2Zy8+'
const MANUAL_SOURCE = 'data:image/png;base64,AAA='

describe('供应商图标客户端缓存', () => {
  test('提供商手动图标独立加载并响应获取与恢复默认', async () => {
    let publish: ((change: DesktopProviderIconChange) => void) | undefined
    const store = createProviderIconStore({
      resolveProviderIcon: async ({ url }) => (url ? { source: CACHED_SOURCE } : { source: null }),
      onProviderIconChange: (listener) => {
        publish = listener
        return () => undefined
      },
    })
    await store.loadProviderOverride('relay')
    expect(store.getProviderOverride('relay')).toEqual({ source: null, resolved: true })

    publish?.({ url: '', providerID: 'relay', source: MANUAL_SOURCE })
    expect(store.getProviderOverride('relay')).toEqual({ source: MANUAL_SOURCE, resolved: true })

    publish?.({ url: '', providerID: 'relay', source: null })
    expect(store.getProviderOverride('relay')).toEqual({ source: null, resolved: true })
  })

  test('手动图标生效时不请求目录图标，恢复默认后才加载目录图标', async () => {
    let publish: ((change: DesktopProviderIconChange) => void) | undefined
    const calls: { url: string; providerID?: string }[] = []
    const store = createProviderIconStore({
      resolveProviderIcon: async (input) => {
        calls.push(input)
        if (!input.url) return { source: MANUAL_SOURCE, override: true }
        if (store.getProviderOverride('relay').source)
          return { source: MANUAL_SOURCE, override: true }
        return { source: CACHED_SOURCE }
      },
      onProviderIconChange: (listener) => {
        publish = listener
        return () => undefined
      },
    })

    expect(await store.loadProviderOverride('relay')).toBe(true)
    // 恢复默认前，目录地址不应被解析或缓存。
    expect(calls).toEqual([{ url: '', providerID: 'relay' }])
    expect(store.getSource(ICON_URL)).toBeUndefined()

    publish?.({ url: '', providerID: 'relay', source: null })
    await store.loadCatalogueIcon(ICON_URL, 'relay')
    expect(store.getSource(ICON_URL)).toBe(CACHED_SOURCE)
    expect(calls.at(-1)).toEqual({ url: ICON_URL, providerID: 'relay' })
  })

  test('目录解析期间被设为手动图标时不污染地址缓存', async () => {
    let release: ((resolution: { source: string | null; override?: boolean }) => void) | undefined
    const store = createProviderIconStore({
      resolveProviderIcon: async () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })

    const pending = store.loadCatalogueIcon(ICON_URL, 'relay')
    release?.({ source: MANUAL_SOURCE, override: true })
    await pending

    expect(store.getSource(ICON_URL)).toBeUndefined()
    expect(store.getProviderOverride('relay')).toEqual({ source: MANUAL_SOURCE, resolved: true })
  })

  test('同一地址只解析一次，重复读取直接命中缓存', async () => {
    const calls: string[] = []
    const store = createProviderIconStore({
      resolveProviderIcon: async ({ url }) => {
        calls.push(url)
        return { source: CACHED_SOURCE }
      },
    })

    await store.loadCatalogueIcon(ICON_URL)
    await store.loadCatalogueIcon(ICON_URL)

    expect(calls).toEqual([ICON_URL])
    expect(store.getSource(ICON_URL)).toBe(CACHED_SOURCE)
  })

  test('并发加载合并为一次解析', async () => {
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const store = createProviderIconStore({
      resolveProviderIcon: async () => {
        calls += 1
        await gate
        return { source: CACHED_SOURCE }
      },
    })

    const pending = Promise.all([
      store.loadCatalogueIcon(ICON_URL),
      store.loadCatalogueIcon(ICON_URL),
      store.loadCatalogueIcon(ICON_URL),
    ])
    release?.()
    await pending

    expect(calls).toBe(1)
    expect(store.getSource(ICON_URL)).toBe(CACHED_SOURCE)
  })

  test('宿主后台刷新成功后替换内容并通知订阅者', async () => {
    let publish: ((change: DesktopProviderIconChange) => void) | undefined
    const store = createProviderIconStore({
      resolveProviderIcon: async () => ({ source: 'data:image/svg+xml;base64,b2xk' }),
      onProviderIconChange: (listener) => {
        publish = listener
        return () => undefined
      },
    })
    let notifications = 0
    const unsubscribe = store.state.subscribe(() => {
      notifications += 1
    })

    await store.loadCatalogueIcon(ICON_URL)
    expect(store.getSource(ICON_URL)).toBe('data:image/svg+xml;base64,b2xk')

    publish?.({ url: ICON_URL, source: CACHED_SOURCE })
    expect(store.getSource(ICON_URL)).toBe(CACHED_SOURCE)
    expect(notifications).toBeGreaterThan(0)

    // 相同内容不重复通知。
    const seen = notifications
    publish?.({ url: ICON_URL, source: CACHED_SOURCE })
    expect(notifications).toBe(seen)
    unsubscribe()
  })

  test('解析失败或尚未缓存时没有本地地址', async () => {
    const store = createProviderIconStore({
      resolveProviderIcon: async () => ({ source: null }),
    })

    expect(store.getSource(ICON_URL)).toBeUndefined()
    await store.loadCatalogueIcon(ICON_URL)
    expect(store.getSource(ICON_URL)).toBeUndefined()
  })

  test('未解析的覆盖状态保持稳定引用，供 useSyncExternalStore 使用', () => {
    const store = createProviderIconStore({ resolveProviderIcon: async () => ({ source: null }) })
    expect(store.getProviderOverride('relay')).toBe(store.getProviderOverride('relay'))
  })
})
