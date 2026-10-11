import { describe, expect, test } from 'bun:test'
import { createAppMenuActions } from '../src/features/layout/shell/UseAppMenuActions.js'
import { createDesktopClient } from '../src/services/desktop-client/index.js'
import type { DesktopClientEnvironment } from '../src/services/desktop-client/Types.js'

type Options = Parameters<typeof createAppMenuActions>[0]
type Actions = ReturnType<typeof createAppMenuActions>
type ClientBridge = NonNullable<NonNullable<DesktopClientEnvironment['window']>['DesktopBridge']>

function setup(overrides: Partial<Options> = {}) {
  const calls: unknown[] = []
  const record = (value: unknown) => {
    calls.push(value)
  }
  const bridge = {
    pickWorkspaceDirectory: async () => null,
    close: async () => record('close'),
    openWindow: async (input) => record(input),
    quitDuringStartup: async () => record('quit'),
    minimize: async () => record('minimize'),
    toggleMaximize: async () => {
      record('maximize')
      return true
    },
    changePageZoom: async (direction) => {
      record(direction)
      return { percent: 100, canZoomIn: true, canZoomOut: true }
    },
  } satisfies ClientBridge
  const client = createDesktopClient({ window: { DesktopBridge: bridge } })
  const actions = createAppMenuActions({
    client,
    bridge,
    browserAvailable: true,
    browserOpen: true,
    canNavigateBack: true,
    canNavigateForward: true,
    navigate: record,
    newChat: () => record('newChat'),
    openFolder: () => record('openFolder'),
    toggleSidebar: () => record('sidebar'),
    togglePanel: record,
    stepWorkspaceLayout: () => record('workspaceLayout'),
    openFiles: () => record('files'),
    openBrowser: () => record('browser'),
    reloadBrowser: () => record('reload'),
    navigateBack: () => record('back'),
    navigateForward: () => record('forward'),
    setMaximized: (value) => record({ maximized: value }),
    openWhatsNew: (element) => record({ restoreFocus: element }),
    onError: record,
    ...overrides,
  })
  return { actions, calls }
}

function key(key: string, init: KeyboardEventInit & { keyCode?: number } = {}): KeyboardEvent {
  // Bun has Event but no browser KeyboardEvent; use the real cancelable Event.
  return Object.assign(new Event('keydown', { cancelable: true }), {
    key,
    code: '',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...init,
  }) as KeyboardEvent
}

describe('application menu actions', () => {
  test('settings and help use the existing routes', () => {
    const { actions, calls } = setup()
    actions.onFileMenuAction('openSettings')
    for (const action of [
      'automations',
      'localEnvironments',
      'worktrees',
      'skills',
      'modelContextProtocol',
      'keyboardShortcuts',
    ] as const) {
      actions.onHelpMenuAction(action)
    }
    expect(calls).toEqual([
      '/settings/general',
      '/automations',
      '/settings/worktrees?tab=environments',
      '/settings/worktrees',
      '/settings/plugins?tab=skills',
      '/settings/plugins?tab=mcps',
      '/settings/shortcuts',
    ])
  })

  test('each shortcut and its menu item execute the same action exactly once', () => {
    const cases: Array<[KeyboardEvent, (actions: Actions) => void, unknown]> = [
      [key('n'), (a) => a.onFileMenuAction('newChat'), 'newChat'],
      [key('n', { shiftKey: true }), (a) => a.onFileMenuAction('newWindow'), { kind: 'home' }],
      [key('n', { altKey: true }), (a) => a.onFileMenuAction('quickChat'), '/new'],
      [key('o'), (a) => a.onFileMenuAction('openFolder'), 'openFolder'],
      [key('w'), (a) => a.onFileMenuAction('close'), 'close'],
      [key(','), (a) => a.onFileMenuAction('openSettings'), '/settings/general'],
      [key('m'), (a) => a.onWindowMenuAction('minimize'), 'minimize'],
      [key('r'), (a) => a.onViewMenuAction('reloadBrowserPage'), 'reload'],
      [key('b'), (a) => a.onViewMenuAction('toggleSidebar'), 'sidebar'],
      [key('j'), (a) => a.onViewMenuAction('toggleSidePanel'), 'workspaceLayout'],
      [
        key('b', { shiftKey: true }),
        (a) => a.onViewMenuAction('toggleSidePanel'),
        'workspaceLayout',
      ],
      [key('t'), (a) => a.onViewMenuAction('openBrowserTab'), 'browser'],
      [key('e', { shiftKey: true }), (a) => a.onViewMenuAction('toggleFileTree'), 'files'],
      [key('[', { code: 'BracketLeft' }), (a) => a.onViewMenuAction('back'), 'back'],
      [key(']', { code: 'BracketRight' }), (a) => a.onViewMenuAction('forward'), 'forward'],
      [
        key('?', { shiftKey: true, code: 'Slash' }),
        (a) => a.onHelpMenuAction('keyboardShortcuts'),
        '/settings/shortcuts',
      ],
    ]
    for (const [event, click, expected] of cases) {
      const { actions, calls } = setup()
      click(actions)
      expect(calls).toEqual([expected])
      calls.length = 0
      actions.handleShortcut(event)
      expect(calls).toEqual([expected])
      expect(event.defaultPrevented).toBe(true)
    }
  })

  test('window actions reach the actual desktop client bridge', async () => {
    const { actions, calls } = setup()
    actions.onWindowMenuAction('zoom')
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['maximize', { maximized: true }])
    actions.onWindowMenuAction('close')
    actions.onFileMenuAction('exit')
    actions.onViewMenuAction('zoomIn')
    actions.onViewMenuAction('zoomOut')
    actions.onViewMenuAction('actualSize')
    expect(calls.slice(2)).toEqual(['close', 'quit', 'in', 'out', 'reset'])
  })

  test('unimplemented actions and missing window capabilities stay disabled', () => {
    const { actions, calls } = setup({
      bridge: undefined,
      canNavigateBack: false,
      canNavigateForward: false,
    })
    for (const action of [
      'find',
      'previousChat',
      'nextChat',
      'toggleFullScreen',
      'back',
      'forward',
      'zoomIn',
      'zoomOut',
      'actualSize',
    ] as const) {
      expect(actions.isViewActionEnabled(action)).toBe(false)
      actions.onViewMenuAction(action)
    }
    for (const action of [
      'pidexDocumentation',
      'troubleshooting',
      'sendFeedback',
      'startPerformanceTrace',
      'aboutPidex',
    ] as const) {
      expect(actions.isHelpActionEnabled(action)).toBe(false)
      actions.onHelpMenuAction(action)
    }
    for (const action of ['close', 'newWindow', 'exit', 'logOut'] as const) {
      expect(actions.isFileActionEnabled(action)).toBe(false)
      actions.onFileMenuAction(action)
    }
    for (const action of ['close', 'minimize', 'zoom'] as const) {
      expect(actions.isWindowActionEnabled(action)).toBe(false)
      actions.onWindowMenuAction(action)
    }
    for (const event of [
      key('w'),
      key('m'),
      key('n', { shiftKey: true }),
      key('f'),
      key('[', { code: 'BracketLeft' }),
    ]) {
      actions.handleShortcut(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(calls).toEqual([])
  })

  test('browser reload requires capability and an open page for clicks and shortcuts', () => {
    for (const [browserAvailable, browserOpen] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ]) {
      const { actions, calls } = setup({ browserAvailable, browserOpen })
      const enabled = browserAvailable && browserOpen
      expect(actions.isViewActionEnabled('openBrowserTab')).toBe(browserAvailable)
      expect(actions.isViewActionEnabled('reloadBrowserPage')).toBe(enabled)
      actions.onViewMenuAction('reloadBrowserPage')
      const event = key('r')
      actions.handleShortcut(event)
      expect(calls).toEqual(enabled ? ['reload', 'reload'] : [])
      expect(event.defaultPrevented).toBe(enabled)
    }
  })

  test('ignores handled, composing, repeating and unrelated modifier keys', () => {
    const { actions, calls } = setup()
    const handled = key('n')
    handled.preventDefault()
    for (const event of [
      handled,
      key('n', { isComposing: true }),
      key('n', { keyCode: 229 }),
      key('n', { repeat: true }),
      key('n', { ctrlKey: false }),
      key('n', { metaKey: true }),
      key('n', { shiftKey: true, altKey: true }),
    ]) {
      actions.handleShortcut(event)
    }
    expect(calls).toEqual([])
  })
})
