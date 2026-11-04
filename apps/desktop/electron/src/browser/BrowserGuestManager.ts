import { webContents, session, type BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import type { BrowserTab, BrowserCommand, BrowserResult } from '@pidex/agent-protocol'
import type {
  DesktopBrowserSnapshot,
  DesktopBrowserBounds,
  DesktopBrowserSitePermission,
  DesktopBrowserUtilityInput,
  DesktopBrowserUtilityResult,
  DesktopBrowserUtilityEvent,
  DesktopBrowserDataRequest,
  DesktopBrowserDataResult,
  DesktopBrowserAnnotationInput,
} from '@pidex/shared/desktop-browser-ipc'
import { DESKTOP_BROWSER_IPC_CHANNELS } from '@pidex/shared/desktop-browser-ipc'
import type { DesktopLogger } from '../logging/DesktopLogger.js'
import type { SidecarSupervisor } from '../sidecar/Supervisor.js'
import { BrowserHostRpcClient } from './BrowserHostRpcClient.js'
import { runBrowserOperation } from './BrowserOperations.js'
import { normalizeDesktopBrowserUrl, isAllowedDesktopBrowserNavigation } from './BrowserUrl.js'
import { runBrowserUtility, applyBrowserDevice } from './BrowserUtilities.js'
import { BrowserDownloads } from './BrowserDownloads.js'
import { BrowserAnnotations } from './BrowserAnnotations.js'

type Entry = {
  agentAuthorization?: BrowserCommand
  tab: BrowserTab
  owner: BrowserWindow
  contents?: WebContents
  visible: boolean
  audio: boolean
  capturing: boolean
  initialized: boolean
  emulated: boolean
  abort?: AbortController
  idle?: ReturnType<typeof setTimeout>
  ready: Set<() => void>
  reporting: Promise<void>
  defaultUserAgent?: string
  visit?: { id: string; visitedAt: number; historyEpoch: number; url: string }
  finding?: boolean
  findText?: string
  findRequestId?: number
  executing?: Promise<void>
  activating?: Promise<void>
}
type WindowHost = {
  owner: BrowserWindow
  windowId: string
  instanceId: string
  stopped: boolean
  registering?: Promise<void>
  registered: boolean
  polling: boolean
  attached: Set<number>
  permissions: DesktopBrowserSitePermission[]
  pollTimer?: ReturnType<typeof setTimeout>
  budgetTimer?: ReturnType<typeof setInterval>
  budgeting?: boolean
  dataRevision?: number
}
export interface DesktopBrowserControllerOptions {
  publish(owner: BrowserWindow, state: DesktopBrowserSnapshot): void
  logger: DesktopLogger
  getSupervisor: () => SidecarSupervisor | undefined
}
export class DesktopBrowserController {
  readonly #rpc: BrowserHostRpcClient
  readonly #hosts = new Map<number, WindowHost>()
  readonly #entries = new Map<string, Entry>()
  readonly #downloads: BrowserDownloads
  readonly #annotations = new BrowserAnnotations()
  constructor(private readonly options: DesktopBrowserControllerOptions) {
    this.#rpc = new BrowserHostRpcClient(options.getSupervisor)
    this.#downloads = new BrowserDownloads(
      this.#rpc,
      () => {
        const host = [...this.#hosts.values()].find((host) => host.registered && !host.stopped)
        if (!host) throw new Error('浏览器宿主已退出')
        return { windowId: host.windowId, instanceId: host.instanceId }
      },
      (id) => {
        const entry = [...this.#entries.values()].find((entry) => entry.contents?.id === id)
        return entry
          ? {
              tabId: entry.tab.tabId,
              allowed: (url) =>
                !entry.tab.controlThreadId ||
                this.#allowed(this.#hosts.get(entry.owner.id)!, url, entry),
            }
          : undefined
      },
      () => this.#dataChanged(),
    )
  }
  async list(owner: BrowserWindow): Promise<DesktopBrowserSnapshot[]> {
    const host = await this.#ensureHost(owner)
    const catalog = await this.#rpc.call('browser/list', {})
    host.permissions = catalog.permissions.map((p) => ({ ...p }))
    this.#sync(
      host,
      catalog.tabs.filter((tab) => tab.windowId === host.windowId),
    )
    return this.#owned(host).map((entry) => this.#snapshot(entry))
  }
  async getState(owner: BrowserWindow, tabId: string) {
    await this.#ensureHost(owner)
    const entry = this.#entries.get(tabId)
    return entry?.owner === owner ? this.#snapshot(entry) : this.#empty(tabId, owner)
  }
  async createOrRestore(
    owner: BrowserWindow,
    tabId: string,
    url?: string,
    sourceThreadId: string | null = null,
  ) {
    const host = await this.#ensureHost(owner)
    const tab = await this.#rpc.call('browser/create', {
      tabId,
      windowId: host.windowId,
      sourceThreadId,
      url: normalizeDesktopBrowserUrl(url ?? 'about:blank').url,
    })
    this.#sync(host, [
      ...this.#owned(host)
        .filter((e) => e.tab.tabId !== tabId)
        .map((e) => e.tab),
      tab,
    ])
    const entry = this.#require(owner, tabId)
    await this.#activate(entry)
    return this.#snapshot(entry)
  }
  async attach(owner: BrowserWindow, tabId: string, generation: string, guestId: number) {
    const host = await this.#ensureHost(owner)
    const entry = this.#require(owner, tabId)
    const guest = webContents.fromId(guestId)
    if (
      !guest ||
      !host.attached.has(guestId) ||
      entry.tab.generation !== generation ||
      entry.contents
    )
      throw new Error('浏览器宿主不匹配')
    entry.contents = guest
    entry.initialized = false
    entry.defaultUserAgent = guest.getUserAgent()
    await this.#downloads.attach(guest.session)
    guest.on('found-in-page', (_event, result) => {
      if (result.requestId === entry.findRequestId)
        this.#utilityEvent(entry, { kind: 'find-result', ...result })
    })
    guest.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const modifier = input.control || input.meta
      if (modifier && input.key.toLowerCase() === 'f') {
        event.preventDefault()
        this.#utilityEvent(entry, { kind: 'find-open' })
      } else if (modifier && ['+', '=', '-', '0'].includes(input.key)) {
        event.preventDefault()
        void this.utility(entry.owner, {
          tabId: entry.tab.tabId,
          generation: entry.tab.generation,
          operation: {
            action: 'zoom',
            direction: input.key === '0' ? 'reset' : input.key === '-' ? 'out' : 'in',
          },
        }).catch(() => {})
      } else if (entry.finding && (input.key === 'Escape' || input.key === 'Enter')) {
        event.preventDefault()
        if (input.key === 'Escape') {
          guest.stopFindInPage('clearSelection')
          entry.finding = false
          this.#utilityEvent(entry, { kind: 'find-close' })
        } else if (entry.findText)
          entry.findRequestId = guest.findInPage(entry.findText, {
            forward: !input.shift,
            findNext: true,
          })
      }
    })
    guest.session.setPermissionCheckHandler(() => false)
    guest.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    guest.setWindowOpenHandler(({ url }) => {
      if (isAllowedDesktopBrowserNavigation(url)) {
        const normalized = normalizeDesktopBrowserUrl(url).url
        if (entry.tab.controlThreadId && !this.#allowed(host, normalized, entry)) {
          void this.#report(entry, { error: `站点需要授权：${new URL(normalized).origin}` })
          return { action: 'deny' }
        }
        void this.#rpc
          .call('browser/create', {
            tabId: randomUUID(),
            windowId: host.windowId,
            sourceThreadId: entry.tab.sourceThreadId,
            url: normalized,
          })
          .then(async (tab) => {
            if (entry.tab.controlThreadId)
              await this.#rpc.call('browser/control', {
                tabId: tab.tabId,
                threadId: entry.tab.controlThreadId,
              })
            await this.list(owner)
          })
          .catch(() => {})
      }
      return { action: 'deny' }
    })
    const intercept = (event: Electron.Event, url: string) => {
      if (
        !isAllowedDesktopBrowserNavigation(url) ||
        (entry.tab.controlThreadId && !this.#allowed(host, url, entry))
      ) {
        event.preventDefault()
        void this.#report(entry, {
          error: isAllowedDesktopBrowserNavigation(url)
            ? `站点需要授权：${new URL(url).origin}`
            : '此网址不受支持',
        })
      }
    }
    guest.on('will-navigate', intercept)
    guest.on('will-redirect', intercept)
    guest.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame && entry.tab.controlThreadId && !this.#allowed(host, event.url, entry))
        event.preventDefault()
    })
    guest.on('did-start-loading', () => void this.#report(entry, { loading: true, error: null }))
    guest.on('did-start-navigation', (_event, _url, _inPlace, main) => {
      if (main) this.#annotations.stop(guest)
    })
    guest.on('did-stop-loading', () => void this.#navigationReport(entry, false))
    const navigated = () => {
      this.#annotations.stop(guest)
      entry.tab = { ...entry.tab, documentId: randomUUID() }
      if (entry.initialized && /^https?:/.test(guest.getURL())) {
        entry.visit = {
          id: randomUUID(),
          visitedAt: Date.now(),
          historyEpoch: entry.tab.historyEpoch ?? 0,
          url: guest.getURL(),
        }
        void this.#recordVisit(entry, false)
      }
      void this.#navigationReport(entry)
    }
    guest.on('did-navigate', navigated)
    guest.on('did-navigate-in-page', (_event, _url, main) => {
      if (main) navigated()
    })
    guest.on('page-title-updated', () => {
      void this.#navigationReport(entry)
      void this.#recordVisit(entry, true)
    })
    guest.on('zoom-changed', (_event, direction) => {
      void this.utility(entry.owner, {
        tabId: entry.tab.tabId,
        generation: entry.tab.generation,
        operation: { action: 'zoom', direction },
      }).catch(() => {})
    })
    guest.on('media-started-playing', () => {
      entry.audio = true
    })
    guest.on('media-paused', () => {
      entry.audio = false
      void this.#budget(host)
    })
    guest.on('render-process-gone', () => {
      this.#annotations.stop(guest)
      entry.abort?.abort()
      entry.contents = undefined
      void this.#report(entry, {
        state: 'crashed',
        loading: false,
        error: '页面进程已退出，点击重试恢复',
      })
    })
    guest.on('did-fail-load', (_event, code, _description, _url, main) => {
      if (main && code !== -3) void this.#report(entry, { loading: false, error: '页面加载失败' })
    })
    const snapshot = entry.tab
    if (snapshot.device && snapshot.device.mode !== 'desktop') {
      await applyBrowserDevice(guest, snapshot.device, entry.defaultUserAgent)
      entry.emulated = true
    }
    entry.initialized = !snapshot.history?.length
    try {
      if (snapshot.history?.length)
        await guest.navigationHistory.restore({
          entries: snapshot.history.map((e) => ({ ...e })),
          index: snapshot.historyIndex ?? snapshot.history.length - 1,
        })
      else await guest.loadURL(snapshot.url)
    } catch {
      /* Guest events own the retry state. */
    }
    if (entry.tab.generation !== generation || guest.isDestroyed()) return
    if (snapshot.zoomFactor) guest.setZoomFactor(snapshot.zoomFactor)
    await this.#report(entry, {
      state: entry.visible ? 'live' : 'parked',
      zoomFactor: guest.getZoomFactor(),
    })
    entry.initialized = true
    for (const ready of entry.ready) ready()
    entry.ready.clear()
    void this.#budget(host)
  }
  async navigate(owner: BrowserWindow, tabId: string, url: string) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    await this.#activate(entry)
    try {
      await (await this.#ready(entry)).loadURL(normalizeDesktopBrowserUrl(url).url)
    } catch {
      /* Guest events report errors. */
    }
    return this.#snapshot(entry)
  }
  async reload(owner: BrowserWindow, tabId: string) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    await this.#activate(entry)
    ;(await this.#ready(entry)).reload()
    return this.#snapshot(entry)
  }
  async stop(owner: BrowserWindow, tabId: string) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    entry.contents?.stop()
    return this.#snapshot(entry)
  }
  async goBack(owner: BrowserWindow, tabId: string) {
    return this.#history(owner, tabId, -1)
  }
  async goForward(owner: BrowserWindow, tabId: string) {
    return this.#history(owner, tabId, 1)
  }
  async #history(owner: BrowserWindow, tabId: string, offset: number) {
    const entry = this.#require(owner, tabId)
    await this.control(owner, tabId, null)
    await this.#activate(entry)
    const guest = await this.#ready(entry)
    if (guest.navigationHistory.canGoToOffset(offset)) guest.navigationHistory.goToOffset(offset)
    return this.#snapshot(entry)
  }
  async setBounds(owner: BrowserWindow, tabId: string, _bounds: DesktopBrowserBounds) {
    return this.getState(owner, tabId)
  }
  async setVisible(owner: BrowserWindow, tabId: string, visible: boolean) {
    // A panel's visibility notification may arrive after the tab was closed.
    if (!this.#entries.has(tabId)) return this.#empty(tabId, owner)
    const entry = this.#require(owner, tabId)
    entry.visible = visible
    if (visible) {
      await this.#activate(entry)
      await this.#report(entry, { lastUsedAt: Date.now(), state: 'live' })
    } else if (entry.contents) await this.#report(entry, { state: 'parked' })
    void this.#budget(this.#hosts.get(owner.id)!)
    return this.#snapshot(entry)
  }
  focus(owner: BrowserWindow, tabId: string) {
    this.#require(owner, tabId).contents?.focus()
  }
  async close(owner: BrowserWindow, tabId: string) {
    const entry = this.#require(owner, tabId)
    await this.#rpc.call('browser/close', { tabId })
    this.#destroy(entry)
    this.#entries.delete(tabId)
    const empty = this.#empty(tabId, owner)
    this.options.publish(owner, empty)
    return empty
  }
  async control(owner: BrowserWindow, tabId: string, threadId: string | null) {
    const entry = this.#require(owner, tabId)
    if (threadId) this.#annotations.stop(entry.contents)
    entry.abort?.abort()
    entry.tab = await this.#rpc.call('browser/control', { tabId, threadId })
    await entry.executing
    this.#publish(entry)
    return this.#snapshot(entry)
  }
  async layout(owner: BrowserWindow, tabId: string, panel: 'right' | 'bottom', order: number) {
    const entry = this.#require(owner, tabId)
    entry.tab = await this.#rpc.call('browser/layout', { tabId, panel, order })
    this.#publish(entry)
  }
  async permission(owner: BrowserWindow, origin: string, decision: 'allow' | 'deny' | 'remove') {
    const host = await this.#ensureHost(owner)
    const result = await this.#rpc.call('browser/permissions', { origin, decision })
    host.permissions = result.permissions.map((p) => ({ ...p }))
    for (const e of this.#owned(host)) this.#publish(e)
    return host.permissions
  }
  async clearAllowedSites(owner: BrowserWindow, tabId: string) {
    const host = await this.#ensureHost(owner)
    await this.#rpc.call('browser/permissions', { decision: 'clear' })
    host.permissions = []
    for (const e of this.#owned(host)) this.#publish(e)
    return this.getState(owner, tabId)
  }
  async annotation(owner: BrowserWindow, input: DesktopBrowserAnnotationInput) {
    const entry = this.#require(owner, input.tabId)
    const valid = () =>
      !owner.isDestroyed() &&
      this.#entries.get(input.tabId) === entry &&
      entry.tab.generation === input.generation &&
      entry.tab.documentId === input.documentId &&
      !entry.tab.controlThreadId
    if (entry.tab.generation !== input.generation || entry.tab.documentId !== input.documentId)
      throw new Error('网页已变化，请重新选择')
    if (input.operation.action === 'start' && entry.tab.controlThreadId)
      await this.control(owner, input.tabId, null)
    const guest = await this.#ready(entry)
    if (!valid()) throw new Error('网页已变化，请重新选择')
    entry.capturing = input.operation.action === 'capture'
    try {
      return await this.#annotations.perform(
        guest,
        input,
        input,
        () => valid() && entry.contents === guest,
        (event) => {
          if (!owner.isDestroyed())
            owner.webContents.send(DESKTOP_BROWSER_IPC_CHANNELS.annotationEvent, event)
        },
      )
    } finally {
      entry.capturing = false
    }
  }
  async utility(
    owner: BrowserWindow,
    input: DesktopBrowserUtilityInput,
  ): Promise<DesktopBrowserUtilityResult> {
    const entry = this.#require(owner, input.tabId)
    if (entry.tab.generation !== input.generation) throw new Error('浏览器页面已失效')
    const operation = input.operation
    if (['zoom', 'device'].includes(operation.action) && entry.tab.controlThreadId)
      await this.control(owner, input.tabId, null)
    await this.#activate(entry)
    if (entry.tab.generation !== input.generation) throw new Error('网页已恢复，请重试操作')
    const guest = await this.#ready(entry)
    if (operation.action === 'device') {
      await applyBrowserDevice(
        guest,
        operation.device,
        entry.defaultUserAgent ?? guest.getUserAgent(),
      )
      entry.emulated = operation.device.mode !== 'desktop'
      await this.#report(entry, {
        device: operation.device,
        viewport: { width: operation.device.width, height: operation.device.height },
      })
      return {}
    }
    if (operation.action === 'find') {
      entry.finding = true
      entry.findText = operation.text
    }
    if (operation.action === 'stopFind') entry.finding = false
    if (entry.tab.busy && ['print', 'screenshot'].includes(operation.action))
      throw new Error('Agent 操作中，请先接管网页')
    entry.capturing = operation.action === 'screenshot'
    try {
      const result = await runBrowserUtility(owner, guest, operation)
      if (operation.action === 'find') entry.findRequestId = result.requestId
      if (operation.action === 'zoom') {
        for (const other of this.#entries.values())
          if (other.contents && new URL(other.tab.url).origin === new URL(entry.tab.url).origin)
            await this.#report(other, { zoomFactor: other.contents.getZoomFactor() })
      }
      return result
    } catch (error) {
      if (error instanceof Error && /^(打印未完成|截图为空)/.test(error.message)) throw error
      throw new Error('浏览器操作未完成')
    } finally {
      entry.capturing = false
    }
  }
  async data(
    owner: BrowserWindow,
    request: DesktopBrowserDataRequest,
  ): Promise<DesktopBrowserDataResult> {
    await this.#ensureHost(owner)
    switch (request.action) {
      case 'history':
        return this.#rpc.call('browser/history/list', {
          ...(request.query ? { query: request.query } : {}),
          ...(request.cursor ? { cursor: request.cursor } : {}),
        })
      case 'removeHistory':
        await this.#rpc.call('browser/history/remove', { id: request.id })
        this.#dataChanged()
        return {}
      case 'downloads':
        return {
          downloads: this.#downloads.decorate(
            (await this.#rpc.call('browser/downloads/list', {})).downloads,
          ),
        }
      case 'downloadAction':
        await this.#downloads.action(request.id, request.command)
        return {}
      case 'preferences': {
        const result = request.downloadSaveMode
          ? await this.#rpc.call('browser/preferences/set', {
              downloadSaveMode: request.downloadSaveMode,
            })
          : await this.#rpc.call('browser/preferences/get', {})
        this.#downloads.setSaveMode(result.downloadSaveMode)
        return { preferences: result }
      }
      case 'clear': {
        const cleared: NonNullable<DesktopBrowserDataResult['cleared']> = []
        for (const category of request.categories) {
          try {
            if (category === 'history') {
              await this.#rpc.call('browser/history/remove', {})
              for (const host of this.#hosts.values())
                if (!host.stopped) await this.list(host.owner)
            } else if (category === 'downloads')
              await this.#rpc.call('browser/downloads/remove', {})
            else if (category === 'cache')
              await session
                .fromPartition('persist:pidex-browser')
                .clearData({ dataTypes: ['cache'] })
            else {
              for (const entry of this.#entries.values())
                if (entry.tab.controlThreadId)
                  await this.control(entry.owner, entry.tab.tabId, null)
              await session.fromPartition('persist:pidex-browser').clearData({
                dataTypes: [
                  'cookies',
                  'fileSystems',
                  'indexedDB',
                  'localStorage',
                  'serviceWorkers',
                  'webSQL',
                  'backgroundFetch',
                ],
              })
            }
            cleared.push({
              category,
              ok: true,
              ...(category === 'siteData' ? { message: '站点数据已清除，请按需刷新网页' } : {}),
            })
          } catch {
            cleared.push({ category, ok: false, message: '此项清理未完成，可以重试' })
          }
        }
        this.#dataChanged()
        return { cleared }
      }
    }
  }
  #utilityEvent(entry: Entry, event: Omit<DesktopBrowserUtilityEvent, 'tabId' | 'generation'>) {
    if (!entry.owner.isDestroyed())
      entry.owner.webContents.send(DESKTOP_BROWSER_IPC_CHANNELS.utilityEvent, {
        ...event,
        tabId: entry.tab.tabId,
        generation: entry.tab.generation,
      })
  }
  #dataChanged() {
    for (const host of this.#hosts.values())
      if (!host.owner.isDestroyed())
        host.owner.webContents.send(DESKTOP_BROWSER_IPC_CHANNELS.dataChanged)
  }
  async #recordVisit(entry: Entry, updateOnly: boolean) {
    const visit = entry.visit
    const guest = entry.contents
    const host = this.#hosts.get(entry.owner.id)
    if (!visit || !guest || !host || !this.#rpc.capabilities.has('browser.data.v1')) return
    const generation = entry.tab.generation
    const title = guest.getTitle().slice(0, 500)
    entry.reporting = entry.reporting
      .catch(() => {})
      .then(async () => {
        await this.#rpc.call('browser/host/visit', {
          windowId: host.windowId,
          instanceId: host.instanceId,
          generation,
          historyEpoch: visit.historyEpoch,
          updateOnly,
          visit: {
            id: visit.id,
            visitedAt: visit.visitedAt,
            url: visit.url,
            tabId: entry.tab.tabId,
            sourceThreadId: entry.tab.sourceThreadId,
            title,
          },
        })
        this.#dataChanged()
      })
      .catch(() => {})
    await entry.reporting
  }
  suspendAll() {
    this.#rpc.invalidate()
    for (const host of this.#hosts.values()) {
      host.registered = false
      for (const entry of this.#owned(host)) {
        entry.abort?.abort()
        this.#detach(entry)
      }
    }
  }
  dispose() {
    this.#downloads.dispose()
    for (const host of this.#hosts.values()) {
      host.stopped = true
      clearTimeout(host.pollTimer)
      clearInterval(host.budgetTimer)
      void this.#rpc
        .call('browser/host/release', { windowId: host.windowId, instanceId: host.instanceId })
        .catch(() => {})
    }
    for (const e of this.#entries.values()) this.#destroy(e)
    this.#hosts.clear()
    this.#entries.clear()
  }
  #require(owner: BrowserWindow, tabId: string) {
    const entry = this.#entries.get(tabId)
    if (!entry || entry.owner !== owner) throw new Error('浏览器标签不属于当前窗口')
    return entry
  }
  #owned(host: WindowHost) {
    return [...this.#entries.values()].filter((e) => e.owner === host.owner)
  }
  #allowed(host: WindowHost, url: string, entry?: Entry) {
    if (url === 'about:blank' || url === 'about:srcdoc') return true
    try {
      const origin = new URL(url).origin
      if (
        host.permissions.some((p) => p.origin === origin && p.decision === 'deny') ||
        entry?.agentAuthorization?.deniedOrigins?.includes(origin)
      )
        return false
      return (
        host.permissions.some((p) => p.origin === origin && p.decision === 'allow') ||
        (!!entry?.agentAuthorization &&
          entry.agentAuthorization.generation === entry.tab.generation &&
          (entry.agentAuthorization.allowAllSites === true ||
            entry.agentAuthorization.allowedOrigins.includes(origin)))
      )
    } catch {
      return false
    }
  }
  async #ensureHost(owner: BrowserWindow) {
    let host = this.#hosts.get(owner.id)
    if (!host) {
      host = {
        owner,
        windowId: `window:${owner.id}`,
        instanceId: randomUUID(),
        stopped: false,
        registered: false,
        polling: false,
        attached: new Set(),
        permissions: [],
      }
      this.#hosts.set(owner.id, host)
      const budgetHost = host
      host.budgetTimer = setInterval(() => void this.#budget(budgetHost), 60_000)
      owner.webContents.on('will-attach-webview', (event, preferences, params) => {
        if (params.partition !== 'persist:pidex-browser' || params.src !== 'about:blank') {
          event.preventDefault()
          return
        }
        delete preferences.preload
        Object.assign(preferences, {
          session: undefined,
          partition: 'persist:pidex-browser',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          devTools: false,
          backgroundThrottling: false,
        })
      })
      owner.webContents.on('did-attach-webview', (_event, guest) => {
        host!.attached.add(guest.id)
        guest.once('destroyed', () => host!.attached.delete(guest.id))
      })
      owner.once('closed', () => {
        host!.stopped = true
        clearTimeout(host!.pollTimer)
        clearInterval(host!.budgetTimer)
        for (const e of this.#owned(host!)) {
          this.#destroy(e)
          this.#entries.delete(e.tab.tabId)
        }
        this.#hosts.delete(owner.id)
        void this.#rpc
          .call('browser/host/release', { windowId: host!.windowId, instanceId: host!.instanceId })
          .catch(() => {})
      })
      owner.webContents.on('did-start-navigation', (_event, _url, inPlace, main) => {
        if (main && !inPlace) {
          for (const e of this.#owned(host!)) {
            this.#destroy(e)
            e.tab = { ...e.tab, state: 'suspended' }
          }
          host!.instanceId = randomUUID()
          host!.registered = false
        }
      })
    }
    if (!host.registered) {
      const current = host
      current.registering ??= this.#rpc
        .call('browser/host/register', {
          windowId: current.windowId,
          instanceId: current.instanceId,
        })
        .then(async (result) => {
          const catalog = await this.#rpc.call('browser/list', {})
          current.permissions = catalog.permissions.map((p) => ({ ...p }))
          this.#sync(current, result.tabs)
          current.registered = true
          if (!current.polling) {
            current.polling = true
            this.#poll(current)
          }
        })
        .finally(() => {
          current.registering = undefined
        })
      await current.registering
    }
    return host
  }
  #poll(host: WindowHost) {
    if (host.stopped) return
    const instanceId = host.instanceId
    void this.#rpc
      .call('browser/host/next', { windowId: host.windowId, instanceId })
      .then((result) => {
        if (instanceId !== host.instanceId) return
        host.permissions = result.permissions.map((p) => ({ ...p }))
        if (result.dataRevision !== host.dataRevision) {
          host.dataRevision = result.dataRevision
          this.#dataChanged()
        }
        this.#sync(host, result.tabs)
        if (result.command) {
          const entry = this.#entries.get(result.command.tabId)
          if (entry) {
            const executing = this.#execute(host, result.command)
            entry.executing = executing
            void executing.finally(() => {
              if (entry.executing === executing) entry.executing = undefined
            })
          }
        }
      })
      .catch(() => {
        if (instanceId !== host.instanceId) return
        host.registered = false
        for (const e of this.#owned(host)) e.abort?.abort()
      })
      .finally(() => {
        if (host.stopped) return
        host.pollTimer = setTimeout(
          () => {
            if (host.registered) this.#poll(host)
            else
              void this.#ensureHost(host.owner)
                .finally(() => this.#poll(host))
                .catch(() => {})
          },
          host.registered ? 0 : 1000,
        )
      })
  }
  #sync(host: WindowHost, tabs: readonly BrowserTab[]) {
    const ids = new Set(tabs.map((t) => t.tabId))
    for (const entry of this.#owned(host))
      if (!ids.has(entry.tab.tabId)) {
        this.#destroy(entry)
        this.#entries.delete(entry.tab.tabId)
        this.options.publish(host.owner, this.#empty(entry.tab.tabId, host.owner))
      }
    for (const tab of tabs) {
      let entry = this.#entries.get(tab.tabId)
      if (!entry) {
        entry = {
          tab,
          owner: host.owner,
          visible: false,
          audio: false,
          capturing: false,
          initialized: false,
          emulated: false,
          ready: new Set(),
          reporting: Promise.resolve(),
        }
        this.#entries.set(tab.tabId, entry)
      } else {
        if (tab.revision < entry.tab.revision) continue
        if (tab.controlThreadId || entry.tab.documentId !== tab.documentId)
          this.#annotations.stop(entry.contents)
        if (entry.tab.generation !== tab.generation || tab.state === 'suspended')
          this.#destroy(entry)
        if (entry.abort && (!tab.busy || entry.tab.controlThreadId !== tab.controlThreadId))
          entry.abort.abort()
        if ((entry.tab.historyEpoch ?? 0) !== (tab.historyEpoch ?? 0)) {
          entry.contents?.navigationHistory.clear()
          entry.visit = undefined
        }
        entry.tab = tab
      }
      this.#publish(entry)
    }
  }
  async #activate(entry: Entry) {
    if (entry.activating) return entry.activating
    if (entry.tab.state !== 'suspended' && entry.tab.state !== 'crashed') {
      this.#publish(entry)
      return
    }
    const host = this.#hosts.get(entry.owner.id)!
    const { tabId, generation } = entry.tab
    this.#destroy(entry)
    entry.activating = this.#rpc
      .call('browser/host/restore', {
        windowId: host.windowId,
        instanceId: host.instanceId,
        tabId,
        generation,
      })
      .then((tab) => {
        if (this.#entries.get(tabId) === entry && tab.revision >= entry.tab.revision) {
          entry.tab = tab
          this.#publish(entry)
        }
      })
      .finally(() => {
        entry.activating = undefined
      })
    await entry.activating
  }
  async #ready(entry: Entry): Promise<WebContents> {
    if (entry.initialized && entry.contents && !entry.contents.isDestroyed()) return entry.contents
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer)
        entry.ready.delete(ready)
        resolve()
      }
      const timer = setTimeout(() => {
        entry.ready.delete(ready)
        reject(new Error('网页宿主连接超时'))
      }, 20_000)
      entry.ready.add(ready)
    })
    if (!entry.contents || entry.contents.isDestroyed()) throw new Error('网页已退出')
    return entry.contents
  }
  async #report(entry: Entry, patch: Record<string, unknown>) {
    const host = this.#hosts.get(entry.owner.id)
    if (!host || host.stopped) return
    const generation = entry.tab.generation
    entry.reporting = entry.reporting
      .catch(() => {})
      .then(async () => {
        if (!this.#entries.has(entry.tab.tabId) || generation !== entry.tab.generation) return
        const tab = await this.#rpc.call('browser/host/report', {
          windowId: host.windowId,
          instanceId: host.instanceId,
          tabId: entry.tab.tabId,
          generation,
          patch: patch as never,
        })
        if (entry.tab.generation === generation && tab.revision >= entry.tab.revision) {
          entry.tab = tab
          this.#publish(entry)
        }
      })
      .catch(() => {})
    await entry.reporting
  }
  async #navigationReport(entry: Entry, loading?: boolean) {
    const guest = entry.contents
    if (!guest || guest.isDestroyed()) return
    await this.#report(entry, {
      url: guest.getURL() || entry.tab.url,
      title: guest.getTitle().slice(0, 500),
      loading: loading ?? guest.isLoading(),
      documentId: entry.tab.documentId,
      canGoBack: guest.navigationHistory.canGoBack(),
      canGoForward: guest.navigationHistory.canGoForward(),
      history: guest.navigationHistory.getAllEntries().map(({ url, title }) => ({ url, title })),
      historyIndex: guest.navigationHistory.getActiveIndex(),
      historyEpoch: entry.tab.historyEpoch ?? 0,
      zoomFactor: guest.getZoomFactor(),
    })
  }
  async #execute(host: WindowHost, command: BrowserCommand) {
    const entry = this.#entries.get(command.tabId)
    if (
      !entry ||
      entry.tab.generation !== command.generation ||
      entry.owner !== host.owner ||
      !entry.tab.busy ||
      !entry.tab.controlThreadId
    )
      return
    const abort = new AbortController()
    entry.abort = abort
    entry.agentAuthorization = command
    let result: BrowserResult | undefined
    let error: string | undefined
    let operationGuest: WebContents | undefined
    let temporaryViewport = false
    try {
      await this.#activate(entry)
      const guest = await this.#ready(entry)
      operationGuest = guest
      abort.signal.throwIfAborted()
      clearTimeout(entry.idle)
      entry.capturing = command.operation.action === 'screenshot'
      abort.signal.addEventListener(
        'abort',
        () => {
          if (guest.isDestroyed()) return
          guest.stop()
          if (guest.debugger.isAttached())
            void guest.debugger.sendCommand('Runtime.terminateExecution').catch(() => {})
        },
        { once: true },
      )
      if (entry.capturing && !entry.visible && !entry.emulated) {
        if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
        await guest.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
          ...entry.tab.viewport,
          deviceScaleFactor: 1,
          mobile: false,
        })
        temporaryViewport = true
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (command.operation.action === 'viewport')
        await applyBrowserDevice(
          guest,
          { mode: 'custom', width: command.operation.width!, height: command.operation.height! },
          entry.defaultUserAgent ?? guest.getUserAgent(),
        )
      abort.signal.throwIfAborted()
      result = await runBrowserOperation(guest, command, () => entry.tab.documentId, abort.signal)
      if (command.operation.action === 'viewport') {
        entry.emulated = true
        await this.#report(entry, {
          viewport: { width: command.operation.width!, height: command.operation.height! },
          device: {
            mode: 'custom',
            width: command.operation.width!,
            height: command.operation.height!,
          },
        })
      }
    } catch (cause) {
      error = abort.signal.aborted
        ? '浏览器操作已取消'
        : cause instanceof Error &&
            /^(站点需要授权|元素引用已过期|缺少|此 iframe|页面 frame|截图为空|此元素|视口尺寸)/.test(
              cause.message,
            )
          ? cause.message
          : '浏览器操作未完成，请检查页面并重新读取快照'
    } finally {
      if (
        temporaryViewport &&
        operationGuest &&
        !operationGuest.isDestroyed() &&
        operationGuest.debugger.isAttached()
      )
        await operationGuest.debugger
          .sendCommand('Emulation.clearDeviceMetricsOverride')
          .catch(() => {})
      const current = entry.tab.generation === command.generation && entry.abort === abort
      if (current) {
        entry.capturing = false
        entry.abort = undefined
        entry.agentAuthorization = undefined
        await this.#navigationReport(entry)
      }
      await this.#rpc
        .call('browser/host/complete', {
          windowId: host.windowId,
          instanceId: host.instanceId,
          requestId: command.requestId,
          generation: command.generation,
          ...(result ? { result } : {}),
          ...(error ? { error } : {}),
        })
        .catch(() => {})
      if (current)
        entry.idle = setTimeout(() => {
          if (!entry.abort && !entry.emulated) this.#detach(entry)
        }, 1500)
      void this.#budget(host)
    }
  }
  async #budget(host: WindowHost) {
    if (!host || host.stopped || host.budgeting) return
    host.budgeting = true
    try {
      const entries = this.#owned(host).filter((e) => e.contents && !e.contents.isDestroyed())
      const protectedChats = new Set<string | null>()
      const candidates = entries
        .filter(
          (e) =>
            !e.visible &&
            !e.tab.busy &&
            !e.abort &&
            !e.capturing &&
            !this.#annotations.active(e.contents) &&
            !e.audio &&
            !e.tab.loading &&
            !this.#downloads.activeForTab(e.tab.tabId),
        )
        .sort((a, b) => b.tab.lastUsedAt - a.tab.lastUsedAt)
        .filter((e) => {
          const latest = !protectedChats.has(e.tab.sourceThreadId)
          protectedChats.add(e.tab.sourceThreadId)
          return !(latest && Date.now() - e.tab.lastUsedAt < 30 * 60_000)
        })
        .sort((a, b) => a.tab.lastUsedAt - b.tab.lastUsedAt)
      for (const entry of candidates.slice(0, Math.max(0, entries.length - 32))) {
        await this.#navigationReport(entry)
        if (entry.visible || entry.tab.busy || entry.abort || entry.audio || entry.tab.loading)
          continue
        this.#destroy(entry)
        await this.#report(entry, { state: 'suspended', loading: false })
      }
    } finally {
      host.budgeting = false
    }
  }
  #detach(entry: Entry) {
    if (this.#annotations.active(entry.contents)) return
    if (entry.contents?.debugger.isAttached()) entry.contents.debugger.detach()
  }
  #destroy(entry: Entry) {
    this.#annotations.stop(entry.contents)
    clearTimeout(entry.idle)
    entry.abort?.abort()
    entry.abort = undefined
    entry.capturing = false
    entry.emulated = false
    entry.audio = false
    this.#detach(entry)
    if (entry.contents && !entry.contents.isDestroyed())
      entry.contents.close({ waitForBeforeUnload: false })
    entry.contents = undefined
    entry.initialized = false
    for (const ready of entry.ready) ready()
    entry.ready.clear()
  }
  #snapshot(entry: Entry): DesktopBrowserSnapshot {
    const permissions = this.#hosts.get(entry.owner.id)?.permissions ?? []
    return {
      ...entry.tab,
      open: true,
      features: {
        utilities: true,
        data: this.#rpc.capabilities.has('browser.data.v1'),
        annotations: true,
      },
      allowedSites: permissions.filter((p) => p.decision === 'allow').map((p) => p.origin),
      sitePermissions: permissions.map((p) => ({ ...p })),
    }
  }
  #empty(tabId: string, owner: BrowserWindow): DesktopBrowserSnapshot {
    const permissions = this.#hosts.get(owner.id)?.permissions ?? []
    return {
      tabId,
      open: false,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      allowedSites: permissions.filter((p) => p.decision === 'allow').map((p) => p.origin),
      sitePermissions: permissions,
    }
  }
  #publish(entry: Entry) {
    if (!entry.owner.isDestroyed()) this.options.publish(entry.owner, this.#snapshot(entry))
  }
}
