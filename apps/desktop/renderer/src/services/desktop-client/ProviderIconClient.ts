import { useEffect } from 'react'
import { useStore } from 'zustand/react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  DesktopProviderIconChange,
  DesktopProviderIconResolution,
} from '@pidex/shared/desktop-provider-icon-ipc'

export type ProviderIconBridge = {
  resolveProviderIcon(input: {
    url: string
    providerID?: string
  }): Promise<DesktopProviderIconResolution>
  onProviderIconChange?(listener: (change: DesktopProviderIconChange) => void): () => void
}

export type ProviderIconOverride = {
  /** 手动图标地址；`null` 表示该供应商没有手动图标。 */
  source: string | null
  /** 是否已经向宿主确认过覆盖状态。 */
  resolved: boolean
}

type ProviderIconState = {
  sources: ReadonlyMap<string, string>
  overrides: ReadonlyMap<string, ProviderIconOverride>
}
export type ProviderIconStore = {
  state: StoreApi<ProviderIconState>
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
  const state = createStore<ProviderIconState>(() => ({ sources: new Map(), overrides: new Map() }))
  const setSource = (url: string, source: string | null) => {
    const sources = new Map(state.getState().sources)
    if (source) sources.set(url, source)
    else sources.delete(url)
    state.setState({ sources })
  }
  const setOverride = (id: string, value: ProviderIconOverride) => {
    state.setState({ overrides: new Map(state.getState().overrides).set(id, value) })
  }
  const requestedURLs = new Set<string>()
  const inFlightProviders = new Map<string, Promise<boolean>>()
  const inFlightURLs = new Map<string, Promise<void>>()

  // 订阅与 React 挂载无关：宿主后台刷新发生在页面关闭期间也不能丢失。
  bridge.onProviderIconChange?.((change) => {
    if (change.providerID) {
      const current = state.getState().overrides.get(change.providerID)
      const source = change.source ?? null
      if (current?.resolved && current.source === source) return
      setOverride(change.providerID, { source, resolved: true })

      return
    }
    if (state.getState().sources.get(change.url) === (change.source ?? undefined)) return
    setSource(change.url, change.source ?? null)
  })

  return {
    state,
    getSource: (url) => state.getState().sources.get(url),
    getProviderOverride: (providerID) =>
      state.getState().overrides.get(providerID) ?? UNRESOLVED_OVERRIDE,
    loadProviderOverride(providerID) {
      const known = state.getState().overrides.get(providerID)
      if (known?.resolved) return Promise.resolve(known.source !== null)
      const pending = inFlightProviders.get(providerID)
      if (pending) return pending

      let request: Promise<boolean>
      request = bridge
        .resolveProviderIcon({ url: '', providerID })
        .then((resolution) => {
          const source = resolution.source ?? null
          setOverride(providerID, { source, resolved: true })

          return source !== null
        })
        .catch(() => {
          // 读取失败按“无手动图标”处理，回退到目录图标，避免整块图标消失。
          setOverride(providerID, { source: null, resolved: true })

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
      if (state.getState().sources.has(url) || requestedURLs.has(url)) return Promise.resolve()

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
              setOverride(providerID, {
                source: resolution.source ?? null,
                resolved: true,
              })
            }
            return
          }
          if (resolution.source) setSource(url, resolution.source)
        })
        .catch(() => undefined)
        .finally(() => {
          if (inFlightURLs.get(url) === request) inFlightURLs.delete(url)
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

const EMPTY_STATE = createStore<ProviderIconState>(() => ({
  sources: new Map(),
  overrides: new Map(),
}))

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
  const overrideState = useStore(activeStore?.state ?? EMPTY_STATE, (state) =>
    providerID ? (state.overrides.get(providerID) ?? UNRESOLVED_OVERRIDE) : UNRESOLVED_OVERRIDE,
  )
  const urlSource = useStore(activeStore?.state ?? EMPTY_STATE, (state) =>
    logoURL ? state.sources.get(logoURL) : undefined,
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
