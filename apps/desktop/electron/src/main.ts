import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, clipboard, ipcMain, nativeTheme, screen, session, shell } from 'electron'
import electronUpdater from 'electron-updater'
import {
  DESKTOP_SETTINGS_IPC_CHANNELS,
  type DesktopSettingsPayload,
} from '@pidex/shared/desktop-settings-ipc'
import { DESKTOP_UPDATE_IPC_CHANNELS } from '@pidex/shared/desktop-update-ipc'
import { registerAppearanceIpc } from './ipc/RegisterAppearanceIpc.js'
import { registerDataLocationIpc } from './ipc/RegisterDataLocationIpc.js'
import { registerDesktopIpc } from './ipc/RegisterDesktopIpc.js'
import { registerTerminalIpc } from './ipc/RegisterTerminalIpc.js'
import { registerBrowserIpc } from './ipc/RegisterBrowserIpc.js'
import { ExternalOpenTargetService } from './ipc/ExternalOpenTargets.js'
import { AttachmentDownloadService } from './ipc/AttachmentDownloadService.js'
import { ComposerPathGrantService } from './ipc/ComposerPathGrantService.js'
import {
  createDesktopClipboardService,
  createDesktopClipboardTimer,
} from './clipboard/DesktopClipboardService.js'
import {
  createDesktopLogger,
  resolveDesktopLogDirectory,
  type DesktopLogger,
} from './logging/DesktopLogger.js'
import { configureAuthCookie, verifyAuthCookie } from './security/AuthSession.js'
import { resolveRendererApplicationOrigin } from './security/RendererApplicationOrigin.js'
import { readStartupAppearanceConfig } from './settings/StartupAppearanceConfig.js'
import { AppearanceSettingsStore } from './settings/AppearanceSettingsStore.js'
import { DataLocationStore, type DataLocationLaunch } from './settings/DataLocationStore.js'
import { formatError } from './sidecar/Readiness.js'
import { SidecarSupervisor } from './sidecar/Supervisor.js'
import { DesktopAgentConnectionCoordinator } from './sidecar/ConnectionCoordinator.js'
import { orchestrateDesktopQuit } from './sidecar/DesktopQuitOrchestrator.js'
import { WindowAppearanceController } from './windows/Appearance.js'
import { WindowManager } from './windows/WindowManager.js'
import { registerPetOverlayIpc } from './ipc/RegisterPetOverlayIpc.js'
import {
  createElectronNotificationFactory,
  publishNotificationActivation,
  registerNotificationIpc,
  resolveNotificationIconPath,
} from './ipc/RegisterNotificationIpc.js'
import { DesktopNotificationService } from './notifications/DesktopNotificationService.js'
import { PetOverlayWindowController } from './windows/PetOverlayWindow.js'
import { PetOverlayWindowStateStore } from './windows/PetOverlayWindowState.js'
import { DesktopAutoUpdater, type ElectronAutoUpdaterLike } from './update/DesktopAutoUpdater.js'
import { resolveStartupPageTheme } from './windows/StartupPage.js'
import { type DesktopDisplayWorkArea, WindowStateStore } from './windows/WindowState.js'
import { TerminalManager } from './terminal/TerminalManager.js'
import { TerminalHostRpcClient } from './terminal/TerminalHostRpcClient.js'
import { stopTerminalsBeforeSupervisor } from './terminal/TerminalShutdown.js'
import { runPackagedTerminalSmoke } from './terminal/PackagedTerminalSmoke.js'
import { DESKTOP_TERMINAL_IPC_CHANNELS } from '@pidex/shared/desktop-terminal-ipc'
import { DESKTOP_BROWSER_IPC_CHANNELS } from '@pidex/shared/desktop-browser-ipc'
import {
  DESKTOP_DEEP_LINK_IPC_CHANNELS,
  normalizeDesktopThreadDeepLinkPayload,
} from '@pidex/shared/desktop-deep-link-ipc'
import { DesktopBrowserController } from './browser/BrowserController.js'
import { DesktopComputerController } from './computer/DesktopComputerController.js'
import { resolveCpxCuaExecutable } from './computer/CpxCuaRuntime.js'
import {
  registerMicrophoneIpc,
  WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL,
} from './ipc/RegisterMicrophoneIpc.js'
import { registerMicrophoneMediaPermissions } from './security/MicrophoneMediaPermission.js'
import {
  createThreadDeepLinkController,
  type ThreadDeepLinkController,
} from './deep-link/ThreadDeepLinkController.js'
import { ProviderIconCacheService } from './ipc/ProviderIconCacheService.js'
import { registerProviderIconIpc } from './ipc/RegisterProviderIconIpc.js'
import { DESKTOP_PROVIDER_ICON_IPC_CHANNELS } from '@pidex/shared/desktop-provider-icon-ipc'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const configuredUserDataDirectory = process.env.PIDEX_USER_DATA_DIR?.trim()
// Electron 默认把 userData 建在 appData/<应用名> 下。这里显式固定到产品展示名，
// 避免应用名或打包名称再次变化时目录漂移，导致外观设置、窗口与宠物状态、会话索引
// 和浏览器分区失联；显式指定目录的优先级不变。
const USER_DATA_DIRECTORY_NAME = 'Pidex Desktop'
const DEFAULT_USER_DATA_DIRECTORY = join(app.getPath('appData'), USER_DATA_DIRECTORY_NAME)
app.setPath(
  'userData',
  configuredUserDataDirectory ? resolve(configuredUserDataDirectory) : DEFAULT_USER_DATA_DIRECTORY,
)

// Windows toast 归属依赖 AppUserModelID；packaged 使用与 electron-builder
// appId 一致的稳定 ID，开发态只能用进程路径做功能调试。
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.pidex.desktop' : process.execPath)
}

// Windows 默认协议客户端注册保持最小：packaged 安装由 electron-builder protocols
// 注册，这里只补充运行时默认客户端注册，不改变开发/打包启动路径。
if (process.platform === 'win32') {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pidex', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('pidex')
  }
}

let supervisor: SidecarSupervisor | undefined
let logger: DesktopLogger | undefined
let windows: WindowManager | undefined
let petOverlay: PetOverlayWindowController | undefined
let quitting = false
let connectionCoordinator: DesktopAgentConnectionCoordinator | undefined
let dataLocationStore: DataLocationStore | undefined
let dataLocationLaunch: DataLocationLaunch | undefined
let terminalManager: TerminalManager | undefined
let terminalHost: TerminalHostRpcClient | undefined
let browserController: DesktopBrowserController | undefined
let computerController: DesktopComputerController | undefined
let providerIcons: ProviderIconCacheService | undefined
let deepLinkController: ThreadDeepLinkController | undefined
const rendererDeepLinkReady = new Set<number>()
const rendererDeepLinkTracked = new Set<number>()

const packagedTerminalSmokeResult = process.env.PIDEX_PACKAGED_TERMINAL_SMOKE_RESULT?.trim()
const packagedTerminalSmokeRequested = process.argv.includes('--pidex-packaged-terminal-smoke')
if (
  app.isPackaged &&
  process.platform === 'win32' &&
  packagedTerminalSmokeRequested &&
  packagedTerminalSmokeResult
) {
  app
    .whenReady()
    .then(() => runPackagedTerminalSmoke(packagedTerminalSmokeResult))
    .then(
      () => app.exit(0),
      () => app.exit(1),
    )
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  if (!hasSingleInstanceLock) {
    app.quit()
  } else {
    // 唯一深链 controller 在生命周期监听注册前创建，从一开始接收
    // process.argv、second-instance 与 open-url；依赖闭包在 windows /
    // rendererDeepLinkReady 建立后自然生效。冷启动 pending 只保存
    // 解析后的 threadId，并由 Renderer 主动 consume。
    deepLinkController = createThreadDeepLinkController({
      getInitialArgv: () => process.argv,
      subscribeRendererReady: () => () => {},
      isRendererReady: () => {
        const id = windows?.focusedWindow?.webContents.id
        return id !== undefined && rendererDeepLinkReady.has(id)
      },
      focusMainWindow: () => windows?.focus(true),
      notify: (payload) => {
        const normalized = normalizeDesktopThreadDeepLinkPayload(payload)
        if (normalized !== null) {
          windows?.sendToFocused(DESKTOP_DEEP_LINK_IPC_CHANNELS.activated, normalized)
        }
      },
    })
    app.on('second-instance', (_event, argv) => {
      const handled = deepLinkController?.pushRuntimeActivation(argv) === true
      if (!handled) {
        windows?.focus(connectionCoordinator?.status.connectionState === 'connected')
      }
    })
    app.on('open-url', (event, url) => {
      if (deepLinkController?.pushRuntimeActivation([url]) === true) {
        event.preventDefault()
      }
    })
    app
      .whenReady()
      .then(startDesktop)
      .catch((error: unknown) => {
        logger?.error('desktop.startup-failed', { error })
        windows?.showStartupStatus('启动流程异常', formatError(error), 'terminal-error')
      })
  }
}

async function startDesktop(): Promise<void> {
  dataLocationStore = new DataLocationStore(
    app.getPath('userData'),
    join(app.getPath('home'), '.pidex'),
    process.env.PIDEX_DATA_DIR?.trim() || null,
  )
  dataLocationLaunch = await dataLocationStore.launch()
  const logDirectory = resolveDesktopLogDirectory(dataLocationLaunch, process.env.PIDEX_LOG_DIR)
  logger = createDesktopLogger(logDirectory)
  logger.info('desktop.starting', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    pid: process.pid,
  })
  const appearanceSettings = await readStartupAppearanceConfig(
    join(dataLocationLaunch.dataDir, 'config.json'),
    join(dataLocationLaunch.dataDir, 'config.toml'),
    join(app.getPath('userData'), 'appearance-settings.json'),
  )
  const startupTheme = resolveStartupPageTheme(
    appearanceSettings,
    nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  )
  const windowStateStore = new WindowStateStore(app.getPath('userData'), logger)
  const displayWorkAreas = screen
    .getAllDisplays()
    .map((display) => display.workArea as DesktopDisplayWorkArea)
  const primaryWorkArea = screen.getPrimaryDisplay().workArea as DesktopDisplayWorkArea
  const initialWindowState = await windowStateStore.load(displayWorkAreas, primaryWorkArea)
  windows = new WindowManager(logger, moduleDirectory, {
    initialWindowState,
    startupTheme,
    windowStateStore,
  })
  registerMicrophoneMediaPermissions({
    session: session.defaultSession,
    getAllowedApplicationOrigin: () => windows?.applicationOrigin,
    isMainWindowSender: (sender) => windows?.isApplicationSender(sender) === true,
  })
  registerMicrophoneIpc({
    ipc: ipcMain,
    isMainWindowSender: (sender) => windows?.isApplicationSender(sender) === true,
    openMicrophonePrivacySettings: async () => {
      await shell.openExternal(WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL)
    },
  })
  const petOverlayStateStore = new PetOverlayWindowStateStore(app.getPath('userData'), logger)
  const initialPetOverlayState = await petOverlayStateStore.load(displayWorkAreas, primaryWorkArea)
  petOverlay = new PetOverlayWindowController(
    logger,
    moduleDirectory,
    petOverlayStateStore,
    initialPetOverlayState,
  )
  const appearance = new WindowAppearanceController(appearanceSettings)
  appearance.onThemeChange((theme) => {
    windows?.updateTitleBarOverlayTheme(theme)
  })
  const externalOpenTargets = new ExternalOpenTargetService({
    platform: process.platform,
    env: process.env,
    openPath: (path) => shell.openPath(path),
    revealPath: (path) => shell.showItemInFolder(path),
    spawnProcess: (executablePath, args, options) => spawn(executablePath, [...args], options),
  })
  const updater = new DesktopAutoUpdater({
    packaged: app.isPackaged,
    version: app.getVersion(),
    logger,
    updater: electronUpdater.autoUpdater as ElectronAutoUpdaterLike,
    onStatusChange: (status) => {
      windows?.broadcast(DESKTOP_UPDATE_IPC_CHANNELS.status, status)
    },
  })
  const attachmentDownloads = new AttachmentDownloadService({
    getDownloadsDirectory: () => app.getPath('downloads'),
  })
  const composerPathGrants = new ComposerPathGrantService()
  providerIcons = new ProviderIconCacheService({
    rootDirectory: join(app.getPath('userData'), 'provider-icons'),
    logger,
    publish: (change) => {
      windows?.broadcast(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.changed, change)
    },
  })
  providerIcons.startExpirySweep()
  browserController = new DesktopBrowserController({
    getSupervisor: () => supervisor,
    publish: (owner, state) => {
      if (!owner.isDestroyed()) {
        owner.webContents.send(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged, state)
      }
    },
    logger,
  })
  computerController = new DesktopComputerController({
    getSupervisor: () => supervisor,
    resolveExecutable: () =>
      resolveCpxCuaExecutable({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        moduleDirectory,
      }),
    logger,
  })

  const clipboardService = createDesktopClipboardService({
    adapter: {
      writeText: (text) => clipboard.writeText(text),
      writeRichText: ({ text, html }) => clipboard.write({ text, html }),
      readText: () => clipboard.readText(),
      clear: () => clipboard.clear(),
    },
    timer: createDesktopClipboardTimer(),
  })

  registerDesktopIpc({
    windows,
    logger,
    externalOpenTargets,
    updater,
    attachmentDownloads,
    composerPathGrants,
    clipboardService,
    getSupervisor: () => supervisor,
    getLogDirectory: () => logger?.directory ?? logDirectory,
    quitDuringStartup: () => app.quit(),
    isDesktopRendererSender: (sender) =>
      windows?.isApplicationSender(sender) === true || petOverlay?.isOverlaySender(sender) === true,
    broadcastDesktopSettingsChanged: (settings) => {
      broadcastDesktopSettingsChanged(settings)
    },
  })
  terminalHost = new TerminalHostRpcClient(() => supervisor, logger)
  terminalManager = new TerminalManager({
    contextResolver: terminalHost,
    actionResolver: terminalHost,
    mirrorSink: terminalHost,
    onEvent: (event) => {
      windows?.broadcast(DESKTOP_TERMINAL_IPC_CHANNELS.event, event)
    },
  })
  registerTerminalIpc({
    manager: terminalManager,
    isMainWindowSender: (sender) => windows?.isApplicationSender(sender) === true,
  })
  registerProviderIconIpc({
    ipc: ipcMain,
    isMainWindowSender: (sender) => windows?.isApplicationSender(sender) === true,
    providerIcons,
  })
  registerBrowserIpc({
    controller: browserController,
    windowForSender: (sender) => windows?.windowForSender(sender),
  })
  registerAppearanceIpc(
    appearanceSettings,
    appearance,
    new AppearanceSettingsStore(app.getPath('userData'), logger),
    (sender) => windows?.isApplicationSender(sender) === true,
  )
  registerDataLocationIpc({
    store: dataLocationStore,
    windows,
    installDirectory: app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath(),
    relaunch: relaunchApplication,
  })
  registerPetOverlayIpc(windows, petOverlay)
  const notificationService = new DesktopNotificationService({
    logger,
    factory: createElectronNotificationFactory(),
    resolveIconPath: resolveNotificationIconPath,
    isMainWindowFocused: () => windows?.focusedWindow?.isFocused() === true,
    focusMainWindow: () => windows?.focus(true),
    publishActivation: (activation) => publishNotificationActivation(windows, activation),
  })
  registerNotificationIpc(windows, notificationService)
  ipcMain.handle(DESKTOP_DEEP_LINK_IPC_CHANNELS.consumePending, (event) => {
    if (windows?.isApplicationSender(event.sender) !== true) return null
    // 11B 保证 Renderer 先注册 activated listener 再调用 consume，因此
    // 经过主窗口 sender 校验的该 invoke 是可靠的 ready 握手。
    trackRendererDeepLinkLifecycle(event.sender)
    rendererDeepLinkReady.add(event.sender.id)
    return deepLinkController?.consumePendingThreadDeepLink() ?? null
  })
  windows.createStartupWindow()

  const token = process.env.PIDEX_AUTH_TOKEN ?? randomBytes(32).toString('base64url')
  supervisor = new SidecarSupervisor(token, logger, moduleDirectory, dataLocationLaunch, {
    appRuntime: {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      getPath: (name) => app.getPath(name),
    },
  })
  const activeLogger = logger
  const activeWindows = windows
  connectionCoordinator = new DesktopAgentConnectionCoordinator({
    supervisor,
    logger: activeLogger,
    loadConnection: async (candidate, guard) => {
      guard.assertCurrent()
      const applicationOrigin = resolveRendererApplicationOrigin({
        agentOrigin: candidate.origin,
        isPackaged: app.isPackaged,
        managedAgent: candidate.managed,
        rendererDevUrl: process.env.PIDEX_RENDERER_DEV_URL,
      })
      activeWindows.showStartupStatus('正在验证 Agent 认证', candidate.origin)
      await configureAuthCookie(candidate.origin, token, activeLogger)
      guard.assertCurrent()
      await verifyAuthCookie(candidate.origin, activeLogger)
      guard.assertCurrent()
      petOverlay?.setApplicationOrigin(applicationOrigin)
      guard.assertCurrent()
      activeWindows.showStartupStatus('正在加载桌面界面', applicationOrigin)
      guard.assertCurrent()
      await activeWindows.loadApplication(applicationOrigin)
      guard.assertCurrent()
    },
    onConnected: async (connection, guard) => {
      guard.assertCurrent()
      activeLogger.info('desktop.ready', {
        origin: connection.origin,
        port: connection.port,
        generation: connection.generation,
      })
      if (dataLocationLaunch?.relocation) {
        await dataLocationStore?.promotePending()
        guard.assertCurrent()
        dataLocationLaunch = {
          dataDir: dataLocationLaunch.dataDir,
          relocation: null,
        }
      }
      guard.assertCurrent()
      activeWindows.showApplication()
      void computerController?.ensure()
    },
    onReconnecting: () => {
      rendererDeepLinkReady.clear()
      browserController?.suspendAll()
      computerController?.invalidate()
      windows?.showReconnectWindow()
    },
    onBeforeReconnect: () => {
      terminalHost?.invalidate()
      computerController?.invalidate()
    },
    isRelocating: () => Boolean(dataLocationLaunch?.relocation),
    onTerminalFailure: (error, kind) => {
      if (kind === 'installation') {
        activeLogger.error('desktop.startup-failed', {
          code: 'SIDECAR_INSTALLATION_INCOMPLETE',
        })
        activeWindows.showStartupStatus(
          '安装不完整，请重新安装',
          'Pidex Agent 文件缺失',
          'terminal-error',
        )
        return
      }
      if (kind === 'relocation') {
        activeLogger.error('desktop.data-location-relocation-failed', {
          reason: 'agent-startup-failed',
        })
        activeWindows.showStartupStatus(
          '用户数据迁移失败',
          '可以重试迁移，或恢复原数据位置后重新启动。',
          'terminal-error',
        )
        return
      }
      if (kind === 'termination') {
        activeLogger.error('desktop.sidecar-termination-unconfirmed', {
          code: 'SIDECAR_TERMINATION_UNCONFIRMED',
        })
        activeWindows.showStartupStatus(
          '残留 Agent 未退出',
          '请结束残留 Agent 进程后重新启动 Pidex。',
          'terminal-error',
        )
        return
      }
      activeLogger.error('desktop.connection-cycle-failed', { error })
      activeWindows.showStartupStatus('Agent 连接失败', formatError(error), 'terminal-error')
    },
  })
  connectionCoordinator.onStateChange((status) => {
    logger?.info('desktop.connection-state', {
      state: status.connectionState,
      phase: status.phase,
      lifecycle: status.lifecycle,
      attempt: status.attempt,
    })
    if (
      status.lifecycle === 'idle' ||
      status.lifecycle === 'failed' ||
      status.lifecycle === 'connected'
    )
      return
    windows?.showStartupStatus(
      status.phase === 'reconnecting' ? 'Agent 连接中断，正在重试' : '正在连接 Agent',
      status.message ?? `第 ${status.attempt} 次尝试`,
    )
  })
  await connectionCoordinator.start()
}

app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitting) return
  quitting = true
  void orchestrateDesktopQuit({
    stopRuntime: () => {
      browserController?.dispose()
      computerController?.dispose()
      providerIcons?.dispose()
      disposeDeepLinkController()
      return stopTerminalsBeforeSupervisor({
        manager: terminalManager,
        stopSupervisor: async () => {
          terminalHost?.invalidate()
          if (connectionCoordinator) await connectionCoordinator.stop()
          else await supervisor?.stop()
        },
      })
    },
    flushState: [
      () => windows?.flushWindowState() ?? Promise.resolve(),
      () => petOverlay?.flushState() ?? Promise.resolve(),
    ],
    exit: () => app.exit(0),
    onBlocked: () => {
      quitting = false
      logger?.error('desktop.quit-blocked', {
        code: 'SIDECAR_TERMINATION_UNCONFIRMED',
      })
      windows?.showReconnectWindow()
      windows?.showStartupStatus(
        '残留 Agent 未退出',
        '请在任务管理器中结束残留 Agent 进程，然后再次退出以重新检查。',
        'terminal-error',
      )
    },
  })
})

function broadcastDesktopSettingsChanged(settings: DesktopSettingsPayload): void {
  windows?.broadcast(DESKTOP_SETTINGS_IPC_CHANNELS.changed, settings)
  petOverlay?.send(DESKTOP_SETTINGS_IPC_CHANNELS.changed, settings)
}

function disposeDeepLinkController(): void {
  deepLinkController?.dispose()
  deepLinkController = undefined
  ipcMain.removeHandler(DESKTOP_DEEP_LINK_IPC_CHANNELS.consumePending)
}

// 每个完整工作台窗口独立跟踪 ready。主框架 reload 后必须重新握手，
// SPA pushState 不影响 ready；destroyed 时只移除该窗口。
function trackRendererDeepLinkLifecycle(webContents: Electron.WebContents): void {
  if (rendererDeepLinkTracked.has(webContents.id)) return
  rendererDeepLinkTracked.add(webContents.id)
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      rendererDeepLinkReady.delete(webContents.id)
    }
  })
  webContents.on('destroyed', () => {
    rendererDeepLinkReady.delete(webContents.id)
    rendererDeepLinkTracked.delete(webContents.id)
  })
}

app.on('window-all-closed', () => app.quit())

function relaunchApplication(): void {
  app.relaunch()
  app.quit()
}
