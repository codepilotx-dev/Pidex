import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_COMPOSITE_VIEWS,
  canViewFloat,
  type WorkbenchTabKind,
} from '../src/features/layout/dock/CompositeViews.js'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchPanelState,
  type WorkbenchTabDescriptor,
  type WorkbenchTabsState,
} from '../src/features/layout/dock/RightDockState.js'
import { AuxiliaryWindowService } from '../src/features/layout/auxiliary/AuxiliaryWindowService.js'

describe('Auxiliary Window (Phase 3) - View Floating Capabilities', () => {
  test('built-in views with floating capability allow floating; browser remains docked', () => {
    const floatableKinds: WorkbenchTabKind[] = [
      'terminal',
      'file-browser',
      'review',
      'file-preview',
      'plan',
      'side-chat',
      'side-task',
    ]

    for (const kind of floatableKinds) {
      expect(canViewFloat(kind)).toBe(true)
      expect(BUILTIN_COMPOSITE_VIEWS[kind].canFloat).toBe(true)
      expect(BUILTIN_COMPOSITE_VIEWS[kind].allowedLocations).toContain('floating')
    }
    expect(canViewFloat('browser')).toBe(false)
    expect(BUILTIN_COMPOSITE_VIEWS.browser.canFloat).toBe(false)
    expect(BUILTIN_COMPOSITE_VIEWS.browser.allowedLocations).toEqual(['right'])
  })
})

describe('Auxiliary Window (Phase 3) - State Machine Transitions', () => {
  function createState(): WorkbenchTabsState {
    const base = createDefaultWorkbenchPanelState()
    const terminalTab: WorkbenchTabDescriptor = {
      id: 'terminal',
      kind: 'terminal',
      title: '终端',
    }
    const reviewTab: WorkbenchTabDescriptor = {
      id: 'review',
      kind: 'review',
      title: '审查',
    }
    const fileBrowserTab: WorkbenchTabDescriptor = {
      id: 'file-browser',
      kind: 'file-browser',
      title: '打开文件',
    }

    return {
      ...base,
      right: {
        tabIds: ['review', 'file-browser'],
        activeTabId: 'review',
        open: true,
      },
      bottom: {
        tabIds: ['terminal'],
        activeTabId: 'terminal',
        open: true,
      },
      tabsById: {
        terminal: terminalTab,
        review: reviewTab,
        'file-browser': fileBrowserTab,
      },
      floatingTabIds: [],
    }
  }

  test('popOutTab moves tab from bottom panel into floatingTabIds and closes bottom panel when empty', () => {
    const initial = createState()
    const next = applyWorkbenchPanelAction(initial, {
      type: 'popOutTab',
      tabId: 'terminal',
    })

    // Removed from bottom
    expect(next.bottom.tabIds).toEqual([])
    expect(next.bottom.activeTabId).toBeNull()
    expect(next.bottom.open).toBe(false)

    // Added to floating
    expect(next.floatingTabIds).toEqual(['terminal'])
    // Descriptor preserved
    expect(next.tabsById.terminal).toBeDefined()
    expect(next.tabsById.terminal?.kind).toBe('terminal')
  })

  test('popOutTab from right panel switches activeTab and keeps panel open when other tabs remain', () => {
    const initial = createState()
    const next = applyWorkbenchPanelAction(initial, {
      type: 'popOutTab',
      tabId: 'review',
    })

    expect(next.right.tabIds).toEqual(['file-browser'])
    expect(next.right.activeTabId).toBe('file-browser')
    expect(next.right.open).toBe(true)
    expect(next.floatingTabIds).toEqual(['review'])
  })

  test('dockBackTab restores floating tab into its default location and activates it', () => {
    const initial = createState()
    const popped = applyWorkbenchPanelAction(initial, {
      type: 'popOutTab',
      tabId: 'terminal',
    })
    expect(popped.floatingTabIds).toContain('terminal')

    const docked = applyWorkbenchPanelAction(popped, {
      type: 'dockBackTab',
      tabId: 'terminal',
    })

    // Removed from floating
    expect(docked.floatingTabIds).toEqual([])
    // Restored to bottom panel (terminal default is bottom)
    expect(docked.bottom.tabIds).toContain('terminal')
    expect(docked.bottom.activeTabId).toBe('terminal')
    expect(docked.bottom.open).toBe(true)
  })

  test('dockBackTab restores floating tab into specified target panel', () => {
    const initial = createState()
    const popped = applyWorkbenchPanelAction(initial, {
      type: 'popOutTab',
      tabId: 'terminal',
    })

    // Dock back explicitly to sidebar
    const docked = applyWorkbenchPanelAction(popped, {
      type: 'dockBackTab',
      tabId: 'terminal',
      target: 'sidebar',
    })

    expect(docked.floatingTabIds).toEqual([])
    expect(docked.sidebar?.tabIds).toContain('terminal')
    expect(docked.sidebar?.activeTabId).toBe('terminal')
    expect(docked.sidebar?.open).toBe(true)
  })

  test('closing/removing a tab purges it from floatingTabIds', () => {
    const initial = createState()
    const popped = applyWorkbenchPanelAction(initial, {
      type: 'popOutTab',
      tabId: 'terminal',
    })
    expect(popped.floatingTabIds).toContain('terminal')

    const closed = applyWorkbenchPanelAction(popped, {
      type: 'closeTab',
      target: 'bottom',
      tabId: 'terminal',
    })

    expect(closed.floatingTabIds).toEqual([])
    expect(closed.tabsById.terminal).toBeUndefined()
  })
})

describe('Auxiliary Window (Phase 3) - AuxiliaryWindowService', () => {
  function createMockWindow() {
    const eventListeners = new Map<string, Set<EventListener>>()
    const mockDoc = {
      title: '',
      head: {
        querySelector: () => null,
        prepend: () => {},
        appendChild: () => {},
      },
      documentElement: {
        className: 'dark',
        getAttribute: () => null,
        setAttribute: () => {},
        removeAttribute: () => {},
        attributes: [],
      },
      body: {
        style: {} as any,
        appendChild: () => {},
      },
      createElement: (tag: string) => {
        return {
          tagName: tag.toUpperCase(),
          id: '',
          style: {} as any,
          href: '',
        }
      },
    }

    const mockWin = {
      closed: false,
      document: mockDoc,
      focusCalls: 0,
      closeCalls: 0,
      focus() {
        this.focusCalls++
      },
      close() {
        this.closed = true
        this.closeCalls++
      },
      addEventListener(type: string, listener: EventListener) {
        if (!eventListeners.has(type)) {
          eventListeners.set(type, new Set())
        }
        eventListeners.get(type)!.add(listener)
      },
      removeEventListener(type: string, listener: EventListener) {
        eventListeners.get(type)?.delete(listener)
      },
      _dispatch(type: string, ev: any = {}) {
        const set = eventListeners.get(type)
        if (set) {
          for (const listener of set) {
            listener(ev)
          }
        }
      },
    }

    return mockWin
  }

  test('manages open, focus, close, and closeAll lifecycle', () => {
    const mockWin = createMockWindow()

    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = {
      screenX: 100,
      screenY: 100,
      outerWidth: 1920,
      outerHeight: 1080,
      open: (_url: string, _target: string, _features: string) => mockWin as unknown as Window,
      addEventListener: () => {},
      removeEventListener: () => {},
    }

    try {
      const service = new AuxiliaryWindowService()
      expect(service.isFloating('terminal')).toBe(false)
      expect(service.getFloatingTabIds()).toEqual([])

      // Open terminal auxiliary window
      const entry = service.open('terminal', '集成终端')
      expect(entry).not.toBeNull()
      expect(entry?.tabId).toBe('terminal')
      expect(service.isFloating('terminal')).toBe(true)
      expect(service.getFloatingTabIds()).toEqual(['terminal'])
      expect(mockWin.document.title).toBe('集成终端 — Pidex Desktop')

      // Opening same tab again focuses existing window
      const second = service.open('terminal', '集成终端')
      expect(second).toBe(entry)
      expect(mockWin.focusCalls).toBe(1)

      // Close terminal auxiliary window
      service.close('terminal')
      expect(service.isFloating('terminal')).toBe(false)
      expect(mockWin.closed).toBe(true)
      expect(mockWin.closeCalls).toBe(1)
    } finally {
      ;(globalThis as any).window = originalWindow
    }
  })

  test('triggers onDockBackRequested callback when native child window is closed via unload', () => {
    const mockWin = createMockWindow()

    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = {
      screenX: 0,
      screenY: 0,
      outerWidth: 1280,
      outerHeight: 800,
      open: () => mockWin as unknown as Window,
      addEventListener: () => {},
      removeEventListener: () => {},
    }

    try {
      const service = new AuxiliaryWindowService()
      const dockBackCalls: string[] = []
      service.setDockBackHandler((tabId) => {
        dockBackCalls.push(tabId)
      })

      service.open('review', '代码审查')
      expect(service.isFloating('review')).toBe(true)

      // Simulate user closing the auxiliary window natively (cross button / Alt+F4)
      mockWin._dispatch('unload')

      expect(dockBackCalls).toEqual(['review'])
      expect(service.isFloating('review')).toBe(false)
    } finally {
      ;(globalThis as any).window = originalWindow
    }
  })
})
