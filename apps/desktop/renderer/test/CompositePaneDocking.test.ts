import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_COMPOSITE_VIEWS,
  getAvailableMoveTargets,
  isViewAllowedAtLocation,
  panelTargetDisplayName,
} from '../src/features/layout/dock/CompositeViews.js'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchPanelState,
  type WorkbenchTabDescriptor,
  type WorkbenchTabsState,
} from '../src/features/layout/dock/RightDockState.js'

describe('composite views registry and rules', () => {
  test('registers all canonical built-in workbench views', () => {
    expect(BUILTIN_COMPOSITE_VIEWS['file-browser'].id).toBe('workbench.view.fileBrowser')
    expect(BUILTIN_COMPOSITE_VIEWS.terminal.id).toBe('workbench.view.terminal')
    expect(BUILTIN_COMPOSITE_VIEWS.review.id).toBe('workbench.view.review')
    expect(BUILTIN_COMPOSITE_VIEWS.browser.id).toBe('workbench.view.browser')
    expect(BUILTIN_COMPOSITE_VIEWS.plan.id).toBe('workbench.view.plan')
  })

  test('validates location compatibility for dockable views', () => {
    // terminal can dock in sidebar, right, and bottom
    expect(isViewAllowedAtLocation('terminal', 'sidebar')).toBe(true)
    expect(isViewAllowedAtLocation('terminal', 'right')).toBe(true)
    expect(isViewAllowedAtLocation('terminal', 'bottom')).toBe(true)

    // file-browser can dock in sidebar and right, but bottom only allows terminal
    expect(isViewAllowedAtLocation('file-browser', 'sidebar')).toBe(true)
    expect(isViewAllowedAtLocation('file-browser', 'right')).toBe(true)
    expect(isViewAllowedAtLocation('file-browser', 'bottom')).toBe(false)

    // browser is restricted to right (cannot dock in sidebar or bottom)
    expect(isViewAllowedAtLocation('browser', 'sidebar')).toBe(false)
    expect(isViewAllowedAtLocation('browser', 'right')).toBe(true)
    expect(isViewAllowedAtLocation('browser', 'bottom')).toBe(false)
  })

  test('generates available move targets excluding current location', () => {
    const fromBottom = getAvailableMoveTargets('bottom', 'terminal')
    expect(fromBottom).toContain('sidebar')
    expect(fromBottom).toContain('right')
    expect(fromBottom).not.toContain('bottom')

    const fromRight = getAvailableMoveTargets('right', 'terminal')
    expect(fromRight).toContain('sidebar')
    expect(fromRight).toContain('bottom')
    expect(fromRight).not.toContain('right')

    const fromSidebar = getAvailableMoveTargets('sidebar', 'terminal')
    expect(fromSidebar).toContain('right')
    expect(fromSidebar).toContain('bottom')
    expect(fromSidebar).not.toContain('sidebar')
  })

  test('formats human readable target names in UI', () => {
    expect(panelTargetDisplayName('sidebar')).toBe('侧边栏')
    expect(panelTargetDisplayName('right')).toBe('右侧栏')
    expect(panelTargetDisplayName('bottom')).toBe('下方面板')
  })
})

describe('three-way panel tab state machine (PaneComposite docking)', () => {
  const terminalTab: WorkbenchTabDescriptor = {
    id: 'terminal',
    kind: 'terminal',
  }

  const reviewTab: WorkbenchTabDescriptor = {
    id: 'review',
    kind: 'review',
  }

  const fileBrowserTab: WorkbenchTabDescriptor = {
    id: 'file-browser',
    kind: 'file-browser',
  }

  test('moves tab from right panel to sidebar', () => {
    let state = createDefaultWorkbenchPanelState()
    state = applyWorkbenchPanelAction(state, {
      type: 'openTab',
      target: 'right',
      tab: terminalTab,
    })

    expect(state.right.open).toBe(true)
    expect(state.right.tabIds).toEqual(['terminal'])
    expect(state.sidebar?.open).toBe(false)
    expect(state.sidebar?.tabIds).toEqual([])

    // Move to sidebar
    state = applyWorkbenchPanelAction(state, {
      type: 'moveTab',
      source: 'right',
      target: 'sidebar',
      tabId: 'terminal',
    })

    expect(state.right.open).toBe(false)
    expect(state.right.tabIds).toEqual([])
    expect(state.sidebar?.open).toBe(true)
    expect(state.sidebar?.activeTabId).toBe('terminal')
    expect(state.sidebar?.tabIds).toEqual(['terminal'])
    expect(state.focusArea).toBe('sidebar-panel')
  })

  test('moves tab from sidebar to bottom panel', () => {
    let state = createDefaultWorkbenchPanelState()
    state = applyWorkbenchPanelAction(state, {
      type: 'openTab',
      target: 'sidebar',
      tab: terminalTab,
    })

    expect(state.sidebar?.open).toBe(true)
    expect(state.sidebar?.tabIds).toEqual(['terminal'])

    // Move from sidebar to bottom
    state = applyWorkbenchPanelAction(state, {
      type: 'moveTab',
      source: 'sidebar',
      target: 'bottom',
      tabId: 'terminal',
    })

    expect(state.sidebar?.open).toBe(false)
    expect(state.sidebar?.tabIds).toEqual([])
    expect(state.bottom.open).toBe(true)
    expect(state.bottom.activeTabId).toBe('terminal')
    expect(state.bottom.tabIds).toEqual(['terminal'])
    expect(state.focusArea).toBe('bottom-panel')
  })

  test('re-opening an existing tab in sidebar activates its existing host', () => {
    let state = createDefaultWorkbenchPanelState()
    state = applyWorkbenchPanelAction(state, {
      type: 'openTab',
      target: 'sidebar',
      tab: fileBrowserTab,
    })

    // Try to open fileBrowserTab targeting 'right' — should activate 'sidebar' where it already lives
    state = applyWorkbenchPanelAction(state, {
      type: 'openTab',
      target: 'right',
      tab: fileBrowserTab,
    })

    expect(state.sidebar?.open).toBe(true)
    expect(state.sidebar?.activeTabId).toBe('file-browser')
    expect(state.right.tabIds).not.toContain('file-browser')
    expect(state.focusArea).toBe('sidebar-panel')
  })

  test('closing tab from sidebar closes the sidebar panel when empty', () => {
    let state = createDefaultWorkbenchPanelState()
    state = applyWorkbenchPanelAction(state, {
      type: 'openTab',
      target: 'sidebar',
      tab: reviewTab,
    })

    expect(state.sidebar?.open).toBe(true)

    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'sidebar',
      tabId: 'review',
    })

    expect(state.sidebar?.open).toBe(false)
    expect(state.sidebar?.tabIds).toEqual([])
    expect(state.tabsById.review).toBeUndefined()
    expect(state.focusArea).toBe('main')
  })

  test('supports backwards compatibility when initial state omits sidebar', () => {
    const legacyState: WorkbenchTabsState = {
      schemaVersion: 2,
      tabsById: {
        terminal: terminalTab,
      },
      right: {
        open: true,
        activeTabId: 'terminal',
        tabIds: ['terminal'],
      },
      bottom: {
        open: false,
        activeTabId: null,
        tabIds: [],
      },
      rightFullWidth: false,
      restoreRightFullWidthOnNextOpen: false,
      focusArea: 'right-panel',
    }

    // Move to sidebar even though legacyState.sidebar was undefined
    const updated = applyWorkbenchPanelAction(legacyState, {
      type: 'moveTab',
      source: 'right',
      target: 'sidebar',
      tabId: 'terminal',
    })

    expect(updated.sidebar?.open).toBe(true)
    expect(updated.sidebar?.tabIds).toEqual(['terminal'])
    expect(updated.right.open).toBe(false)
    expect(updated.right.tabIds).toEqual([])
  })
})
