import { describe, expect, test } from 'bun:test'
import type {
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
} from '@pidex/shared/desktop-browser-ipc'
import { createDesktopBrowserClient } from '../src/services/desktop-client/DesktopBrowserClient.js'

const snapshot = (overrides: Partial<DesktopBrowserSnapshot> = {}): DesktopBrowserSnapshot => ({
  tabId: 'tab:one',
  open: true,
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  allowedSites: [],
  sitePermissions: [],
  ...overrides,
})

describe('desktop browser client', () => {
  test('delegates an explicit browser tab and forwards state events', async () => {
    const calls: unknown[] = []
    let stateListener: ((state: DesktopBrowserSnapshot) => void) | null = null
    const bridge = {
      performDesktopBrowserAnnotation: async () => ({}),
      onDesktopBrowserAnnotationEvent: () => () => {},
      performDesktopBrowserUtility: async () => ({}),
      manageDesktopBrowserData: async () => ({}),
      onDesktopBrowserUtilityEvent: () => () => {},
      onDesktopBrowserDataChange: () => () => {},
      listDesktopBrowserTabs: async () => [snapshot()],
      attachDesktopBrowserGuest: async () => {},
      controlDesktopBrowser: async () => snapshot(),
      layoutDesktopBrowser: async () => {},
      setDesktopBrowserPermission: async () => [],
      getDesktopBrowserState: async (input) => (calls.push(input), snapshot()),
      createOrRestoreDesktopBrowser: async (input) => (calls.push(input), snapshot()),
      navigateDesktopBrowser: async (input) => (calls.push(input), snapshot({ url: input.url })),
      reloadDesktopBrowser: async () => snapshot(),
      stopDesktopBrowser: async () => snapshot({ loading: false }),
      goBackDesktopBrowser: async () => snapshot(),
      goForwardDesktopBrowser: async () => snapshot(),
      setDesktopBrowserBounds: async (input) => (calls.push(input), snapshot()),
      setDesktopBrowserVisible: async (input) => (calls.push(input), snapshot()),
      focusDesktopBrowser: async (input) => {
        calls.push(input)
      },
      closeDesktopBrowser: async () => snapshot({ open: false }),
      clearDesktopBrowserAllowedSites: async () => snapshot(),
      onDesktopBrowserStateChange: (listener) => {
        stateListener = listener
        return () => {
          stateListener = null
        }
      },
    } satisfies DesktopBrowserIpcBridge
    const root = createDesktopBrowserClient(bridge)
    const client = root.forTab('tab:one')
    const events: string[] = []
    const unsubscribe = client.onBrowserStateChange((state) => events.push(state.url))

    expect(client.available).toBe(true)
    await client.openBrowser()
    await client.navigateBrowser('https://openai.com/')
    await client.setBrowserVisible(false)
    await client.focusBrowser()
    stateListener?.(snapshot({ url: 'https://event.example/' }))
    unsubscribe()

    expect(calls).toEqual([
      { tabId: 'tab:one', sourceThreadId: null },
      { tabId: 'tab:one', url: 'https://openai.com/' },
      { tabId: 'tab:one', visible: false },
      { tabId: 'tab:one' },
    ])
    expect(events.at(-1)).toBe('https://event.example/')
    expect(root.getTab('tab:one')?.url).toBe('https://event.example/')
  })

  test('reports unavailable instead of succeeding with an Electron mock', async () => {
    const client = createDesktopBrowserClient()
    expect(client.available).toBe(false)
    await expect(client.openBrowser()).rejects.toThrow('仅在连接 Agent 的 Pidex 桌面应用中可用')
  })
})
