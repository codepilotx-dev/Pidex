import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type {
  DesktopProviderIconChange,
  DesktopProviderIconResolution,
} from '@pidex/shared/desktop-provider-icon-ipc'

export type ProviderIconBridge = {
  resolveProviderIcon(input: { url: string }): Promise<DesktopProviderIconResolution>
  onProviderIconChange?(listener: (change: DesktopProviderIconChange) => void): () => void
}

export type ProviderIconStore = {
  subscribe(listener: () => void): () => void
  getSource(url: string): string | undefined
  load(url: string): Promise<void>
}

/**
 * 供应商图标的客户端缓存：同一地址只解析一次，宿主后台刷新成功后由
 * `provider-icon:changed` 事件替换当前显示内容，无需重新挂载页面。
 */
export function createProviderIconStore(bridge: ProviderIconBridge): ProviderIconStore {
  const sources = new Map<string, string>()
  const requested = new Set<string>()
  const inFlight = new Map<string, Promise<void>>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  // 订阅与 React 挂载无关：宿主后台刷新发生在页面关闭期间也不能丢失。
  bridge.onProviderIconChange?.((change) => {
    if (sources.get(change.url) === change.source) return
    sources.set(change.url, change.source)
    notify()
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSource: (url) => sources.get(url),
    load(url) {
      const pending = inFlight.get(url)
      if (pending) return pending
      if (sources.has(url) || requested.has(url)) return Promise.resolve()
      requested.add(url)
      let request: Promise<void>
      request = bridge
        .resolveProviderIcon({ url })
        .then((resolution) => {
          if (resolution.source) sources.set(url, resolution.source)
        })
        .catch(() => undefined)
        .finally(() => {
          if (inFlight.get(url) === request) inFlight.delete(url)
          notify()
        })
      inFlight.set(url, request)
      return request
    },
  }
}

function resolveProviderIconBridge(): ProviderIconBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const bridge = window.DesktopBridge
  if (!bridge || typeof bridge.resolveProviderIcon !== 'function') return undefined
  return bridge
}

const EMPTY_SUBSCRIBE = (): (() => void) => () => undefined
const EMPTY_GET_SOURCE = (): string | undefined => undefined

let store: ProviderIconStore | undefined
let storeBridge: ProviderIconBridge | undefined

export function getProviderIconStore(): ProviderIconStore | undefined {
  const bridge = resolveProviderIconBridge()
  if (!bridge) return undefined
  if (!store || storeBridge !== bridge) {
    store = createProviderIconStore(bridge)
    storeBridge = bridge
  }
  return store
}

/**
 * 供应商图标的统一加载入口。返回本地缓存的显示地址；宿主缓存尚未命中或下载
 * 失败时返回 `undefined`，由调用方继续展示占位图标。没有桌面桥（browser-mock）
 * 或旧版桥时回退为原始远端地址，保持既有行为。
 */
export function useProviderIconSource(logoURL?: string): string | undefined {
  const activeStore = getProviderIconStore()
  const subscribe = useMemo(
    () => (activeStore ? activeStore.subscribe : EMPTY_SUBSCRIBE),
    [activeStore],
  )
  const getSnapshot = useMemo(
    () => (activeStore && logoURL ? () => activeStore.getSource(logoURL) : EMPTY_GET_SOURCE),
    [activeStore, logoURL],
  )
  const source = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (activeStore && logoURL) void activeStore.load(logoURL)
  }, [activeStore, logoURL])

  if (!logoURL) return undefined
  return activeStore ? source : logoURL
}
