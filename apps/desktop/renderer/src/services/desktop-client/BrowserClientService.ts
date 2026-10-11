import type {
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
  DesktopBrowserSitePermission,
} from '@pidex/shared/desktop-browser-ipc'
import type {
  DesktopApi,
  DesktopBrowserState,
  DesktopBrowserBounds,
} from '../../../shared/Types.js'
import { BrowserGuestHosts } from '../../features/browser/BrowserGuestHosts.js'
type BrowserApi = Pick<
  DesktopApi,
  | 'getBrowserState'
  | 'openBrowser'
  | 'navigateBrowser'
  | 'reloadBrowser'
  | 'goBackBrowser'
  | 'goForwardBrowser'
  | 'closeBrowser'
  | 'setBrowserBounds'
  | 'clearBrowserAllowedSites'
>
export type DesktopBrowserClient = BrowserApi & {
  annotation(
    input: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationInput,
  ): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationResult>
  onAnnotationEvent(
    listener: (
      event: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationEvent,
    ) => void,
  ): () => void
  utility(
    operation: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtility,
  ): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtilityResult>
  data(
    request: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserDataRequest,
  ): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserDataResult>
  onUtilityEvent(
    listener: (
      event: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtilityEvent,
    ) => void,
  ): () => void
  onDataChange(listener: () => void): () => void
  available: boolean
  stopBrowser(): Promise<DesktopBrowserState>
  setBrowserVisible(visible: boolean): Promise<DesktopBrowserState>
  focusBrowser(): Promise<void>
  onBrowserStateChange(listener: (state: DesktopBrowserState) => void): () => void
  listTabs(): Promise<DesktopBrowserState[]>
  createTab(sourceThreadId: string | null, url?: string): Promise<DesktopBrowserState>
  forTab(tabId: string): DesktopBrowserClient
  getTab(tabId: string): DesktopBrowserState | null
  setContext(threadId: string | null): void
  selectTab(tabId: string): void
  onTabsChange(listener: (tabs: DesktopBrowserState[]) => void): () => void
  control(threadId: string | null): Promise<DesktopBrowserState>
  layout(panel: 'right' | 'bottom', order: number): Promise<void>
  setPermission(
    origin: string,
    decision: 'allow' | 'deny' | 'remove',
  ): Promise<DesktopBrowserSitePermission[]>
}
export function createDesktopBrowserClient(
  bridge?: Partial<DesktopBrowserIpcBridge>,
  document?: Document,
): DesktopBrowserClient {
  const states = new Map<string, DesktopBrowserState>()
  const clients = new Map<string, DesktopBrowserClient>()
  const listeners = new Set<(tabs: DesktopBrowserState[]) => void>()
  const hosts = document && bridge ? new BrowserGuestHosts(bridge, document) : null
  let selectedId: string | undefined
  let sourceThreadId: string | null = null
  const available = Boolean(
    bridge?.listDesktopBrowserTabs &&
    bridge.attachDesktopBrowserGuest &&
    bridge.createOrRestoreDesktopBrowser &&
    bridge.onDesktopBrowserStateChange,
  )
  const unavailable = (): never => {
    throw new Error('内置浏览器仅在连接 Agent 的 Pidex 桌面应用中可用。')
  }
  const accept = (snapshot: DesktopBrowserSnapshot): DesktopBrowserState => {
    const previous = states.get(snapshot.tabId)
    if (previous?.revision && snapshot.revision && snapshot.revision < previous.revision)
      return previous
    const state: DesktopBrowserState = {
      ...snapshot,
      allowedSites: [...snapshot.allowedSites],
      sitePermissions: snapshot.sitePermissions.map((p) => ({ ...p })),
    }
    if (snapshot.open) states.set(snapshot.tabId, state)
    else states.delete(snapshot.tabId)
    hosts?.update(snapshot)
    for (const listener of listeners) listener([...states.values()])
    return state
  }
  bridge?.onDesktopBrowserStateChange?.(accept)
  const createClient = (fixedId?: string): DesktopBrowserClient => {
    const id = () => fixedId ?? selectedId ?? states.keys().next().value ?? 'catalog'
    const tab = () => ({ tabId: id() })
    const apply = async (promise?: Promise<DesktopBrowserSnapshot>) =>
      accept(await (promise ?? unavailable()))
    const client: DesktopBrowserClient = {
      annotation: (input) =>
        bridge?.performDesktopBrowserAnnotation?.(input) ??
        Promise.reject(new Error('浏览器批注能力不可用')),
      onAnnotationEvent: (listener) =>
        bridge?.onDesktopBrowserAnnotationEvent?.((event) => {
          if (event.tabId === id()) listener(event)
        }) ?? (() => {}),
      utility: (operation) => {
        const generation = states.get(id())?.generation
        if (!generation) return Promise.reject(new Error('浏览器页面尚未连接'))
        return (
          bridge?.performDesktopBrowserUtility?.({ ...tab(), generation, operation }) ??
          Promise.reject(new Error('浏览器菜单能力不可用'))
        )
      },
      data: (request) =>
        bridge?.manageDesktopBrowserData?.(request) ??
        Promise.reject(new Error('浏览管理能力不可用')),
      onUtilityEvent: (listener) =>
        bridge?.onDesktopBrowserUtilityEvent?.((event) => {
          if (event.tabId === id() && event.generation === states.get(id())?.generation)
            listener(event)
        }) ?? (() => {}),
      onDataChange: (listener) => bridge?.onDesktopBrowserDataChange?.(listener) ?? (() => {}),
      available,
      getBrowserState: () => apply(bridge?.getDesktopBrowserState?.(tab())),
      openBrowser: async (url) => {
        if (!fixedId && id() === 'catalog') return client.createTab(null, url)
        return apply(
          bridge?.createOrRestoreDesktopBrowser?.({
            ...tab(),
            sourceThreadId,
            ...(url === undefined ? {} : { url }),
          }),
        )
      },
      navigateBrowser: (url) => apply(bridge?.navigateDesktopBrowser?.({ ...tab(), url })),
      reloadBrowser: () => apply(bridge?.reloadDesktopBrowser?.(tab())),
      stopBrowser: () => apply(bridge?.stopDesktopBrowser?.(tab())),
      goBackBrowser: () => apply(bridge?.goBackDesktopBrowser?.(tab())),
      goForwardBrowser: () => apply(bridge?.goForwardDesktopBrowser?.(tab())),
      closeBrowser: () => apply(bridge?.closeDesktopBrowser?.(tab())),
      setBrowserBounds: async (bounds: DesktopBrowserBounds) => {
        hosts?.setBounds(id(), bounds)
        return states.get(id()) ?? client.getBrowserState()
      },
      setBrowserVisible: async (visible) => {
        return apply(bridge?.setDesktopBrowserVisible?.({ ...tab(), visible }))
      },
      focusBrowser: async () => {
        await (bridge?.focusDesktopBrowser?.(tab()) ?? unavailable())
      },
      clearBrowserAllowedSites: () => apply(bridge?.clearDesktopBrowserAllowedSites?.(tab())),
      onBrowserStateChange: (listener) => {
        const update = () => {
          const state = states.get(id())
          if (state) listener(state)
        }
        listeners.add(update)
        return () => listeners.delete(update)
      },
      listTabs: async () => {
        const snapshots = await (bridge?.listDesktopBrowserTabs?.() ?? unavailable())
        const ids = new Set(snapshots.map((s) => s.tabId))
        for (const [tabId, state] of states)
          if (!ids.has(tabId)) {
            states.delete(tabId)
            hosts?.update({ ...state, tabId, open: false })
          }
        snapshots.forEach(accept)
        return [...states.values()]
      },
      createTab: async (sourceThreadId, url) => {
        const tabId = crypto.randomUUID()
        return apply(
          bridge?.createOrRestoreDesktopBrowser?.({
            tabId,
            sourceThreadId,
            ...(url === undefined ? {} : { url }),
          }),
        )
      },
      forTab: (tabId) => {
        let scoped = clients.get(tabId)
        if (!scoped) {
          scoped = createClient(tabId)
          clients.set(tabId, scoped)
        }
        return scoped
      },
      getTab: (tabId) => states.get(tabId) ?? null,
      setContext: (threadId) => {
        sourceThreadId = threadId
      },
      selectTab: (tabId) => {
        selectedId = tabId
      },
      onTabsChange: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      control: (threadId) => apply(bridge?.controlDesktopBrowser?.({ ...tab(), threadId })),
      layout: async (panel, order) => {
        await (bridge?.layoutDesktopBrowser?.({ ...tab(), panel, order }) ?? unavailable())
      },
      setPermission: async (origin, decision) => {
        const permissions = await (bridge?.setDesktopBrowserPermission?.({ origin, decision }) ??
          unavailable())
        await client.listTabs()
        return permissions
      },
    }
    return client
  }
  return createClient()
}
