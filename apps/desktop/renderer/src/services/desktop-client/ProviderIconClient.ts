import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type {
  DesktopProviderIconChange,
  DesktopProviderIconResolution,
} from '@pidex/shared/desktop-provider-icon-ipc'

export type ProviderIconBridge = {
  resolveProviderIcon(input: { url: string; providerID?: string }): Promise<DesktopProviderIconResolution>
  onProviderIconChange?(listener: (change: DesktopProviderIconChange) => void): () => void
}

export type ProviderIconOverride = {
  /** 手动图标地址；`null` 表示该供应商没有手动图标。 */
  source: string | null
  /** 是否已经向宿主确认过覆盖状态。 */
  resolved: boolean
}

export type ProviderIconStore = {
  subscribe(listener: () => void): () => void
  getSource(url: string): string | undefined
  getProviderOverride(providerID: string): ProviderIconOverride
  /** 解析供应商手动图标，返回是否处于手动覆盖状态。 */
  loadProviderOverride(providerID: string): Promise<boolean>
  /** 解析目录/模型图标；供应商有手动图标时不调用，避免进入 5 小时刷新链路。 */
  loadCatalogueIcon(url: string, providerID?: string): Promise<void>
}

const UNRESOLVED_OVERRIDE: ProviderIconOverride = { source: null, resolved: false }

/**
 * 供应商图标的客户端缓存。手动图标按供应商独立保存；目录图标按地址缓存，
 * 并由宿主每 5 小时在后台刷新。两者分开存放，手动图标不会被目录刷新覆盖，
 * 恢复默认后目录图标才重新参与加载与刷新。
 */
export function createProviderIconStore(bridge: ProviderIconBridge): ProviderIconStore {
  const sources = new Map<string, string>()
  const overrides = new Map<string, ProviderIconOverride>()
  const requestedURLs = new Set<string>()
  const inFlightProviders = new Map<string, Promise<boolean>>()
  const inFlightURLs = new Map<string, Promise<void>>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  // 订阅与 React 挂载无关：宿主后台刷新发生在页面关闭期间也不能丢失。
  bridge.onProviderIconChange?.((change) => {
    if (change.providerID) {
      const current = overrides.get(change.providerID)
      const source = change.source ?? null
      if (current?.resolved && current.source === source) return
      overrides.set(change.providerID, { source, resolved: true })
      notify()
      return
    }
    if (sources.get(change.url) === (change.source ?? undefined)) return
    if (change.source) sources.set(change.url, change.source)
    else sources.delete(change.url)
    notify()
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSource: (url) => sources.get(url),
    getProviderOverride: (providerID) => overrides.get(providerID) ?? UNRESOLVED_OVERRIDE,
    loadProviderOverride(providerID) {
      const known = overrides.get(providerID)
      if (known?.resolved) return Promise.resolve(known.source !== null)
      const pending = inFlightProviders.get(providerID)
      if (pending) return pending

      let request: Promise<boolean>
      request = bridge
        .resolveProviderIcon({ url: '', providerID })
        .then((resolution) => {
          const source = resolution.source ?? null
          overrides.set(providerID, { source, resolved: true })
          notify()
          return source !== null
        })
        .catch(() => {
          // 读取失败按“无手动图标”处理，回退到目录图标，避免整块图标消失。
          overrides.set(providerID, { source: null, resolved: true })
          notify()
          return false
        })
        .finally(() => {
          if (inFlightProviders.get(providerID) === request) inFlightProviders.delete(providerID)
        })
      inFlightProviders.set(providerID, request)
      return request
    },
    loadCatalogueIcon(url, providerID) {
      const pending = inFlightURLs.get(url)
      if (pending) return pending
      if (sources.has(url) || requestedURLs.has(url)) return Promise.resolve()

      requestedURLs.add(url)
      let request: Promise<void>
      request = bridge
        .resolveProviderIcon({ url, ...(providerID ? { providerID } : {}) })
        .then((resolution) => {
          if (resolution.override) {
            // 供应商在此期间被设为手动图标：目录内容不得写入地址缓存，否则恢复
            // 默认后会短暂显示旧的手动图标。
            requestedURLs.delete(url)
            if (providerID) {
              overrides.set(providerID, {
                source: resolution.source ?? null,
                resolved: true,
              })
              notify()
            }
            return
          }
          if (resolution.source) sources.set(url, resolution.source)
        })
        .catch(() => undefined)
        .finally(() => {
          if (inFlightURLs.get(url) === request) inFlightURLs.delete(url)
          notify()
        })
      inFlightURLs.set(url, request)
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
const EMPTY_GET_OVERRIDE = (): ProviderIconOverride => UNRESOLVED_OVERRIDE

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

export type ProviderIconSource = {
  source: string | undefined
  override: boolean
}

/**
 * 供应商图标的统一加载入口。手动图标与目录图标互斥加载：手动图标生效期间不会
 * 请求目录图标，因此不会触发 5 小时刷新；恢复默认后才开始加载并参与刷新。
 * 没有桌面桥（browser-mock）或旧版桥时回退为原始远端地址。
 */
export function useProviderIconSource(logoURL?: string, providerID?: string): ProviderIconSource {
  const activeStore = getProviderIconStore()
  const subscribe = useMemo(
    () => (activeStore ? activeStore.subscribe : EMPTY_SUBSCRIBE),
    [activeStore],
  )
  const overrideState = useSyncExternalStore(
    subscribe,
    () => (activeStore && providerID ? activeStore.getProviderOverride(providerID) : UNRESOLVED_OVERRIDE),
    EMPTY_GET_OVERRIDE,
  )
  const urlSource = useSyncExternalStore(
    subscribe,
    () => (activeStore && logoURL ? activeStore.getSource(logoURL) : undefined),
    EMPTY_GET_SOURCE,
  )

  useEffect(() => {
    if (!activeStore) return
    if (providerID) {
      if (!overrideState.resolved) {
        void activeStore.loadProviderOverride(providerID)
        return
      }
      if (overrideState.source) return
    }
    if (logoURL) void activeStore.loadCatalogueIcon(logoURL, providerID)
  }, [activeStore, logoURL, providerID, overrideState])

  if (!activeStore) return { source: logoURL, override: false }

  const source = providerID
    ? overrideState.resolved
      ? (overrideState.source ?? (logoURL ? urlSource : undefined))
      : undefined
    : logoURL
      ? urlSource
      : undefined

  return { source, override: Boolean(providerID && overrideState.source) }
}
