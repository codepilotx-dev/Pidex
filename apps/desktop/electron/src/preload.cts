import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopThemeSettingsV7 } from './settings/AppearanceSettingsStore.js'
import type { DesktopSystemFontFace, DesktopSystemFontsResult } from '@pidex/shared/desktop-theme'
import type {
  DesktopPetOverlayBridge,
  DesktopPetPresentation,
} from '@pidex/shared/desktop-pet-overlay'
import type {
  DesktopSettingsIpcBridge,
  DesktopSettingsPayload,
} from '@pidex/shared/desktop-settings-ipc'
import type { DesktopDataLocationIpcBridge } from '@pidex/shared/desktop-data-location-ipc'
import type { DesktopEditAction, DesktopEditIpcBridge } from '@pidex/shared/desktop-edit-ipc'
import type { DesktopUpdateIpcBridge, DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'
import type {
  AckDesktopTerminalOutputInput,
  AttachDesktopTerminalInput,
  CloseDesktopTerminalForThreadInput,
  CloseDesktopTerminalInput,
  DesktopTerminalEvent,
  DesktopTerminalIpcBridge,
  DesktopTerminalProfile,
  DesktopTerminalSnapshot,
  EnsureDesktopTerminalInput,
  ResizeDesktopTerminalInput,
  RunDesktopTerminalActionInput,
  WriteDesktopTerminalInput,
} from '@pidex/shared/desktop-terminal-ipc'
import type {
  DesktopNotificationActivation,
  DesktopNotificationIpcBridge,
  DesktopNotificationRequest,
  DesktopNotificationResult,
} from '@pidex/shared/desktop-notification-ipc'
import type {
  DesktopAttachmentIpcBridge,
  DesktopAttachmentSaveInput,
  DesktopAttachmentSaveResult,
  DesktopComposerPathGrant,
  DesktopComposerPathListInput,
  DesktopComposerPathListResult,
  DesktopComposerPathPreview,
  DesktopComposerPathReadInput,
} from '@pidex/shared/desktop-attachment-ipc'
import type {
  CreateOrRestoreDesktopBrowserInput,
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
  DesktopBrowserTabInput,
  NavigateDesktopBrowserInput,
  SetDesktopBrowserBoundsInput,
  SetDesktopBrowserVisibleInput,
} from '@pidex/shared/desktop-browser-ipc'
import type {
  DesktopClipboardIpcBridge,
  DesktopClipboardRichTextInput,
  DesktopClipboardTextInput,
  DesktopSensitiveClipboardResult,
} from '@pidex/shared/desktop-clipboard-ipc'
import type { DesktopMicrophoneIpcBridge } from '@pidex/shared/desktop-microphone-ipc'
import type { DesktopProviderIconIpcBridge } from '@pidex/shared/desktop-provider-icon-ipc'
// 注意：preload.cjs 不参与打包，只能使用 type-only import；一旦引入运行时代码，
// 编译产物会 require workspace 的 TS 源并导致 preload 加载失败（整个桥消失）。
import type {
  DesktopOpenWindowInput,
  DesktopPageZoomAction,
  DesktopPageZoomState,
  DesktopResizeActivity,
  DesktopWindowIpcBridge,
} from '@pidex/shared/desktop-window-ipc'
import type { DesktopWorkspaceIpcBridge } from '@pidex/shared/desktop-workspace-ipc'
import type {
  DesktopExternalOpenTarget,
  DesktopShellIpcBridge,
} from '@pidex/shared/desktop-shell-ipc'
import type { DesktopStartupIpcBridge } from '@pidex/shared/desktop-startup-ipc'
import type {
  DesktopAppearanceIpcBridge,
  DesktopStartupThemeSeed,
} from '@pidex/shared/desktop-appearance-ipc'
import type {
  DesktopDeepLinkIpcBridge,
  DesktopThreadDeepLinkPayload,
} from '@pidex/shared/desktop-deep-link-ipc'

// Sandboxed preload scripts cannot resolve workspace packages at runtime.
// Keep this literal type-checked against the shared contract so the emitted
// preload remains self-contained without allowing IPC channel drift.
const PET_OVERLAY_CHANNELS = {
  open: 'pet-overlay:open',
  hide: 'pet-overlay:hide',
  getState: 'pet-overlay:get-state',
  previewPresentation: 'desktop-pet-overlay:preview-presentation',
  presentationPreview: 'desktop-pet-overlay:presentation-preview',
  getGlobalPointerPosition: 'desktop-pet-overlay:get-global-pointer-position',
  beginDrag: 'pet-overlay:drag-begin',
  updateDrag: 'pet-overlay:drag-update',
  endDrag: 'pet-overlay:drag-end',
  setPointerPassthrough: 'pet-overlay:pointer-passthrough',
  requestKeyboardFocus: 'pet-overlay:keyboard-focus',
  openSession: 'pet-overlay:open-session',
} as const satisfies typeof import('@pidex/shared/desktop-pet-overlay').PET_OVERLAY_CHANNELS

const DESKTOP_SETTINGS_IPC_CHANNELS = {
  get: 'desktop-settings:get',
  save: 'desktop-settings:save',
  changed: 'desktop-settings:changed',
} as const satisfies typeof import('@pidex/shared/desktop-settings-ipc').DESKTOP_SETTINGS_IPC_CHANNELS

const DESKTOP_DATA_LOCATION_IPC_CHANNELS = {
  get: 'desktop-data-location:get',
  choose: 'desktop-data-location:choose',
  retry: 'desktop-data-location:retry',
  restore: 'desktop-data-location:restore',
} as const satisfies typeof import('@pidex/shared/desktop-data-location-ipc').DESKTOP_DATA_LOCATION_IPC_CHANNELS

const DESKTOP_EDIT_IPC_CHANNELS = {
  perform: 'desktop-edit:perform',
} as const satisfies typeof import('@pidex/shared/desktop-edit-ipc').DESKTOP_EDIT_IPC_CHANNELS

const DESKTOP_UPDATE_IPC_CHANNELS = {
  check: 'desktop-update:check',
  download: 'desktop-update:download',
  quitAndInstall: 'desktop-update:quit-and-install',
  status: 'desktop-update:status',
} as const satisfies typeof import('@pidex/shared/desktop-update-ipc').DESKTOP_UPDATE_IPC_CHANNELS

const DESKTOP_TERMINAL_IPC_CHANNELS = {
  listProfiles: 'desktop-terminal:list-profiles',
  ensure: 'desktop-terminal:ensure',
  attach: 'desktop-terminal:attach',
  write: 'desktop-terminal:write',
  resize: 'desktop-terminal:resize',
  close: 'desktop-terminal:close',
  closeThread: 'desktop-terminal:close-thread',
  runAction: 'desktop-terminal:run-action',
  event: 'desktop-terminal:event',
  ack: 'desktop-terminal:ack',
} as const satisfies typeof import('@pidex/shared/desktop-terminal-ipc').DESKTOP_TERMINAL_IPC_CHANNELS

const DESKTOP_NOTIFICATION_IPC_CHANNELS = {
  show: 'desktop-notification:show',
  activated: 'desktop-notification:activated',
} as const satisfies typeof import('@pidex/shared/desktop-notification-ipc').DESKTOP_NOTIFICATION_IPC_CHANNELS

const DESKTOP_ATTACHMENT_IPC_CHANNELS = {
  saveToDownloads: 'desktop-attachment:save-to-downloads',
  chooseComposerFiles: 'desktop-attachment:choose-composer-files',
  grantComposerPaths: 'desktop-attachment:grant-composer-paths',
  readComposerPathGrant: 'desktop-attachment:read-composer-path-grant',
  listComposerPathGrant: 'desktop-attachment:list-composer-path-grant',
} as const satisfies typeof import('@pidex/shared/desktop-attachment-ipc').DESKTOP_ATTACHMENT_IPC_CHANNELS

const DESKTOP_BROWSER_IPC_CHANNELS = {
  annotation: 'desktop-browser:annotation',
  annotationEvent: 'desktop-browser:annotation-event',
  utility: 'desktop-browser:utility',
  utilityEvent: 'desktop-browser:utility-event',
  data: 'desktop-browser:data',
  dataChanged: 'desktop-browser:data-changed',
  list: 'desktop-browser:list',
  attach: 'desktop-browser:attach',
  control: 'desktop-browser:control',
  layout: 'desktop-browser:layout',
  permission: 'desktop-browser:permission',
  getState: 'desktop-browser:get-state',
  createOrRestore: 'desktop-browser:create-or-restore',
  navigate: 'desktop-browser:navigate',
  reload: 'desktop-browser:reload',
  stop: 'desktop-browser:stop',
  goBack: 'desktop-browser:go-back',
  goForward: 'desktop-browser:go-forward',
  setBounds: 'desktop-browser:set-bounds',
  setVisible: 'desktop-browser:set-visible',
  focus: 'desktop-browser:focus',
  close: 'desktop-browser:close',
  clearAllowedSites: 'desktop-browser:clear-allowed-sites',
  stateChanged: 'desktop-browser:state-changed',
} as const satisfies typeof import('@pidex/shared/desktop-browser-ipc').DESKTOP_BROWSER_IPC_CHANNELS

const DESKTOP_MICROPHONE_IPC_CHANNELS = {
  openPrivacySettings: 'desktop-microphone:open-privacy-settings',
} as const satisfies typeof import('@pidex/shared/desktop-microphone-ipc').DESKTOP_MICROPHONE_IPC_CHANNELS

const DESKTOP_PROVIDER_ICON_IPC_CHANNELS = {
  resolve: 'desktop-provider-icon:resolve',
  website: 'desktop-provider-icon:website',
  changed: 'desktop-provider-icon:changed',
} as const satisfies typeof import('@pidex/shared/desktop-provider-icon-ipc').DESKTOP_PROVIDER_ICON_IPC_CHANNELS

const DESKTOP_WINDOW_IPC_CHANNELS = {
  openWindow: 'window:open',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  isMaximized: 'window:is-maximized',
  getPageZoom: 'window:page-zoom:get',
  changePageZoom: 'window:page-zoom:change',
  pageZoomChanged: 'window:page-zoom:changed',
  resizeStateChanged: 'window:resize-state-changed',
  resizeActivity: 'window:resize-activity',
} as const satisfies typeof import('@pidex/shared/desktop-window-ipc').DESKTOP_WINDOW_IPC_CHANNELS

const DESKTOP_WORKSPACE_IPC_CHANNELS = {
  pickDirectories: 'workspace:pick-directories',
  pickDirectory: 'workspace:pick-directory',
} as const satisfies typeof import('@pidex/shared/desktop-workspace-ipc').DESKTOP_WORKSPACE_IPC_CHANNELS

const DESKTOP_SHELL_IPC_CHANNELS = {
  openExternal: 'shell:open-external',
  listExternalOpenTargets: 'shell:list-external-open-targets',
  openPathWithTarget: 'shell:open-path-with-target',
  revealPathInFolder: 'shell:reveal-path-in-folder',
} as const satisfies typeof import('@pidex/shared/desktop-shell-ipc').DESKTOP_SHELL_IPC_CHANNELS

const DESKTOP_CLIPBOARD_IPC_CHANNELS = {
  writeText: 'clipboard:write-text',
  writeRichText: 'clipboard:write-rich-text',
  copyProviderApiKey: 'clipboard:copy-provider-api-key',
} as const satisfies typeof import('@pidex/shared/desktop-clipboard-ipc').DESKTOP_CLIPBOARD_IPC_CHANNELS

const DESKTOP_STARTUP_IPC_CHANNELS = {
  openLogs: 'startup:open-logs',
  quit: 'startup:quit',
  stopBackendAndExit: 'startup:stop-backend-and-exit',
} as const satisfies typeof import('@pidex/shared/desktop-startup-ipc').DESKTOP_STARTUP_IPC_CHANNELS

const DESKTOP_APPEARANCE_IPC_CHANNELS = {
  getSettings: 'appearance:settings:get',
  saveSettings: 'appearance:settings:save',
  getSystemTheme: 'appearance:system-theme:get',
  getStartupThemeSeed: 'appearance:startup-theme-seed:get',
  systemThemeChanged: 'appearance:system-theme:changed',
  canRestorePreviousAppearance: 'appearance:previous-appearance:can-restore',
  restorePreviousAppearance: 'appearance:previous-appearance:restore',
  applyNewDesignTheme: 'appearance:new-design-theme:apply',
} as const satisfies typeof import('@pidex/shared/desktop-appearance-ipc').DESKTOP_APPEARANCE_IPC_CHANNELS

applyStartupThemeSeed(
  ipcRenderer.sendSync(DESKTOP_APPEARANCE_IPC_CHANNELS.getStartupThemeSeed) as unknown,
)

const DESKTOP_DEEP_LINK_IPC_CHANNELS = {
  consumePending: 'desktop-deep-link:consume-pending',
  activated: 'desktop-deep-link:activated',
} as const satisfies typeof import('@pidex/shared/desktop-deep-link-ipc').DESKTOP_DEEP_LINK_IPC_CHANNELS

function isDesktopNotificationActivation(value: unknown): value is DesktopNotificationActivation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const activation = value as Record<string, unknown>
  return (
    isNotificationIdentifier(activation.notificationId) &&
    isNotificationIdentifier(activation.threadId)
  )
}

function isNotificationIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

const DESKTOP_THREAD_DEEP_LINK_ID_MAX_LENGTH = 512

function normalizeDesktopThreadDeepLinkPayload(
  value: unknown,
): DesktopThreadDeepLinkPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const payload = value as Record<string, unknown>
  if (typeof payload.threadId !== 'string') return null
  const threadId = payload.threadId
  if (threadId.trim().length < 1) return null
  if (threadId.length > DESKTOP_THREAD_DEEP_LINK_ID_MAX_LENGTH) return null
  return { threadId }
}

type SystemThemeVariant = 'light' | 'dark'
const pendingComposerDropPaths = new Set<string>()

const desktop = {
  performDesktopBrowserAnnotation: (
    input: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationInput,
  ): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationResult> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.annotation, input),
  onDesktopBrowserAnnotationEvent: (
    listener: (
      event: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationEvent,
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserAnnotationEvent,
    ) => listener(value)
    ipcRenderer.on(DESKTOP_BROWSER_IPC_CHANNELS.annotationEvent, handler)
    return () => ipcRenderer.removeListener(DESKTOP_BROWSER_IPC_CHANNELS.annotationEvent, handler)
  },
  listDesktopBrowserTabs: (): Promise<DesktopBrowserSnapshot[]> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.list),
  performDesktopBrowserUtility: (
    input: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtilityInput,
  ): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtilityResult> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.utility, input),
  manageDesktopBrowserData: (
    input: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserDataRequest,
  ): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserDataResult> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.data, input),
  onDesktopBrowserUtilityEvent: (
    listener: (
      event: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtilityEvent,
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: import('@pidex/shared/desktop-browser-ipc').DesktopBrowserUtilityEvent,
    ) => listener(value)
    ipcRenderer.on(DESKTOP_BROWSER_IPC_CHANNELS.utilityEvent, handler)
    return () => ipcRenderer.removeListener(DESKTOP_BROWSER_IPC_CHANNELS.utilityEvent, handler)
  },
  onDesktopBrowserDataChange: (listener: () => void): (() => void) => {
    const handler = () => listener()
    ipcRenderer.on(DESKTOP_BROWSER_IPC_CHANNELS.dataChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_BROWSER_IPC_CHANNELS.dataChanged, handler)
  },
  attachDesktopBrowserGuest: (input: {
    tabId: string
    generation: string
    guestId: number
  }): Promise<void> => ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.attach, input),
  controlDesktopBrowser: (input: {
    tabId: string
    threadId: string | null
  }): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.control, input),
  layoutDesktopBrowser: (input: {
    tabId: string
    panel: 'right' | 'bottom'
    order: number
  }): Promise<void> => ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.layout, input),
  setDesktopBrowserPermission: (input: {
    origin: string
    decision: 'allow' | 'deny' | 'remove'
  }): Promise<import('@pidex/shared/desktop-browser-ipc').DesktopBrowserSitePermission[]> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.permission, input),
  getDesktopBrowserState: (input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.getState, input),
  createOrRestoreDesktopBrowser: (
    input: CreateOrRestoreDesktopBrowserInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.createOrRestore, input),
  navigateDesktopBrowser: (input: NavigateDesktopBrowserInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.navigate, input),
  reloadDesktopBrowser: (input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.reload, input),
  stopDesktopBrowser: (input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.stop, input),
  goBackDesktopBrowser: (input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.goBack, input),
  goForwardDesktopBrowser: (input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.goForward, input),
  setDesktopBrowserBounds: (input: SetDesktopBrowserBoundsInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.setBounds, input),
  setDesktopBrowserVisible: (
    input: SetDesktopBrowserVisibleInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.setVisible, input),
  focusDesktopBrowser: (input: DesktopBrowserTabInput): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.focus, input),
  closeDesktopBrowser: (input: DesktopBrowserTabInput): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.close, input),
  clearDesktopBrowserAllowedSites: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.clearAllowedSites, input),
  onDesktopBrowserStateChange: (
    listener: (state: DesktopBrowserSnapshot) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      if (isDesktopBrowserSnapshot(state)) listener(state)
    }
    ipcRenderer.on(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged, handler)
  },
  openMicrophonePrivacySettings: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_MICROPHONE_IPC_CHANNELS.openPrivacySettings),
  setProviderWebsiteIcon: (
    input: import('@pidex/shared/desktop-provider-icon-ipc').DesktopProviderWebsiteIconInput,
  ): Promise<import('@pidex/shared/desktop-provider-icon-ipc').DesktopProviderIconResolution> =>
    ipcRenderer.invoke(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.website, input),
  resolveProviderIcon: (
    input: import('@pidex/shared/desktop-provider-icon-ipc').DesktopProviderIconResolveInput,
  ): Promise<import('@pidex/shared/desktop-provider-icon-ipc').DesktopProviderIconResolution> =>
    ipcRenderer.invoke(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.resolve, input),
  onProviderIconChange: (
    listener: (
      change: import('@pidex/shared/desktop-provider-icon-ipc').DesktopProviderIconChange,
    ) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      change: import('@pidex/shared/desktop-provider-icon-ipc').DesktopProviderIconChange,
    ): void => listener(change)
    ipcRenderer.on(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.changed, handler)
    return () => ipcRenderer.removeListener(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.changed, handler)
  },
  saveAttachmentToDownloads: (
    input: DesktopAttachmentSaveInput,
  ): Promise<DesktopAttachmentSaveResult> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.saveToDownloads, input),
  chooseComposerFiles: (): Promise<DesktopComposerPathGrant[]> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.chooseComposerFiles),
  grantComposerPaths: (paths: readonly string[]): Promise<DesktopComposerPathGrant[]> => {
    if (
      !Array.isArray(paths) ||
      paths.some((path) => typeof path !== 'string' || !pendingComposerDropPaths.has(path))
    ) {
      return Promise.reject(new Error('本地文件未通过拖放或粘贴选择'))
    }
    for (const path of paths) pendingComposerDropPaths.delete(path)
    return ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.grantComposerPaths, paths)
  },
  getPathForFile: (file: File): string => {
    const path = webUtils.getPathForFile(file)
    if (path) pendingComposerDropPaths.add(path)
    return path
  },
  readComposerPathGrant: (
    input: DesktopComposerPathReadInput,
  ): Promise<DesktopComposerPathPreview> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.readComposerPathGrant, input),
  listComposerPathGrant: (
    input: DesktopComposerPathListInput,
  ): Promise<DesktopComposerPathListResult> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.listComposerPathGrant, input),
  openWindow: (input: DesktopOpenWindowInput): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.openWindow, input),
  minimize: (): Promise<void> => ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.minimize),
  toggleMaximize: (): Promise<boolean> =>
    ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.toggleMaximize),
  close: (): Promise<void> => ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.close),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.isMaximized),
  getPageZoom: (): Promise<DesktopPageZoomState> =>
    ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.getPageZoom),
  changePageZoom: (action: DesktopPageZoomAction): Promise<DesktopPageZoomState> =>
    ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.changePageZoom, action),
  onPageZoomChanged: (listener: (state: DesktopPageZoomState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      if (isDesktopPageZoomState(state)) listener(state)
    }
    ipcRenderer.on(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged, handler)
  },
  onWindowResizeStateChanged: (listener: (resizing: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, resizing: unknown): void => {
      if (typeof resizing === 'boolean') listener(resizing)
    }
    ipcRenderer.on(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged, handler)
    return () => ipcRenderer.removeListener(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged, handler)
  },
  onWindowResizeActivity: (listener: (activity: DesktopResizeActivity) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activity: unknown): void => {
      if (isDesktopResizeActivity(activity)) listener(activity)
    }
    ipcRenderer.on(DESKTOP_WINDOW_IPC_CHANNELS.resizeActivity, handler)
    return () => ipcRenderer.removeListener(DESKTOP_WINDOW_IPC_CHANNELS.resizeActivity, handler)
  },
  pickWorkspaceDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(DESKTOP_WORKSPACE_IPC_CHANNELS.pickDirectory),
  pickWorkspaceDirectories: (): Promise<string[]> =>
    ipcRenderer.invoke(DESKTOP_WORKSPACE_IPC_CHANNELS.pickDirectories),
  getDataLocation: () => ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.get),
  chooseDataLocation: (workspaceRoots?: readonly string[]) =>
    ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.choose, workspaceRoots),
  retryDataLocation: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.retry),
  restoreDataLocation: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.restore),
  performEditAction: (action: DesktopEditAction): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_EDIT_IPC_CHANNELS.perform, action),
  getDesktopSettings: (): Promise<DesktopSettingsPayload> =>
    ipcRenderer.invoke(DESKTOP_SETTINGS_IPC_CHANNELS.get),
  saveDesktopSettings: (settings: DesktopSettingsPayload): Promise<DesktopSettingsPayload> =>
    ipcRenderer.invoke(DESKTOP_SETTINGS_IPC_CHANNELS.save, settings),
  onDesktopSettingsChange: (listener: (settings: DesktopSettingsPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: unknown): void => {
      if (isRecord(settings)) listener(settings as DesktopSettingsPayload)
    }
    ipcRenderer.on(DESKTOP_SETTINGS_IPC_CHANNELS.changed, handler)
    return () => ipcRenderer.removeListener(DESKTOP_SETTINGS_IPC_CHANNELS.changed, handler)
  },
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(DESKTOP_UPDATE_IPC_CHANNELS.check),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(DESKTOP_UPDATE_IPC_CHANNELS.download),
  quitAndInstall: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_UPDATE_IPC_CHANNELS.quitAndInstall),
  onUpdateStatusChange: (listener: (status: DesktopUpdateStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown): void => {
      if (isDesktopUpdateStatus(status)) listener(status)
    }
    ipcRenderer.on(DESKTOP_UPDATE_IPC_CHANNELS.status, handler)
    return () => ipcRenderer.removeListener(DESKTOP_UPDATE_IPC_CHANNELS.status, handler)
  },
  listTerminalProfiles: (): Promise<readonly DesktopTerminalProfile[]> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.listProfiles),
  ensureTerminal: (input: EnsureDesktopTerminalInput): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.ensure, input),
  attachTerminal: (input: AttachDesktopTerminalInput): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.attach, input),
  writeTerminal: (input: WriteDesktopTerminalInput): void =>
    ipcRenderer.send(DESKTOP_TERMINAL_IPC_CHANNELS.write, input),
  resizeTerminal: (input: ResizeDesktopTerminalInput): void =>
    ipcRenderer.send(DESKTOP_TERMINAL_IPC_CHANNELS.resize, input),
  ackTerminalOutput: (input: AckDesktopTerminalOutputInput): void =>
    ipcRenderer.send(DESKTOP_TERMINAL_IPC_CHANNELS.ack, input),
  closeTerminal: (input: CloseDesktopTerminalInput): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.close, input),
  closeTerminalForThread: (
    input: CloseDesktopTerminalForThreadInput,
  ): Promise<{ closed: boolean }> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.closeThread, input),
  runTerminalAction: (input: RunDesktopTerminalActionInput): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.runAction, input),
  onTerminalEvent: (listener: (event: DesktopTerminalEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: unknown): void => {
      if (isDesktopTerminalEvent(event)) listener(event)
    }
    ipcRenderer.on(DESKTOP_TERMINAL_IPC_CHANNELS.event, handler)
    return () => ipcRenderer.removeListener(DESKTOP_TERMINAL_IPC_CHANNELS.event, handler)
  },
  writeClipboardText: (input: DesktopClipboardTextInput): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_CLIPBOARD_IPC_CHANNELS.writeText, input),
  writeClipboardRichText: (input: DesktopClipboardRichTextInput): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_CLIPBOARD_IPC_CHANNELS.writeRichText, input),
  copyProviderApiKey: (credentialId: string): Promise<DesktopSensitiveClipboardResult> =>
    ipcRenderer.invoke(DESKTOP_CLIPBOARD_IPC_CHANNELS.copyProviderApiKey, credentialId),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_SHELL_IPC_CHANNELS.openExternal, url),
  listExternalOpenTargets: (targetPath: string): Promise<DesktopExternalOpenTarget[]> =>
    ipcRenderer.invoke(DESKTOP_SHELL_IPC_CHANNELS.listExternalOpenTargets, targetPath),
  openPathWithTarget: (targetPath: string, targetId: string): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_SHELL_IPC_CHANNELS.openPathWithTarget, targetPath, targetId),
  revealPathInFolder: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_SHELL_IPC_CHANNELS.revealPathInFolder, targetPath),
  openLogDirectory: (): Promise<string> =>
    ipcRenderer.invoke(DESKTOP_STARTUP_IPC_CHANNELS.openLogs),
  quitDuringStartup: (): Promise<void> => ipcRenderer.invoke(DESKTOP_STARTUP_IPC_CHANNELS.quit),
  stopBackendAndExit: (): Promise<void> => ipcRenderer.invoke(DESKTOP_STARTUP_IPC_CHANNELS.stopBackendAndExit),
  getAppearanceSettings: (): Promise<DesktopThemeSettingsV7> =>
    ipcRenderer.invoke(DESKTOP_APPEARANCE_IPC_CHANNELS.getSettings),
  saveAppearanceSettings: (settings: DesktopThemeSettingsV7): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_APPEARANCE_IPC_CHANNELS.saveSettings, settings),
  canRestorePreviousAppearance: (): Promise<boolean> =>
    ipcRenderer.invoke(DESKTOP_APPEARANCE_IPC_CHANNELS.canRestorePreviousAppearance),
  restorePreviousAppearance: (): Promise<DesktopThemeSettingsV7> =>
    ipcRenderer.invoke(DESKTOP_APPEARANCE_IPC_CHANNELS.restorePreviousAppearance),
  applyNewDesignTheme: (): Promise<DesktopThemeSettingsV7> =>
    ipcRenderer.invoke(DESKTOP_APPEARANCE_IPC_CHANNELS.applyNewDesignTheme),
  getSystemTheme: (): Promise<SystemThemeVariant> =>
    ipcRenderer.invoke(DESKTOP_APPEARANCE_IPC_CHANNELS.getSystemTheme),
  onSystemThemeChange: (listener: (variant: SystemThemeVariant) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, variant: unknown) => {
      if (variant === 'light' || variant === 'dark') listener(variant)
    }
    ipcRenderer.on(DESKTOP_APPEARANCE_IPC_CHANNELS.systemThemeChanged, handler)
    return () =>
      ipcRenderer.removeListener(DESKTOP_APPEARANCE_IPC_CHANNELS.systemThemeChanged, handler)
  },
  openPetOverlay: (): Promise<void> => ipcRenderer.invoke(PET_OVERLAY_CHANNELS.open),
  hidePetOverlay: (): Promise<void> => ipcRenderer.invoke(PET_OVERLAY_CHANNELS.hide),
  getPetOverlayWindowState: () => ipcRenderer.invoke(PET_OVERLAY_CHANNELS.getState),
  previewPetPresentation: (presentation: DesktopPetPresentation): Promise<DesktopPetPresentation> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.previewPresentation, presentation),
  listSystemFonts: async (): Promise<DesktopSystemFontsResult> => {
    // Local Font Access (Chromium 103+). Only display metadata is returned;
    // font file paths, Blobs, and filesystem access never cross the bridge.
    const queryLocalFonts = (
      window as unknown as {
        queryLocalFonts?: () => Promise<readonly LocalFontMetadata[]>
      }
    ).queryLocalFonts
    if (typeof queryLocalFonts !== 'function') {
      return { ok: false, error: 'unsupported' }
    }
    try {
      const entries = await queryLocalFonts()
      if (!Array.isArray(entries)) return { ok: false, error: 'failed' }
      const seen = new Set<string>()
      const fonts: DesktopSystemFontFace[] = []
      for (const entry of entries) {
        const face = normalizeSystemFontFace(entry)
        if (!face) continue
        const key = `${face.family}\u0000${face.postscriptName}`
        if (seen.has(key)) continue
        seen.add(key)
        fonts.push(face)
      }
      fonts.sort(
        (left, right) =>
          left.family.localeCompare(right.family) ||
          left.fullName.localeCompare(right.fullName) ||
          left.postscriptName.localeCompare(right.postscriptName),
      )
      return { ok: true, fonts }
    } catch (error) {
      if (isRecord(error) && error.name === 'NotAllowedError') {
        return { ok: false, error: 'denied' }
      }
      return { ok: false, error: 'failed' }
    }
  },
  onPetPresentationPreview: (
    listener: (presentation: DesktopPetPresentation) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, presentation: unknown): void => {
      if (isPetPresentation(presentation)) listener(presentation)
    }
    ipcRenderer.on(PET_OVERLAY_CHANNELS.presentationPreview, handler)
    return () => ipcRenderer.removeListener(PET_OVERLAY_CHANNELS.presentationPreview, handler)
  },
  getPetGlobalPointerPosition: () =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.getGlobalPointerPosition),
  beginPetDrag: (): void => ipcRenderer.send(PET_OVERLAY_CHANNELS.beginDrag),
  updatePetDrag: (): void => ipcRenderer.send(PET_OVERLAY_CHANNELS.updateDrag),
  endPetDrag: (): void => ipcRenderer.send(PET_OVERLAY_CHANNELS.endDrag),
  setPetPointerPassthrough: (passthrough: boolean): void =>
    ipcRenderer.send(PET_OVERLAY_CHANNELS.setPointerPassthrough, passthrough),
  requestPetKeyboardFocus: (focused: boolean): Promise<void> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.requestKeyboardFocus, focused),
  openPetSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.openSession, sessionId),
  onPetOpenSession: (listener: (sessionId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: unknown) => {
      if (typeof sessionId === 'string') listener(sessionId)
    }
    ipcRenderer.on(PET_OVERLAY_CHANNELS.openSession, handler)
    return () => ipcRenderer.removeListener(PET_OVERLAY_CHANNELS.openSession, handler)
  },
  showDesktopNotification: (
    request: DesktopNotificationRequest,
  ): Promise<DesktopNotificationResult> =>
    ipcRenderer.invoke(DESKTOP_NOTIFICATION_IPC_CHANNELS.show, request),
  onDesktopNotificationActivated: (
    listener: (activation: DesktopNotificationActivation) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activation: unknown): void => {
      if (isDesktopNotificationActivation(activation)) listener(activation)
    }
    ipcRenderer.on(DESKTOP_NOTIFICATION_IPC_CHANNELS.activated, handler)
    return () => ipcRenderer.removeListener(DESKTOP_NOTIFICATION_IPC_CHANNELS.activated, handler)
  },
  consumePendingThreadDeepLink: async (): Promise<DesktopThreadDeepLinkPayload | null> => {
    const result: unknown = await ipcRenderer.invoke(DESKTOP_DEEP_LINK_IPC_CHANNELS.consumePending)
    if (result === null) return null
    const normalized = normalizeDesktopThreadDeepLinkPayload(result)
    if (normalized === null) return null
    return normalized
  },
  onThreadDeepLinkActivated: (
    listener: (payload: DesktopThreadDeepLinkPayload) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const normalized = normalizeDesktopThreadDeepLinkPayload(payload)
      if (normalized !== null) listener(normalized)
    }
    ipcRenderer.on(DESKTOP_DEEP_LINK_IPC_CHANNELS.activated, handler)
    return () => ipcRenderer.removeListener(DESKTOP_DEEP_LINK_IPC_CHANNELS.activated, handler)
  },
} satisfies DesktopPetOverlayBridge &
  DesktopSettingsIpcBridge &
  DesktopDataLocationIpcBridge &
  DesktopEditIpcBridge &
  DesktopUpdateIpcBridge &
  DesktopTerminalIpcBridge &
  DesktopNotificationIpcBridge &
  DesktopAttachmentIpcBridge &
  DesktopBrowserIpcBridge &
  DesktopMicrophoneIpcBridge &
  DesktopProviderIconIpcBridge &
  DesktopWindowIpcBridge &
  DesktopWorkspaceIpcBridge &
  DesktopShellIpcBridge &
  DesktopClipboardIpcBridge &
  DesktopStartupIpcBridge &
  DesktopAppearanceIpcBridge &
  DesktopDeepLinkIpcBridge &
  Record<string, unknown>

contextBridge.exposeInMainWorld('DesktopBridge', desktop)

function applyStartupThemeSeed(value: unknown): void {
  if (!isStartupThemeSeed(value)) return

  const applyToRoot = (root: HTMLElement): void => {
    root.dataset.theme = value.variant
    root.style.colorScheme = value.variant
    root.style.setProperty('--startup-splash-background', value.surface)
    root.style.setProperty('--startup-splash-foreground', value.ink)
  }
  const root = document.documentElement
  if (root) {
    applyToRoot(root)
  } else {
    const observer = new MutationObserver(() => {
      const nextRoot = document.documentElement
      if (!nextRoot) return
      applyToRoot(nextRoot)
      observer.disconnect()
    })
    observer.observe(document, { childList: true })
  }

  const updateThemeColor = (): void => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value.surface)
  }
  updateThemeColor()
  document.addEventListener('DOMContentLoaded', updateThemeColor, { once: true })
}

function isStartupThemeSeed(value: unknown): value is DesktopStartupThemeSeed {
  if (!isRecord(value)) return false
  return (
    value.version === 1 &&
    (value.variant === 'light' || value.variant === 'dark') &&
    isSixDigitHexColor(value.surface) &&
    isSixDigitHexColor(value.ink)
  )
}

function isSixDigitHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDesktopBrowserSnapshot(value: unknown): value is DesktopBrowserSnapshot {
  if (!isRecord(value)) return false
  return (
    isIdentifier(value.tabId) &&
    typeof value.open === 'boolean' &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    typeof value.loading === 'boolean' &&
    typeof value.canGoBack === 'boolean' &&
    typeof value.canGoForward === 'boolean' &&
    (value.error === null || typeof value.error === 'string') &&
    Array.isArray(value.allowedSites) &&
    value.allowedSites.every((site) => typeof site === 'string') &&
    Array.isArray(value.sitePermissions)
  )
}
type LocalFontMetadata = {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

function normalizeSystemFontFace(value: unknown): DesktopSystemFontFace | null {
  if (!isRecord(value)) return null
  const family = fontMetadataField(value.family, 200)
  const fullName = fontMetadataField(value.fullName, 200)
  const postscriptName = fontMetadataField(value.postscriptName, 200)
  if (!family || !fullName || !postscriptName) return null
  const style = typeof value.style === 'string' ? value.style.trim() : ''
  return {
    family,
    fullName,
    postscriptName,
    style: style.length > 0 && style.length <= 100 ? style : 'Regular',
  }
}

function fontMetadataField(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null
}

function isPetPresentation(value: unknown): value is DesktopPetPresentation {
  return (
    isRecord(value) &&
    (typeof value.selectedPetId === 'string' || value.selectedPetId === null) &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size)
  )
}

function isDesktopUpdateStatus(value: unknown): value is DesktopUpdateStatus {
  if (!isRecord(value) || typeof value.phase !== 'string') return false
  switch (value.phase) {
    case 'checking':
    case 'downloaded':
    case 'no-update':
      return true
    case 'available':
      return (
        typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 64
      )
    case 'downloading':
      return (
        typeof value.percent === 'number' &&
        Number.isFinite(value.percent) &&
        value.percent >= 0 &&
        value.percent <= 100
      )
    case 'error':
      return (
        typeof value.message === 'string' && value.message.length > 0 && value.message.length <= 200
      )
    default:
      return false
  }
}

function isDesktopPageZoomState(value: unknown): value is DesktopPageZoomState {
  return (
    isRecord(value) &&
    typeof value.percent === 'number' &&
    Number.isFinite(value.percent) &&
    value.percent >= 50 &&
    value.percent <= 200 &&
    typeof value.canZoomIn === 'boolean' &&
    typeof value.canZoomOut === 'boolean'
  )
}

function isDesktopTerminalEvent(value: unknown): value is DesktopTerminalEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'output') return isDesktopTerminalChunk(value.chunk)
  if (value.type !== 'state') return false
  return (
    isIdentifier(value.terminalId) &&
    isIdentifier(value.instanceId) &&
    isTerminalState(value.state) &&
    (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
    isTerminalExitReason(value.exitReason)
  )
}

function isDesktopTerminalChunk(value: unknown): boolean {
  return (
    isRecord(value) &&
    isIdentifier(value.terminalId) &&
    isIdentifier(value.instanceId) &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 0 &&
    typeof value.data === 'string' &&
    new TextEncoder().encode(value.data).byteLength <= 1_048_576
  )
}

/** 与 @pidex/shared/desktop-window-ipc 的校验保持一致（preload 不能运行时引用它）。 */
function isDesktopResizeActivity(value: unknown): value is DesktopResizeActivity {
  if (!isRecord(value)) return false
  if (Object.keys(value).length !== 3) return false
  return (
    Number.isSafeInteger(value.windowId) &&
    (value.phase === 'start' || value.phase === 'end') &&
    Number.isSafeInteger(value.revision)
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function isTerminalState(value: unknown): boolean {
  return ['starting', 'running', 'closing', 'exited', 'failed'].includes(String(value))
}

function isTerminalExitReason(value: unknown): boolean {
  return (
    value === null ||
    [
      'process-exit',
      'user-close',
      'task-close',
      'workspace-delete',
      'app-quit',
      'launch-failed',
    ].includes(String(value))
  )
}
