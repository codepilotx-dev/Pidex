import { useEffect } from 'react'
import type {
  FileMenuAction,
  HelpMenuAction,
  ViewMenuAction,
  WindowMenuAction,
} from '../MenuBar.js'
import type { DesktopClient } from '../../../services/desktop-client/Types.js'

type Action = () => void | Promise<unknown>
type Options = {
  client: Pick<
    DesktopClient,
    'closeWindow' | 'newWindow' | 'exitApp' | 'minimizeWindow' | 'toggleWindowMaximized'
  >
  bridge:
    | Partial<
        Pick<
          NonNullable<Window['DesktopBridge']>,
          | 'close'
          | 'openWindow'
          | 'minimize'
          | 'toggleMaximize'
          | 'changePageZoom'
          | 'quitDuringStartup'
        >
      >
    | undefined
  browserAvailable: boolean
  browserOpen: boolean
  canNavigateBack: boolean
  canNavigateForward: boolean
  navigate: (path: string) => void
  newChat: Action
  openFolder: Action
  toggleSidebar: Action
  togglePanel: (panel: 'bottom' | 'right') => void
  /** 右工作区三态步进；菜单、快捷键与外壳按钮共用同一动作。 */
  stepWorkspaceLayout: Action
  openFiles: Action
  openBrowser: Action
  reloadBrowser: Action
  navigateBack: Action
  navigateForward: Action
  setMaximized: (value: boolean) => void
  openWhatsNew: (restoreFocusElement: HTMLElement | null) => void
  onError: (message: string) => void
}

export function createAppMenuActions(options: Options) {
  const { bridge, client } = options
  const file: Record<FileMenuAction, Action | undefined> = {
    close: bridge?.close ? () => client.closeWindow() : undefined,
    newWindow: bridge?.openWindow ? () => client.newWindow() : undefined,
    newChat: options.newChat,
    quickChat: () => options.navigate('/new'),
    openFolder: options.openFolder,
    openSettings: () => options.navigate('/settings/general'),
    logOut: undefined,
    exit: bridge?.quitDuringStartup ? () => client.exitApp() : undefined,
  }
  const view: Record<ViewMenuAction, Action | undefined> = {
    toggleSidebar: options.toggleSidebar,
    toggleBottomPanel: () => options.togglePanel('bottom'),
    toggleSidePanel: options.stepWorkspaceLayout,
    toggleFileTree: options.openFiles,
    openBrowserTab: options.browserAvailable ? options.openBrowser : undefined,
    reloadBrowserPage:
      options.browserAvailable && options.browserOpen ? options.reloadBrowser : undefined,
    back: options.canNavigateBack ? options.navigateBack : undefined,
    forward: options.canNavigateForward ? options.navigateForward : undefined,
    zoomIn: bridge?.changePageZoom ? () => bridge.changePageZoom?.('in') : undefined,
    zoomOut: bridge?.changePageZoom ? () => bridge.changePageZoom?.('out') : undefined,
    actualSize: bridge?.changePageZoom ? () => bridge.changePageZoom?.('reset') : undefined,
    find: undefined,
    previousChat: undefined,
    nextChat: undefined,
    toggleFullScreen: undefined,
  }
  const windowActions: Record<WindowMenuAction, Action | undefined> = {
    close: file.close,
    minimize: bridge?.minimize ? () => client.minimizeWindow() : undefined,
    zoom: bridge?.toggleMaximize
      ? async () => options.setMaximized(await client.toggleWindowMaximized())
      : undefined,
  }
  const help: Record<HelpMenuAction, Action | undefined> = {
    whatsNew: () => options.openWhatsNew(null),
    automations: () => options.navigate('/automations'),
    localEnvironments: () => options.navigate('/settings/worktrees?tab=environments'),
    worktrees: () => options.navigate('/settings/worktrees'),
    skills: () => options.navigate('/settings/plugins?tab=skills'),
    modelContextProtocol: () => options.navigate('/settings/plugins?tab=mcps'),
    keyboardShortcuts: () => options.navigate('/settings/shortcuts'),
    pidexDocumentation: undefined,
    troubleshooting: undefined,
    sendFeedback: undefined,
    startPerformanceTrace: undefined,
    aboutPidex: undefined,
  }
  function run(action: Action | undefined): void {
    if (!action) return
    try {
      void Promise.resolve(action()).catch(() => options.onError('无法完成菜单操作，请重试。'))
    } catch {
      options.onError('无法完成菜单操作，请重试。')
    }
  }
  return {
    isFileActionEnabled: (action: FileMenuAction) => Boolean(file[action]),
    isViewActionEnabled: (action: ViewMenuAction) => Boolean(view[action]),
    isWindowActionEnabled: (action: WindowMenuAction) => Boolean(windowActions[action]),
    isHelpActionEnabled: (action: HelpMenuAction) => Boolean(help[action]),
    onFileMenuAction: (action: FileMenuAction) => run(file[action]),
    onViewMenuAction: (action: ViewMenuAction) => run(view[action]),
    onWindowMenuAction: (action: WindowMenuAction) => run(windowActions[action]),
    onHelpMenuAction: (action: HelpMenuAction, restoreFocusElement?: HTMLElement | null) => {
      if (action === 'whatsNew') options.openWhatsNew(restoreFocusElement ?? null)
      else run(help[action])
    },
    handleShortcut: (event: KeyboardEvent): void => {
      if (
        !event.ctrlKey ||
        event.metaKey ||
        event.repeat ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      )
        return
      const key = event.key.toLowerCase()
      let action: Action | undefined
      if (event.altKey) {
        if (!event.shiftKey && key === 'n') action = file.quickChat
      } else if (event.shiftKey) {
        if (key === 'n') action = file.newWindow
        else if (key === 'e') action = view.toggleFileTree
        // Ctrl+Shift+B 与 Ctrl+J 走同一动作：Shift 分支必须显式处理，不能被 Ctrl+B 截获。
        else if (key === 'b') action = view.toggleSidePanel
        else if (event.code === 'Slash') action = help.keyboardShortcuts
      } else {
        switch (key) {
          case 'n':
            action = file.newChat
            break
          case 'o':
            action = file.openFolder
            break
          case 'w':
            action = file.close
            break
          case ',':
            action = file.openSettings
            break
          case 'm':
            action = windowActions.minimize
            break
          case 'r':
            action = view.reloadBrowserPage
            break
          case 'b':
            action = view.toggleSidebar
            break
          case 'j':
            action = view.toggleSidePanel
            break
          case 't':
            action = view.openBrowserTab
            break
        }
        if (event.code === 'BracketLeft') action = view.back
        else if (event.code === 'BracketRight') action = view.forward
      }
      if (action) {
        event.preventDefault()
        run(action)
      }
    },
  }
}

export function useAppMenuActions(options: Options) {
  const actions = createAppMenuActions(options)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) return
      if (
        event.target instanceof Element &&
        event.target.closest('[data-terminal-keyboard-capture]')
      )
        return
      actions.handleShortcut(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actions])
  return actions
}
