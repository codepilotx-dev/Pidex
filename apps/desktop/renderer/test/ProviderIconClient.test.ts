import { describe, expect, test } from 'bun:test'
import type { DesktopProviderIconChange } from '@pidex/shared/desktop-provider-icon-ipc'
import { createProviderIconStore } from '../src/services/desktop-client/ProviderIconClient.js'

const ICON_URL = 'https://models.dev/logos/openai.svg'
const CACHED_SOURCE = 'data:image/svg+xml;base64,PHN2Zy8+'

describe('供应商图标客户端缓存', () => {
  test('同一地址只解析一次，重复读取直接命中缓存', async () => {
    const calls: string[] = []
    const store = createProviderIconStore({
      resolveProviderIcon: async ({ url }) => {
        calls.push(url)
        return { source: CACHED_SOURCE }
      },
    })

    await store.load(ICON_URL)
    await store.load(ICON_URL)

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

    const pending = Promise.all([store.load(ICON_URL), store.load(ICON_URL), store.load(ICON_URL)])
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
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    await store.load(ICON_URL)
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
    await store.load(ICON_URL)
    expect(store.getSource(ICON_URL)).toBeUndefined()
  })
})
