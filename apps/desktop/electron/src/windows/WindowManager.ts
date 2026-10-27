import {
  DESKTOP_STARTUP_IPC_CHANNELS,
  type DesktopStartupSnapshot,
} from '@pidex/shared/desktop-startup-ipc'
import { installVisualizationIsolation } from '../security/VisualizationIsolation.js'
import { join, resolve } from 'node:path'
import {
  DESKTOP_WINDOW_IPC_CHANNELS,
  type DesktopOpenWindowInput,
  type DesktopPageZoomAction,
  type DesktopPageZoomState,
  type DesktopResizeActivityPhase,
} from '@pidex/shared/desktop-window-ipc'
import { app, BrowserWindow, screen, shell, type WebContents } from 'electron'
import type { DesktopChromeTheme } from '@pidex/shared/desktop-theme'
import type { DesktopLogger } from '../logging/DesktopLogger.js'
import { rendererConsoleRecord } from '../logging/RendererConsole.js'
import {
  isAllowedApplicationUrl,
  isApplicationOriginUrl,
  isSafeExternalUrl,
  normalizeOrigin,
} from '../security/Navigation.js'
import { createRendererApplicationUrl, type StartupStatusKind } from './StartupPage.js'
import {
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  type DesktopWindowBounds,
  type DesktopWindowStateV1,
  WindowStateStore,
} from './WindowState.js'
import { isDevToolsShortcut } from './DevtoolsShortcut.js'
import { nextPageZoomPercent, pageZoomState, resolvePageZoomShortcut } from './PageZoom.js'
import { createWindowsTitleBarOverlay } from './TitleBarOverlay.js'

const APPLICATION_LOAD_TIMEOUT_MS = 20_000
/** 取消拖拽后 "resized" 不再触发，用静默间隔补齐一次 resize end。 */
const RESIZE_SETTLE_MS = 300

export interface WindowManagerOptions {
  initialWindowState: DesktopWindowStateV1
  startupTheme: {
    variant: 'light' | 'dark'
    theme: Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'> & {
      surfaceUnder: string
    }
  }
  windowStateStore: WindowStateStore
}

export class WindowManager {
  readonly #logger: DesktopLogger
  readonly #moduleDirectory: string
  readonly #options: WindowManagerOptions
  readonly #applicationWindows = new Map<number, BrowserWindow>()
  #primaryWindowId: number | undefined
  #focusedWindowId: number | undefined
  #normalWindowBounds: DesktopWindowBounds
  #allowedApplicationOrigin: string | undefined
  #navigationGeneration = 0
  #pageZoomPercent: number
  #startupSnapshot: DesktopStartupSnapshot = {
    generation: 0,
    revision: 0,
    state: 'loading',
    label: '正在启动…',
  }

  constructor(logger: DesktopLogger, moduleDirectory: string, options: WindowManagerOptions) {
    this.#logger = logger
    this.#moduleDirectory = moduleDirectory
    this.#options = options
    this.#normalWindowBounds = options.initialWindowState.bounds
    this.#pageZoomPercent = options.initialWindowState.zoomPercent
  }

  get mainWindow(): BrowserWindow | undefined {
    return this.#windowById(this.#primaryWindowId)
  }

  get focusedWindow(): BrowserWindow | undefined {
    return this.#windowById(this.#focusedWindowId) ?? this.mainWindow
  }

  get applicationOrigin(): string | undefined {
    return this.#allowedApplicationOrigin
  }

  isMainSender(sender: WebContents): boolean {
    return this.isApplicationSender(sender)
  }

  isApplicationSender(sender: WebContents): boolean {
    return this.windowForSender(sender) !== undefined
  }

  getPageZoom(): DesktopPageZoomState {
    return pageZoomState(this.#pageZoomPercent)
  }

  changePageZoom(action: DesktopPageZoomAction): DesktopPageZoomState {
    this.#pageZoomPercent = nextPageZoomPercent(this.#pageZoomPercent, action)
    for (const window of this.#applicationWindows.values()) {
      if (!window.isDestroyed()) {
        window.webContents.setZoomFactor(this.#pageZoomPercent / 100)
      }
    }
    this.#scheduleWindowState()
    const state = this.getPageZoom()
    this.broadcast(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged, state)
    return state
  }

  windowForSender(sender: WebContents): BrowserWindow | undefined {
    for (const window of this.#applicationWindows.values()) {
      if (!window.isDestroyed() && window.webContents === sender) return window
    }
    return undefined
  }

  requireApplicationWindow(sender: WebContents): BrowserWindow {
    const window = this.windowForSender(sender)
    if (!window) throw new Error('IPC 调用来源无效')
    return window
  }

  flushWindowState(): Promise<void> {
    return this.#options.windowStateStore.flush()
  }

  focus(_connectionIsReady: boolean): void {
    this.#focusWindow(this.focusedWindow)
  }

  get startupSnapshot(): DesktopStartupSnapshot {
    return this.#startupSnapshot
  }

  showStartupStatus(
    status: string,
    _detail = '',
    kind: StartupStatusKind = 'progress',
    generation = this.#startupSnapshot.generation,
  ): void {
    this.publishStartupState({
      generation,
      state: kind === 'terminal-error' ? 'failed' : 'loading',
      label: status,
    })
  }

  publishStartupState(snapshot: Omit<DesktopStartupSnapshot, 'revision'>): void {
    this.#startupSnapshot = { ...snapshot, revision: this.#startupSnapshot.revision + 1 }
    this.broadcast(DESKTOP_STARTUP_IPC_CHANNELS.changed, this.#startupSnapshot)
  }

  async loadApplication(applicationOriginInput: string): Promise<void> {
    const navigationGeneration = ++this.#navigationGeneration
    const mainWindow = this.#ensureMainWindow()
    mainWindow.once('ready-to-show', () => {
      if (!mainWindow.isDestroyed()) mainWindow.show()
    })
    const applicationOrigin = normalizeOrigin(applicationOriginInput)
    const applicationUrl = createRendererApplicationUrl(
      applicationOrigin,
      this.#options.startupTheme,
    )
    this.#allowedApplicationOrigin = applicationOrigin
    this.#setThemeBackground(mainWindow)
    try {
      await new Promise<void>((resolveLoad, rejectLoad) => {
        const timer = setTimeout(() => {
          cleanup()
          mainWindow.webContents.stop()
          this.#logger.error('desktop.page-load-timeout', {
            origin: this.#allowedApplicationOrigin,
            timeoutMs: APPLICATION_LOAD_TIMEOUT_MS,
          })
          rejectLoad(new Error(`Renderer 页面加载超时（${APPLICATION_LOAD_TIMEOUT_MS / 1_000}s）`))
        }, APPLICATION_LOAD_TIMEOUT_MS)
        const onFinished = () => {
          if (!isApplicationOriginUrl(mainWindow.webContents.getURL(), applicationOrigin)) {
            return
          }
          cleanup()
          this.#logger.info('desktop.application-document-loaded')
          resolveLoad()
        }
        const onFailed = (
          _event: Electron.Event,
          errorCode: number,
          errorDescription: string,
          validatedURL: string,
          isMainFrame: boolean,
        ) => {
          if (!isMainFrame) return
          if (!isApplicationOriginUrl(validatedURL, applicationOrigin)) return
          cleanup()
          this.#logger.error('desktop.page-load-failed', {
            errorCode,
            errorDescription,
            validatedURL,
          })
          rejectLoad(new Error(`Renderer 页面加载失败：${errorDescription} (${errorCode})`))
        }
        const cleanup = () => {
          clearTimeout(timer)
          mainWindow.webContents.removeListener('did-finish-load', onFinished)
          mainWindow.webContents.removeListener('did-fail-load', onFailed)
        }
        mainWindow.webContents.on('did-finish-load', onFinished)
        mainWindow.webContents.on('did-fail-load', onFailed)
        void mainWindow.loadURL(applicationUrl).catch((error) => {
          cleanup()
          rejectLoad(error)
        })
      })
      if (navigationGeneration !== this.#navigationGeneration) {
        throw new Error('Renderer 页面加载已被新的导航替代')
      }
    } catch (error) {
      if (navigationGeneration === this.#navigationGeneration && !mainWindow.isDestroyed()) {
        this.#logger.error('desktop.application-document-failed')
      }
      throw error
    }
  }

  send(channel: string, ...args: unknown[]): void {
    this.sendToFocused(channel, ...args)
  }

  sendToFocused(channel: string, ...args: unknown[]): void {
    const window = this.focusedWindow
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const window of this.#applicationWindows.values()) {
      if (!window.isDestroyed()) window.webContents.send(channel, ...args)
    }
  }

  updateTitleBarOverlayTheme(theme: { ink: string }): void {
    if (process.platform !== 'win32') return
    for (const window of this.#applicationWindows.values()) {
      if (window.isDestroyed()) continue
      try {
        window.setTitleBarOverlay(createWindowsTitleBarOverlay(theme.ink))
      } catch (error) {
        this.#logger.warn('desktop.set-title-bar-overlay-failed', { error })
      }
    }
  }

  openWindow(input: DesktopOpenWindowInput): BrowserWindow {
    const applicationOrigin = this.#allowedApplicationOrigin
    if (!applicationOrigin) throw new Error('Agent 尚未连接')
    const window = this.#createManagedWindow(this.#nextWindowBounds(), false)
    const applicationUrl = createRendererApplicationUrl(
      applicationOrigin,
      this.#options.startupTheme,
    )
    const targetUrl =
      input.kind === 'thread'
        ? `${applicationUrl}#/threads/${encodeURIComponent(input.threadId)}`
        : applicationUrl
    window.once('ready-to-show', () => {
      this.#focusWindow(window)
    })
    void window.loadURL(targetUrl).catch((error) => {
      this.#logger.error('desktop.page-load-failed', {
        reason: 'secondary-window',
        error,
      })
      if (!window.isDestroyed()) window.close()
    })
    return window
  }

  #ensureMainWindow(): BrowserWindow {
    const existingWindow = this.mainWindow
    if (existingWindow && !existingWindow.isDestroyed()) return existingWindow
    return this.#createManagedWindow(this.#options.initialWindowState.bounds, true)
  }

  #createManagedWindow(bounds: DesktopWindowBounds, primary: boolean): BrowserWindow {
    const window = new BrowserWindow({
      ...bounds,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
      show: false,
      titleBarStyle: 'hidden',
      titleBarOverlay:
        process.platform === 'win32'
          ? createWindowsTitleBarOverlay(this.#options.startupTheme.theme.ink)
          : false,
      backgroundColor: this.#options.startupTheme.theme.surface,
      autoHideMenuBar: true,
      title: 'Pidex Desktop',
      icon: this.#resolveWindowIconPath(),
      webPreferences: {
        preload: join(this.#moduleDirectory, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: true,
        devTools: true,
      },
    })
    window.webContents.setZoomFactor(this.#pageZoomPercent / 100)
    installVisualizationIsolation(window.webContents)
    window.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) {
        window.webContents.setZoomFactor(this.#pageZoomPercent / 100)
      }
    })
    this.#applicationWindows.set(window.id, window)
    if (primary || this.#primaryWindowId === undefined) {
      this.#primaryWindowId = window.id
    }
    this.#focusedWindowId = window.id
    this.#registerWindowShortcuts(window)
    window.webContents.on(
      'render-process-gone',
      (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        this.#logger.error('desktop.render-process-gone', {
          reason: details.reason,
          exitCode: details.exitCode,
        })
      },
    )
    window.on('unresponsive', () => {
      this.#logger.warn('desktop.renderer-unresponsive')
    })
    const createdAt = Date.now()
    window.webContents.on('console-message', (details) => {
      if (
        details.level === 'info' &&
        ['desktop.business-root-mounted', 'desktop.startup-surface-committed'].includes(
          details.message,
        )
      ) {
        this.#logger.info(details.message, {
          durationMs: Date.now() - createdAt,
          generation: this.#startupSnapshot.generation,
        })
        return
      }
      const record = rendererConsoleRecord(
        details.level,
        details.message,
        details.lineNumber,
        details.sourceId,
      )
      if (!record) return
      const write =
        record.level === 'error'
          ? this.#logger.error.bind(this.#logger)
          : this.#logger.warn.bind(this.#logger)
      write('desktop.renderer-console', { details: record })
    })
    window.on('focus', () => {
      this.#focusedWindowId = window.id
    })
    window.on('maximize', () => {
      if (this.#primaryWindowId === window.id) this.#scheduleWindowState(true)
    })
    window.on('unmaximize', () => {
      if (this.#primaryWindowId === window.id) this.#scheduleWindowState(false)
    })
    const rememberNormalBounds = () => {
      if (
        this.#primaryWindowId !== window.id ||
        window.isDestroyed() ||
        window.isMaximized() ||
        window.isMinimized() ||
        window.isFullScreen()
      ) {
        return
      }
      this.#normalWindowBounds = window.getBounds()
      this.#scheduleWindowState(false)
    }
    let manualResizeActive = false
    let resizeActivityRevision = 0
    let resizeSettleTimer: NodeJS.Timeout | undefined
    const clearResizeSettleTimer = (): void => {
      if (resizeSettleTimer) clearTimeout(resizeSettleTimer)
      resizeSettleTimer = undefined
    }
    const sendResizeActivity = (phase: DesktopResizeActivityPhase): void => {
      if (window.webContents.isDestroyed()) return
      resizeActivityRevision += 1
      window.webContents.send(DESKTOP_WINDOW_IPC_CHANNELS.resizeActivity, {
        windowId: window.id,
        phase,
        revision: resizeActivityRevision,
      })
    }
    const finishManualResize = (): void => {
      if (!manualResizeActive) return
      manualResizeActive = false
      clearResizeSettleTimer()
      if (window.webContents.isDestroyed()) return
      window.webContents.send(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged, false)
      sendResizeActivity('end')
    }
    // 取消拖拽时 "resized" 不会再触发；最后一次 resize 之后静默一段时间即视为
    // 结束，保证 start/end 始终配对，渲染端不会卡在降载状态。
    const armResizeSettleTimer = (): void => {
      clearResizeSettleTimer()
      resizeSettleTimer = setTimeout(() => {
        resizeSettleTimer = undefined
        finishManualResize()
      }, RESIZE_SETTLE_MS)
      resizeSettleTimer.unref()
    }
    window.on('will-resize', () => {
      if (manualResizeActive || window.webContents.isDestroyed()) return
      manualResizeActive = true
      window.webContents.send(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged, true)
      sendResizeActivity('start')
      armResizeSettleTimer()
    })
    window.on('resized', () => {
      if (!manualResizeActive || window.webContents.isDestroyed()) return
      manualResizeActive = false
      clearResizeSettleTimer()
      window.webContents.send(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged, false)
      sendResizeActivity('end')
    })
    const onWindowResize = (): void => {
      if (manualResizeActive) armResizeSettleTimer()
      rememberNormalBounds()
    }
    window.on('resize', onWindowResize)
    window.on('move', rememberNormalBounds)
    window.on('closed', () => {
      clearResizeSettleTimer()
      this.#applicationWindows.delete(window.id)
      if (this.#focusedWindowId === window.id) this.#focusedWindowId = undefined
      if (this.#primaryWindowId === window.id) this.#promotePrimaryWindow()
    })
    window.webContents.setWindowOpenHandler(({ url, frameName }) => {
      if (url === 'about:blank' || url === '' || frameName?.startsWith('auxiliary:')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            frame: false,
            titleBarStyle: 'hidden',
            titleBarOverlay:
              process.platform === 'win32'
                ? createWindowsTitleBarOverlay(this.#options.startupTheme.theme.ink)
                : false,
            backgroundColor: this.#options.startupTheme.theme.surface,
            minWidth: 400,
            minHeight: 300,
            autoHideMenuBar: true,
            title: 'Pidex Desktop',
            icon: this.#resolveWindowIconPath(),
            webPreferences: {
              preload: join(this.#moduleDirectory, 'preload.cjs'),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              webSecurity: true,
              devTools: true,
            },
          },
        }
      }
      if (!isAllowedApplicationUrl(url, this.#allowedApplicationOrigin) && isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })
    window.webContents.on('did-create-window', (childWindow) => {
      childWindow.webContents.setZoomFactor(this.#pageZoomPercent / 100)
      this.#applicationWindows.set(childWindow.id, childWindow)
      this.#registerWindowShortcuts(childWindow)
      childWindow.on('focus', () => {
        this.#focusedWindowId = childWindow.id
      })
      childWindow.on('closed', () => {
        this.#applicationWindows.delete(childWindow.id)
        if (this.#focusedWindowId === childWindow.id) {
          this.#focusedWindowId = undefined
        }
      })
    })
    window.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedApplicationUrl(url, this.#allowedApplicationOrigin)) {
        event.preventDefault()
      }
    })
    if (primary && this.#options.initialWindowState.maximized) {
      window.once('ready-to-show', () => {
        if (!window.isDestroyed()) window.maximize()
      })
    }
    return window
  }

  #setThemeBackground(mainWindow: BrowserWindow): void {
    if (mainWindow.isDestroyed()) return
    mainWindow.setBackgroundColor(this.#options.startupTheme.theme.surface)
  }

  #scheduleWindowState(maximized = this.mainWindow?.isMaximized() ?? false): void {
    this.#options.windowStateStore.scheduleSave({
      version: 1,
      bounds: this.#normalWindowBounds,
      maximized,
      zoomPercent: this.#pageZoomPercent,
    })
  }

  #windowById(id: number | undefined): BrowserWindow | undefined {
    if (id === undefined) return undefined
    const window = this.#applicationWindows.get(id)
    return window && !window.isDestroyed() ? window : undefined
  }

  #focusWindow(window: BrowserWindow | undefined): void {
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  #promotePrimaryWindow(): void {
    const promoted = this.focusedWindow ?? Array.from(this.#applicationWindows.values()).at(-1)
    this.#primaryWindowId = promoted?.id
    if (!promoted || promoted.isDestroyed()) return
    this.#focusedWindowId ??= promoted.id
    if (!promoted.isMaximized() && !promoted.isMinimized() && !promoted.isFullScreen()) {
      this.#normalWindowBounds = promoted.getBounds()
    }
  }

  #nextWindowBounds(): DesktopWindowBounds {
    const source = this.focusedWindow
    const sourceBounds =
      source && !source.isDestroyed() ? source.getBounds() : this.#normalWindowBounds
    const candidate = {
      ...sourceBounds,
      x: sourceBounds.x + 24,
      y: sourceBounds.y + 24,
    }
    const workArea = screen.getDisplayMatching(candidate).workArea
    const maxX = workArea.x + Math.max(0, workArea.width - candidate.width)
    const maxY = workArea.y + Math.max(0, workArea.height - candidate.height)
    return {
      ...candidate,
      x: Math.min(Math.max(candidate.x, workArea.x), maxX),
      y: Math.min(Math.max(candidate.y, workArea.y), maxY),
    }
  }

  #registerWindowShortcuts(window: BrowserWindow): void {
    window.webContents.on('before-input-event', (event, input) => {
      if (isDevToolsShortcut(input)) {
        event.preventDefault()
        window.webContents.toggleDevTools()
        return
      }
      const zoomAction = resolvePageZoomShortcut(input)
      if (zoomAction) {
        event.preventDefault()
        this.changePageZoom(zoomAction)
      }
    })
    window.webContents.on('devtools-opened', () => {
      this.#logger.info('desktop.devtools-opened')
    })
    window.webContents.on('devtools-closed', () => {
      this.#logger.info('desktop.devtools-closed')
    })
  }

  #resolveWindowIconPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : resolve(this.#moduleDirectory, '../../build/icon.ico')
  }
}
